import type { Habit } from '@/hooks/app-state/types';
import { canRemindAt, canSnoozeAt } from '@/hooks/app-state/reminders';

jest.mock('@/authentication/authService', () => ({ getApiBaseUrl: jest.fn(), getAuthenticatedHeaders: jest.fn(), getWebPushVapidPublicKey: jest.fn(), saveWebPushSubscription: jest.fn(), sendTestWebPush: jest.fn() }));

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'gym', startDate: '2026-09-01', label: 'Gym', meta: 'Daily • 11:30 AM', category: 'Health', frequency: 'Daily', icon: 'barbell-outline', color: '#E58D8D',
    goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: true, reminderTime: '11:30 AM', reminderTimes: ['11:30 AM'], ...overrides,
  };
}

// Monday Oct 19, 2026.
const at = (hour: number, minute = 0, day = 19) => new Date(2026, 9, day, hour, minute);

describe('reminders for missed habits', () => {
  it('reminds until the last reminder time, and not once the habit is missed', () => {
    const gym = habit();
    expect(canRemindAt(gym, at(11, 0), at(11, 0))).toBe(true);
    // Its last reminder time is the deadline: still open during that minute.
    expect(canRemindAt(gym, at(11, 30), at(11, 30))).toBe(true);
    expect(canRemindAt(gym, at(11, 31), at(11, 31))).toBe(false);
    expect(canRemindAt(gym, at(11, 55), at(11, 55))).toBe(false);
  });

  it('keeps reminding while a later reminder time is still ahead', () => {
    const twice = habit({ reminderTimes: ['11:30 AM', '08:00 PM'] });
    expect(canRemindAt(twice, at(11, 55), at(11, 55))).toBe(true);
    expect(canRemindAt(twice, at(20, 1), at(20, 1))).toBe(false);
  });

  it('does not remind of a habit already done today', () => {
    expect(canRemindAt(habit({ completionDates: ['2026-10-19'] }), at(9, 0), at(9, 0))).toBe(false);
  });

  it('drops a snooze that would come back after the habit is missed or on the next day', () => {
    const gym = habit();
    expect(canRemindAt(gym, at(11, 25), at(11, 15))).toBe(true);
    expect(canRemindAt(gym, at(11, 45), at(11, 15))).toBe(false);
    // Without a reminder there is no deadline, but a snooze past midnight is for a day that is over.
    const anytime = habit({ reminderEnabled: false });
    expect(canRemindAt(anytime, at(23, 50), at(23, 30))).toBe(true);
    expect(canRemindAt(anytime, at(0, 10, 20), at(23, 50))).toBe(false);
  });

  it('offers Snooze only when it comes back before the last reminder time', () => {
    const twice = habit({ reminderTimes: ['07:00 AM', '08:00 PM'] });
    expect(canSnoozeAt(twice, 7 * 60, 30)).toBe(true);
    // The last reminder is the deadline: any snooze of it lands after.
    expect(canSnoozeAt(twice, 20 * 60, 1)).toBe(false);
    expect(canSnoozeAt(twice, 19 * 60 + 30, 30)).toBe(true);
    expect(canSnoozeAt(twice, 19 * 60 + 31, 30)).toBe(false);
    // Reminders off: until the end of the day.
    expect(canSnoozeAt(habit({ reminderEnabled: false }), 23 * 60, 30)).toBe(true);
    expect(canSnoozeAt(habit({ reminderEnabled: false }), 23 * 60 + 45, 30)).toBe(false);
  });
});
