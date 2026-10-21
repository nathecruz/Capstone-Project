// Habits last one week (utils/habit-week.ts): a habit whose week has ended gets no reminders, on the
// phone (the two-week plan, snoozes) or in an open tab, and no snooze.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotificationRequest, NotificationResponse } from 'expo-notifications';
import { planReminders } from '@/hooks/app-state/native-reminders';
import { isHabitReminderDay } from '@/hooks/app-state/reminders';
import { keepsSnooze, snoozeReminder } from '@/hooks/app-state/snooze';
import type { Habit } from '@/hooks/app-state/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/authService', () => ({ getApiBaseUrl: jest.fn(), getAuthenticatedHeaders: jest.fn(), getWebPushVapidPublicKey: jest.fn(), saveWebPushSubscription: jest.fn(), sendTestWebPush: jest.fn() }));

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'gym', startDate: '2026-10-19', activeUntil: '2026-10-25', label: 'Gym', meta: 'Daily • 08:00 AM', category: 'Health', frequency: 'Daily', icon: 'barbell-outline', color: '#E58D8D',
    goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: true, reminderTime: '08:00 AM', reminderTimes: ['08:00 AM'], ...overrides,
  };
}

// October 2026: the 19th is a Monday, the 25th the Sunday ending that week.
const at = (day: number, hour: number, minute = 0, month = 9) => new Date(2026, month, day, hour, minute);
const dates = (habits: Habit[], now: Date) => planReminders(habits, now, { ringInterval: 20, limit: 200 }).map((reminder) => reminder.date);
// Last week's habit (October 12 to 18).
const lastWeek = habit({ id: 'old', label: 'Old', startDate: '2026-10-12', activeUntil: '2026-10-18' });

describe('reminder days', () => {
  it('stop after the last day of the habit\'s week', () => {
    expect(isHabitReminderDay(habit(), at(25, 9))).toBe(true);
    expect(isHabitReminderDay(habit(), at(26, 9))).toBe(false);
    // A habit from an older app version (no last active day yet) has no end.
    expect(isHabitReminderDay(habit({ activeUntil: undefined }), at(26, 9))).toBe(true);
  });
});

describe('reminders planned on the phone', () => {
  it('never come after the end of the habit\'s week, even within the two weeks planned', () => {
    expect(dates([habit()], at(19, 6))).toEqual(Array.from({ length: 7 }, (_, day) => at(19 + day, 8)));
    // Without a last active day: the full two weeks, as before.
    expect(dates([habit({ activeUntil: undefined })], at(19, 6))).toHaveLength(14);
  });

  it('plan nothing for a habit whose week has ended', () => {
    expect(dates([lastWeek], at(19, 6))).toEqual([]);
    expect(dates([lastWeek, habit()], at(19, 6))).toEqual(dates([habit()], at(19, 6)));
  });

  it('skip a monthly habit\'s next day when it falls after the habit\'s week', () => {
    const monthly = habit({ frequency: 'Monthly', startDate: '2026-10-19', meta: 'Monthly • 08:00 AM' });
    expect(dates([monthly], at(19, 6))).toEqual([at(19, 8)]);
    expect(dates([monthly], at(19, 9))).toEqual([]);
  });
});

describe('snoozes', () => {
  const request = (data: Record<string, unknown>) => ({ identifier: 'x', content: { data }, trigger: null }) as unknown as NotificationRequest;
  const Notifications = { scheduleNotificationAsync: jest.fn(async (_request: Record<string, unknown>) => 'id'), SchedulableTriggerInputTypes: { DATE: 'date' } };
  const tap = (shownAt: Date, habitId: string) => ({
    actionIdentifier: 'SNOOZE',
    notification: { date: shownAt.getTime(), request: { identifier: `tap-${habitId}-${shownAt.getTime()}`, content: { title: 'Reminder', body: 'Go', data: { habitId, snoozeCount: 0 } } } },
  }) as unknown as NotificationResponse;

  // A second reminder in the evening: a snooze of the morning one comes back before the deadline.
  const twice = { reminderTimes: ['08:00 AM', '09:00 PM'] };
  const gym = habit(twice);
  const old = { ...lastWeek, ...twice };

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('are dropped for a habit whose week has ended when the reminders are scheduled again', () => {
    const snoozeAt = at(19, 8, 20).getTime();
    expect(keepsSnooze(request({ habitId: 'gym', snoozeCount: 1, snoozeAt }), [gym], at(19, 8, 5))).toBe(true);
    expect(keepsSnooze(request({ habitId: 'old', snoozeCount: 1, snoozeAt }), [old], at(19, 8, 5))).toBe(false);
    // From an older version (no time saved): kept only while the habit is open now.
    expect(keepsSnooze(request({ habitId: 'old', snoozeCount: 1 }), [old], at(19, 8, 5))).toBe(false);
  });

  it('are not set for a habit whose week has ended, e.g. from the settings saved on the device', async () => {
    // The settings loaded from storage hold every habit, also last week's.
    const settings = { habits: [old, gym], ringInterval: 10, snoozeFrequency: 'Once' };
    expect(await snoozeReminder(Notifications as never, tap(at(19, 8), 'old'), settings, at(19, 8, 1))).toBe(false);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(await snoozeReminder(Notifications as never, tap(at(19, 8), 'gym'), settings, at(19, 8, 1))).toBe(true);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});
