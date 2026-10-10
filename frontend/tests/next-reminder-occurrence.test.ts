import { nextReminderOccurrence } from '@/hooks/app-state/reminders';

jest.mock('@/authentication/authService', () => ({ getApiBaseUrl: jest.fn(), getAuthenticatedHeaders: jest.fn(), getWebPushVapidPublicKey: jest.fn(), saveWebPushSubscription: jest.fn(), sendTestWebPush: jest.fn() }));

const daily = { frequency: 'Daily', startDate: '2026-09-01', meta: 'Daily • 08:00 AM', reminderDays: [] as string[] };
const weeklyMon = { frequency: 'Weekly', startDate: '2026-09-07', meta: 'Weekly • 08:00 AM • Mon', reminderDays: ['Mon'] };
const monthly15 = { frequency: 'Monthly', startDate: '2026-09-15', meta: 'Monthly • 09:00 AM', reminderDays: [] as string[] };
const at8 = { hour: 8, minute: 0 };

describe('nextReminderOccurrence', () => {
  it('schedules today when the set time is still ahead', () => {
    expect(nextReminderOccurrence(daily, at8, new Date(2026, 9, 8, 6, 0))).toEqual(new Date(2026, 9, 8, 8, 0, 0, 0));
  });

  it('moves to tomorrow once the time has passed', () => {
    expect(nextReminderOccurrence(daily, at8, new Date(2026, 9, 8, 9, 0))).toEqual(new Date(2026, 9, 9, 8, 0, 0, 0));
  });

  it('skips today for a habit already done, even before its reminder time', () => {
    expect(nextReminderOccurrence(daily, at8, new Date(2026, 9, 8, 6, 0), true)).toEqual(new Date(2026, 9, 9, 8, 0, 0, 0));
  });

  it('finds the next scheduled weekday for a weekly habit', () => {
    // 2026-10-08 is a Thursday; the next Monday is the 12th.
    expect(nextReminderOccurrence(weeklyMon, at8, new Date(2026, 9, 8, 6, 0))).toEqual(new Date(2026, 9, 12, 8, 0, 0, 0));
  });

  it('finds the monthly day, rolling into the next month once done', () => {
    expect(nextReminderOccurrence(monthly15, { hour: 9, minute: 0 }, new Date(2026, 9, 10, 8, 0))).toEqual(new Date(2026, 9, 15, 9, 0, 0, 0));
    expect(nextReminderOccurrence(monthly15, { hour: 9, minute: 0 }, new Date(2026, 9, 15, 8, 0), true)).toEqual(new Date(2026, 10, 15, 9, 0, 0, 0));
  });
});
