// The Tokens screen: every number is the wallet summary's (GET /api/wallet/summary), each way to
// earn leads to where it is done and each thing to buy to its existing sheet, a negative balance
// says how it is paid back, and the history pages through the whole ledger with its filters.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import WalletScreen from '@/app/wallet';
import { getWalletHistory, getWalletSummary, type WalletHistoryItem, type WalletSummary } from '@/authentication/authService';
import { reloadWallet, withFirstPage } from '@/hooks/use-wallet';
import { getLocalDateKey } from '@/utils/habit-visibility';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockParams: { section?: string } = {};
// The screen's focus callback, called again to come back to the screen.
const mockFocus: { effect: (() => void) | null } = { effect: null };
jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual('react');
  return {
    router: { dismissTo: jest.fn(), push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) => {
      mockFocus.effect = effect;
      ReactActual.useEffect(() => effect(), [effect]);
    },
  };
});
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});
jest.mock('@/authentication/authService', () => ({ getWalletSummary: jest.fn(), getWalletHistory: jest.fn() }));
jest.mock('@/authentication/session', () => {
  const listeners: (() => void)[] = [];
  return { subscribeToAuthChanges: (listener: () => void) => { listeners.push(listener); return () => undefined; }, mockSignOut: () => listeners.forEach((listener) => listener()) };
});
const mockContext = { tokens: 120, isFaculty: false, isDarkMode: false };
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext }));
jest.mock('@/components/streak-freeze-sheet', () => {
  const { Text } = jest.requireActual('react-native');
  return { StreakFreezeSheet: ({ visible }: { visible: boolean }) => (visible ? <Text>Streak Freeze sheet</Text> : null) };
});

const summaryMock = getWalletSummary as jest.Mock;
const historyMock = getWalletHistory as jest.Mock;
const today = getLocalDateKey();
const tiers = [{ percent: 60, amount: 10, label: 'Steady week' }, { percent: 75, amount: 20, label: 'Strong week' }, { percent: 90, amount: 30, label: 'Consistent week' }];

/** A wallet summary as the server sends it for `today`, with `overrides` on top. */
function summaryWith(overrides: Partial<WalletSummary> = {}): WalletSummary & { ok: true } {
  return {
    ok: true,
    balance: 120,
    tokens: 120,
    affordable: 3,
    today: {
      date: today,
      checkIns: { paid: 2, limit: 6, perCheckIn: 5, earned: 10 },
      dailyClaim: { claimed: false, day: 3, amount: 4, tomorrowAmount: 5 },
      challenges: { done: 1, total: 3, earned: 5, available: 20 },
      mysteryBox: { status: 'ready', amount: null, min: 3, max: 20 },
      canStillEarn: 42,
    },
    week: {
      start: '2026-10-19', end: '2026-10-25', resetsAt: 0, earned: 85, spent: 30, bySource: { 'check-in': 60, quest: 25 }, bySink: { freeze: 30 },
      quests: { done: 1, total: 3, earned: 15, available: 35 },
      bonus: {
        lastWeek: { weekStart: '2026-10-12', weekEnd: '2026-10-18', scheduled: 20, done: 16, percent: 80, activeDays: 6, eligible: true, reason: null, tier: tiers[1], claimed: false, claimedAmount: null, claimable: true, lapsesAt: 0 },
        thisWeek: { weekStart: '2026-10-19', weekEnd: '2026-10-25', dueSoFar: 6, doneSoFar: 3, dueWeek: 21, percentSoFar: 50, next: { percent: 60, amount: 10, checkInsNeeded: 1, reachable: true } },
        tiers,
      },
    },
    streak: { days: 5, next: { days: 7, bonus: 15, daysLeft: 2 } },
    earn: [
      { id: 'check-in', title: 'Check in a habit', amount: '+5', detail: 'Up to 6 paid check-ins a day' },
      { id: 'daily-claim', title: 'Daily reward', amount: '+2 to +15', detail: 'Open HabitAI every day: 2, 3, 4, 5, 6, 8 and 15 over 7 days in a row' },
      { id: 'challenge', title: 'Daily challenges', amount: '+5 to +15', detail: '3 a day, paid when you finish them' },
      { id: 'mystery', title: 'Mystery box', amount: '+3 to +20', detail: 'Once a day after your first check-in' },
      { id: 'quest', title: 'Weekly quests', amount: '+15 to +20', detail: '3 a week, new every Monday' },
      { id: 'weekly-bonus', title: 'Weekly consistency bonus', amount: '+10 / +20 / +30', detail: "Do 60%, 75% or 90% of last week's check-ins, claim on Monday" },
      { id: 'streak', title: 'Streak milestones', amount: '+15 to +500', detail: '7, 14, 30, 50, 100, 200 and 365 days in a row' },
    ],
    spend: [
      { id: 'streak-freeze', title: 'Streak Freeze', detail: 'Covers a missed day · 1/2 held', cost: 30, from: false, status: 'ready', held: 1, max: 2, target: 'freeze' },
      { id: 'buddy-shop', title: "Habi's shop", detail: '2 items you can buy now', cost: 40, from: true, status: 'ready', target: 'buddy' },
      { id: 'weekly-drop', title: 'Weekly Drop', detail: '☔ Umbrella · finish 2 of 3 quests (1/2)', cost: 150, from: false, status: 'locked', target: 'buddy' },
      { id: 'premium-theme', title: 'Premium Theme', detail: 'Unlock app themes', cost: 200, from: false, status: 'short', short: 80, target: 'reward:premium-theme' },
      { id: 'custom-title', title: 'Custom Title', detail: 'Show a title on the leaderboard', cost: 250, from: false, status: 'owned', target: 'reward:custom-title' },
      { id: 'treat-gift', title: 'Treats for classmates', detail: '3 sent today · more tomorrow', cost: 15, from: true, status: 'full', target: 'gift' },
      { id: 'coach', title: 'AI Coach', detail: 'Enough for 12 answers', cost: 10, from: false, status: 'ready', target: 'coach' },
    ],
    pace: { perDay: 20 },
    nextGoal: { id: 'profile-frames', title: 'Profile Frames', cost: 180, short: 60, days: 3 },
    ...overrides,
  };
}

const at = (daysAgo: number, hour: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour).getTime();
};
const row = (id: string, amount: number, label: string, kind: WalletHistoryItem['kind'], createdAt: number): WalletHistoryItem => ({ id, amount, kind, label, date: new Date(createdAt).toISOString(), createdAt });
// Monday, October 20, 2025: neither today nor yesterday.
const longAgo = new Date(2025, 9, 20, 9).getTime();
const firstPage = [
  row('check-in:h1:a', 5, 'Checked in: Read', 'check-in', at(0, 11)),
  row('spend:freeze:u1', -30, 'Streak freeze', 'freeze', at(0, 10)),
  row('daily-claim:a', 4, 'Daily reward: day 3', 'daily-claim', at(0, 9)),
  row('check-in:h2:b', 5, 'Checked in: Walk', 'check-in', at(1, 18)),
  row('quest:b', 15, 'Quest: 5 check-ins', 'quest', at(1, 17)),
  row('spend:coach:u2', -10, 'AI Coach answer', 'coach', at(1, 16)),
  row('mystery:c', 8, 'Opened the mystery box', 'mystery', longAgo),
];
const olderPage = [row('legacy-uuid', -200, 'Redeemed Premium Theme', 'reward', longAgo - 60_000)];
const totals = { earned: 250, spent: 240, balance: 10 };

/** The history as GET /api/wallet/history pages it: the first page ends at cursor 'c1'. */
function historyAnswer({ filter = 'all', before }: { filter?: string; before?: string | null }) {
  const keep = (items: WalletHistoryItem[]) => items.filter((item) => filter === 'all' || (filter === 'earned' ? item.amount > 0 : item.amount < 0));
  if (before === 'c1') return { ok: true, items: keep(olderPage), nextCursor: null, totals };
  return { ok: true, items: keep(firstPage), nextCursor: 'c1', totals };
}

async function renderWallet() {
  const screen = render(<WalletScreen />);
  await screen.findByText('Ways to earn');
  await screen.findByText('Checked in: Read');
  return screen;
}

beforeEach(() => {
  // A new account: the wallet store starts empty.
  jest.requireMock<{ mockSignOut: () => void }>('@/authentication/session').mockSignOut();
  mockContext.isFaculty = false;
  delete mockParams.section;
  summaryMock.mockImplementation(async () => summaryWith());
  historyMock.mockImplementation(async (query: { filter?: string; before?: string | null }) => historyAnswer(query));
});

describe('Tokens screen', () => {
  it("shows the balance, this week's flow and every way to earn with today's progress", async () => {
    const screen = await renderWallet();
    expect(summaryMock).toHaveBeenCalledWith(today);
    expect(screen.getByText('YOUR WALLET')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();
    expect(screen.getByText('This week: +85 earned · -30 spent')).toBeTruthy();
    expect(screen.getByText('You can still earn up to 42 today')).toBeTruthy();
    expect(screen.queryByText(/You undid a check-in/)).toBeNull();

    for (const title of ['Check in a habit', 'Daily reward', 'Daily challenges', 'Mystery box', 'Weekly quests', 'Weekly consistency bonus', 'Streak milestones']) expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText('Up to 6 paid check-ins a day')).toBeTruthy();
    expect(screen.getByText('+10 / +20 / +30')).toBeTruthy();
    expect(screen.getByText('2/6 paid today · +5 each')).toBeTruthy();
    expect(screen.getByText('Day 3 of 7 · +4 ready')).toBeTruthy();
    expect(screen.getByText('1/3 done · up to 20 more')).toBeTruthy();
    expect(screen.getByText('Ready to open')).toBeTruthy();
    expect(screen.getByText('1/3 · up to 35 more · new on Monday')).toBeTruthy();
    expect(screen.getByText('Last week 80%: +20 ready')).toBeTruthy();
    expect(screen.getByText('5-day streak · 2 days to +15')).toBeTruthy();
    expect(screen.getByText('Next goal: Profile Frames · 60 tokens · about 3 days at your pace')).toBeTruthy();
  });

  it('shows each thing to buy with its cost and status', async () => {
    const screen = await renderWallet();
    expect(screen.getByLabelText('Streak Freeze, 30 tokens: Ready')).toBeTruthy();
    expect(screen.getByLabelText("Habi's shop, from 40 tokens: Ready")).toBeTruthy();
    expect(screen.getByLabelText('Weekly Drop, 150 tokens: Locked')).toBeTruthy();
    expect(screen.getByText('☔ Umbrella · finish 2 of 3 quests (1/2)')).toBeTruthy();
    expect(screen.getByLabelText('Premium Theme, 200 tokens: 80 more')).toBeTruthy();
    expect(screen.getByLabelText('Custom Title, 250 tokens: Owned')).toBeTruthy();
    expect(screen.getByLabelText('Treats for classmates, from 15 tokens: Full')).toBeTruthy();
    expect(screen.getByLabelText('AI Coach, 10 tokens: Ready')).toBeTruthy();
    expect(screen.getByText('Enough for 12 answers')).toBeTruthy();
  });

  it('leads each way to earn to where it is done, and each thing to buy to its sheet', async () => {
    const screen = await renderWallet();
    // Back to the tabs below this screen, not a second copy of them on top.
    fireEvent.press(screen.getByLabelText('Check in a habit: Go'));
    expect(router.dismissTo).toHaveBeenLastCalledWith('/(tabs)/habits');
    fireEvent.press(screen.getByLabelText('Daily reward: Go'));
    expect(router.dismissTo).toHaveBeenLastCalledWith('/(tabs)');
    fireEvent.press(screen.getByLabelText('Mystery box: Go'));
    expect(router.dismissTo).toHaveBeenLastCalledWith('/(tabs)');
    fireEvent.press(screen.getByLabelText('Streak milestones: Go'));
    expect(router.dismissTo).toHaveBeenLastCalledWith('/(tabs)/habits');

    fireEvent.press(screen.getByLabelText('Premium Theme, 200 tokens: 80 more'));
    expect(router.push).toHaveBeenLastCalledWith('/leaderboards?reward=premium-theme');
    fireEvent.press(screen.getByLabelText('Custom Title, 250 tokens: Owned'));
    expect(router.push).toHaveBeenLastCalledWith('/leaderboards?reward=custom-title');
    fireEvent.press(screen.getByLabelText('Weekly Drop, 150 tokens: Locked'));
    expect(router.push).toHaveBeenLastCalledWith('/buddy');
    fireEvent.press(screen.getByLabelText('Treats for classmates, from 15 tokens: Full'));
    expect(router.push).toHaveBeenLastCalledWith('/leaderboards');
    fireEvent.press(screen.getByLabelText('AI Coach, 10 tokens: Ready'));
    expect(router.dismissTo).toHaveBeenLastCalledWith('/(tabs)/profile');

    expect(screen.queryByText('Streak Freeze sheet')).toBeNull();
    fireEvent.press(screen.getByLabelText('Streak Freeze, 30 tokens: Ready'));
    expect(screen.getByText('Streak Freeze sheet')).toBeTruthy();
  });

  it('says how a negative balance is paid back, and the other states of the day', async () => {
    summaryMock.mockImplementation(async () => {
      const base = summaryWith();
      return summaryWith({
        balance: -15,
        tokens: 0,
        today: { ...base.today, dailyClaim: { claimed: true, day: 3, amount: 4, tomorrowAmount: 5 }, mysteryBox: { status: 'opened', amount: 8, min: 3, max: 20 } },
        week: { ...base.week, bonus: { ...base.week.bonus, lastWeek: { ...base.week.bonus.lastWeek, claimable: false, claimed: true, claimedAmount: 20 } } },
        streak: { days: 0, next: { days: 7, bonus: 15, daysLeft: 7 } },
        nextGoal: { id: 'profile-frames', title: 'Profile Frames', cost: 180, short: 195, days: null },
      });
    });
    const screen = await renderWallet();
    expect(screen.getByText('You undid a check-in after spending. Your next 15 tokens pay this back.')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('Claimed +4 · tomorrow +5')).toBeTruthy();
    expect(screen.getByText('Opened +8')).toBeTruthy();
    expect(screen.getByText('This week 50% · 1 more check-in reaches 60% (+10)')).toBeTruthy();
    expect(screen.getByText('0-day streak · 7 days to +15')).toBeTruthy();
    // No pace yet: no days.
    expect(screen.getByText('Next goal: Profile Frames · 195 tokens')).toBeTruthy();
  });

  it("shows the account's own day when the phone is on another one", async () => {
    const now = new Date();
    const accountDay = getLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12));
    summaryMock.mockImplementation(async (date: string) => (date === today
      ? { ok: false, code: 'DAY_CLOSED', message: 'That day is over.', today: accountDay, timeZone: 'Asia/Manila' }
      : summaryWith({ today: { ...summaryWith().today, date: accountDay } })));
    const screen = await renderWallet();
    expect(summaryMock).toHaveBeenLastCalledWith(accountDay, 'Asia/Manila');
    expect(screen.getByText(`Showing your HabitAI day, ${accountDay}. Your phone is on another day because its time zone changed.`)).toBeTruthy();
    expect(screen.getByText('2/6 paid today · +5 each')).toBeTruthy();
  });

  it('shows the latest 5 rows, then all of them by day with filters and Load more', async () => {
    const screen = await renderWallet();
    expect(historyMock).toHaveBeenCalledWith({ filter: 'all', limit: 30 });
    expect(screen.getByText('Checked in: Walk')).toBeTruthy();
    expect(screen.queryByText('AI Coach answer')).toBeNull();
    expect(screen.queryByText('Opened the mystery box')).toBeNull();
    expect(screen.queryByText('All')).toBeNull();

    fireEvent.press(screen.getByText('See all'));
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('Mon, Oct 20')).toBeTruthy();
    expect(screen.getByText('Opened the mystery box')).toBeTruthy();
    expect(screen.getByText('AI Coach answer')).toBeTruthy();
    expect(screen.getByText('-30')).toBeTruthy();
    expect(screen.getByText('In all: +250 earned · -240 spent')).toBeTruthy();

    fireEvent.press(screen.getByText('Load more'));
    expect(await screen.findByText('Redeemed Premium Theme')).toBeTruthy();
    expect(historyMock).toHaveBeenLastCalledWith({ filter: 'all', before: 'c1', limit: 30 });
    expect(screen.queryByText('Load more')).toBeNull();

    fireEvent.press(screen.getByText('Spent'));
    await waitFor(() => expect(screen.queryByText('Checked in: Read')).toBeNull());
    expect(historyMock).toHaveBeenLastCalledWith({ filter: 'spent', limit: 30 });
    expect(screen.getByText('Streak freeze')).toBeTruthy();
    expect(screen.getByText('AI Coach answer')).toBeTruthy();
    expect(screen.queryByText('Redeemed Premium Theme')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Spent', selected: true })).toBeTruthy();

    fireEvent.press(screen.getByText('Load more'));
    expect(await screen.findByText('Redeemed Premium Theme')).toBeTruthy();
    expect(historyMock).toHaveBeenLastCalledWith({ filter: 'spent', before: 'c1', limit: 30 });

    fireEvent.press(screen.getByText('Earned'));
    await waitFor(() => expect(screen.queryByText('Streak freeze')).toBeNull());
    expect(screen.getByText('Checked in: Read')).toBeTruthy();
  });

  it('loads again after a live change, and the history only while a screen shows it', async () => {
    const screen = await renderWallet();
    summaryMock.mockImplementation(async () => summaryWith({ balance: 90, tokens: 90 }));
    await act(async () => reloadWallet());
    expect(await screen.findByText('90')).toBeTruthy();
    expect(summaryMock).toHaveBeenCalledTimes(2);
    expect(historyMock).toHaveBeenCalledTimes(2);

    screen.unmount();
    await act(async () => reloadWallet());
    // Home's Tokens tile still shows the summary; nothing shows the history.
    expect(summaryMock).toHaveBeenCalledTimes(3);
    expect(historyMock).toHaveBeenCalledTimes(2);
  });

  it('loads again when the student comes back to it, not when it opens', async () => {
    const screen = await renderWallet();
    expect(summaryMock).toHaveBeenCalledTimes(1);
    expect(historyMock).toHaveBeenCalledTimes(1);
    // Back from the leaderboard, where Premium Theme was bought.
    summaryMock.mockImplementation(async () => summaryWith({ balance: 0, tokens: 0, spend: summaryWith().spend.map((entry) => (entry.id === 'premium-theme' ? { ...entry, status: 'owned' } : entry)) }));
    await act(async () => mockFocus.effect?.());
    expect(await screen.findByLabelText('Premium Theme, 200 tokens: Owned')).toBeTruthy();
    expect(summaryMock).toHaveBeenCalledTimes(2);
    expect(historyMock).toHaveBeenCalledTimes(2);
  });

  it('starts the history over when it opens again after more new rows than a page', async () => {
    const screen = await renderWallet();
    fireEvent.press(screen.getByText('See all'));
    fireEvent.press(screen.getByText('Load more'));
    expect(await screen.findByText('Redeemed Premium Theme')).toBeTruthy();
    screen.unmount();

    // Days later: a whole page of new rows, and more of them after it (cursor 'c2').
    const fresh = Array.from({ length: 7 }, (_, index) => row(`check-in:new:${index}`, 5, `New check-in ${index}`, 'check-in', at(0, 12) + index * 60_000)).reverse();
    historyMock.mockImplementation(async ({ before }: { before?: string | null }) => (before === 'c2'
      ? { ok: true, items: [row('check-in:new:older', 5, 'Older new check-in', 'check-in', at(0, 11) + 30 * 60_000)], nextCursor: 'c1', totals }
      : { ok: true, items: fresh, nextCursor: 'c2', totals }));
    const again = render(<WalletScreen />);
    await again.findByText('New check-in 6');
    fireEvent.press(again.getByText('See all'));
    // The rows loaded before are not shown after the new page as if nothing came between them.
    expect(again.queryByText('Checked in: Read')).toBeNull();
    expect(again.queryByText('Redeemed Premium Theme')).toBeNull();
    fireEvent.press(again.getByText('Load more'));
    expect(await again.findByText('Older new check-in')).toBeTruthy();
    expect(historyMock).toHaveBeenLastCalledWith({ filter: 'all', before: 'c2', limit: 30 });
  });

  it('opens on the whole history from /wallet?section=history', async () => {
    mockParams.section = 'history';
    const screen = await renderWallet();
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Show less')).toBeTruthy();
    expect(screen.getByText('Mon, Oct 20')).toBeTruthy();
  });

  it('sends faculty back without asking for a wallet', async () => {
    mockContext.isFaculty = true;
    const screen = render(<WalletScreen />);
    await act(async () => undefined);
    expect(router.back).toHaveBeenCalled();
    expect(screen.queryByText('Tokens')).toBeNull();
    expect(summaryMock).not.toHaveBeenCalled();
    expect(historyMock).not.toHaveBeenCalled();
  });
});

describe('withFirstPage', () => {
  const known = { items: [...firstPage, ...olderPage], nextCursor: null };

  it('keeps the rows Load more brought after a reload that reaches them', () => {
    const page = { items: [row('check-in:h3:c', 5, 'Checked in: Stretch', 'check-in', at(0, 12)), ...firstPage.slice(0, 5)], nextCursor: 'c0' };
    const merged = withFirstPage(page, known);
    expect(merged.items.map((item) => item.id)).toEqual(['check-in:h3:c', ...firstPage.map((item) => item.id), 'legacy-uuid']);
    expect(merged.nextCursor).toBeNull();
  });

  it('drops them when the new page ends before them (the rows in between were never loaded)', () => {
    const page = { items: [row('check-in:h4:d', 5, 'Checked in: Swim', 'check-in', at(0, 12) + 60_000), row('check-in:h3:c', 5, 'Checked in: Stretch', 'check-in', at(0, 12))], nextCursor: 'c9' };
    expect(withFirstPage(page, known)).toEqual(page);
  });
});
