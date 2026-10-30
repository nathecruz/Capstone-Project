// The app state's side of the fair earning guard: a check-in past the day's paid limit (the server
// answers tokenCapped) shows the daily token limit once a day and, from the day the counted cap
// starts (26 October 2026), a check-in past the day's six adds no points or tokens on the tap,
// grows no Habi and celebrates no level or growth; the server's points then set Habi's count. A
// refused or unsent check-in takes back only what its tap changed that is still on screen. A
// check-in refused because the account's day is not the phone's says which day it is.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { getLocalDateKey } from '@/hooks/app-state/habit-progress';
import { ColorSchemeProvider, useAppColorScheme, type Celebration } from '@/hooks/color-scheme-context';
import { getCurrentSession, subscribeToAuthChanges } from '@/authentication/session';
import { saveRemoteHabitCompletion } from '@/authentication/authService';
import { adjustBuddyCheckIns, getCachedBuddy, syncBuddyCheckIns } from '@/hooks/use-buddy';
import type { Buddy } from '@/utils/buddy';
import { weekEndKey } from '@/utils/habit-week';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/session', () => ({
  getCurrentSession: jest.fn(async () => ({ email: 'student@example.com', fullName: 'A Student', role: 'user', region: 'Philippines' })),
  subscribeToAuthChanges: jest.fn(() => () => undefined),
}));

/** The day the test runs on (onDay). */
let today = '';
const habit = (id: string, checkedIn = false) => ({
  id, startDate: today, activeUntil: weekEndKey(today), label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: checkedIn ? [today] : [] as string[], reminderEnabled: false, reminderTime: '07:00 AM', reminderTimes: [],
});
let mockState: { habits: ReturnType<typeof habit>[] } & Record<string, unknown>;
/** Fixes the clock (timers stay real) and the server's state: `checkedIn` habits done today, and `points`. */
function onDay(date: Date, { checkedIn = 0, points = 0 } = {}) {
  jest.useFakeTimers({ now: date, doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  today = getLocalDateKey();
  const done = Array.from({ length: checkedIn }, (_, index) => habit(`done-${index + 1}`, true));
  mockState = {
    avatarImage: null, profile: { email: 'student@example.com', fullName: 'A Student' }, preferences: {}, habits: [...done, ...['read', 'walk', 'water'].map((id) => habit(id))],
    points, tokens: 30, tokenHistory: [], darkModeOverride: null, ringInterval: 30, snoozeFrequency: 'Once', goals: [],
  };
}
jest.mock('@/authentication/authService', () => ({
  getRemoteAppState: jest.fn(async () => ({ ok: true, state: mockState, updatedAt: 1000, completions: null })),
  getRemoteHabitCompletions: jest.fn(async () => mockState.habits.flatMap((item) => item.completionDates.map((date) => ({ habitId: item.id, date })))),
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
jest.mock('@/hooks/use-daily-challenges', () => ({ getKnownChallenges: jest.fn(() => []), loadDailyChallenges: jest.fn(), publishDailyChallenges: jest.fn() }));
jest.mock('@/hooks/app-state/use-habit-reminders', () => ({ useHabitReminders: () => undefined }));
jest.mock('@/widgets/use-home-widget', () => ({ useHomeWidget: () => undefined }));

/** Tuesday 27 October 2026 (the counted cap has started) and Wednesday 21 October (it has not). */
const CAPPED_DAY = new Date(2026, 9, 27, 10, 0);
const BEFORE_CAP = new Date(2026, 9, 21, 10, 0);

/** The server's answer to a check-in past the day's six paid ones. */
const capped = { ok: true, points: 140, tokens: 30, tokenHistory: [], habit: null, tokenCapped: true, paidCheckInsToday: 6, paidCheckInsLimit: 6 };
const paid = { ok: true, points: 160, tokens: 35, tokenHistory: [], habit: null, tokenCapped: false, paidCheckInsToday: 6, paidCheckInsLimit: 6 };

let view: { current: ReturnType<typeof useAppColorScheme> };
const app = () => view.current;
/** Opens the app (signed in, the server's state loaded); returns how to close it. */
async function open() {
  const opened = renderHook(() => useAppColorScheme(), { wrapper: ({ children }: { children: React.ReactNode }) => <ColorSchemeProvider>{children}</ColorSchemeProvider> });
  view = opened.result;
  await waitFor(() => expect(app().habits).toHaveLength(mockState.habits.length));
  return opened.unmount;
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
/** Habi's count as last set from the server's points. */
const syncedBuddy = () => jest.mocked(syncBuddyCheckIns).mock.calls.at(-1)?.[0];
/** Habi's count from `start` as the app changes it: a check-in adjusts it, the server's count replaces it. */
function trackHabi(start: number) {
  let count = start;
  jest.mocked(adjustBuddyCheckIns).mockImplementation((delta) => { count = Math.max(0, count + delta); });
  jest.mocked(syncBuddyCheckIns).mockImplementation((checkIns) => { count = checkIns; });
  return () => count;
}
type CheckInAnswer = Awaited<ReturnType<typeof saveRemoteHabitCompletion>>;
/** The next check-in request, answered only when the test gives the answer, so the app is used meanwhile. */
function answerLater() {
  let resolve: (answer: CheckInAnswer) => void = () => undefined;
  jest.mocked(saveRemoteHabitCompletion).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  return (answer: CheckInAnswer) => act(async () => resolve(answer));
}

beforeEach(async () => {
  jest.clearAllMocks();
  // Without the counting trackHabi gave them.
  jest.mocked(adjustBuddyCheckIns).mockReset();
  jest.mocked(syncBuddyCheckIns).mockReset();
  jest.mocked(getCachedBuddy).mockReturnValue(null);
  await AsyncStorage.clear();
  onDay(CAPPED_DAY);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the daily token limit', () => {
  it('is shown once a day, and a check-in past the day\'s six does not grow Habi', async () => {
    onDay(CAPPED_DAY, { checkedIn: 6, points: 120 });
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue({ ...capped, points: 120 });
    await open();

    await checkIn('read');
    expect(notices(shown())).toEqual([{
      id: `token-cap:${today}`, kind: 'info', icon: 'wallet-outline', title: 'Daily token limit reached',
      message: 'You have earned tokens for 6 check-ins today. This one still counts for your streak, challenges and quests.',
    }]);
    // Habi does not grow on the tap, and its count is the server's (120 points / 20); the wallet is the server's.
    expect(buddyChanges()).toEqual([]);
    expect(syncedBuddy()).toBe(6);
    expect(app().tokens).toBe(30);
    expect(app().points).toBe(120);
    // The check-in itself stays.
    expect(app().habits.find((item) => item.id === 'read')?.completionDates).toEqual([today]);

    await checkIn('walk');
    expect(notices(shown())).toEqual([]);
    expect(buddyChanges()).toEqual([]);
  });

  it('is not shown for a paid check-in, and undoing a check-in past it changes neither Habi nor tokens', async () => {
    onDay(CAPPED_DAY, { checkedIn: 5, points: 100 });
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValueOnce({ ...paid, points: 120 });
    await open();
    await checkIn('read');
    expect(notices(shown())).toEqual([]);
    expect(buddyChanges()).toEqual([1]);

    jest.mocked(saveRemoteHabitCompletion).mockResolvedValueOnce({ ...capped, points: 120 });
    await checkIn('walk');
    shown();
    expect(buddyChanges()).toEqual([1]);
    // Undone right after the tap (the answer never comes): it grew no Habi and paid no tokens, so
    // its undo takes neither back.
    jest.mocked(saveRemoteHabitCompletion).mockReturnValueOnce(new Promise(() => undefined));
    await checkIn('walk');
    expect(saveRemoteHabitCompletion).toHaveBeenLastCalledWith({ habitId: 'walk', date: today, completed: false });
    expect(buddyChanges()).toEqual([1]);
    expect([app().points, app().tokens]).toEqual([120, 30]);
  });

  it('adds points and tokens on the tap only for the day\'s counted and paid check-ins', async () => {
    onDay(CAPPED_DAY, { checkedIn: 6, points: 120 });
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue(null);
    await open();
    await checkIn('read');
    // The server could not be reached: the seventh is shown done, worth nothing yet.
    expect(app().habits.find((item) => item.id === 'read')?.completionDates).toEqual([today]);
    expect([app().points, app().tokens]).toEqual([120, 30]);
    expect(buddyChanges()).toEqual([]);
  });

  it('adds 20 points, 5 tokens and Habi\'s growth on the tap of a check-in that counts', async () => {
    onDay(CAPPED_DAY, { checkedIn: 2, points: 40 });
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue(null);
    await open();
    await checkIn('read');
    expect([app().points, app().tokens]).toEqual([60, 35]);
    expect(buddyChanges()).toEqual([1]);
  });

  it('is not shown again when the app is opened again the same day, and is shown the next day', async () => {
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue(capped);
    let close = await open();
    await checkIn('read');
    expect(notices(shown()).map((item) => item.id)).toEqual([`token-cap:${today}`]);
    close();

    close = await open();
    await checkIn('walk');
    expect(notices(shown())).toEqual([]);
    close();

    onDay(new Date(2026, 9, 28, 9, 0));
    await open();
    await checkIn('water');
    expect(notices(shown()).map((item) => item.id)).toEqual(['token-cap:2026-10-28']);
  });

  it('celebrates no level and no growing Habi for a check-in past the day\'s six', async () => {
    // Six check-ins today, 80 points (the next counted check-in is level 2) and Habi one check-in
    // from the Teen stage: the seventh adds neither.
    onDay(CAPPED_DAY, { checkedIn: 6, points: 80 });
    jest.mocked(getCachedBuddy).mockReturnValue({ name: 'Habi', checkIns: 49 } as Buddy);
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue({ ...capped, points: 80 });
    await open();
    await checkIn('read');
    const seen = shown();
    expect(seen.map((item) => item.kind)).not.toContain('level');
    expect(seen.map((item) => item.kind)).not.toContain('buddy');
    expect(notices(seen).map((item) => item.id)).toEqual([`token-cap:${today}`]);
    expect(buddyChanges()).toEqual([]);
    expect(app().points).toBe(80);
  });
});

describe("Habi's growth before Habi is loaded", () => {
  it('is celebrated from the counted check-ins the points hold, not every check-in', async () => {
    // 980 points: 49 counted check-ins (more were made, but capped days count 6). The 50th makes a Teen.
    onDay(CAPPED_DAY, { checkedIn: 2, points: 980 });
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue({ ...paid, points: 1000 });
    await open();
    await checkIn('read');
    expect(shown()[0]).toEqual(expect.objectContaining({ kind: 'buddy', title: 'Habi grew into a Teen!', message: "50 check-ins together. New looks are waiting in Habi's shop." }));
  });
});

describe('the daily token limit before 26 October, when every check-in still counts', () => {
  it('is shown, and the seventh check-in still grows Habi', async () => {
    onDay(BEFORE_CAP, { checkedIn: 6, points: 80 });
    jest.mocked(getCachedBuddy).mockReturnValue({ name: 'Habi', checkIns: 49 } as Buddy);
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValue({ ...capped, points: 100 });
    await open();
    await checkIn('read');
    const seen = shown();
    expect(seen[0]).toEqual(expect.objectContaining({ kind: 'buddy', title: 'Habi grew into a Teen!' }));
    expect(notices(seen).map((item) => item.id)).toEqual(['token-cap:2026-10-21']);
    // Grown on the tap and kept, as the server counts it too; undoing it takes it back.
    expect(buddyChanges()).toEqual([1]);
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValueOnce({ ...capped, tokenCapped: false });
    await checkIn('read');
    expect(buddyChanges()).toEqual([1, -1]);
  });
});

describe('a check-in that does not reach the server', () => {
  it('keeps Habi as it was when its undo could not be sent', async () => {
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValueOnce(paid).mockResolvedValueOnce(null);
    await open();
    await checkIn('read');
    await checkIn('read');
    // Shown again as checked in, and Habi's count with it.
    expect(app().habits.find((item) => item.id === 'read')?.completionDates).toEqual([today]);
    expect(buddyChanges()).toEqual([1, -1, 1]);
  });
});

describe('check-ins answered after other taps', () => {
  it('take back nothing of a refused check-in that the answer to an earlier one already replaced', async () => {
    onDay(CAPPED_DAY, { checkedIn: 2, points: 40 });
    const habi = trackHabi(2);
    const answerRead = answerLater();
    const answerWalk = answerLater();
    await open();
    await checkIn('read');
    await checkIn('walk');
    expect([app().points, app().tokens, habi()]).toEqual([80, 40, 4]);
    // read's answer is the server's wallet with read and without walk, which the server then refused.
    await answerRead({ ...paid, points: 60, tokens: 35 });
    await answerWalk({ rejected: true, message: 'Habit not found.' });
    expect(app().habits.find((item) => item.id === 'walk')?.completionDates).toEqual([]);
    expect([app().points, app().tokens, habi()]).toEqual([60, 35, 3]);
  });

  it('take back a refused check-in that is still on screen', async () => {
    onDay(CAPPED_DAY, { checkedIn: 2, points: 40 });
    const habi = trackHabi(2);
    const answerRead = answerLater();
    const answerWalk = answerLater();
    await open();
    await checkIn('read');
    await checkIn('walk');
    await answerWalk({ rejected: true, message: 'Habit not found.' });
    expect([app().points, app().tokens, habi()]).toEqual([60, 35, 3]);
    await answerRead({ ...paid, points: 60, tokens: 35 });
    expect([app().points, app().tokens, habi()]).toEqual([60, 35, 3]);
  });

  it('show an undo that could not be sent as checked in again, without adding back what the server\'s wallet already has', async () => {
    onDay(CAPPED_DAY, { checkedIn: 2, points: 40 });
    const habi = trackHabi(2);
    jest.mocked(saveRemoteHabitCompletion).mockResolvedValueOnce({ ...paid, points: 60, tokens: 35 });
    await open();
    await checkIn('read');
    const answerUndo = answerLater();
    await checkIn('read');
    expect([app().points, app().tokens, habi()]).toEqual([40, 30, 2]);
    // Meanwhile the daily reward's answer brings the server's wallet, which still has read.
    act(() => app().applyWallet({ points: 60, tokens: 39, tokenHistory: [] }));
    await answerUndo(null);
    expect(app().habits.find((item) => item.id === 'read')?.completionDates).toEqual([today]);
    expect([app().points, app().tokens, habi()]).toEqual([60, 39, 3]);
  });

  it("keep the newest answer's wallet when an older answer comes back after it", async () => {
    onDay(CAPPED_DAY, { checkedIn: 2, points: 40 });
    const habi = trackHabi(2);
    const answerRead = answerLater();
    const answerWalk = answerLater();
    await open();
    await checkIn('read');
    await checkIn('walk');
    // The server saved walk last (updatedAt 3000); read's answer (2000) comes back after it.
    await answerWalk({ ...paid, points: 80, tokens: 40, updatedAt: 3000 });
    await answerRead({ ...paid, points: 60, tokens: 35, updatedAt: 2000 });
    expect([app().points, app().tokens, habi()]).toEqual([80, 40, 4]);
  });

  it('ignore an answer that comes back after signing out', async () => {
    const answerRead = answerLater();
    await open();
    await checkIn('read');
    // Signed out before the answer came.
    jest.mocked(getCurrentSession).mockResolvedValueOnce(null);
    await act(async () => jest.mocked(subscribeToAuthChanges).mock.calls[0][0]());
    await waitFor(() => expect(app().habits).toHaveLength(0));
    await answerRead({ ...paid, points: 60, tokens: 35 });
    expect([app().points, app().tokens]).toEqual([0, 0]);
    expect(syncBuddyCheckIns).not.toHaveBeenCalled();
  });

  it('take no tokens back for undoing, before its answer, a check-in that paid none on the tap', async () => {
    onDay(CAPPED_DAY, { checkedIn: 6, points: 120 });
    const answerCheckIn = answerLater();
    const answerUndo = answerLater();
    await open();
    await checkIn('read');
    await checkIn('read');
    expect(app().habits.find((item) => item.id === 'read')?.completionDates).toEqual([]);
    expect([app().points, app().tokens]).toEqual([120, 30]);
    // The server then says it paid nothing, and the undo could not be sent: done again, still 30 tokens.
    await answerCheckIn({ ...capped, points: 120 });
    shown();
    await answerUndo(null);
    expect(app().habits.find((item) => item.id === 'read')?.completionDates).toEqual([today]);
    expect([app().points, app().tokens]).toEqual([120, 30]);
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
