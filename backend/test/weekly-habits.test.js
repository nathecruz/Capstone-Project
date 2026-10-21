// Habits last one week (Monday to Sunday) and stay as history: the rules the server applies.
// Dates: Monday October 12 to Sunday October 18, 2026 is "last week"; October 19 starts "this week".
import assert from 'node:assert/strict';
import test from 'node:test';
import { accountStreak, accountStreakRun } from '../services/account-streak.js';
import { buildHabitContext } from '../services/ai-context.js';
import { canStillCheckIn, secondsUntilCheckInCloses } from '../services/completion-date.js';
import { dailyChallenges } from '../services/daily-challenges.js';
import { habitStats } from '../services/habit-analysis.js';
import { habitActiveUntil, hasHabitEnded, isHabitActiveOn, weekEndKey, withActiveUntil } from '../services/habit-week.js';
import { buildTrainingRows } from '../services/ml-training-rows.js';
import { isHabitInWeek, weeklyQuests } from '../services/quests.js';
import { daysToFreeze } from '../services/streak-freeze.js';
import { computeStreak } from '../services/streaks.js';
import { awardAccountStreakMilestones } from '../services/wallet.js';
import { getDueHabitReminders, getWebPushSnoozeSettings } from '../services/web-push-reminders.js';
import { keepActiveUntil, stampActiveUntil, weeklyResetSnapshot } from '../services/weekly-reset.js';

const daily = (id, startDate, activeUntil, extra = {}) => ({ id, label: id, frequency: 'Daily', startDate, activeUntil, reminderDays: [], meta: 'Daily • Anytime', ...extra });
const lastWeek = (id, extra) => daily(id, '2026-10-12', '2026-10-18', extra);
const thisWeek = (id, extra) => daily(id, '2026-10-19', '2026-10-25', extra);
const days = (from, to) => {
  const list = [];
  for (let day = from; day <= to; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) list.push(day);
  return list;
};

test('a habit is active from its start date to the Sunday of its week', () => {
  assert.equal(weekEndKey('2026-10-14'), '2026-10-18');
  assert.equal(weekEndKey('2026-10-18'), '2026-10-18', 'Sunday ends the week');
  assert.equal(weekEndKey('2026-10-19'), '2026-10-25');
  assert.equal(habitActiveUntil('2026-10-01', '2026-10-14'), '2026-10-18', 'a past start date: this week');
  assert.equal(habitActiveUntil('2026-10-21', '2026-10-14'), '2026-10-25', 'a later start date: the week it starts in');
  assert.equal(habitActiveUntil('', '2026-10-14'), '2026-10-18');

  const habit = lastWeek('read');
  assert.deepEqual(['2026-10-11', '2026-10-12', '2026-10-18', '2026-10-19'].map((day) => isHabitActiveOn(habit, day)), [false, true, true, false]);
  assert.equal(isHabitActiveOn({}, '2026-10-19'), true, 'a habit not stamped yet has no end');
  assert.deepEqual([hasHabitEnded(habit, '2026-10-18'), hasHabitEnded(habit, '2026-10-19'), hasHabitEnded({}, '2030-01-01')], [false, true, false]);
  assert.equal(computeStreak(habit, days('2026-10-14', '2026-10-18'), '2026-10-22'), 5, "an ended habit keeps its last day's streak");
});

test('habits without a last active day get the end of their week, in their time zone', () => {
  // Sunday October 18, 8 PM UTC: already Monday in Manila, still Sunday in Los Angeles.
  const now = new Date('2026-10-18T20:00:00Z');
  const state = { habits: [{ id: 'a' }, { id: 'b', activeUntil: '2026-10-11' }, { id: 'c', startDate: '2026-10-28' }, { id: 'd', completionTimeZone: 'America/Los_Angeles' }] };
  const stamped = withActiveUntil(state, now);
  assert.deepEqual(stamped.habits.map((habit) => habit.activeUntil), ['2026-10-25', '2026-10-11', '2026-11-01', '2026-10-18']);
  assert.equal(withActiveUntil(stamped, now), stamped, 'nothing to stamp: the same state');
});

test('a saved habit keeps the last active day the server gave it', () => {
  const now = new Date('2026-10-20T04:00:00Z');
  const current = { habits: [{ id: 'old', activeUntil: '2026-10-11' }, { id: 'kept', activeUntil: '2026-10-25' }] };
  // An older app version sends the habits without the field, and a new habit.
  const incoming = { habits: [{ id: 'old' }, { id: 'kept', activeUntil: '2026-11-01' }, { id: 'new' }] };
  assert.deepEqual(keepActiveUntil(incoming, current).habits.map((habit) => habit.activeUntil), ['2026-10-11', '2026-11-01', undefined]);
  assert.equal(keepActiveUntil(incoming, { habits: [] }), incoming, 'nothing stored: the same state');
  assert.deepEqual(stampActiveUntil(incoming, current, now).habits.map((habit) => habit.activeUntil), ['2026-10-11', '2026-11-01', '2026-10-25'], 'an ended habit is not moved into this week');
  assert.deepEqual(stampActiveUntil(incoming, null, now).habits.map((habit) => habit.activeUntil), ['2026-10-25', '2026-11-01', '2026-10-25']);
});

test('the one-time migration stamps a snapshot as a newer one, or leaves it', () => {
  const now = Date.parse('2026-10-20T04:00:00Z');
  const latest = { state: { habits: [{ id: 'a', startDate: '2026-09-01', completionDates: ['2026-10-19'] }, { id: 'b', activeUntil: '2026-10-11' }], points: 20 }, updatedAt: now - 60_000 };
  const stamped = weeklyResetSnapshot(latest, now);
  assert.deepEqual(stamped.state.habits.map((habit) => habit.activeUntil), ['2026-10-25', '2026-10-11']);
  assert.deepEqual(stamped.state.habits[0].completionDates, ['2026-10-19'], 'check-ins are kept');
  assert.equal(stamped.state.points, 20);
  assert.equal(stamped.updatedAt, now);
  assert.equal(weeklyResetSnapshot({ ...latest, updatedAt: now + 5000 }, now).updatedAt, now + 5001, 'always newer than the snapshot it replaces');
  assert.equal(weeklyResetSnapshot({ state: stamped.state, updatedAt: now }, now), null, 'already stamped: nothing to save');
  assert.equal(weeklyResetSnapshot(null, now), null);
});

test('the account streak counts days with any check-in, across weeks', () => {
  const today = '2026-10-20';
  const done = (habit, dates) => ({ ...habit, completionDates: dates });
  assert.deepEqual(accountStreakRun([done(lastWeek('w'), days('2026-10-14', '2026-10-18')), done(thisWeek('t'), ['2026-10-19', '2026-10-20'])], today), { streak: 7, start: '2026-10-14' });
  assert.equal(accountStreak([done(lastWeek('w'), days('2026-10-14', '2026-10-18')), done(thisWeek('t'), ['2026-10-19'])], today), 6, 'an unfinished today does not break it');
  const missed = done(lastWeek('w'), ['2026-10-14', '2026-10-16', '2026-10-17', '2026-10-18']);
  assert.equal(accountStreak([missed, done(thisWeek('t'), ['2026-10-19', '2026-10-20'])], today), 5, 'a due day with no check-in breaks it');
  assert.equal(accountStreak([missed, done(thisWeek('t'), ['2026-10-19', '2026-10-20'])], today, ['2026-10-15']), 6, 'a frozen day does not');
  assert.equal(accountStreak([done(lastWeek('w'), days('2026-10-12', '2026-10-18'))], '2026-10-21'), 7, 'the days after a habit ended are never missed');
});

test('a check-in is closed after the habit\'s week, and so are its reminders and snoozes', () => {
  const habit = lastWeek('read', { reminderEnabled: true, reminderTime: '08:30 AM', completionDates: [] });
  assert.equal(canStillCheckIn(habit, '2026-10-18', 'UTC', new Date('2026-10-18T08:00:00Z')), true);
  assert.equal(canStillCheckIn(habit, '2026-10-19', 'UTC', new Date('2026-10-19T08:00:00Z')), false, 'the next Monday');
  assert.equal(secondsUntilCheckInCloses(habit, '2026-10-19', 'UTC', new Date('2026-10-19T08:00:00Z')), 0);
  assert.ok(secondsUntilCheckInCloses(habit, '2026-10-18', 'UTC', new Date('2026-10-18T08:00:00Z')) > 0);

  assert.deepEqual(getDueHabitReminders(habit, 'UTC', new Date('2026-10-18T08:30:00Z')), [{ date: '2026-10-18', time: '08:30' }]);
  assert.deepEqual(getDueHabitReminders(habit, 'UTC', new Date('2026-10-19T08:30:00Z')), [], 'no reminder once the week has ended');
  assert.deepEqual(getDueHabitReminders({ ...habit, activeUntil: undefined }, 'UTC', new Date('2026-10-19T08:30:00Z')), [{ date: '2026-10-19', time: '08:30' }], 'not stamped yet: no end');

  const state = { habits: [habit], snoozeFrequency: '2', ringInterval: 10 };
  assert.equal(getWebPushSnoozeSettings(state, 'read', 0, '2026-10-19'), null, 'an ended habit is not snoozed');
  assert.equal(getWebPushSnoozeSettings(state, 'read', 0, '2026-10-18').intervalMinutes, 10);
  assert.ok(getWebPushSnoozeSettings(state, 'read', 0), 'without a day, only the settings are checked');
});

test('weekly quests count the habits that were active in that week', () => {
  const weekStart = '2026-10-19';
  assert.equal(isHabitInWeek(lastWeek('w'), weekStart), false, "last week's habit");
  assert.equal(isHabitInWeek(thisWeek('t'), weekStart), true);
  assert.equal(isHabitInWeek(daily('later', '2026-10-23', '2026-10-25'), weekStart), true, 'starts later this week');
  assert.equal(isHabitInWeek(daily('next', '2026-10-26', '2026-11-01'), weekStart), false, 'starts next week');
  assert.equal(isHabitInWeek({ id: 'old' }, weekStart), true, 'not stamped yet');
  assert.equal(isHabitInWeek(lastWeek('w'), '2026-10-12'), true, 'it still counts for its own week');

  const doneByDate = new Map([['2026-10-19', new Set(['a', 'b'])], ['2026-10-20', new Set(['a', 'b'])]]);
  const quests = weeklyQuests([lastWeek('w'), thisWeek('a'), thisWeek('b')], doneByDate, '2026-10-21');
  assert.equal(quests[0].target, 8, 'two habits this week');
  assert.deepEqual([quests[1].progress, quests[1].complete], [2, true], 'both days perfect: last week\'s habit is not due');
  assert.deepEqual(weeklyQuests([lastWeek('w')], new Map(), '2026-10-21'), [], 'no habit this week: no quests');
});

test('daily challenges only look at the habits active today', () => {
  // Monday: last week's habit had a 6-day streak and was missed on Sunday.
  const challenges = dailyChallenges({
    habits: [lastWeek('old'), thisWeek('new')],
    doneToday: new Map(),
    doneYesterday: new Set(),
    streaksBefore: new Map([['old', 6]]),
    today: '2026-10-19',
  });
  assert.equal(challenges[0].target, 1, 'only the new habit is due');
  assert.ok(!challenges.some((challenge) => challenge.id === 'comeback' || challenge.id === 'streak-keeper'), JSON.stringify(challenges.map((challenge) => challenge.id)));
  assert.deepEqual(dailyChallenges({ habits: [lastWeek('old')], doneToday: new Map(), doneYesterday: new Set(), streaksBefore: new Map(), today: '2026-10-19' }), [], 'nothing due today');
});

test('a streak freeze saves the account streak, past days with nothing due', () => {
  const done = (entries) => new Map(Object.entries(entries).map(([id, dates]) => [id, new Set(dates)]));
  // Sunday was missed; Monday had no habit yet (this week's starts on Tuesday).
  const habits = [lastWeek('w'), daily('t', '2026-10-20', '2026-10-25')];
  assert.deepEqual(daysToFreeze(habits, done({ w: days('2026-10-12', '2026-10-17') }), new Set(), '2026-10-20', 1), ['2026-10-18']);
  // A habit done every day of its week: the days after it are not misses.
  assert.deepEqual(daysToFreeze([lastWeek('w')], done({ w: days('2026-10-12', '2026-10-18') }), new Set(), '2026-10-21', 2), []);
  // Another habit was checked in yesterday: the account streak did not break.
  assert.deepEqual(daysToFreeze([thisWeek('a'), thisWeek('b')], done({ a: ['2026-10-19', '2026-10-20'] }), new Set(), '2026-10-21', 2), []);
  // No check-in ever: no streak to save.
  assert.deepEqual(daysToFreeze([thisWeek('a')], new Map(), new Set(), '2026-10-21', 2), []);
});

test('habit facts stop at the end of the habit\'s week', () => {
  const at = (date) => ({ date, completedAt: Date.parse(`${date}T18:00:00+08:00`) });
  const habit = { ...lastWeek('Gym'), label: 'Gym', category: 'Health' };
  const stats = habitStats({ habit, completions: days('2026-10-12', '2026-10-16').map(at), now: new Date('2026-10-22T04:00:00Z'), timeZone: 'Asia/Manila' });
  assert.deepEqual({ scheduled: stats.scheduledDays, completed: stats.completedDays, missed: stats.missedDays, weekEnded: stats.weekEnded }, { scheduled: 7, completed: 5, missed: 2, weekEnded: '2026-10-18' }, 'the days after Sunday are not misses');
  assert.deepEqual(stats.last7Days, [1, 1, 1, 1, 1, 0, 0], 'the habit\'s last 7 days');
  assert.equal(stats.usualCheckInTime, '6:00 PM');
  const current = habitStats({ habit: { ...thisWeek('Read'), label: 'Read' }, completions: [at('2026-10-19')], now: new Date('2026-10-20T04:00:00Z'), timeZone: 'Asia/Manila' });
  assert.deepEqual([current.weekEnded, current.scheduledDays, current.missedDays], [null, 1, 0], 'today is still open');
});

test('the AI context lists this week\'s habits apart from the past weeks\' history', () => {
  const row = (id, start, activeUntil, extra = {}) => ({ id, label: id, category: 'Health', meta: 'Daily • 07:00 AM', frequency: 'Daily', start_date: start, activeUntil, reminder_days: [], ...extra });
  const habits = [
    row('Current', '2026-10-19', '2026-10-25'),
    row('Last week', '2026-10-12', '2026-10-18'),
    row('Two weeks ago', '2026-10-05', '2026-10-11', { meta: 'Selected days • 07:00 AM • Mon, Wed', frequency: 'Custom', reminder_days: ['Mon', 'Wed'] }),
    row('Too old', '2026-09-14', '2026-09-20'),
    row('Not stamped', '2026-09-01', ''),
  ];
  const completions = [
    ...days('2026-10-12', '2026-10-17').map((date) => ({ habitId: 'Last week', date })),
    { habitId: 'Two weeks ago', date: '2026-10-07' },
    { habitId: 'Current', date: '2026-10-19' },
    { habitId: 'Current', date: '2026-10-20' },
  ];
  const context = buildHabitContext({ habits, completions, now: new Date('2026-10-21T04:00:00Z'), timeZone: 'Asia/Manila' });
  assert.deepEqual(context.habits.map((habit) => habit.name), ['Current', 'Not stamped']);
  assert.deepEqual(context.pastHabits, [
    { name: 'Last week', category: 'Health', frequency: 'Daily', weekEnded: '2026-10-18', scheduledDays: 7, checkIns: 6, completionRate: 0.86 },
    { name: 'Two weeks ago', category: 'Health', frequency: 'Custom (Mon, Wed)', weekEnded: '2026-10-11', scheduledDays: 2, checkIns: 1, completionRate: 0.5 },
  ], 'newest first, counted up to the end of their week');
  assert.equal(context.summary.habitsTracked, 2);
  assert.equal(context.summary.checkInsLast7Days, 5, "check-ins are history: last week's count too");
  assert.equal(context.summary.accountStreakDays, 2, 'Sunday was missed');
  assert.equal(buildHabitContext({ habits, completions, now: new Date('2026-10-21T04:00:00Z'), frozenDays: ['2026-10-18'] }).summary.accountStreakDays, 8);
  assert.equal(buildHabitContext({ habits, completions, accountStreakDays: 40 }).summary.accountStreakDays, 40, 'the caller can count it from every check-in');
  assert.match(context.note, /pastHabits ended with their week/);
});

test('ML training rows end a week before the habit\'s week did', () => {
  const habit = { category: 'Health', frequency: 'Daily', activeUntil: '2026-09-20' };
  const dates = days('2026-09-01', '2026-09-20');
  const rows = buildTrainingRows(habit, dates, { today: '2026-10-20' });
  assert.equal(rows.length, 1, 'only September 7 has its 7-day outcome inside the habit\'s life');
  assert.ok(rows.every((row) => row.completed_next_7_days === 1), 'its end is not labelled as dropping out');
  assert.equal(buildTrainingRows({ ...habit, activeUntil: undefined }, dates, { today: '2026-10-20' }).length, 6, 'an open-ended habit');
  assert.equal(buildTrainingRows({ ...habit, activeUntil: undefined }, dates, { today: '2026-10-20', activeUntil: '2026-09-20' }).length, 1, 'passed as an option');
  assert.deepEqual(buildTrainingRows(lastWeek('w'), days('2026-10-12', '2026-10-18'), { today: '2026-11-30' }), [], 'one week is too short for a row');
});

test('account streak milestones pay once per run of the streak', async () => {
  const ledger = new Map();
  const db = {
    query: async (_text, [id, , amount, label]) => {
      if (ledger.has(id)) return { rowCount: 0 };
      ledger.set(id, { amount, label });
      return { rowCount: 1 };
    },
  };
  const run = (streak, start) => ({ streak, start });
  assert.equal(await awardAccountStreakMilestones(db, 'u1', run(6, '2026-10-13'), run(7, '2026-10-13')), 15);
  assert.deepEqual([...ledger], [['u1:token:streak:account:2026-10-13:7', { amount: 15, label: '7-day streak' }]]);
  assert.equal(await awardAccountStreakMilestones(db, 'u1', run(6, '2026-10-13'), run(7, '2026-10-13')), 0, 'an undo and a new check-in pay nothing more');
  assert.equal(await awardAccountStreakMilestones(db, 'u1', run(7, '2026-10-13'), run(7, '2026-10-13')), 0);
  assert.equal(await awardAccountStreakMilestones(db, 'u1', run(6, '2026-11-02'), run(7, '2026-11-02')), 15, 'a new run after a break pays again');
  assert.equal(await awardAccountStreakMilestones(db, 'u1', run(13, '2026-11-02'), run(30, '2026-11-02')), 75, 'a jump pays each milestone it clears');
});
