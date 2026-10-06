import type { Habit } from '@/hooks/app-state/types';
import { computeSmartReminderTimes, heuristicRisk } from '@/hooks/app-state/smart-reminders';

jest.mock('@/authentication/authService', () => ({ getApiBaseUrl: jest.fn(), getAuthenticatedHeaders: jest.fn(), getWebPushVapidPublicKey: jest.fn(), saveWebPushSubscription: jest.fn(), sendTestWebPush: jest.fn() }));

const habit = (completionDates: string[] = []): Habit => ({
  id: 'read', startDate: '2026-09-01', label: 'Read', meta: 'Daily • 08:00 AM', category: 'Mind', frequency: 'Daily', icon: 'book-outline', color: '#7A6AED',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates, reminderEnabled: false, reminderTime: '08:00 AM', reminderTimes: ['08:00 AM'], smartReminderEnabled: true,
});
const october = (...days: number[]) => days.map((day) => `2026-10-${String(day).padStart(2, '0')}`);
// 6:00 AM on October 8, 2026, before the reminder.
const now = new Date(2026, 9, 8, 6, 0);
const clocks = (result: { times: { hour: number; minute: number }[] }) => result.times.map((time) => `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`);

describe('smart reminders without the ML model', () => {
  // Same cases as the server's Web Push smart reminders (backend/test/web-push-reminders.test.js).
  it('keep the set time, adding a nudge 30 minutes early when the habit is at risk', () => {
    expect(heuristicRisk(habit(october(1, 2, 3, 4, 5, 6, 7)), now)).toBe('low');
    expect(clocks(computeSmartReminderTimes(habit(october(1, 2, 3, 4, 5, 6, 7)), now))).toEqual(['08:00']);
    expect(clocks(computeSmartReminderTimes(habit(october(1, 3, 6, 7)), now))).toEqual(['08:00']);
    expect(clocks(computeSmartReminderTimes(habit(), now))).toEqual(['07:30', '08:00']);
  });

  it('remind a brand-new habit at the time it was given, even right after making it', () => {
    // Made at 2:18 PM with a 2:19 PM reminder: the 1:49 PM nudge has passed, 2:19 PM still comes.
    const fresh = { ...habit(), startDate: '2026-10-06', reminderEnabled: true, reminderTime: '02:19 PM', reminderTimes: ['02:19 PM'] };
    expect(clocks(computeSmartReminderTimes(fresh, new Date(2026, 9, 6, 14, 18)))).toEqual(['13:49', '14:19']);
  });

  it('do not treat a habit as at risk just because today is not done yet', () => {
    // Today's progress is 0 until the habit is checked off; a good week still counts as going well.
    expect(computeSmartReminderTimes(habit(october(1, 2, 3, 4, 5, 6, 7)), now).riskLevel).toBe('low');
  });
});
