// The leaderboard's weeks and months come from the server's range on the campus calendar
// (Asia/Manila), not from the device clock: the dates under the period picker, the countdown to the
// reset and the reload when it passes. Rows are keyed by their public id, as names are not unique.
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import LeaderboardsScreen from '@/app/leaderboards';
import { leaderboardDateLabel, leaderKey, periodRange, rangeLabel, resetCountdownText, type LeaderboardRange } from '@/utils/leaderboard-range';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => jest.fn() }));
jest.mock('@/components/framed-avatar', () => ({ FramedAvatar: ({ children }: { children?: React.ReactNode }) => children }));
jest.mock('@/components/reward-sheets', () => ({ FrameSheet: () => null, ThemeSheet: () => null, TitleSheet: () => null }));
jest.mock('@/components/streak-freeze-sheet', () => ({ StreakFreezeSheet: () => null }));
jest.mock('@/authentication', () => ({
  getApiBaseUrl: () => 'https://api.test',
  getAuthenticatedHeaders: async () => ({ Authorization: 'Bearer token' }),
  redeemReward: jest.fn(),
}));
jest.mock('@/hooks/use-rewards', () => ({ loadRewards: jest.fn(), markRewardOwned: jest.fn(), useRewards: () => ({ status: 'ready', rewards: [], owns: () => false, title: '' }) }));
const mockContext = { tokens: 120, applyWallet: jest.fn(), points: 240, profile: { fullName: 'Maria Reyes', email: 'maria@psau.edu.ph' }, tokenHistory: [], isFaculty: false, streakFreeze: null };
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
  const leaders = [
    { id: '3f9a1c0b7d2e', rank: 1, name: 'Maria R.', points: 120, avatar: 'M', title: '', frame: '', isYou: false, canGift: false, buddy: null },
    { id: 'a81c44e0f1b9', rank: 2, name: 'Maria R.', points: 100, avatar: 'M', title: '', frame: '', isYou: false, canGift: false, buddy: null },
    { id: '0c7e2b19d4f3', rank: 3, name: 'Maria R. (You)', points: 60, avatar: 'M', title: '', frame: '', isYou: true, canGift: false, buddy: null },
  ];
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
});
