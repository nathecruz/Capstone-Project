import type { Habit } from '@/hooks/app-state/types';
import { computeSmartReminderTime, heuristicRisk } from '@/hooks/app-state/smart-reminders';

jest.mock('@/authentication/authService', () => ({ getApiBaseUrl: jest.fn(), getAuthenticatedHeaders: jest.fn(), getWebPushVapidPublicKey: jest.fn(), saveWebPushSubscription: jest.fn(), sendTestWebPush: jest.fn() }));

const habit = (completionDates: string[] = []): Habit => ({
  id: 'read', startDate: '2026-09-01', label: 'Read', meta: 'Daily • 08:00 AM', category: 'Mind', frequency: 'Daily', icon: 'book-outline', color: '#7A6AED',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates, reminderEnabled: false, reminderTime: '08:00 AM', reminderTimes: ['08:00 AM'], smartReminderEnabled: true,
});
const october = (...days: number[]) => days.map((day) => `2026-10-${String(day).padStart(2, '0')}`);
// 6:00 AM on October 8, 2026, before the reminder.
const now = new Date(2026, 9, 8, 6, 0);
const clock = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

describe('smart reminders without the ML model', () => {
  // Same cases as the server's Web Push smart reminders (backend/test/web-push-reminders.test.js).
  it('move with the 7 days before today, like the server', () => {
    expect(heuristicRisk(habit(october(1, 2, 3, 4, 5, 6, 7)), now)).toBe('low');
    expect(clock(computeSmartReminderTime(habit(october(1, 2, 3, 4, 5, 6, 7)), now).target)).toBe('08:45');
    expect(clock(computeSmartReminderTime(habit(october(1, 3, 6, 7)), now).target)).toBe('08:15');
    expect(clock(computeSmartReminderTime(habit(), now).target)).toBe('07:30');
  });

  it('do not treat a habit as at risk just because today is not done yet', () => {
    // Today's progress is 0 until the habit is checked off; a good week still counts as going well.
    expect(computeSmartReminderTime(habit(october(1, 2, 3, 4, 5, 6, 7)), now).riskLevel).toBe('low');
  });
});
