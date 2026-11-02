// The phone's reminders as the reminder check shows them (hooks/app-state/reminders.ts): the next
// ones set on the phone, soonest first, and a test reminder a minute later on the reminders' channel.
import { Platform } from 'react-native';
import { nextPhoneReminders, scheduleTestReminder, type NotificationsModule } from '@/hooks/app-state/reminders';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/authService', () => ({ getWebPushVapidPublicKey: jest.fn(), saveWebPushSubscription: jest.fn(), sendTestWebPush: jest.fn() }));

const now = Date.parse('2026-11-02T10:00:00Z');
const plan = (at: number) => JSON.stringify([at, { title: 'x' }, true, true]);
const notifications = (scheduled: object[]) => ({
  getAllScheduledNotificationsAsync: jest.fn(async () => scheduled),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'habitai-test-reminder'),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
  AndroidImportance: { HIGH: 4 },
}) as unknown as NotificationsModule & { scheduleNotificationAsync: jest.Mock; setNotificationChannelAsync: jest.Mock };

const nativeOS = Platform.OS;
afterEach(() => Object.defineProperty(Platform, 'OS', { value: nativeOS, configurable: true }));

describe("the phone's reminders", () => {
  it('lists the next habit reminders and snoozes, soonest first, without past or other notifications', async () => {
    const module = notifications([
      { identifier: 'habitai-reminder:read:2026-11-03:19:00', content: { title: 'Read · 7:00 PM', data: { plan: plan(now + 2 * 3_600_000) } } },
      { identifier: 'habitai-snooze:walk', content: { title: 'Walk · 5:30 PM', data: { snoozeAt: now + 600_000 } } },
      { identifier: 'habitai-reminder:old:2026-11-01:08:00', content: { title: 'Old', data: { plan: plan(now - 1) } } },
      { identifier: 'habitai-reminder:broken', content: { title: 'Broken', data: { plan: 'not json' } } },
      { identifier: 'something-else', content: { title: 'Other', data: { snoozeAt: now + 1 } } },
      { identifier: 'habitai-reminder:gym:2026-11-04:06:00', content: { title: 'Gym · 6:00 AM', data: { plan: plan(now + 9 * 3_600_000) } } },
      { identifier: 'habitai-reminder:pray:2026-11-05:06:00', content: { title: 'Pray · 6:00 AM', data: { plan: plan(now + 30 * 3_600_000) } } },
    ]);
    expect(await nextPhoneReminders(module, 3, now)).toEqual([
      { title: 'Walk · 5:30 PM', at: now + 600_000 },
      { title: 'Read · 7:00 PM', at: now + 2 * 3_600_000 },
      { title: 'Gym · 6:00 AM', at: now + 9 * 3_600_000 },
    ]);
  });

  it('sets a test reminder a minute later, on the reminders\' channel on Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const module = notifications([]);
    await scheduleTestReminder(module, 60);
    expect(module.setNotificationChannelAsync).toHaveBeenCalledWith('habit-reminders-sound-v2', expect.objectContaining({ sound: 'reminder_sound.mp3' }));
    expect(module.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      identifier: 'habitai-test-reminder',
      trigger: { type: 'timeInterval', seconds: 60, channelId: 'habit-reminders-sound-v2' },
    }));
  });
});
