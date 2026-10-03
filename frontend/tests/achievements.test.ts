import type { Goal, Habit } from '@/hooks/app-state/types';
import { badgeProgress, badgeRemaining, historyStats, longestStreak, milestones, nextBadge } from '@/utils/achievements';

function habit(id: string, overrides: Partial<Habit> = {}): Habit {
  return {
    id, startDate: '2026-09-01', label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
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

// Saturday, October 3, 2026, in the evening.
const now = new Date(2026, 9, 3, 20);
const read = habit('read', { label: 'Read for 20 minutes', category: 'Mind', completionDates: days('2026-09-21', '2026-09-30') });
const water = habit('water', { label: 'Drink water', completionDates: days('2026-09-26', '2026-09-30') });

describe('streaks from history', () => {
  it('finds the longest run, not only the current one', () => {
    const walk = habit('walk', { completionDates: [...days('2026-09-01', '2026-09-05'), ...days('2026-09-10', '2026-09-20'), '2026-10-01', '2026-10-02'] });
    expect(longestStreak(walk, '2026-10-03')).toBe(11);
    expect(longestStreak(habit('new'), '2026-10-03')).toBe(0);
  });
});

describe('badges', () => {
  const badges = badgeProgress([read, water], [], now);
  const byId = (id: string) => badges.find((badge) => badge.id === id)!;

  it('are earned from past check-ins and stay earned', () => {
    expect(byId('bookworm')).toMatchObject({ earned: true, current: 10 });
    expect(byId('streak-7')).toMatchObject({ earned: true, current: 10 });
    // September 26 to 30: both habits done, five perfect days.
    expect(byId('day-finisher')).toMatchObject({ earned: true, current: 5 });
  });

  it('show how far along the locked ones are', () => {
    expect(byId('hydration')).toMatchObject({ earned: false, current: 5, target: 14 });
    expect(byId('habit-hero')).toMatchObject({ earned: false, current: 2 });
    expect(byId('focus-master').current).toBe(10);
    // Best week: September 21 to 27, 9 of 14 check-ins.
    expect(byId('consistency-pro').current).toBe(64);
    expect(badgeRemaining(byId('hydration'))).toBe('9 more check-ins');
    expect(badgeRemaining(byId('consistency-pro'))).toBe('16% more');
    expect(badgeRemaining({ ...byId('legend'), current: 29 })).toBe('1 more day');
  });

  it('point to the closest one next', () => {
    expect(nextBadge(badges)?.id).toBe('consistency-pro');
    expect(nextBadge(badges.map((badge) => ({ ...badge, earned: true })))).toBeNull();
  });

  it('count a perfect week only when the whole week is done', () => {
    const pair = ['a', 'b'].map((id) => habit(id, { startDate: '2026-09-28', completionDates: days('2026-09-28', '2026-10-03') }));
    const sundayEvening = new Date(2026, 9, 4, 20);
    expect(badgeProgress(pair, [], sundayEvening).find((badge) => badge.id === 'perfect-week')?.earned).toBe(false);
    const finished = pair.map((item) => ({ ...item, completionDates: [...item.completionDates, '2026-10-04'] }));
    expect(badgeProgress(finished, [], sundayEvening).find((badge) => badge.id === 'perfect-week')?.earned).toBe(true);
  });

  it('reward a finished goal', () => {
    const goal = { id: 'g', completedSteps: [true, true, true, true] } as Goal;
    expect(badgeProgress([read], [goal], now).find((badge) => badge.id === 'goal-getter')?.earned).toBe(true);
    expect(badgeProgress([read], [{ ...goal, completedSteps: [true, false] }], now).find((badge) => badge.id === 'goal-getter')?.earned).toBe(false);
  });
});

describe('milestones and history stats', () => {
  it('list what is reached and the next step', () => {
    const rows = Object.fromEntries(milestones([read, water], 260, now).map((row) => [row.id, row]));
    expect(rows['check-ins']).toMatchObject({ current: 15, reached: [10], next: 25 });
    expect(rows.streak).toMatchObject({ current: 10, reached: [3, 7], next: 14 });
    expect(rows.level).toMatchObject({ current: 3, reached: [2], next: 5 });
    expect(rows['perfect-days']).toMatchObject({ current: 5, reached: [1, 5], next: 10 });
  });

  it('use the whole history, and an unfinished today does not lower the rates', () => {
    expect(historyStats([read, water], now)).toEqual({ totalCheckIns: 15, bestStreak: 10, thisWeekRate: 60, last7Rate: 67, last30Rate: expect.any(Number), perfectDays: 5 });
  });
});
