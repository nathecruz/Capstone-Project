import type { Habit } from '@/hooks/app-state/types';
import { applyRemoteCompletionDates } from '@/hooks/app-state/habit-progress';
import { longestStreak } from '@/utils/achievements';
import { buddyMood } from '@/utils/buddy';
import { habitsAtRisk } from '@/utils/engagement';
import { computeStreak } from '@/utils/streaks';

function habit(id: string, completionDates: string[] = []): Habit {
  return {
    id, startDate: '2026-09-01', label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
    goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates, reminderEnabled: false, reminderTime: '07:00 AM',
  };
}

// Same cases as the server (backend/test/engagement.test.js): October 1 was missed.
const dates = ['2026-09-29', '2026-09-30', '2026-10-02'];

describe('streak freeze', () => {
  afterEach(() => jest.useRealTimers());

  it('keeps a streak alive over a frozen day without counting it', () => {
    expect(computeStreak(habit('a'), dates, '2026-10-03')).toBe(1);
    expect(computeStreak(habit('a'), dates, '2026-10-03', ['2026-10-01'])).toBe(3);
    expect(computeStreak(habit('a'), [...dates, '2026-10-01'], '2026-10-03', ['2026-10-01'])).toBe(4);
    expect(longestStreak(habit('a', dates), '2026-10-03', ['2026-10-01'])).toBe(3);
  });

  it('flows into the habit, the evening alert and the buddy', () => {
    const now = new Date(2026, 9, 3, 20);
    // The habit's streak is counted up to the device's today.
    jest.useFakeTimers({ now });
    expect(applyRemoteCompletionDates(habit('a'), dates, ['2026-10-01']).streak).toBe(3);
    // Yesterday (October 2) missed: no running streak without the freeze, one with it.
    const missedYesterday = habit('a', ['2026-09-30', '2026-10-01']);
    expect(habitsAtRisk([missedYesterday], now)).toEqual([]);
    expect(habitsAtRisk([missedYesterday], now, 18, ['2026-10-02']).map((item) => item.id)).toEqual(['a']);
    const afternoon = new Date(2026, 9, 3, 15);
    expect(buddyMood([missedYesterday], 'Habi', afternoon).mood).toBe('sad');
    expect(buddyMood([missedYesterday], 'Habi', afternoon, ['2026-10-02'])).toMatchObject({ mood: 'happy', line: expect.stringContaining('streak freeze') });
  });
});
