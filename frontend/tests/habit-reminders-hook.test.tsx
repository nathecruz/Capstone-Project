import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import type { Habit, Preferences } from '@/hooks/app-state/types';
import { useHabitReminders } from '@/hooks/app-state/use-habit-reminders';

jest.mock('@/authentication/authService', () => ({ getApiBaseUrl: jest.fn(), getAuthenticatedHeaders: jest.fn(), getWebPushVapidPublicKey: jest.fn(), saveWebPushSubscription: jest.fn(), sendTestWebPush: jest.fn() }));

type Listener = (response: unknown) => void;
const mockNotifications = {
  listeners: [] as Listener[],
  setNotificationCategoryAsync: jest.fn(async () => undefined),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async (_request: { content: Record<string, unknown>; trigger: { date: Date } }) => 'id'),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn((listener: Listener) => {
    mockNotifications.listeners.push(listener);
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

// iOS (jest-expo's platform) gives the notification's date in seconds.
function snoozeResponse(shownAt: Date) {
  return {
    actionIdentifier: 'SNOOZE',
    notification: {
      date: shownAt.getTime() / 1000,
      request: { identifier: `gym-${shownAt.getTime()}`, content: { title: 'Gym reminder', body: 'A small step today keeps your streak moving.', data: { habitId: 'gym', snoozeCount: 0 } } },
    },
  };
}

const scheduled = () => mockNotifications.scheduleNotificationAsync.mock.calls.map(([request]) => request);

describe('reminders scheduled by the Android and iOS app', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    mockNotifications.listeners = [];
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('schedules no "still open" nudge after the last reminder, and no Snooze where it cannot come back in time', async () => {
    renderHook(() => useHabitReminders({ habits: [gym], preferences, ringInterval: 20, snoozeFrequency: 'Once' }));
    await settle();
    const requests = scheduled();
    expect(requests.map((request) => request.content.title)).toEqual(['Gym reminder', 'Gym reminder']);
    expect(requests.some((request) => (request.content.data as { type?: string }).type === 'missed-habit')).toBe(false);
    // 11:00 + 20 minutes is still before 11:30; a snooze of the 11:30 reminder always comes back after it.
    const category = (hour: number, minute: number) => requests.find((request) => request.trigger.date.getHours() === hour && request.trigger.date.getMinutes() === minute)?.content.categoryIdentifier;
    expect(category(11, 0)).toBe('habit-reminder-snooze');
    expect(category(11, 30)).toBeUndefined();
  });

  it('does not set a snooze that would come back after the habit is missed', async () => {
    renderHook(() => useHabitReminders({ habits: [gym], preferences, ringInterval: 20, snoozeFrequency: '2 times' }));
    await settle();
    mockNotifications.scheduleNotificationAsync.mockClear();
    // 11:15 + 20 minutes is 11:35, past the 11:30 deadline.
    await act(async () => { mockNotifications.listeners.forEach((listener) => listener(snoozeResponse(now))); });
    await settle();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('ignores Snooze on an older day\'s reminder even before the habits have loaded', async () => {
    // The app can be woken by the Snooze tap before its habits are read: no habit to check yet.
    renderHook(() => useHabitReminders({ habits: [], preferences, ringInterval: 30, snoozeFrequency: 'Once' }));
    await settle();
    await act(async () => { mockNotifications.listeners.forEach((listener) => listener(snoozeResponse(new Date(2026, 9, 18, 21, 0)))); });
    await settle();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    // Today's reminder is still snoozed.
    await act(async () => { mockNotifications.listeners.forEach((listener) => listener(snoozeResponse(new Date(2026, 9, 19, 11, 0)))); });
    await settle();
    expect(scheduled()).toHaveLength(1);
  });

  it('sets a snooze that comes back in time, without another Snooze that could not, and none from an older reminder', async () => {
    renderHook(() => useHabitReminders({ habits: [gym], preferences, ringInterval: 10, snoozeFrequency: '2 times' }));
    await settle();
    mockNotifications.scheduleNotificationAsync.mockClear();
    await act(async () => { mockNotifications.listeners.forEach((listener) => listener(snoozeResponse(now))); });
    await settle();
    expect(scheduled()).toHaveLength(1);
    expect(scheduled()[0].trigger.date).toEqual(new Date(2026, 9, 19, 11, 25));
    // Snoozed again at 11:25 it would come back at 11:35, after the deadline: no Snooze button.
    expect(scheduled()[0].content.categoryIdentifier).toBeUndefined();

    mockNotifications.scheduleNotificationAsync.mockClear();
    // Snooze tapped today on yesterday's reminder: that day is over.
    await act(async () => { mockNotifications.listeners.forEach((listener) => listener(snoozeResponse(new Date(2026, 9, 18, 11, 0)))); });
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
    const { unmount } = renderHook(() => useHabitReminders({ habits: [gym], preferences, ringInterval: 20, snoozeFrequency: 'Once' }));
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
