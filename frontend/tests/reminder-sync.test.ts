// The Android background reminder sync (hooks/app-state/reminder-sync.ts): while HabitAI is not
// open, a habit added on another device gets its reminders on this phone, from the server's state
// fetched only when the server says it changed; this phone's unsent changes are kept; and every
// reminder is scheduled again, which sets its alarm again.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getRemoteAppState, getRemoteStateVersion, getStateSyncToken } from '@/authentication/authService';
import { getCurrentSession } from '@/authentication/session';
import { keepSyncToken, syncRemindersInBackground } from '@/hooks/app-state/reminder-sync';
import { requestHabitPrediction } from '@/hooks/app-state/smart-reminders';
import type { Habit } from '@/hooks/app-state/types';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/authentication/authService', () => ({
  getRemoteAppState: jest.fn(),
  getRemoteStateVersion: jest.fn(),
  getStateSyncToken: jest.fn(),
  getApiBaseUrl: jest.fn(),
  getAuthenticatedHeaders: jest.fn(),
}));
jest.mock('@/hooks/app-state/smart-reminders', () => ({ ...jest.requireActual('@/hooks/app-state/smart-reminders'), requestHabitPrediction: jest.fn(async () => null) }));

type ScheduledRequest = { identifier: string; content: { data: Record<string, unknown> } };
let mockPending: ScheduledRequest[] = [];
const mockNotifications = {
  setNotificationCategoryAsync: jest.fn(async () => undefined),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getAllScheduledNotificationsAsync: jest.fn(async () => mockPending),
  cancelScheduledNotificationAsync: jest.fn(async (identifier: string) => {
    mockPending = mockPending.filter((item) => item.identifier !== identifier);
  }),
  scheduleNotificationAsync: jest.fn(async (request: { identifier: string; content: { data: Record<string, unknown> } }) => {
    mockPending = [...mockPending.filter((item) => item.identifier !== request.identifier), { identifier: request.identifier, content: { data: request.content.data } }];
    return request.identifier;
  }),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { HIGH: 4 },
};
jest.mock('@/hooks/app-state/reminders', () => ({ ...jest.requireActual('@/hooks/app-state/reminders'), getNotificationsModule: jest.fn(async () => mockNotifications) }));

const email = 'student@example.com';
// Monday 2 November 2026, 8 AM: this week's habits run to Sunday the 8th.
const now = new Date(2026, 10, 2, 8, 0);
const habit = (id: string, reminderTime: string): Habit => ({
  id, label: id, startDate: '2026-11-02', activeUntil: '2026-11-08', meta: `Daily • ${reminderTime}`, category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: true, reminderTime, reminderTimes: [reminderTime],
});
const saveDevice = (habits: Habit[]) => AsyncStorage.setItem(`habitai_app_state:${email}`, JSON.stringify({ habits, preferences: { notificationsEnabled: true }, ringInterval: 30, goals: [{ id: 'goal' }] }));
const device = async () => JSON.parse((await AsyncStorage.getItem(`habitai_app_state:${email}`)) ?? 'null') as { habits: Habit[]; goals: unknown[] };
const scheduledHabits = () => [...new Set(mockPending.map((item) => item.content.data.habitId))].sort();
const settle = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

const nativeOS = Platform.OS;
beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  mockPending = [];
  await AsyncStorage.clear();
  jest.mocked(getCurrentSession).mockResolvedValue({ email, fullName: 'A Student' } as Awaited<ReturnType<typeof getCurrentSession>>);
  await AsyncStorage.setItem(`habitai_sync_base:${email}`, JSON.stringify({ updatedAt: 1000, state: { habits: [] } }));
  await AsyncStorage.setItem(`habitai_state_sync:${email}`, JSON.stringify({ token: 'sync-token', expiresAt: now.getTime() + 30 * 86_400_000 }));
});
afterEach(() => {
  jest.useRealTimers();
  Object.defineProperty(Platform, 'OS', { value: nativeOS, configurable: true });
});

describe('the background reminder sync', () => {
  it('schedules the reminders of a habit added on another device, fetching the state once', async () => {
    await saveDevice([habit('read', '07:00 PM')]);
    jest.mocked(getRemoteStateVersion).mockResolvedValue({ ok: true, updatedAt: 2000 });
    jest.mocked(getRemoteAppState).mockResolvedValue({
      ok: true,
      updatedAt: 2000,
      state: { habits: [habit('read', '07:00 PM'), habit('web', '09:00 PM')], preferences: { notificationsEnabled: true }, ringInterval: 30 } as never,
      completions: [],
    });
    expect(await syncRemindersInBackground(now)).toBe('scheduled');
    expect(getRemoteStateVersion).toHaveBeenCalledWith('sync-token');
    // Not counted as the student using HabitAI.
    expect(getRemoteAppState).toHaveBeenCalledWith(null, { background: true });
    expect(scheduledHabits()).toEqual(['read', 'web']);
    // Today's 9 PM and the rest of the week, up to Sunday.
    expect(mockPending.filter((item) => item.content.data.habitId === 'web')).toHaveLength(7);
    // Saved on the phone as the app saves it, with this phone's goals when the server has none.
    await settle();
    expect((await device()).habits.map((item) => item.id)).toEqual(['read', 'web']);
    expect((await device()).goals).toEqual([{ id: 'goal' }]);
    expect(JSON.parse((await AsyncStorage.getItem(`habitai_sync_base:${email}`)) ?? '{}').updatedAt).toBe(2000);
    // The next run, with nothing newer, asks only whether something changed.
    jest.mocked(getRemoteAppState).mockClear();
    jest.mocked(getRemoteStateVersion).mockResolvedValue({ ok: true, updatedAt: 2000 });
    await syncRemindersInBackground(now);
    expect(getRemoteAppState).not.toHaveBeenCalled();
    expect(requestHabitPrediction).not.toHaveBeenCalled();
  });

  it('leaves out today for a habit checked in on another device', async () => {
    await saveDevice([habit('read', '07:00 PM')]);
    jest.mocked(getRemoteStateVersion).mockResolvedValue({ ok: true, updatedAt: 3000 });
    jest.mocked(getRemoteAppState).mockResolvedValue({ ok: true, updatedAt: 3000, state: { habits: [habit('read', '07:00 PM')] } as never, completions: [{ habitId: 'read', date: '2026-11-02' }] });
    await syncRemindersInBackground(now);
    expect(mockPending.some((item) => String(item.identifier).includes(':2026-11-02:'))).toBe(false);
    expect(mockPending.some((item) => String(item.identifier).includes(':2026-11-03:'))).toBe(true);
  });

  it('keeps the changes this phone has not sent yet, and asks the server nothing', async () => {
    await saveDevice([habit('read', '07:00 PM'), habit('offline', '06:00 PM')]);
    await AsyncStorage.setItem(`habitai_unsaved:${email}`, '1');
    await syncRemindersInBackground(now);
    expect(getRemoteStateVersion).not.toHaveBeenCalled();
    expect(scheduledHabits()).toEqual(['offline', 'read']);
  });

  it('sets every reminder again, also one already scheduled, which sets its alarm again', async () => {
    await saveDevice([habit('read', '07:00 PM')]);
    jest.mocked(getRemoteStateVersion).mockResolvedValue(null);
    await syncRemindersInBackground(now);
    const first = mockNotifications.scheduleNotificationAsync.mock.calls.length;
    await syncRemindersInBackground(now);
    expect(mockNotifications.scheduleNotificationAsync.mock.calls.length).toBe(first * 2);
  });

  it('drops a token the server no longer takes, and still schedules from the phone', async () => {
    await saveDevice([habit('read', '07:00 PM')]);
    jest.mocked(getRemoteStateVersion).mockResolvedValue({ ok: false, invalid: true });
    expect(await syncRemindersInBackground(now)).toBe('scheduled');
    expect(await AsyncStorage.getItem(`habitai_state_sync:${email}`)).toBeNull();
    expect(scheduledHabits()).toEqual(['read']);
  });

  it('does nothing when signed out, or before the account was opened on this phone', async () => {
    expect(await syncRemindersInBackground(now)).toBe('skipped');
    jest.mocked(getCurrentSession).mockResolvedValue(null);
    await saveDevice([habit('read', '07:00 PM')]);
    expect(await syncRemindersInBackground(now)).toBe('skipped');
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('the sync token', () => {
  it('is asked for while the app is open only when missing or close to expiry', async () => {
    jest.mocked(getStateSyncToken).mockResolvedValue({ token: 'new-token', expiresAt: now.getTime() + 60 * 86_400_000 });
    await keepSyncToken(email, now.getTime());
    expect(getStateSyncToken).not.toHaveBeenCalled();
    await keepSyncToken(email, now.getTime() + 25 * 86_400_000);
    expect(getStateSyncToken).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await AsyncStorage.getItem(`habitai_state_sync:${email}`)) ?? '{}').token).toBe('new-token');
  });
});
