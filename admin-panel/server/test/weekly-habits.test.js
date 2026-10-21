import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://user:password@localhost:5432/unused';
const { activeUntilOf, currentHabitSql, hasHabitEnded, lastDueDay } = await import('../src/lib/habit-week.js');
const { expectedCheckIns, habitFirstDay } = await import('../src/lib/metrics.js');
const { computeStreak } = await import('../src/lib/streaks.js');
const { expectedBetween, prepareHabits } = await import('../src/routes/analytics.js');
const { userHabits } = await import('../src/routes/users.js');

// Wednesday Oct 21, 2026. Weeks run Monday to Sunday: last week was Oct 12-18.
const today = '2026-10-21';
const timeZone = 'Asia/Manila';
const lastWeek = { meta: 'Daily • 07:00 AM', frequency: 'Daily', start_date: '2026-10-12', active_until: '2026-10-18', reminder_days: [] };

test('a habit is active until the end of its week, then it has ended', () => {
  assert.equal(activeUntilOf(lastWeek), '2026-10-18');
  assert.equal(activeUntilOf({ active_until: '' }), null);
  assert.equal(activeUntilOf({ active_until: 'soon' }), null);
  assert.equal(hasHabitEnded(lastWeek, '2026-10-18'), false, 'its last day is still active');
  assert.equal(hasHabitEnded(lastWeek, '2026-10-19'), true);
  assert.equal(hasHabitEnded({ active_until: '' }, '2030-01-01'), false, 'a habit without a week end has no end yet');
  assert.equal(lastDueDay(lastWeek, today), '2026-10-18');
  assert.equal(lastDueDay(lastWeek, '2026-10-15'), '2026-10-15');
  assert.equal(currentHabitSql('h', '$3'), "(h.active_until !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR h.active_until >= $3)");
});

test('an ended habit keeps the streak of its last day', () => {
  const week = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
  assert.equal(computeStreak(lastWeek, week, today), 5);
  assert.equal(computeStreak(lastWeek, week.slice(0, -1), today), 0, 'its last day is over: missing it ended the streak');
  assert.equal(computeStreak(lastWeek, week.slice(0, -1), '2026-10-18'), 4, 'on its last day an unfinished today does not break it');

  const mondayWednesdayFriday = { ...lastWeek, meta: 'Selected days • 08:00 AM • Mon, Wed, Fri', frequency: 'Custom', reminder_days: ['Mon', 'Wed', 'Fri'] };
  assert.equal(computeStreak(mondayWednesdayFriday, ['2026-10-12', '2026-10-14', '2026-10-16'], today), 3, 'an unscheduled last day is skipped');

  const thisWeek = { ...lastWeek, start_date: '2026-10-19', active_until: '2026-10-25' };
  assert.equal(computeStreak(thisWeek, ['2026-10-19', '2026-10-20'], today), 2);
});

test('expected check-ins stop at the end of the habit week', () => {
  const created = Date.parse('2026-10-12T01:00:00Z');
  const habit = { ...lastWeek, id: `u1:habit:habit-${created}-1` };
  assert.equal(habitFirstDay(habit, timeZone), '2026-10-12');
  assert.equal(habitFirstDay({ id: 'legacy', start_date: '' }, timeZone), null);
  assert.equal(expectedCheckIns(habit, '2026-10-01', today, timeZone), 7, 'only its own week');
  assert.equal(expectedCheckIns(habit, '2026-10-15', today, timeZone), 4);
  assert.equal(expectedCheckIns(habit, '2026-10-19', today, timeZone), 0, 'nothing is due after it ended');
  assert.equal(expectedCheckIns({ id: 'legacy', meta: 'Daily', start_date: '2026-10-20', active_until: '' }, '2026-10-01', today, timeZone), 2, 'from its start date, with no end yet');

  const prepared = prepareHabits([habit, { id: 'legacy', meta: 'Weekly • Anytime', start_date: '', active_until: '' }], timeZone, today);
  assert.deepEqual(prepared.map((row) => row.current), [false, true]);
  assert.equal(expectedBetween(prepared, '2026-10-01', today), 7 + 3, 'the daily habit for its week, the weekly one for 3 weeks');
  assert.equal(expectedBetween(prepared, '2026-10-19', today), 3 / 7);
});

test('a student detail counts the habits tracked now and lists ended ones as history', () => {
  const row = (name, activeUntil) => ({ id: `u1:habit:${name}`, label: name, meta: 'Daily • 07:00 AM', active_until: activeUntil });
  const rows = [row('walk', '2026-10-11'), row('read', '2026-10-18'), row('run', '2026-10-25'), row('legacy', '')];
  const streaks = new Map([['u1:habit:walk', 7], ['u1:habit:read', 5], ['u1:habit:run', 2], ['u1:habit:legacy', 1]]);
  const result = userHabits(rows, streaks, 'u1', today);
  assert.equal(result.habitCount, 2);
  assert.equal(result.totalHabitCount, 4);
  assert.equal(result.bestStreak, 2, 'ended habits keep their streak but are not current');
  assert.deepEqual(result.habits.map((habit) => [habit.id, habit.ended, habit.activeUntil, habit.streak, habit.frequency]), [
    ['run', false, '2026-10-25', 2, 'Daily'],
    ['legacy', false, null, 1, 'Daily'],
    ['read', true, '2026-10-18', 5, 'Daily'],
    ['walk', true, '2026-10-11', 7, 'Daily'],
  ]);
  assert.ok(result.habits.every((habit) => !('active_until' in habit)));
  assert.equal(userHabits([], new Map(), 'u1', today).bestStreak, 0);
});
