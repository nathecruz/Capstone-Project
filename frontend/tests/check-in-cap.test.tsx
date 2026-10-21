// The app state's side of the fair earning guard: a check-in past the day's paid limit (the server
// answers tokenCapped) shows the daily token limit once a day and takes back Habi's optimistic
// growth; a check-in refused because the account's day is not the phone's says which day it is.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { getLocalDateKey } from '@/hooks/app-state/habit-progress';
import { ColorSchemeProvider, useAppColorScheme, type Celebration } from '@/hooks/color-scheme-context';
import { saveRemoteHabitCompletion } from '@/authentication/authService';
import { adjustBuddyCheckIns } from '@/hooks/use-buddy';
import { weekEndKey } from '@/utils/habit-week';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/session', () => ({
  getCurrentSession: jest.fn(async () => ({ email: 'student@example.com', fullName: 'A Student', role: 'user', region: 'Philippines' })),
  subscribeToAuthChanges: jest.fn(() => () => undefined),
}));

const today = getLocalDateKey();
const habit = (id: string) => ({
  id, startDate: today, activeUntil: weekEndKey(today), label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [] as string[], reminderEnabled: false, reminderTime: '07:00 AM', reminderTimes: [],
});
const mockState = {
  avatarImage: null, profile: { email: 'student@example.com', fullName: 'A Student' }, preferences: {}, habits: ['read', 'walk', 'water'].map(habit),
  points: 0, tokens: 30, tokenHistory: [], darkModeOverride: null, ringInterval: 30, snoozeFrequency: 'Once', goals: [],
};
jest.mock('@/authentication/authService', () => ({
  getRemoteAppState: jest.fn(async () => ({ ok: true, state: mockState, updatedAt: 1000, completions: null })),
  getRemoteHabitCompletions: jest.fn(async () => []),
  saveRemoteAppState: jest.fn(async () => null),
  saveRemoteHabitCompletion: jest.fn(),
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
jest.mock('@/hooks/app-state/use-habit-reminders', () => ({ useHabitReminders: () => undefined }));
jest.mock('@/widgets/use-home-widget', () => ({ useHomeWidget: () => undefined }));

/** The server's answer to a check-in past the day's six paid ones. */
const capped = { ok: true, points: 140, tokens: 30, tokenHistory: [], habit: null, tokenCapped: true, paidCheckInsToday: 6, paidCheckInsLimit: 6 };
const paid = { ok: true, points: 160, tokens: 35, tokenHistory: [], habit: null, tokenCapped: false, paidCheckInsToday: 6, paidCheckInsLimit: 6 };

let view: { current: ReturnType<typeof useAppColorScheme> };
const app = () => view.current;
async function open() {
  view = renderHook(() => useAppColorScheme(), { wrapper: ({ children }: { children: React.ReactNode }) => <ColorSchemeProvider>{children}</ColorSchemeProvider> }).result;
  await waitFor(() => expect(app().habits).toHaveLength(3));
}
/** Everything shown after a check-in (one after the other), dismissed one by one. */
function shown() {
  const seen: Celebration[] = [];
  while (app().celebration) {
    seen.push(app().celebration as Celebration);
    act(() => app().dismissCelebration());
  }
  return seen;
}
const notices = (seen: Celebration[]) => seen.filter((item) => item.kind === 'info');
const checkIn = (id: string) => act(async () => app().toggleHabit(id));
const buddyChanges = () => jest.mocked(adjustBuddyCheckIns).mock.calls.map(([delta]) => delta);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('the daily token limit', () => {
  it('is shown once a day, and Habi does not grow from a check-in past it', async () => {
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue(capped);
    await open();

    await checkIn('read');
    expect(notices(shown())).toEqual([{
      id: `token-cap:${today}`, kind: 'info', icon: 'wallet-outline', title: 'Daily token limit reached',
      message: 'You have earned tokens for 6 check-ins today. This one still counts for your streak, challenges and quests.',
    }]);
    // Grown on the tap, taken back with the server's answer; the wallet is the server's.
    expect(buddyChanges()).toEqual([1, -1]);
    expect(app().tokens).toBe(30);
    expect(app().points).toBe(140);
    // The check-in itself stays.
    expect(app().habits.find((item) => item.id === 'read')?.completionDates).toEqual([today]);

    await checkIn('walk');
    expect(notices(shown())).toEqual([]);
    expect(buddyChanges()).toEqual([1, -1, 1, -1]);
  });

  it('is not shown for a paid check-in, and undoing a check-in past it leaves Habi as it is', async () => {
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValueOnce(paid);
    await open();
    await checkIn('read');
    expect(notices(shown())).toEqual([]);
    expect(buddyChanges()).toEqual([1]);

    jest.mocked(saveRemoteHabitCompletion).mockResolvedValueOnce(capped).mockResolvedValueOnce({ ...capped, tokenCapped: false });
    await checkIn('walk');
    shown();
    expect(buddyChanges()).toEqual([1, 1, -1]);
    // Undone right after the tap: it never grew Habi, so it does not shrink it either.
    await checkIn('walk');
    expect(saveRemoteHabitCompletion).toHaveBeenLastCalledWith({ habitId: 'walk', date: today, completed: false });
    expect(buddyChanges()).toEqual([1, 1, -1]);
  });
});

describe('a check-in on a day the account has not got', () => {
  it('is undone, and says which day the account is on', async () => {
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue({ rejected: true, code: 'DAY_CLOSED', message: 'Only today can be checked in. A missed day stays missed.', today: '2030-01-02', timeZone: 'Asia/Manila' });
    await open();
    await checkIn('read');
    expect(app().habits.find((item) => item.id === 'read')?.completionDates).toEqual([]);
    expect(app().canUndoCheckIn('read')).toBe(false);
    expect(buddyChanges()).toEqual([1, -1]);
    expect(notices(shown())).toEqual([expect.objectContaining({
      kind: 'info',
      message: 'Your HabitAI day is 2030-01-02 (Asia/Manila). A day that already started cannot be reopened.',
    })]);
  });

  it('says nothing more when the account is on the same day (another refusal)', async () => {
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue({ rejected: true, code: 'DAY_CLOSED', message: 'Only today can be checked in.', today, timeZone: 'Asia/Manila' });
    await open();
    await checkIn('read');
    expect(app().habits.find((item) => item.id === 'read')?.completionDates).toEqual([]);
    expect(notices(shown())).toEqual([]);
  });
});
