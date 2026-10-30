// The account streak keeps the days that are over as the server kept them (the same cases as
// backend/test/weekly-habits.test.js): deleting or rescheduling a habit cannot erase a miss or a
// check-in, or add a miss.
import type { Habit } from '@/hooks/app-state/types';
import { badgeProgress, historyStats, milestones } from '@/utils/achievements';
import { accountStreak, longestAccountStreak, type KeptDays } from '@/utils/account-streak';

function habit(id: string, overrides: Partial<Habit> = {}): Habit {
  return {
    id, startDate: '2026-10-19', activeUntil: '2026-10-25', label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
    goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: false, reminderTime: '07:00 AM', ...overrides,
  };
}

// October 2026: last week ran from Monday the 12th to Sunday the 18th; today is Wednesday the 21st.
const today = '2026-10-21';
const wednesday = new Date(2026, 9, 21, 9);
const lastWeek = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
const walk = habit('walk', { startDate: '2026-10-12', activeUntil: '2026-10-18', completionDates: lastWeek });
const read = habit('read', { startDate: today, completionDates: [today] });

describe('kept streak days', () => {
  it('keep the misses of a deleted habit', () => {
    // Gym, missed on Monday and Tuesday, is deleted: those days had nothing else due.
    expect(accountStreak([walk, habit('gym'), read], today)).toBe(1);
    expect(accountStreak([walk, read], today)).toBe(8);
    const missed: KeptDays = { '2026-10-19': 'breaks', '2026-10-20': 'breaks' };
    expect(accountStreak([walk, read], today, [], missed)).toBe(1);
    expect(longestAccountStreak([walk, read], today, [], missed)).toBe(7);
    // A streak freeze still covers a kept miss.
    expect(accountStreak([walk, read], today, ['2026-10-19', '2026-10-20'], missed)).toBe(8);
  });

  it('keep the check-ins of a deleted habit, with no habit left too', () => {
    const checkIns: KeptDays = { '2026-10-19': 'counts', '2026-10-20': 'counts' };
    expect([accountStreak([walk], today), accountStreak([walk], today, [], checkIns)]).toEqual([7, 9]);
    expect(accountStreak([], today, [], checkIns)).toBe(2);
  });

  it('add no misses for a habit dated back', () => {
    const backdated = habit('new');
    expect(accountStreak([walk, read, backdated], today)).toBe(1);
    expect(accountStreak([walk, read, backdated], today, [], { '2026-10-19': 'neutral', '2026-10-20': 'neutral' })).toBe(8);
  });

  it('count in the best streak of the badges, milestones and stats', () => {
    const checkIns: KeptDays = { '2026-10-19': 'counts', '2026-10-20': 'counts' };
    expect(historyStats([walk, read], wednesday).bestStreak).toBe(8);
    expect(historyStats([walk, read], wednesday, [], checkIns).bestStreak).toBe(10);
    expect(milestones([walk, read], 0, wednesday, [], checkIns).find((row) => row.id === 'streak')?.current).toBe(10);
    expect(badgeProgress([walk, read], [], wednesday, [], checkIns).find((badge) => badge.id === 'streak-7')).toMatchObject({ current: 10, earned: true });
  });
});
