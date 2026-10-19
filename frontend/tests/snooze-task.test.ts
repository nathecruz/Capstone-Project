import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/authService', () => ({ getApiBaseUrl: jest.fn(), getAuthenticatedHeaders: jest.fn(), getWebPushVapidPublicKey: jest.fn(), saveWebPushSubscription: jest.fn(), sendTestWebPush: jest.fn() }));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

const mockNotifications = {
  scheduleNotificationAsync: jest.fn(async (_request: Record<string, unknown>) => 'id'),
  registerTaskAsync: jest.fn(async (_name: string) => null),
  SchedulableTriggerInputTypes: { DATE: 'date' },
};
jest.mock('@/hooks/app-state/reminders', () => ({
  ...jest.requireActual('@/hooks/app-state/reminders'),
  getNotificationsModule: jest.fn(async () => mockNotifications),
}));

// The Android file itself (jest runs as iOS, which resolves the no-op one).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerSnoozeTask, SNOOZE_TASK } = require('@/hooks/app-state/snooze-task.android') as typeof import('@/hooks/app-state/snooze-task.android');

type Executor = (body: { data: unknown }) => Promise<void>;
// Captured now: the mocks' calls are cleared before each test.
const [definedName, executor] = (TaskManager.defineTask as jest.Mock).mock.calls[0] as [string, Executor];

const gym = {
  id: 'gym', startDate: '2026-09-01', label: 'Gym', meta: 'Daily • 11:00 AM, 11:30 AM', category: 'Health', frequency: 'Daily', icon: 'barbell-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: true, reminderTime: '11:00 AM', reminderTimes: ['11:00 AM', '11:30 AM'],
};
// The payload expo-notifications gives the task for a Snooze tapped at 11:15 on the 11:00 reminder.
const payload = (identifier: string) => ({
  actionIdentifier: 'SNOOZE',
  notification: { date: new Date(2026, 9, 19, 11, 0).getTime(), request: { identifier, content: { title: 'Gym reminder', body: 'Go', dataString: '{"habitId":"gym","snoozeCount":0}' } } },
});

describe('the Android background task for Snooze', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 19, 11, 15), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    mockNotifications.scheduleNotificationAsync.mockClear();
    await AsyncStorage.clear();
    await AsyncStorage.setItem('habitai_session', JSON.stringify({ email: 'student@example.com', fullName: 'A Student' }));
  });
  afterEach(() => jest.useRealTimers());

  it('is defined when the app loads and registered with expo-notifications', async () => {
    expect(definedName).toBe(SNOOZE_TASK);
    expect(typeof executor).toBe('function');
    registerSnoozeTask();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockNotifications.registerTaskAsync).toHaveBeenCalledWith(SNOOZE_TASK);
  });

  it('sets the snooze from the habits saved on the device', async () => {
    await AsyncStorage.setItem('habitai_app_state:student@example.com', JSON.stringify({ habits: [gym], ringInterval: 10, snoozeFrequency: 'Once' }));
    await executor({ data: payload('task-1') });
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const [request] = mockNotifications.scheduleNotificationAsync.mock.calls[0] as [{ identifier: string; trigger: { date: Date } }];
    expect(request.identifier).toBe('habitai-snooze:gym');
    expect(request.trigger.date).toEqual(new Date(2026, 9, 19, 11, 25));
  });

  it('sets none when reminders are off, or for anything but Snooze', async () => {
    await AsyncStorage.setItem('habitai_app_state:student@example.com', JSON.stringify({ habits: [gym], ringInterval: 10, preferences: { notificationsEnabled: false } }));
    await executor({ data: payload('task-2') });
    await executor({ data: { ...payload('task-3'), actionIdentifier: 'expo.modules.notifications.actions.DEFAULT' } });
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
