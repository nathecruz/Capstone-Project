// A habit with a proof (utils/habit-templates.ts) is checked in only with it: a tap opens its Focus
// timer or walk, or the camera, and the proof goes with the check-in. A proof the server refuses
// (too early, unreadable) or could not get takes the check-in back with the reason.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { saveRemoteHabitCompletion } from '@/authentication/authService';
import { getLocalDateKey } from '@/hooks/app-state/habit-progress';
import { ColorSchemeProvider, useAppColorScheme, type Celebration, type HabitProof } from '@/hooks/color-scheme-context';
import { takeProofPhoto } from '@/utils/proof-photo';
import { weekEndKey } from '@/utils/habit-week';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/session', () => ({
  getCurrentSession: jest.fn(async () => ({ email: 'student@example.com', fullName: 'A Student', role: 'user', region: 'Philippines' })),
  subscribeToAuthChanges: jest.fn(() => () => undefined),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@/utils/proof-photo', () => ({ takeProofPhoto: jest.fn() }));

const today = getLocalDateKey();
const habit = (id: string, proof?: HabitProof) => ({
  id, startDate: today, activeUntil: weekEndKey(today), label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [] as string[], reminderEnabled: false, reminderTime: '07:00 AM', reminderTimes: [],
  ...(proof ? { proof } : {}),
});
const mockState = {
  avatarImage: null, profile: { email: 'student@example.com', fullName: 'A Student' }, preferences: {},
  habits: [habit('water', { type: 'photo' }), habit('study', { type: 'timer', minutes: 20 }), habit('walk', { type: 'steps', steps: 2000 }), habit('legacy')],
  points: 0, tokens: 0, tokenHistory: [], darkModeOverride: null, ringInterval: 30, snoozeFrequency: 'Once', goals: [],
};
jest.mock('@/authentication/authService', () => ({
  getRemoteAppState: jest.fn(async () => ({ ok: true, state: mockState, updatedAt: 1000, completions: null })),
  getRemoteHabitCompletions: jest.fn(async () => []),
  saveRemoteAppState: jest.fn(async () => null),
  saveRemoteHabitCompletion: jest.fn(async () => ({ ok: true, habit: null, tokenCapped: false })),
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
jest.mock('@/hooks/use-daily-challenges', () => ({ getKnownChallenges: jest.fn(() => []), loadDailyChallenges: jest.fn(), publishDailyChallenges: jest.fn() }));
jest.mock('@/hooks/app-state/use-habit-reminders', () => ({ useHabitReminders: () => undefined }));
jest.mock('@/widgets/use-home-widget', () => ({ useHomeWidget: () => undefined }));

let view: { current: ReturnType<typeof useAppColorScheme> };
const app = () => view.current;
async function open() {
  view = renderHook(() => useAppColorScheme(), { wrapper: ({ children }: { children: React.ReactNode }) => <ColorSchemeProvider>{children}</ColorSchemeProvider> }).result;
  await waitFor(() => expect(app().habits).toHaveLength(mockState.habits.length));
}
const done = (id: string) => app().habits.find((item) => item.id === id)?.completionDates.includes(today);
const requests = () => jest.mocked(saveRemoteHabitCompletion).mock.calls.map(([request]) => request);
function notices() {
  const seen: Celebration[] = [];
  while (app().celebration) {
    seen.push(app().celebration as Celebration);
    act(() => app().dismissCelebration());
  }
  return seen.filter((item) => item.kind === 'info');
}
const photo = { photo: 'abc123', type: 'image/jpeg' as const };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('a check-in with proof', () => {
  it('takes a photo first, and sends it with the check-in', async () => {
    jest.mocked(takeProofPhoto).mockResolvedValueOnce({ ok: true, proof: photo });
    await open();
    await act(async () => app().toggleHabit('water'));
    await waitFor(() => expect(requests()).toHaveLength(1));
    expect(requests()[0]).toEqual({ habitId: 'water', date: today, completed: true, proof: photo });
    expect(done('water')).toBe(true);
  });

  it('checks nothing in when the camera is closed, and says why when it cannot open', async () => {
    jest.mocked(takeProofPhoto).mockResolvedValueOnce(null).mockResolvedValueOnce({ ok: false, message: 'Allow camera access to take the photo that proves this check-in.' });
    await open();
    await act(async () => app().toggleHabit('water'));
    await act(async () => app().toggleHabit('water'));
    expect(requests()).toHaveLength(0);
    expect(done('water')).toBe(false);
    expect(notices().map((item) => item.message)).toEqual(['Allow camera access to take the photo that proves this check-in.']);
  });

  it('opens the Focus timer or the walk instead of checking in, and checks in with the session they end', async () => {
    await open();
    await act(async () => app().toggleHabit('study'));
    await act(async () => app().toggleHabit('walk'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
    expect(mockPush.mock.calls).toEqual([[{ pathname: '/focus', params: { id: 'study' } }], [{ pathname: '/walk', params: { id: 'walk' } }]]);
    expect(requests()).toHaveLength(0);
    await act(async () => app().checkInWithProof('walk', { sessionId: 'walk-session-1', steps: 2100 }));
    expect(requests()).toEqual([{ habitId: 'walk', date: today, completed: true, proof: { sessionId: 'walk-session-1', steps: 2100 } }]);
    expect(done('walk')).toBe(true);
  });

  it('a habit from before proofs is checked in by the tap', async () => {
    await open();
    await act(async () => app().toggleHabit('legacy'));
    expect(requests()).toEqual([{ habitId: 'legacy', date: today, completed: true }]);
    expect(done('legacy')).toBe(true);
  });

  it('takes it back with the reason when the server refuses the proof or cannot be reached', async () => {
    jest.mocked(saveRemoteHabitCompletion)
      .mockResolvedValueOnce({ rejected: true, code: 'PROOF_TOO_SOON', message: 'The Focus timer has not run its full time yet: 3 more minutes.', waitSeconds: 170 })
      .mockResolvedValueOnce(null);
    await open();
    await act(async () => app().checkInWithProof('study', { sessionId: 'study-session-1' }));
    expect(done('study')).toBe(false);
    jest.mocked(takeProofPhoto).mockResolvedValueOnce({ ok: true, proof: photo });
    await act(async () => app().toggleHabit('water'));
    await waitFor(() => expect(requests()).toHaveLength(2));
    await waitFor(() => expect(done('water')).toBe(false));
    expect(notices().map((item) => item.message)).toEqual([
      'The Focus timer has not run its full time yet: 3 more minutes.',
      'HabitAI could not be reached, so the proof was not sent. Check your connection and try again.',
    ]);
  });
});
