import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import type { Habit, Preferences } from '@/hooks/app-state/types';
import { useHabitReminders } from '@/hooks/app-state/use-habit-reminders';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/authService', () => ({ getApiBaseUrl: jest.fn(), getAuthenticatedHeaders: jest.fn(), getWebPushVapidPublicKey: jest.fn(), saveWebPushSubscription: jest.fn(), sendTestWebPush: jest.fn() }));

type Listener = (response: unknown) => void;
type ScheduledRequest = { identifier: string; content: { data: Record<string, unknown> } };
// What getAllScheduledNotificationsAsync returns: the notifications scheduled before.
let mockPending: ScheduledRequest[] = [];
const mockListeners: Listener[] = [];
const mockNotifications = {
  setNotificationCategoryAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => mockPending),
  cancelScheduledNotificationAsync: jest.fn(async (_identifier: string) => undefined),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async (_request: { content: Record<string, unknown>; trigger: { date: Date } }) => 'id'),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn((listener: Listener) => {
    mockListeners.push(listener);
    return { remove: jest.fn() };
  }),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { HIGH: 4 },
};

const mockRegistration = {
  getNotifications: jest.fn(async () => []),
  showNotification: jest.fn(async (_title: string, _options: Record<string, unknown>) => undefined),
};

jest.mock('@/hooks/app-state/reminders', () => ({
  ...jest.requireActual('@/hooks/app-state/reminders'),
  getNotificationsModule: jest.fn(async () => mockNotifications),
  getBrowserNotificationRegistration: jest.fn(async () => mockRegistration),
  enableWebReminders: jest.fn(),
  playReminderSound: jest.fn(),
}));
jest.mock('@/hooks/app-state/smart-reminders', () => ({
  ...jest.requireActual('@/hooks/app-state/smart-reminders'),
  requestHabitPrediction: jest.fn(async () => null),
}));

const gym: Habit = {
  id: 'gym', startDate: '2026-09-01', label: 'Gym', meta: 'Daily • 11:00 AM, 11:30 AM', category: 'Health', frequency: 'Daily', icon: 'barbell-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: true, reminderTime: '11:00 AM', reminderTimes: ['11:00 AM', '11:30 AM'],
};
const preferences = { notificationsEnabled: true } as Preferences;
// Monday, October 19, 2026, 11:15 AM: the habit's last reminder (its deadline) is at 11:30.
const now = new Date(2026, 9, 19, 11, 15);

async function settle() {
  for (let round = 0; round < 10; round += 1) await act(async () => { await Promise.resolve(); });
}

// iOS (jest-expo's platform) gives the notification's date in seconds. Each tap is a new notification.
let tapCount = 0;
function snoozeResponse(shownAt: Date) {
  tapCount += 1;
  return {
    actionIdentifier: 'SNOOZE',
    notification: {
      date: shownAt.getTime() / 1000,
      request: { identifier: `gym-${tapCount}`, content: { title: 'Gym reminder', body: 'A small step today keeps your streak moving.', data: { habitId: 'gym', snoozeCount: 0 } } },
    },
  };
}

const scheduled = () => mockNotifications.scheduleNotificationAsync.mock.calls.map(([request]) => request);

describe('reminders scheduled by the Android and iOS app', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    mockListeners.length = 0;
    mockPending = [];
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });
  afterEach(() => jest.useRealTimers());

  it('schedules no "still open" nudge after the last reminder, and no Snooze where it cannot come back in time', async () => {
    renderHook(() => useHabitReminders({ habits: [gym], preferences, ringInterval: 20, snoozeFrequency: 'Once', ready: true }));
    await settle();
    const requests = scheduled();
    expect(requests.map((request) => request.content.title)).toEqual(['Gym reminder', 'Gym reminder']);
    expect(requests.some((request) => (request.content.data as { type?: string }).type === 'missed-habit')).toBe(false);
    // 11:00 + 20 minutes is still before 11:30; a snooze of the 11:30 reminder always comes back after it.
    const category = (hour: number, minute: number) => requests.find((request) => request.trigger.date.getHours() === hour && request.trigger.date.getMinutes() === minute)?.content.categoryIdentifier;
    expect(category(11, 0)).toBe('habit-reminder-snooze');
    expect(category(11, 30)).toBeUndefined();
  });

  it('keeps a pending snooze when the reminders are scheduled again, but not one that is no use any more', async () => {
    const at = (hour: number, minute: number) => new Date(2026, 9, 19, hour, minute).getTime();
    mockPending = [
      { identifier: 'regular', content: { data: { habitId: 'gym', snoozeCount: 0 } } },
      { identifier: 'habitai-snooze:gym', content: { data: { habitId: 'gym', snoozeCount: 1, snoozeAt: at(11, 25) } } },
      { identifier: 'after-deadline', content: { data: { habitId: 'gym', snoozeCount: 1, snoozeAt: at(11, 35) } } },
      { identifier: 'deleted-habit', content: { data: { habitId: 'old', snoozeCount: 1, snoozeAt: at(11, 25) } } },
    ];
    renderHook(() => useHabitReminders({ habits: [gym], preferences, ringInterval: 10, snoozeFrequency: 'Once', ready: true }));
    await settle();
    const cancelled = mockNotifications.cancelScheduledNotificationAsync.mock.calls.map(([identifier]) => identifier);
    expect(cancelled.sort()).toEqual(['after-deadline', 'deleted-habit', 'regular']);

    // Checked in meanwhile: its snooze goes too.
    jest.clearAllMocks();
    renderHook(() => useHabitReminders({ habits: [{ ...gym, completionDates: ['2026-10-19'] }], preferences, ringInterval: 10, snoozeFrequency: 'Once', ready: true }));
    await settle();
    expect(mockNotifications.cancelScheduledNotificationAsync.mock.calls.map(([identifier]) => identifier)).toContain('habitai-snooze:gym');
  });

  it('leaves the scheduled reminders alone until the account has loaded', async () => {
    mockPending = [{ identifier: 'habitai-snooze:gym', content: { data: { habitId: 'gym', snoozeCount: 1 } } }];
    renderHook(() => useHabitReminders({ habits: [], preferences, ringInterval: 30, snoozeFrequency: 'Once', ready: false }));
    await settle();
    expect(mockNotifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('snoozes with the settings saved on the device when the tap opens the app before it has loaded', async () => {
    await AsyncStorage.setItem('habitai_session', JSON.stringify({ email: 'Student@Example.com', fullName: 'A Student' }));
    await AsyncStorage.setItem('habitai_app_state:student@example.com', JSON.stringify({ habits: [gym], ringInterval: 10, snoozeFrequency: 'Once' }));
    renderHook(() => useHabitReminders({ habits: [], preferences, ringInterval: 30, snoozeFrequency: 'Once', ready: false }));
    await settle();
    await act(async () => { mockListeners.forEach((listener) => listener(snoozeResponse(new Date(2026, 9, 19, 11, 0)))); });
    await settle();
    expect(scheduled()).toHaveLength(1);
    expect(scheduled()[0].trigger.date).toEqual(new Date(2026, 9, 19, 11, 25));
    expect((scheduled()[0] as { identifier?: string }).identifier).toBe('habitai-snooze:gym');
  });

  it('does not set a snooze that would come back after the habit is missed', async () => {
    renderHook(() => useHabitReminders({ habits: [gym], preferences, ringInterval: 20, snoozeFrequency: '2 times', ready: true }));
    await settle();
    mockNotifications.scheduleNotificationAsync.mockClear();
    // 11:15 + 20 minutes is 11:35, past the 11:30 deadline.
    await act(async () => { mockListeners.forEach((listener) => listener(snoozeResponse(now))); });
    await settle();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('sets no snooze for a habit that is gone (deleted, or signed out) or with notifications off', async () => {
    renderHook(() => useHabitReminders({ habits: [], preferences, ringInterval: 10, snoozeFrequency: 'Once', ready: true }));
    await settle();
    await act(async () => { mockListeners.forEach((listener) => listener(snoozeResponse(new Date(2026, 9, 19, 11, 0)))); });
    await settle();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    renderHook(() => useHabitReminders({ habits: [gym], preferences: { ...preferences, notificationsEnabled: false }, ringInterval: 10, snoozeFrequency: 'Once', ready: true }));
    await settle();
    await act(async () => { mockListeners.forEach((listener) => listener(snoozeResponse(new Date(2026, 9, 19, 11, 0)))); });
    await settle();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('sets a snooze that comes back in time, without another Snooze that could not, and none from an older reminder', async () => {
    renderHook(() => useHabitReminders({ habits: [gym], preferences, ringInterval: 10, snoozeFrequency: '2 times', ready: true }));
    await settle();
    mockNotifications.scheduleNotificationAsync.mockClear();
    await act(async () => { mockListeners.forEach((listener) => listener(snoozeResponse(now))); });
    await settle();
    expect(scheduled()).toHaveLength(1);
    expect(scheduled()[0].trigger.date).toEqual(new Date(2026, 9, 19, 11, 25));
    // Snoozed again at 11:25 it would come back at 11:35, after the deadline: no Snooze button.
    expect(scheduled()[0].content.categoryIdentifier).toBeUndefined();

    mockNotifications.scheduleNotificationAsync.mockClear();
    // Snooze tapped today on yesterday's reminder: that day is over.
    await act(async () => { mockListeners.forEach((listener) => listener(snoozeResponse(new Date(2026, 9, 18, 11, 0)))); });
    await settle();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('reminders shown by an open HabitAI tab', () => {
  const nativeOS = Platform.OS;
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    (globalThis as { Notification?: unknown }).Notification = { permission: 'granted' };
    jest.clearAllMocks();
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: nativeOS, configurable: true });
    delete (globalThis as { Notification?: unknown }).Notification;
    jest.useRealTimers();
  });

  const shownAt = async (hour: number, minute: number) => {
    jest.useFakeTimers({ now: new Date(2026, 9, 19, hour, minute, 5), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const { unmount } = renderHook(() => useHabitReminders({ habits: [gym], preferences, ringInterval: 20, snoozeFrequency: 'Once', ready: true }));
    await settle();
    unmount();
    return mockRegistration.showNotification.mock.calls.map(([title]) => title);
  };

  it('shows the last reminder on its minute, but not a minute later when the habit is missed', async () => {
    expect(await shownAt(11, 30)).toEqual(['Gym reminder']);
    jest.clearAllMocks();
    // A background tab can run its timer late; by 11:31 the habit is missed and cannot be checked in.
    expect(await shownAt(11, 31)).toEqual([]);
  });
});
