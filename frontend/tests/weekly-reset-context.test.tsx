// The app state's side of habits lasting one week (utils/habit-week.ts): it takes the last active
// days the server gives habits of older app versions, so the sync settles instead of saving again
// and again; it refuses check-ins of ended habits; the streak celebration follows the account
// streak; reminders and the home-screen widget get this week's habits only.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState } from 'react-native';
import { getLocalDateKey } from '@/hooks/app-state/habit-progress';
import { initialPreferences, initialProfile } from '@/hooks/app-state/types';
import { ColorSchemeProvider, useAppColorScheme, type Habit } from '@/hooks/color-scheme-context';
import { saveRemoteAppState, saveRemoteHabitCompletion } from '@/authentication/authService';
import { weekEndKey } from '@/utils/habit-week';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/session', () => ({
  getCurrentSession: jest.fn(async () => ({ email: 'student@example.com', fullName: 'A Student', role: 'user', region: 'Philippines' })),
  subscribeToAuthChanges: jest.fn(() => () => undefined),
}));

// A small stand-in for the server: its latest snapshot, saved and checked in like
// PUT /api/app-state and PUT /api/habit-completions do, giving every habit without a last active
// day the end of this week.
type Snapshot = { updatedAt: number; state: { habits: Record<string, unknown>[] } & Record<string, unknown> };
let mockServer: Snapshot;
// How long the server takes to answer a check-in (ms).
let mockCheckInDelay = 0;
const mockTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
function mockStamp(state: Snapshot['state']) {
  const end = weekEndKey(getLocalDateKey());
  return { ...state, habits: state.habits.map((habit) => (/^\d{4}-\d{2}-\d{2}$/.test(String(habit.activeUntil ?? '')) ? habit : { ...habit, activeUntil: end })) };
}
function mockSaveState(state: Snapshot['state'], base: { updatedAt: number } | null) {
  const merged = Number(base?.updatedAt) !== mockServer.updatedAt;
  mockServer = { updatedAt: mockServer.updatedAt + 1, state: mockStamp(merged ? mockServer.state : state) };
  return { ok: true, state: mockServer.state, updatedAt: mockServer.updatedAt, merged };
}
function mockCheckIn({ habitId, date, completed }: { habitId: string; date: string; completed: boolean }) {
  const habit = mockServer.state.habits.find((item) => item.id === habitId);
  // The server's habit has ended: 409 HABIT_ENDED, which the app gets as a refusal.
  if (!habit || (typeof habit.activeUntil === 'string' && date > habit.activeUntil)) return { rejected: true };
  const habits = mockServer.state.habits.map((item) => {
    if (item.id !== habitId) return item;
    const dates = new Set(item.completionDates as string[]);
    if (completed) dates.add(date);
    else dates.delete(date);
    return { ...item, completionDates: [...dates].sort(), completionTimeZone: mockTimeZone };
  });
  mockServer = { updatedAt: mockServer.updatedAt + 1, state: mockStamp({ ...mockServer.state, habits }) };
  return { ok: true, updatedAt: mockServer.updatedAt, state: mockServer.state, habit: { id: habitId, streak: 1, done: completed } };
}
jest.mock('@/authentication/authService', () => ({
  getRemoteAppState: jest.fn(async (since?: number | null) => (since && since >= mockServer.updatedAt
    ? { ok: true, unchanged: true, updatedAt: mockServer.updatedAt }
    : { ok: true, state: mockServer.state, updatedAt: mockServer.updatedAt, completions: null })),
  getRemoteHabitCompletions: jest.fn(async () => mockServer.state.habits.flatMap((habit) => (habit.completionDates as string[]).map((date) => ({ habitId: habit.id, date })))),
  saveRemoteAppState: jest.fn(async (state: Snapshot['state'], base: { updatedAt: number } | null) => mockSaveState(state, base)),
  saveRemoteHabitCompletion: jest.fn(async (completion: { habitId: string; date: string; completed: boolean }) => {
    if (mockCheckInDelay) await new Promise((resolve) => setTimeout(resolve, mockCheckInDelay));
    return mockCheckIn(completion);
  }),
  syncStreakFreezes: jest.fn(async () => ({ ok: false })),
  getLiveVersions: jest.fn(async () => ({ ok: false })),
  buyStreakFreeze: jest.fn(),
  getApiBaseUrl: jest.fn(),
  getAuthenticatedHeaders: jest.fn(),
  getWebPushVapidPublicKey: jest.fn(),
  saveWebPushSubscription: jest.fn(),
  sendTestWebPush: jest.fn(),
}));
jest.mock('@/hooks/use-buddy', () => ({ adjustBuddyCheckIns: jest.fn(), getCachedBuddy: jest.fn(() => null), reloadBuddy: jest.fn() }));
jest.mock('@/hooks/use-rewards', () => ({ loadRewards: jest.fn() }));
jest.mock('@/hooks/use-daily-challenges', () => ({ getKnownChallenges: jest.fn(() => []), loadDailyChallenges: jest.fn(), publishDailyChallenges: jest.fn() }));
// What the reminders and the widget are given, render after render.
const mockReminded: Habit[][] = [];
const mockWidget: { habits: Habit[]; streak: number }[] = [];
jest.mock('@/hooks/app-state/use-habit-reminders', () => ({ useHabitReminders: ({ habits }: { habits: Habit[] }) => { mockReminded.push(habits); } }));
jest.mock('@/widgets/use-home-widget', () => ({ useHomeWidget: (habits: Habit[], streak: number) => { mockWidget.push({ habits, streak }); } }));

const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return getLocalDateKey(date);
};
const today = day(0);
// The Sunday ending last week: a habit with it as its last active day has ended.
const lastSunday = weekEndKey(day(-7));

function habit(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, startDate: today, label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
    goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [] as string[], reminderEnabled: false, reminderTime: '07:00 AM', reminderTimes: [], ...overrides,
  };
}
const serverState = (habits: Record<string, unknown>[]) => ({
  avatarImage: null, profile: { email: 'student@example.com', fullName: 'A Student' }, preferences: {}, habits,
  points: 0, tokens: 0, tokenHistory: [], darkModeOverride: null, ringInterval: 30, snoozeFrequency: 'Once', goals: [],
});
/** A server copy exactly as the app keeps it, so loading it needs no save. */
const appShapedState = (habits: Record<string, unknown>[]) => ({
  ...serverState(habits.map((item) => ({ ...item, isBadHabit: false }))),
  profile: { ...initialProfile, email: 'student@example.com', fullName: 'A Student', firstName: 'A', lastName: 'Student' },
  preferences: { ...initialPreferences, region: 'Philippines' },
});

let view: { current: ReturnType<typeof useAppColorScheme> };
/** The app state as screens see it, after the latest render. */
const app = () => view.current;
async function open(habits: Record<string, unknown>[], state: Snapshot['state'] = serverState(habits)) {
  mockServer = { updatedAt: 1000, state };
  view = renderHook(() => useAppColorScheme(), { wrapper: ({ children }: { children: React.ReactNode }) => <ColorSchemeProvider>{children}</ColorSchemeProvider> }).result;
  await waitFor(() => expect(app().habits).toHaveLength(habits.length));
  await wait();
}
// A check-in runs in an async act: the server's answer then shows right away, as in the app (a sync
// act leaves it unrendered until the next one, and the half-second save timer could fire first).
/** Past the half-second a change waits before it is saved, and the save itself. */
const wait = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)); });
const saves = () => (saveRemoteAppState as jest.Mock).mock.calls.length;

beforeEach(async () => {
  jest.clearAllMocks();
  mockCheckInDelay = 0;
  mockReminded.length = 0;
  mockWidget.length = 0;
  await AsyncStorage.clear();
});

describe('the sync with the server', () => {
  it('takes the last active day the server gives a habit of an older app version, then settles', async () => {
    await open([habit('old')]);
    act(() => app().setSnoozeSettings(45, 'Once'));
    await wait();
    expect(saves()).toBeGreaterThan(0);
    expect(app().habits[0].activeUntil).toBe(weekEndKey(today));
    // Nothing changed since: a reorder to the same order saves nothing.
    const before = saves();
    act(() => app().reorderHabits(app().habits));
    await wait();
    expect(saves()).toBe(before);
  });

  it('takes it from a check-in\'s answer too, so a check-in needs no save of the state', async () => {
    // In the foreground, so the live pulse runs (it sends unsaved changes again).
    const appState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    try {
      await open([habit('old')], appShapedState([habit('old')]));
      expect(saves()).toBe(0);
      // The server stamps its copy (the one-time migration) before this device hears of it.
      mockServer = { updatedAt: 1001, state: mockStamp(mockServer.state) };
      // The check-in shows at once; the server's answer comes a moment later.
      mockCheckInDelay = 100;
      await act(async () => app().toggleHabit('old'));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
      // Past the save timer and the next live pulse.
      await wait();
      await wait();
      expect(saveRemoteHabitCompletion).toHaveBeenCalledWith({ habitId: 'old', date: today, completed: true });
      expect(app().habits[0]).toMatchObject({ activeUntil: weekEndKey(today), completionDates: [today] });
      expect(saves()).toBe(0);
    } finally {
      if (appState) Object.defineProperty(AppState, 'currentState', appState);
      else delete (AppState as { currentState?: string }).currentState;
    }
  });
});

describe('habits whose week has ended', () => {
  const ended = habit('ended', { startDate: day(-13), activeUntil: lastSunday, completionDates: [lastSunday] });
  const current = habit('current', { activeUntil: weekEndKey(today) });

  it('stay in the history but leave this week\'s habits, reminders and the widget', async () => {
    await open([ended, current]);
    expect(app().habits.map((item) => item.id)).toEqual(['ended', 'current']);
    expect(app().currentHabits.map((item) => item.id)).toEqual(['current']);
    expect(mockReminded.at(-1)?.map((item) => item.id)).toEqual(['current']);
    expect(mockWidget.at(-1)).toEqual({ habits: app().currentHabits, streak: app().streak });
  });

  it('take no new check-in', async () => {
    await open([ended, current]);
    await act(async () => app().toggleHabit('ended'));
    await wait();
    expect(saveRemoteHabitCompletion).not.toHaveBeenCalled();
    expect(app().habits[0].completionDates).toEqual([lastSunday]);
  });

  it('undo the check-in the server refuses because the habit\'s week has ended (409 HABIT_ENDED)', async () => {
    // This device has no last active day for it yet; the server knows it ended.
    await open([{ ...ended, activeUntil: undefined }]);
    mockServer = { ...mockServer, state: { ...mockServer.state, habits: [{ ...mockServer.state.habits[0], activeUntil: lastSunday }] } };
    await act(async () => app().toggleHabit('ended'));
    await wait();
    expect(saveRemoteHabitCompletion).toHaveBeenCalledTimes(1);
    expect(app().habits[0].completionDates).toEqual([lastSunday]);
    expect(app().canUndoCheckIn('ended')).toBe(false);
  });
});

describe('the streak', () => {
  it('celebrates the account streak\'s milestones, not one habit\'s', async () => {
    // Six days in a row with a check-in on an older habit; today, the first check-in of a new one.
    const older = habit('older', { startDate: day(-30), completionDates: [-6, -5, -4, -3, -2, -1].map(day) });
    await open([older, habit('fresh', { activeUntil: weekEndKey(today) })]);
    expect(app().streak).toBe(6);
    await act(async () => app().toggleHabit('fresh'));
    await wait();
    expect(app().streak).toBe(7);
    expect(app().bestStreak).toBe(7);
    expect(app().celebration).toMatchObject({ kind: 'streak', title: '7-day streak!', message: '7 days in a row with a check-in. +15 tokens! Keep the flame going!' });
  });
});
