// Habits last one week (utils/habit-week.ts): a habit whose week has ended is never due again, so it
// is never missed or counted after it, but it stays history for stats, badges and the account streak.
import { DEFAULT_HABIT_CATEGORIES } from '@/constants/habit-categories';
import { applyRemoteCompletionDates, withServerActiveUntil } from '@/hooks/app-state/habit-progress';
import type { Habit } from '@/hooks/app-state/types';
import { badgeProgress, historyStats, longestStreak, milestones } from '@/utils/achievements';
import { buddyMood, buddyTips, buddyWeek } from '@/utils/buddy';
import { dailyChallenge, habitsAtRisk, todayAgenda, weeklyRecap } from '@/utils/engagement';
import { normalizeHabitFields } from '@/utils/habit-data';
import { editedHabitFields } from '@/utils/habit-edit';
import { predictHabitOutcomes } from '@/utils/habit-predictions';
import { isHabitMissedOn } from '@/utils/habit-visibility';
import { currentHabits } from '@/utils/habit-week';
import { isHabitInWeek, weeklyQuests } from '@/utils/quests';
import { computeWidgetData } from '@/widgets/widget-data';

function habit(id: string, overrides: Partial<Habit> = {}): Habit {
  return {
    id, startDate: '2026-10-19', activeUntil: '2026-10-25', label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
    goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: false, reminderTime: '07:00 AM', ...overrides,
  };
}

const days = (from: string, to: string) => {
  const result: string[] = [];
  for (let date = new Date(`${from}T12:00:00`); date <= new Date(`${to}T12:00:00`); date.setDate(date.getDate() + 1)) {
    result.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  }
  return result;
};

// October 2026: last week ran from Monday the 12th to Sunday the 18th; this week from the 19th to
// the 25th. "Now" is Wednesday the 21st.
const at = (day: number, hour: number) => new Date(2026, 9, day, hour);
const wednesday = at(21, 9);
// Last week's habit, done every day of its week (its own streak stays 7 after it).
const lastWeek = habit('lastWeek', { startDate: '2026-10-12', activeUntil: '2026-10-18', completionDates: days('2026-10-12', '2026-10-18'), streak: 7 });
// This week's, done Monday and Tuesday.
const thisWeek = habit('thisWeek', { completionDates: ['2026-10-19', '2026-10-20'], streak: 2 });
// This week's too, starting Friday.
const fromFriday = habit('fromFriday', { startDate: '2026-10-23' });
const ids = (habits: Habit[]) => habits.map((item) => item.id);

describe('today\'s agenda', () => {
  it('is the same with every habit or only this week\'s, and never counts an ended habit as "not today"', () => {
    const all = todayAgenda([lastWeek, thisWeek, fromFriday], wednesday);
    const current = todayAgenda(currentHabits([lastWeek, thisWeek, fromFriday], '2026-10-21'), wednesday);
    expect(ids(all.scheduled)).toEqual(['thisWeek']);
    expect(ids(all.open)).toEqual(ids(current.open));
    expect(all.notToday).toBe(1);
    expect(current.notToday).toBe(1);
    expect(dailyChallenge([lastWeek, thisWeek], wednesday)).toEqual(dailyChallenge([thisWeek], wednesday));
  });

  it('warns about the same streaks at risk, never an ended habit\'s', () => {
    expect(ids(habitsAtRisk([lastWeek, thisWeek], at(21, 20)))).toEqual(['thisWeek']);
    expect(ids(habitsAtRisk([lastWeek], at(21, 20)))).toEqual([]);
  });

  it('keeps last week in the Monday recap', () => {
    const recap = weeklyRecap([lastWeek, habit('new')], at(19, 9));
    expect(recap.lastWeek).toMatchObject({ start: '2026-10-12', end: '2026-10-18', scheduled: 7, done: 7 });
    // The week before, last week's habit had not started.
    expect(recap.weekBefore.scheduled).toBe(0);
  });
});

describe('history: badges, milestones and stats', () => {
  // Two habits of last week checked in on alternate days, then this week's.
  const odd = habit('odd', { startDate: '2026-10-12', activeUntil: '2026-10-18', completionDates: ['2026-10-12', '2026-10-14', '2026-10-16'] });
  const even = habit('even', { startDate: '2026-10-12', activeUntil: '2026-10-18', completionDates: ['2026-10-13', '2026-10-15', '2026-10-17'] });
  const habits = [odd, even, thisWeek];

  it('measure the streak as days in a row with a check-in across habits and weeks', () => {
    // Each of last week's habits alone never went two days in a row; the account went six (12th to 17th).
    expect([odd, even].map((item) => longestStreak(item, '2026-10-21'))).toEqual([1, 1]);
    expect(historyStats(habits, wednesday).bestStreak).toBe(6);
    expect(milestones(habits, 0, wednesday).find((row) => row.id === 'streak')).toMatchObject({ current: 6, reached: [3], next: 7 });
    expect(badgeProgress(habits, [], wednesday).find((badge) => badge.id === 'streak-7')).toMatchObject({ current: 6, earned: false, goal: 'Check in 7 days in a row' });
  });

  it('count every habit ever made, and an ended habit only on the days of its week', () => {
    expect(badgeProgress(habits, [], wednesday).find((badge) => badge.id === 'habit-hero')?.current).toBe(3);
    // This week (Monday to today): only this week's habit was due, done Monday and Tuesday.
    expect(historyStats([lastWeek, thisWeek], wednesday).thisWeekRate).toBe(100);
    expect(historyStats([lastWeek, thisWeek], wednesday).totalCheckIns).toBe(9);
  });

  it('never call a day after a habit\'s week missed', () => {
    const missedSunday = { ...lastWeek, completionDates: days('2026-10-12', '2026-10-17') };
    expect(isHabitMissedOn(missedSunday, '2026-10-18', wednesday)).toBe(true);
    expect(isHabitMissedOn(missedSunday, '2026-10-19', wednesday)).toBe(false);
    expect(isHabitMissedOn(missedSunday, '2026-10-20', wednesday)).toBe(false);
  });
});

describe('weekly quests', () => {
  it('count a habit for a week when it was active at some point in it (the server\'s rule)', () => {
    expect(isHabitInWeek({ startDate: '2026-10-12', activeUntil: '2026-10-18' }, '2026-10-19')).toBe(false);
    expect(isHabitInWeek({ startDate: '2026-10-12', activeUntil: '2026-10-18' }, '2026-10-12')).toBe(true);
    expect(isHabitInWeek({ startDate: '2026-10-26', activeUntil: '2026-11-01' }, '2026-10-19')).toBe(false);
    expect(isHabitInWeek({ startDate: '2026-10-25', activeUntil: '2026-10-25' }, '2026-10-19')).toBe(true);
    // Habits from older app versions have no end yet.
    expect(isHabitInWeek({ startDate: '2026-09-01', activeUntil: undefined }, '2026-10-19')).toBe(true);
    expect(isHabitInWeek({ startDate: '', activeUntil: '' }, '2026-10-19')).toBe(true);
  });

  it('leave last week\'s habits out of this week\'s quests', () => {
    expect(weeklyQuests([lastWeek, thisWeek], wednesday)).toEqual(weeklyQuests([thisWeek], wednesday));
    expect(weeklyQuests([lastWeek, thisWeek], wednesday)[0]).toMatchObject({ target: 5, progress: 2 });
    expect(weeklyQuests([lastWeek], wednesday)).toEqual([]);
  });
});

describe('the buddy', () => {
  it('feels about this week\'s habits only', () => {
    // Monday after the reset, nothing added yet.
    expect(buddyMood([lastWeek], 'Habi', at(19, 15))).toEqual(buddyMood([], 'Habi', at(19, 15)));
    // Last week's habit was missed on Sunday, its last day: not "missed yesterday" now.
    const missedSunday = { ...lastWeek, completionDates: days('2026-10-12', '2026-10-17') };
    expect(buddyMood([missedSunday, habit('new')], 'Habi', at(19, 15))).toEqual(buddyMood([habit('new')], 'Habi', at(19, 15)));
    expect(buddyMood([missedSunday, habit('new')], 'Habi', at(19, 15)).mood).toBe('hungry');
  });

  it('names only this week\'s habits in its tips, and gives the best day from history', () => {
    // Not checked in this week: it needs a habit it can follow, and last week's is not one.
    const weak = habit('weak');
    expect(buddyTips([lastWeek, weak], { checkIns: 0 }, at(21, 15)).some((tip) => tip.includes('lastWeek'))).toBe(false);
    const tips = buddyTips([lastWeek, thisWeek, weak], { checkIns: 0 }, at(21, 15));
    expect(tips).toContain('weak needs some love. Try it right after thisWeek, which you rarely skip.');
    expect(tips.some((tip) => tip.includes('is your best day'))).toBe(true);
    // No habit this week: nothing to make the best day count with.
    expect(buddyTips([lastWeek], { checkIns: 0 }, at(21, 15)).some((tip) => tip.includes('is your best day'))).toBe(false);
  });

  it('keeps last week in its week of moods', () => {
    const week = buddyWeek([lastWeek, thisWeek], wednesday);
    expect(week.map((day) => [day.key, day.due])).toEqual([
      ['2026-10-15', 1], ['2026-10-16', 1], ['2026-10-17', 1], ['2026-10-18', 1], ['2026-10-19', 1], ['2026-10-20', 1], ['2026-10-21', 1],
    ]);
    expect(week[0]).toMatchObject({ mood: 'ecstatic', done: 1 });
  });
});

describe('editing and keeping a habit\'s week', () => {
  it('moves the last active day with a new start date', () => {
    const edit = (startDate: string) => editedHabitFields(thisWeek, { label: 'thisWeek', category: 'Health', frequency: 'Daily', startDate }, DEFAULT_HABIT_CATEGORIES, '2026-10-21');
    expect(edit('2026-10-27')).toMatchObject({ startDate: '2026-10-27', activeUntil: '2026-11-01' });
    // A start date in the past keeps the habit in this week.
    expect(edit('2026-10-14')).toMatchObject({ startDate: '2026-10-14', activeUntil: '2026-10-25' });
    // Unchanged start date: the last active day stays as it is.
    expect(edit('2026-10-19')).not.toHaveProperty('activeUntil');
  });

  it('keeps the last active day through normalizing and the server\'s check-ins', () => {
    expect(normalizeHabitFields({ category: 'Health', icon: 'heart-outline', meta: 'Daily • Anytime', activeUntil: '2026-10-25' })).toMatchObject({ activeUntil: '2026-10-25' });
    const applied = applyRemoteCompletionDates(lastWeek, lastWeek.completionDates);
    expect(applied.activeUntil).toBe('2026-10-18');
    // Its own streak stays the one of its last day.
    expect(applied.streak).toBe(7);
  });

  it('takes the last active day the server gave a habit without one', () => {
    const local = [habit('old', { activeUntil: undefined }), habit('mine', { activeUntil: '2026-10-25' })];
    const server = [{ id: 'old', activeUntil: '2026-10-25' }, { id: 'mine', activeUntil: '2026-11-01' }, { id: 'gone', activeUntil: '2026-10-25' }];
    const taken = withServerActiveUntil(local, server);
    expect(taken.map((item) => [item.id, item.activeUntil])).toEqual([['old', '2026-10-25'], ['mine', '2026-10-25']]);
    // Nothing to take: the same array, so React keeps the same state.
    expect(withServerActiveUntil(taken, server)).toBe(taken);
    expect(withServerActiveUntil(local, [{ id: 'old', activeUntil: 'soon' }])).toBe(local);
    expect(withServerActiveUntil(local, undefined)).toBe(local);
  });
});

describe('the home-screen widget and the forecast', () => {
  it('show this week\'s habits due today and the account streak', () => {
    expect(computeWidgetData([lastWeek, thisWeek, fromFriday], 9, wednesday)).toMatchObject({ doneToday: 0, totalToday: 1, bestStreak: 9 });
  });

  it('forecast this week\'s habits only', () => {
    expect(predictHabitOutcomes([lastWeek, { ...thisWeek, done: true, progress: 100 }], wednesday)).toEqual(predictHabitOutcomes([{ ...thisWeek, done: true, progress: 100 }], wednesday));
  });
});
