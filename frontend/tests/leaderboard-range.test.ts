// The leaderboard's weeks and months come from the server's range on the campus calendar
// (Asia/Manila), not from the device clock: the dates under the period picker, the countdown to the
// reset and the reload when it passes. Rows are keyed by their public id, as names are not unique.
// A showcased Habi sits beside its student's name, a tap opens the classmate's card, and
// /leaderboards?reward=<id> opens that reward.
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import LeaderboardsScreen from '@/app/leaderboards';
import { leaderboardDateLabel, leaderKey, periodRange, rangeLabel, resetCountdownText, type LeaderboardRange } from '@/utils/leaderboard-range';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockParams: { reward?: string } = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => jest.fn() }));
jest.mock('@/components/framed-avatar', () => ({ FramedAvatar: ({ children }: { children?: React.ReactNode }) => children }));
jest.mock('@/components/reward-sheets', () => {
  const ReactActual = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { FrameSheet: () => null, ThemeSheet: () => null, TitleSheet: () => null, ShowcaseSheet: ({ visible }: { visible: boolean }) => (visible ? ReactActual.createElement(Text, null, 'Showcase settings open') : null) };
});
// The Habi beside a name and the classmate card, as what they were given.
jest.mock('@/components/buddy', () => {
  const ReactActual = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { BuddyAvatar: ({ buddy, checkIns, size }: { buddy: { name: string; head: string }; checkIns: number; size: number }) => ReactActual.createElement(View, { accessibilityLabel: `${buddy.name}: ${checkIns} check-ins, ${buddy.head || 'no hat'}, ${size} px` }) };
});
jest.mock('@/components/classmate-sheet', () => {
  const ReactActual = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { ClassmateSheet: ({ leader, period }: { leader: { name: string; rank: number }; period: string }) => ReactActual.createElement(Text, null, `Card of ${leader.name} (#${leader.rank}, ${period})`) };
});
// The student's own buddy, as the session has it.
const mockOwnBuddy: { buddy: object | null } = { buddy: null };
jest.mock('@/hooks/use-buddy', () => ({ useBuddy: () => mockOwnBuddy, getCachedBuddy: () => mockOwnBuddy.buddy }));
jest.mock('@/components/streak-freeze-sheet', () => ({ StreakFreezeSheet: () => null }));
jest.mock('@/authentication', () => ({
  getApiBaseUrl: () => 'https://api.test',
  getAuthenticatedHeaders: async () => ({ Authorization: 'Bearer token' }),
  redeemReward: jest.fn(),
}));
const mockCatalog: { rewards: { id: string; name: string; cost: number; description: string; permanent: boolean }[]; owned: string[] } = { rewards: [], owned: [] };
jest.mock('@/hooks/use-rewards', () => ({ loadRewards: jest.fn(), markRewardOwned: jest.fn(), useRewards: () => ({ status: 'ready', ...mockCatalog, owns: (id: string) => mockCatalog.owned.includes(id), title: '' }) }));
const mockContext = { tokens: 120, applyWallet: jest.fn(), points: 240, profile: { fullName: 'Maria Reyes', email: 'maria@psau.edu.ph' }, preferences: {} as { showBuddy?: boolean }, tokenHistory: [], isFaculty: false, streakFreeze: null };
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext }));

// Monday 26 October 2026, 01:00 in Manila: still Sunday 25 October on a UTC device clock.
const NOW = Date.parse('2026-10-25T17:00:00Z');
const week: LeaderboardRange = { start: '2026-10-26', end: '2026-11-01', timeZone: 'Asia/Manila', resetsAt: Date.parse('2026-11-01T16:00:00Z') };
const month: LeaderboardRange = { start: '2026-10-01', end: '2026-10-31', timeZone: 'Asia/Manila', resetsAt: Date.parse('2026-10-31T16:00:00Z') };

describe('the leaderboard calendar', () => {
  it('labels the period with the server\'s date and range, not the device clock', () => {
    const now = new Date(NOW);
    expect(leaderboardDateLabel('This Week', { period: 'This Week', date: 'Oct 26 - Nov 1', range: week }, now)).toBe('Oct 26 - Nov 1');
    expect(leaderboardDateLabel('This Week', { period: 'This Week', date: '', range: week }, now)).toBe('Oct 26 - Nov 1');
    expect(leaderboardDateLabel('All Time', { period: 'All Time', date: 'Since joining', range: null }, now)).toBe('Since joining');
    expect(rangeLabel(month)).toBe('Oct 1 - Oct 31');
  });

  it('works out the periods it has no answer for on the board\'s calendar, or the device\'s for older servers', () => {
    expect(periodRange('This Week', new Date(NOW), 'Asia/Manila')).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(periodRange('This Month', new Date('2026-10-31T16:30:00Z'), 'Asia/Manila')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(periodRange('This Month', new Date('2026-12-31T16:30:00Z'), 'Asia/Manila')).toEqual({ start: '2027-01-01', end: '2027-01-31' });
    // The week's board is loaded; This Month is worked out in its zone.
    expect(leaderboardDateLabel('This Month', { period: 'This Week', date: 'Oct 26 - Nov 1', range: week }, new Date(NOW), 'Asia/Manila')).toBe('Oct 1 - Oct 31');
    // An older server sends the period's name as its date and no range: the device's own week.
    expect(leaderboardDateLabel('This Week', { period: 'This Week', date: 'This Week', range: null }, new Date(2026, 9, 21, 12))).toBe('Oct 19 - Oct 25');
  });

  it('counts down to the reset from the range', () => {
    expect(resetCountdownText('This Week', week, Date.parse('2026-10-30T11:00:00Z'))).toBe('Resets Monday 12:00 AM Manila time · in 2d 5h');
    expect(resetCountdownText('This Month', month, Date.parse('2026-10-21T13:00:00Z'))).toBe('Resets Nov 1, 12:00 AM Manila time · in 10d 3h');
    expect(resetCountdownText('This Week', week, week.resetsAt - 3 * 3_600_000 - 12 * 60_000)).toBe('Resets Monday 12:00 AM Manila time · in 3h 12m');
    expect(resetCountdownText('This Week', { ...week, timeZone: 'America/New_York' }, week.resetsAt - 8 * 60_000)).toBe('Resets Monday 12:00 AM New York time · in 8m');
  });

  it('keys rows by their public id, or by rank from older servers', () => {
    const rows = [{ id: '3f9a1c0b7d2e', rank: 1, name: 'Maria R.' }, { id: 'a81c44e0f1b9', rank: 2, name: 'Maria R.' }];
    expect(new Set(rows.map(leaderKey)).size).toBe(2);
    expect(rows.map(({ rank }) => leaderKey({ rank }))).toEqual(['1', '2']);
  });
});

describe('the Leaderboards screen', () => {
  const baseLeaders: object[] = [
    { id: '3f9a1c0b7d2e', rank: 1, name: 'Maria R.', points: 120, avatar: 'M', title: '', frame: '', isYou: false, canGift: false, buddy: null },
    { id: 'a81c44e0f1b9', rank: 2, name: 'Maria R.', points: 100, avatar: 'M', title: '', frame: '', isYou: false, canGift: false, buddy: null },
    { id: '0c7e2b19d4f3', rank: 3, name: 'Maria R. (You)', points: 60, avatar: 'M', title: '', frame: '', isYou: true, canGift: false, buddy: null },
  ];
  let leaders = baseLeaders;
  let mockRange: LeaderboardRange;
  const fetchMock = jest.fn(async (url: string) => {
    const period = decodeURIComponent(/period=([^&]+)/.exec(url)?.[1] ?? '');
    const body = url.endsWith('/api/leaderboard/sync')
      ? { ok: true }
      : period === 'This Month'
        ? { period, date: 'Oct 1 - Oct 31', range: month, leaders }
        : { period, date: rangeLabel(mockRange), range: mockRange, leaders };
    return { ok: true, json: async () => body };
  });
  const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => url.includes(path)).length;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // React's act waits on microtasks, so only the clock and the timers are fake.
    jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    mockRange = week;
    leaders = baseLeaders;
    delete mockParams.reward;
    mockCatalog.rewards = [];
    mockCatalog.owned = [];
    mockOwnBuddy.buddy = null;
    mockContext.preferences = {};
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('shows the server\'s week and its reset, keeps classmates with the same name apart, and saves the row once', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const screen = render(React.createElement(LeaderboardsScreen));
      await waitFor(() => expect(screen.getByText('Resets Monday 12:00 AM Manila time · in 6d 23h')).toBeTruthy());
      // The device clock (Sunday 25 October) would have said Oct 19 - Oct 25.
      expect(screen.getAllByText('Oct 26 - Nov 1').length).toBeGreaterThan(0);
      expect(screen.queryByText('Oct 19 - Oct 25')).toBeNull();
      // Both "Maria R." are on the podium and in the rankings, each under its own key.
      expect(screen.getAllByText('Maria R.')).toHaveLength(4);
      expect(consoleError.mock.calls.some((args) => String(args[0]).includes('same key'))).toBe(false);
      // The student's own row is the one the server marks (its name is 'Maria R. (You)', not the profile's).
      expect(screen.getAllByText('You')).toHaveLength(1);

      fireEvent.press(screen.getByLabelText('Choose leaderboard date'));
      fireEvent.press(screen.getByText('This Month'));
      await waitFor(() => expect(screen.getByText('Resets Nov 1, 12:00 AM Manila time · in 5d 23h')).toBeTruthy());
      expect(calls('/api/leaderboard?period=This%20Month')).toBe(1);
      // The student's own row was saved once for the visit, not again for the new period.
      expect(calls('/api/leaderboard/sync')).toBe(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('loads the new week once the reset passes', async () => {
    mockRange = { ...week, resetsAt: NOW + 90_000 };
    const screen = render(React.createElement(LeaderboardsScreen));
    await waitFor(() => expect(screen.getByText('Resets Monday 12:00 AM Manila time · in 1m')).toBeTruthy());
    expect(calls('/api/leaderboard?period=This%20Week')).toBe(1);
    mockRange = { start: '2026-11-02', end: '2026-11-08', timeZone: 'Asia/Manila', resetsAt: Date.parse('2026-11-08T16:00:00Z') };
    await act(async () => {
      jest.advanceTimersByTime(2 * 60_000);
    });
    await waitFor(() => expect(screen.getAllByText('Nov 2 - Nov 8').length).toBeGreaterThan(0));
    expect(calls('/api/leaderboard?period=This%20Week')).toBe(2);
    expect(calls('/api/leaderboard/sync')).toBe(1);
  });

  it('reloads once when the server still has the old week (a phone clock ahead of it)', async () => {
    mockRange = { ...week, resetsAt: NOW + 90_000 };
    const screen = render(React.createElement(LeaderboardsScreen));
    await waitFor(() => expect(screen.getByText('Resets Monday 12:00 AM Manila time · in 1m')).toBeTruthy());
    await act(async () => {
      jest.advanceTimersByTime(2 * 60_000);
    });
    await waitFor(() => expect(calls('/api/leaderboard?period=This%20Week')).toBe(2));
    await act(async () => {
      jest.advanceTimersByTime(5 * 60_000);
    });
    expect(calls('/api/leaderboard?period=This%20Week')).toBe(2);
  });

  it("shows a classmate's Habi beside their name, and a tap opens their card", async () => {
    const showcased = { id: '5d1e9a0c3b7f', rank: 2, name: 'Jose P.', points: 100, avatar: 'J', title: '', frame: '', isYou: false, canGift: true, buddy: { stage: 'teen', checkIns: 50, head: 'top-hat', hand: '', accessory: '', room: 'garden' } };
    leaders = [baseLeaders[0], showcased, baseLeaders[2]];
    const screen = render(React.createElement(LeaderboardsScreen));
    await waitFor(() => expect(screen.getAllByText('Jose P.').length).toBeGreaterThan(0));
    // On the podium and in the rankings, at 28 px, with the stage's check-ins and what it wears.
    expect(screen.getAllByLabelText("Jose P.'s Habi: 50 check-ins, top-hat, 28 px")).toHaveLength(2);
    // Students without a showcased Habi have none.
    expect(screen.queryAllByLabelText(/Maria R\.'s Habi/)).toHaveLength(0);
    const rows = screen.getAllByLabelText('Jose P., rank 2, 100 points. Open card');
    expect(rows).toHaveLength(2);
    fireEvent.press(rows[1]);
    expect(screen.getByText('Card of Jose P. (#2, This Week)')).toBeTruthy();
    // The podium spot opens it too, also for the student's own row.
    fireEvent.press(screen.getAllByLabelText('Maria R. (You), rank 3, 60 points. Open card')[0]);
    expect(screen.getByText('Card of Maria R. (You) (#3, This Week)')).toBeTruthy();
  });

  it("shows the student's own Habi as this device has it, before the board loads again", async () => {
    const showcase = { id: 'buddy-showcase', name: 'Buddy Showcase', cost: 300, description: 'Show your Habi', permanent: true };
    mockCatalog.rewards = [showcase];
    mockCatalog.owned = ['buddy-showcase'];
    // The board was loaded before Habi put on a top hat (and before it was shown at all).
    mockOwnBuddy.buddy = { name: 'Habi', head: 'top-hat', hand: '', accessory: '', room: '', owned: ['top-hat'], checkIns: 64, items: [], drops: [], stages: [], treats: [], fedTreats: [], treatsFed: 0 };
    const shown = render(React.createElement(LeaderboardsScreen));
    await waitFor(() => expect(shown.getAllByText('Maria R. (You)').length).toBeGreaterThan(0));
    // Its stage with that stage's least check-ins (Teen, 50), as classmates get it, on the podium and in the rows.
    expect(shown.getAllByLabelText('Your Habi: 50 check-ins, top-hat, 28 px')).toHaveLength(2);
    shown.unmount();

    // "Show my Habi" was just turned off: the row the server sent still has Habi.
    leaders = [baseLeaders[0], baseLeaders[1], { ...(baseLeaders[2] as object), buddy: { stage: 'kid', checkIns: 10, head: 'cap', hand: '', accessory: '', room: '' } }];
    mockContext.preferences = { showBuddy: false };
    const hidden = render(React.createElement(LeaderboardsScreen));
    await waitFor(() => expect(hidden.getAllByText('Maria R. (You)').length).toBeGreaterThan(0));
    expect(hidden.queryAllByLabelText(/Your Habi/)).toHaveLength(0);
    hidden.unmount();
  });

  it('opens the reward of /leaderboards?reward=<id>: its settings once owned, or what is still missing', async () => {
    const showcase = { id: 'buddy-showcase', name: 'Buddy Showcase', cost: 300, description: 'Show your Habi', permanent: true };
    mockCatalog.rewards = [showcase];
    mockParams.reward = 'buddy-showcase';
    const notYet = render(React.createElement(LeaderboardsScreen));
    // 120 tokens: not enough to redeem it yet.
    expect(notYet.getByText('180 more tokens to Buddy Showcase.')).toBeTruthy();
    expect(notYet.queryByText('Redeem Buddy Showcase?')).toBeNull();
    expect(notYet.getByText('Your Habi next to your name on the leaderboard')).toBeTruthy();
    notYet.unmount();

    mockCatalog.owned = ['buddy-showcase'];
    const owned = render(React.createElement(LeaderboardsScreen));
    expect(owned.getByText('Showcase settings open')).toBeTruthy();
    expect(owned.getByText('Showcase settings')).toBeTruthy();
    owned.unmount();
  });
});
