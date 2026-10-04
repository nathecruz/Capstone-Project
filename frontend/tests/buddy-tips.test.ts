import type { Habit } from '@/hooks/app-state/types';
import { buddyTips, buddyWeek } from '@/utils/buddy';

function habit(id: string, completionDates: string[] = [], overrides: Partial<Habit> = {}): Habit {
  return {
    id, startDate: '2026-09-01', label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
    goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates, reminderEnabled: false, reminderTime: '07:00 AM', ...overrides,
  };
}

// Sunday, October 4, 2026, in the evening.
const now = new Date(2026, 9, 4, 19);
const days = (...keys: string[]) => keys.map((day) => `2026-${day}`);
const lastWeek = days('09-27', '09-28', '09-29', '09-30', '10-01', '10-02', '10-03');

describe('Habi\'s tips', () => {
  it('says when it is about to grow, and when a streak milestone is one check-in away', () => {
    const tips = buddyTips([habit('Read', days('10-01', '10-02', '10-03'), { streak: 6 })], { checkIns: 47 }, now);
    expect(tips[0]).toBe('Just 3 more check-ins and I grow into a Teen!');
    expect(tips).toContain('Do Read today for a 7-day streak!');
  });

  it('pairs a habit that needs love with one the student rarely skips', () => {
    const tips = buddyTips([habit('Read', lastWeek), habit('Journal', days('09-28'))], { checkIns: 20 }, now);
    expect(tips).toContain('Journal needs some love. Try it right after Read, which you rarely skip.');
  });

  it('names the best day of the week once there are enough check-ins', () => {
    const sundays = days('09-06', '09-13', '09-20', '09-27');
    const habits = ['a', 'b', 'c'].map((id) => habit(id, sundays));
    expect(buddyTips(habits, { checkIns: 20 }, now)).toContain("Sunday is your best day. That's today, let's make it count!");
    expect(buddyTips([habit('a', days('10-03'))], { checkIns: 20 }, now).some((tip) => tip.includes('best day'))).toBe(false);
  });

  it('gives at most three tips, and none for a new student with nothing to say', () => {
    expect(buddyTips([], { checkIns: 0 }, now)).toEqual([]);
    const many = buddyTips([habit('Read', lastWeek, { streak: 6 }), habit('Journal', [])], { checkIns: 49 }, now);
    expect(many.length).toBeLessThanOrEqual(3);
  });
});

describe('Habi\'s week', () => {
  it('shows a mood for each of the last 7 days, today last', () => {
    const week = buddyWeek([habit('Read', days('09-29', '09-30', '10-02')), habit('Walk', days('09-29', '10-02'))], now, ['10-01'].map((day) => `2026-${day}`));
    expect(week.map((day) => day.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Today']);
    expect(week.map((day) => day.mood)).toEqual(['sad', 'ecstatic', 'happy', 'sleepy', 'ecstatic', 'sad', 'hungry']);
    expect(week[1]).toMatchObject({ key: '2026-09-29', done: 2, due: 2 });
  });
});
