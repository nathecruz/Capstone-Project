// What a check-in's answer celebrates about the daily quests: each quest it finished, or, when it
// finished the last of them, the quest chest (one celebration with the chest's bonus). An older
// server without the chest gets a celebration per quest.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import type { DailyChallenge } from '@/authentication/authService';
import { saveRemoteHabitCompletion } from '@/authentication/authService';
import { getLocalDateKey } from '@/hooks/app-state/habit-progress';
import { ColorSchemeProvider, useAppColorScheme, type Celebration } from '@/hooks/color-scheme-context';
import { getKnownChallenges, getKnownChestReward, publishDailyChallenges } from '@/hooks/use-daily-challenges';
import { weekEndKey } from '@/utils/habit-week';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/session', () => ({
  getCurrentSession: jest.fn(async () => ({ email: 'student@example.com', fullName: 'A Student', role: 'user', region: 'Philippines' })),
  subscribeToAuthChanges: jest.fn(() => () => undefined),
}));

let today = '';
const habit = (id: string) => ({
  id, startDate: today, activeUntil: weekEndKey(today), label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [] as string[], reminderEnabled: false, reminderTime: '07:00 AM', reminderTimes: [],
});
let mockState: Record<string, unknown>;
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
jest.mock('@/hooks/use-buddy', () => ({ adjustBuddyCheckIns: jest.fn(), getCachedBuddy: jest.fn(() => null), reloadBuddy: jest.fn(), syncBuddyCheckIns: jest.fn() }));
jest.mock('@/hooks/use-rewards', () => ({ loadRewards: jest.fn() }));
jest.mock('@/hooks/use-daily-challenges', () => ({ getKnownChallenges: jest.fn(() => []), getKnownChestReward: jest.fn(() => 0), loadDailyChallenges: jest.fn(), publishDailyChallenges: jest.fn() }));
jest.mock('@/hooks/app-state/use-habit-reminders', () => ({ useHabitReminders: () => undefined }));
jest.mock('@/widgets/use-home-widget', () => ({ useHomeWidget: () => undefined }));

const quest = (id: string, title: string, reward: number, complete: boolean): DailyChallenge => ({ id, title, icon: 'trophy', target: 1, progress: complete ? 1 : 0, reward, date: today, complete, reachable: true });
const answer = (dailyChallenges: DailyChallenge[]) => ({ ok: true, points: 20, tokens: 35, tokenHistory: [], habit: null, tokenCapped: false, paidCheckInsToday: 1, paidCheckInsLimit: 6, dailyChallenges });

let view: { current: ReturnType<typeof useAppColorScheme> };
const app = () => view.current;
async function open() {
  const opened = renderHook(() => useAppColorScheme(), { wrapper: ({ children }: { children: React.ReactNode }) => <ColorSchemeProvider>{children}</ColorSchemeProvider> });
  view = opened.result;
  await waitFor(() => expect(app().habits).toHaveLength(2));
}
function shown() {
  const seen: Celebration[] = [];
  while (app().celebration) {
    seen.push(app().celebration as Celebration);
    act(() => app().dismissCelebration());
  }
  return seen.filter((item) => item.kind === 'challenge').map(({ title, message }) => ({ title, message }));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.useFakeTimers({ now: new Date(2026, 10, 18, 15, 0), doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  today = getLocalDateKey();
  mockState = {
    avatarImage: null, profile: { email: 'student@example.com', fullName: 'A Student' }, preferences: {}, habits: [habit('read'), habit('walk')],
    points: 0, tokens: 30, tokenHistory: [], darkModeOverride: null, ringInterval: 30, snoozeFrequency: 'Once', goals: [],
  };
});
afterEach(() => {
  jest.useRealTimers();
});

describe('daily quests after a check-in', () => {
  it('celebrates each quest it finished, and keeps the new progress', async () => {
    jest.mocked(getKnownChallenges).mockReturnValue([quest('finish', 'Finish 2 habits today', 10, false), quest('comeback', 'Bounce back: do read today', 8, false)]);
    jest.mocked(getKnownChestReward).mockReturnValue(10);
    const after = [quest('finish', 'Finish 2 habits today', 10, false), quest('comeback', 'Bounce back: do read today', 8, true)];
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue(answer(after));
    await open();
    await act(async () => app().toggleHabit('read'));
    expect(shown()).toEqual([{ title: 'Quest complete!', message: 'Bounce back: do read today: +8 tokens.' }]);
    expect(publishDailyChallenges).toHaveBeenCalledWith(after);
  });

  it('opens the quest chest with the last quest: one celebration with its bonus', async () => {
    jest.mocked(getKnownChallenges).mockReturnValue([quest('finish', 'Finish 2 habits today', 10, false), quest('comeback', 'Bounce back: do read today', 8, true)]);
    jest.mocked(getKnownChestReward).mockReturnValue(10);
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue(answer([quest('finish', 'Finish 2 habits today', 10, true), quest('comeback', 'Bounce back: do read today', 8, true)]));
    await open();
    await act(async () => app().toggleHabit('walk'));
    expect(shown()).toEqual([{ title: 'Quest chest opened!', message: 'All 2 daily quests done: +20 tokens with the +10 bonus.' }]);
  });

  it('without the chest (an older server), celebrates the last quest like the others', async () => {
    jest.mocked(getKnownChallenges).mockReturnValue([quest('finish', 'Finish 2 habits today', 10, false), quest('comeback', 'Bounce back: do read today', 8, true)]);
    jest.mocked(getKnownChestReward).mockReturnValue(0);
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue(answer([quest('finish', 'Finish 2 habits today', 10, true), quest('comeback', 'Bounce back: do read today', 8, true)]));
    await open();
    await act(async () => app().toggleHabit('walk'));
    expect(shown()).toEqual([{ title: 'Quest complete!', message: 'Finish 2 habits today: +10 tokens.' }]);
  });
});
