import type { Habit } from '@/hooks/app-state/types';
import { buddyGrowth, buddyMood } from '@/utils/buddy';
import { daysLeftInWeek, weekStartOf, weeklyQuests } from '@/utils/quests';

function habit(id: string, completionDates: string[] = [], overrides: Partial<Habit> = {}): Habit {
  return {
    id, startDate: '2026-09-01', label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
    goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates, reminderEnabled: false, reminderTime: '07:00 AM', ...overrides,
  };
}

// Saturday, October 3, 2026: the same cases as backend/test/engagement.test.js.
const saturday = new Date(2026, 9, 3, 20);

describe('weekly quests', () => {
  it('match the server for the same week', () => {
    expect(weekStartOf('2026-10-04')).toBe('2026-09-28');
    const habits = [
      habit('a', ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-03']),
      habit('b', ['2026-09-27', '2026-09-28', '2026-09-29', '2026-10-01']),
      habit('c', ['2026-09-27', '2026-09-28', '2026-09-29']),
    ];
    const quests = Object.fromEntries(weeklyQuests(habits, saturday).map((quest) => [quest.id, quest]));
    expect(quests['check-ins']).toEqual({ id: 'check-ins', title: 'Check in 12 times', icon: 'checkmark-done', target: 12, progress: 10, reward: 15, weekStart: '2026-09-28', complete: false });
    expect(quests['perfect-days']).toMatchObject({ progress: 2, complete: true, reward: 20 });
    const third = Object.values(quests).find((quest) => !['check-ins', 'perfect-days'].includes(quest.id))!;
    const expected = { 'challenge-days': [2, false], 'active-days': [5, true], 'every-habit': [3, true] }[third.id];
    expect([third.progress, third.complete]).toEqual(expected);
  });

  it('fit the number of habits and count the days left', () => {
    expect(weeklyQuests([], saturday)).toEqual([]);
    expect(weeklyQuests([habit('a')], saturday)[0].target).toBe(5);
    expect(weeklyQuests([habit('a'), habit('b')], saturday)[0].target).toBe(8);
    expect(daysLeftInWeek(saturday)).toBe(2);
    expect(daysLeftInWeek(new Date(2026, 8, 28))).toBe(7);
  });
});

describe('habit buddy', () => {
  it('grows through stages with check-ins', () => {
    expect(buddyGrowth(0)).toMatchObject({ index: 0, toNext: 10, share: 0 });
    expect(buddyGrowth(30)).toMatchObject({ index: 1, toNext: 20, share: 0.5 });
    expect(buddyGrowth(400)).toMatchObject({ index: 4, next: null, share: 1, toNext: 0 });
  });

  it('feels how today is going', () => {
    const morning = new Date(2026, 9, 3, 8);
    const afternoon = new Date(2026, 9, 3, 15);
    expect(buddyMood([], 'Habi', morning).mood).toBe('sleepy');
    expect(buddyMood([habit('a', ['2026-10-02'])], 'Habi', morning).mood).toBe('sleepy');
    expect(buddyMood([habit('a', ['2026-10-02'])], 'Habi', afternoon).mood).toBe('hungry');
    expect(buddyMood([habit('a', ['2026-10-02', '2026-10-03']), habit('b', ['2026-10-02'])], 'Habi', afternoon)).toMatchObject({ mood: 'happy', energy: 0.5 });
    expect(buddyMood([habit('a', ['2026-10-03'])], 'Habi', afternoon)).toMatchObject({ mood: 'ecstatic', energy: 1 });
    // Missed yesterday (October 2) and nothing done yet today.
    expect(buddyMood([habit('a', ['2026-10-01'])], 'Habi', afternoon).mood).toBe('sad');
  });
});
