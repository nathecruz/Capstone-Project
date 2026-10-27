import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { WeeklyRecapCard } from '@/components/engagement-cards';
import { RewardsHub } from '@/components/rewards-hub';
import { getWeeklyBonus } from '@/authentication/authService';

const mockClaim = { ready: true };
// Last week's bonus and this week's next tier as GET /api/weekly-bonus answers them, and Habi's week drop.
const mockBonus: { claimable: boolean; next: null | { percent: number; amount: number; checkInsNeeded: number; reachable: boolean } } = { claimable: false, next: null };
const mockBuddy: { buddy: null | { drop: object } } = { buddy: null };
const mockQuests = ['check-ins', 'perfect-days'].map((id) => ({ id, title: id, icon: 'flag', target: 5, progress: 1, reward: 15, weekStart: '2026-10-05', complete: false }));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/components/daily-cards', () => {
  const ReactActual = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    DailyClaimCard: ({ onReadyChange }: { onReadyChange?: (ready: boolean) => void }) => {
      ReactActual.useEffect(() => { onReadyChange?.(mockClaim.ready); }, [onReadyChange]);
      return <Text>daily card</Text>;
    },
    DailyChallengesCard: () => <Text>challenges card</Text>,
  };
});
jest.mock('@/authentication/authService', () => {
  const tiers = [{ percent: 60, amount: 10, label: 'Steady week' }, { percent: 75, amount: 20, label: 'Strong week' }, { percent: 90, amount: 30, label: 'Consistent week' }];
  return {
    openMysteryBox: jest.fn(),
    claimWeeklyBonus: jest.fn(),
    getWeeklyBonus: jest.fn(async () => ({
      ok: true,
      lastWeek: { weekStart: '2026-09-28', weekEnd: '2026-10-04', scheduled: 20, done: 16, percent: 80, activeDays: 6, eligible: true, reason: null, tier: tiers[1], claimed: false, claimedAmount: null, claimable: mockBonus.claimable, lapsesAt: 0 },
      thisWeek: { weekStart: '2026-10-05', weekEnd: '2026-10-11', dueSoFar: 3, doneSoFar: 2, dueWeek: 21, percentSoFar: 66, next: mockBonus.next },
      tiers,
    })),
  };
});
jest.mock('@/authentication/session', () => {
  const listeners: (() => void)[] = [];
  return { subscribeToAuthChanges: (listener: () => void) => { listeners.push(listener); return () => undefined; }, mockSignOut: () => listeners.forEach((listener) => listener()) };
});
jest.mock('@/utils/ai-client', () => ({ askAi: jest.fn() }));
jest.mock('@/hooks/use-buddy', () => ({ useBuddy: () => mockBuddy }));
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => ({ applyWallet: jest.fn(), celebrate: jest.fn(), streakFreeze: null }) }));
jest.mock('@/hooks/use-daily-challenges', () => ({ useDailyChallenges: () => [{ complete: true }, { complete: false }, { complete: false }] }));
jest.mock('@/utils/quests', () => ({ ...jest.requireActual('@/utils/quests'), weeklyQuests: () => mockQuests }));

const selected = (screen: ReturnType<typeof render>, label: string) => screen.getByLabelText(label).props.accessibilityState?.selected;
// Monday, October 5, 2026.
const monday = new Date(2026, 9, 5, 9);

beforeEach(async () => {
  // A new account: the bonus store starts empty.
  jest.requireMock<{ mockSignOut: () => void }>('@/authentication/session').mockSignOut();
  mockBonus.claimable = false;
  mockBonus.next = null;
  mockBuddy.buddy = null;
  await AsyncStorage.clear();
});

describe('RewardsHub', () => {
  it('opens on the daily reward while it waits to be claimed', async () => {
    mockClaim.ready = true;
    const screen = render(<RewardsHub habits={[]} now={monday} />);
    await waitFor(() => expect(screen.getByLabelText('Daily: Ready to claim')).toBeTruthy());
    expect(selected(screen, 'Daily: Ready to claim')).toBe(true);
    expect(selected(screen, 'Challenges: 1/3 done')).toBe(false);
  });

  it('opens on the challenges once the reward is claimed, and switches tabs on a tap', async () => {
    mockClaim.ready = false;
    const screen = render(<RewardsHub habits={[]} now={monday} />);
    await waitFor(() => expect(screen.getByLabelText('Daily: Claimed today')).toBeTruthy());
    expect(selected(screen, 'Challenges: 1/3 done')).toBe(true);

    fireEvent.press(screen.getByLabelText('Quests: 0/2 done'));
    expect(selected(screen, 'Quests: 0/2 done')).toBe(true);
    expect(selected(screen, 'Challenges: 1/3 done')).toBe(false);
    expect(within(screen.getByLabelText('Quests: 0/2 done')).queryByTestId('quests-waiting-dot')).toBeNull();
  });

  it("keeps last week's bonus waiting on the Quests tab, with a red dot, after the recap was closed", async () => {
    mockClaim.ready = false;
    mockBonus.claimable = true;
    const screen = render(<><WeeklyRecapCard habits={[]} now={monday} /><RewardsHub habits={[]} now={monday} /></>);
    expect(await screen.findByText('Claim +20 tokens')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Hide the weekly recap'));
    expect(screen.queryByText('Your week in review')).toBeNull();

    const tab = screen.getByLabelText('Quests: Bonus waiting');
    expect(within(tab).getByTestId('quests-waiting-dot')).toBeTruthy();
    fireEvent.press(tab);
    expect(selected(screen, 'Quests: Bonus waiting')).toBe(true);
    expect(screen.getByText("Last week's bonus is waiting: +20")).toBeTruthy();
    expect(screen.getByLabelText("Claim last week's bonus of 20 tokens")).toBeTruthy();
  });

  it("says how close this week is to the next bonus tier, and names the drop the quests unlock", async () => {
    mockClaim.ready = false;
    mockBonus.next = { percent: 75, amount: 20, checkInsNeeded: 14, reachable: true };
    mockBuddy.buddy = { drop: { item: { id: 'drop-umbrella', slot: 'hand', name: 'Umbrella', emoji: '☔', cost: 150, stage: 'kid', drop: true }, weekStart: '2026-10-05', weekEnd: '2026-10-11', questsDone: 0, questsNeeded: 2, unlocked: false, owned: false } };
    const screen = render(<RewardsHub habits={[]} now={monday} />);
    fireEvent.press(screen.getByLabelText('Quests: 0/2 done'));
    expect(await screen.findByText('This week so far: 66% · 14 more check-ins reach 75% (+20)')).toBeTruthy();
    expect(screen.getByText("Unlocks this week's drop: ☔ Umbrella (0/2)")).toBeTruthy();
    expect(screen.queryByText(/bonus is waiting/)).toBeNull();
  });

  it('leads to every way to earn on the Tokens screen', async () => {
    const screen = render(<RewardsHub habits={[]} now={monday} />);
    fireEvent.press(await screen.findByText('See all ways'));
    expect(router.push).toHaveBeenCalledWith('/wallet');
  });

  it('leaves out a tier this week can no longer reach', async () => {
    mockBonus.claimable = true;
    mockBonus.next = { percent: 90, amount: 30, checkInsNeeded: 18, reachable: false };
    const screen = render(<RewardsHub habits={[]} now={monday} />);
    fireEvent.press(await screen.findByLabelText('Quests: Bonus waiting'));
    expect(getWeeklyBonus).toHaveBeenCalledWith('2026-10-05');
    expect(screen.getByText("Last week's bonus is waiting: +20")).toBeTruthy();
    expect(screen.queryByText(/This week so far/)).toBeNull();
  });
});
