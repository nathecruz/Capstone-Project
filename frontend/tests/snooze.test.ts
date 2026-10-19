import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotificationRequest, NotificationResponse } from 'expo-notifications';
import { keepsSnooze, loadSnoozeSettings, responseFromTaskPayload, snoozeReminder } from '@/hooks/app-state/snooze';
import type { Habit } from '@/hooks/app-state/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/authService', () => ({ getApiBaseUrl: jest.fn(), getAuthenticatedHeaders: jest.fn(), getWebPushVapidPublicKey: jest.fn(), saveWebPushSubscription: jest.fn(), sendTestWebPush: jest.fn() }));

const gym: Habit = {
  id: 'gym', startDate: '2026-09-01', label: 'Gym', meta: 'Daily • 11:00 AM, 11:30 AM', category: 'Health', frequency: 'Daily', icon: 'barbell-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: true, reminderTime: '11:00 AM', reminderTimes: ['11:00 AM', '11:30 AM'],
};
// Monday, October 19, 2026; Gym's last reminder (its deadline) is at 11:30.
const at = (hour: number, minute: number) => new Date(2026, 9, 19, hour, minute);
const request = (data: Record<string, unknown>) => ({ identifier: 'x', content: { data }, trigger: null }) as unknown as NotificationRequest;

const Notifications = {
  scheduleNotificationAsync: jest.fn(async (_request: Record<string, unknown>) => 'id'),
  SchedulableTriggerInputTypes: { DATE: 'date' },
};
let tapCount = 0;
function snoozeTap(shownAt: Date, data: Record<string, unknown> = { habitId: 'gym', snoozeCount: 0 }) {
  tapCount += 1;
  return {
    actionIdentifier: 'SNOOZE',
    notification: { date: shownAt.getTime(), request: { identifier: `tap-${tapCount}`, content: { title: 'Gym reminder', body: 'Go', data } } },
  } as unknown as NotificationResponse;
}
const snooze = (response: NotificationResponse, settings = { habits: [gym], ringInterval: 10, snoozeFrequency: '2 times' }, now = at(11, 15)) =>
  snoozeReminder(Notifications as never, response, settings, now);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('which pending snoozes stay when the reminders are scheduled again', () => {
  it('keeps a snooze that comes back while the habit can still be checked in', () => {
    expect(keepsSnooze(request({ habitId: 'gym', snoozeCount: 1, snoozeAt: at(11, 25).getTime() }), [gym], at(11, 15))).toBe(true);
  });

  it('drops regular reminders (scheduled again) and snoozes that are no use any more', () => {
    expect(keepsSnooze(request({ habitId: 'gym', snoozeCount: 0 }), [gym], at(11, 15))).toBe(false);
    expect(keepsSnooze(request({ habitId: 'gym', snoozeCount: 1, snoozeAt: at(11, 35).getTime() }), [gym], at(11, 15))).toBe(false);
    expect(keepsSnooze(request({ habitId: 'gym', snoozeCount: 1, snoozeAt: at(11, 25).getTime() }), [{ ...gym, completionDates: ['2026-10-19'] }], at(11, 15))).toBe(false);
    expect(keepsSnooze(request({ habitId: 'gym', snoozeCount: 1, snoozeAt: at(11, 25).getTime() }), [{ ...gym, reminderEnabled: false }], at(11, 15))).toBe(false);
    expect(keepsSnooze(request({ habitId: 'gone', snoozeCount: 1, snoozeAt: at(11, 25).getTime() }), [gym], at(11, 15))).toBe(false);
  });

  it('keeps a snooze from an older version (no time saved) while the habit is still open', () => {
    expect(keepsSnooze(request({ habitId: 'gym', snoozeCount: 1 }), [gym], at(11, 15))).toBe(true);
    expect(keepsSnooze(request({ habitId: 'gym', snoozeCount: 1 }), [gym], at(11, 31))).toBe(false);
  });
});

describe('a tapped Snooze', () => {
  it('schedules one snooze per habit, with the time it comes back', async () => {
    expect(await snooze(snoozeTap(at(11, 0)))).toBe(true);
    const [scheduled] = Notifications.scheduleNotificationAsync.mock.calls[0] as [{ identifier: string; content: { data: Record<string, unknown> }; trigger: { date: Date } }];
    expect(scheduled.identifier).toBe('habitai-snooze:gym');
    expect(scheduled.trigger.date).toEqual(at(11, 25));
    expect(scheduled.content.data).toEqual({ habitId: 'gym', snoozeCount: 1, snoozeAt: at(11, 25).getTime() });
  });

  it('is handled once, even when the app and the background task both get it, or after a restart', async () => {
    const tap = snoozeTap(at(11, 0));
    expect(await snooze(tap)).toBe(true);
    expect(await snooze(tap)).toBe(false);
    // A tap a previous run of the app already handled (saved on the device).
    await AsyncStorage.setItem('habitai_handled_snoozes', JSON.stringify(['earlier-tap:SNOOZE']));
    const earlier = { ...snoozeTap(at(11, 0)), notification: { ...snoozeTap(at(11, 0)).notification, request: { identifier: 'earlier-tap', content: { title: 'Gym reminder', data: { habitId: 'gym', snoozeCount: 0 } } } } } as unknown as NotificationResponse;
    expect(await snooze(earlier)).toBe(false);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});

describe('the background task (Android, HabitAI closed)', () => {
  it('reads the response from its payload, where the data is still a JSON string', () => {
    const response = responseFromTaskPayload({
      actionIdentifier: 'SNOOZE',
      notification: { date: at(11, 0).getTime(), request: { identifier: 'abc', content: { title: 'Gym reminder', dataString: '{"habitId":"gym","snoozeCount":0}' } } },
    });
    expect(response?.actionIdentifier).toBe('SNOOZE');
    expect(response?.notification.request.identifier).toBe('abc');
    expect(response?.notification.request.content.data).toEqual({ habitId: 'gym', snoozeCount: 0 });
    expect(response?.notification.date).toBe(at(11, 0).getTime());
    // A notification that was received, not answered.
    expect(responseFromTaskPayload({ notification: { request: { identifier: 'abc' } } })).toBeNull();
    expect(responseFromTaskPayload(null)).toBeNull();
  });

  it('uses the habits and snooze settings saved on the device for the signed-in account', async () => {
    expect(await loadSnoozeSettings()).toBeNull();
    await AsyncStorage.setItem('habitai_session', JSON.stringify({ email: 'Student@Example.com', fullName: 'A Student' }));
    await AsyncStorage.setItem('habitai_app_state:student@example.com', JSON.stringify({ habits: [gym], ringInterval: 15, snoozeFrequency: '3 times', preferences: { notificationsEnabled: false } }));
    expect(await loadSnoozeSettings()).toEqual({ habits: [gym], ringInterval: 15, snoozeFrequency: '3 times', notificationsEnabled: false });
  });
});
