// The Monday recap with the weekly consistency bonus: the server's numbers for last week, the
// ladder, the claim (paid once) and the AI planner for the new week, or what to reach this week.
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { claimWeeklyBonus, getWeeklyBonus, type WeeklyBonus } from '@/authentication/authService';
import { WeeklyRecapCard } from '@/components/engagement-cards';
import type { Habit } from '@/hooks/app-state/types';
import { askAi } from '@/utils/ai-client';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/authService', () => ({ openMysteryBox: jest.fn(), getWeeklyBonus: jest.fn(), claimWeeklyBonus: jest.fn() }));
jest.mock('@/authentication/session', () => {
  const listeners: (() => void)[] = [];
  return { subscribeToAuthChanges: (listener: () => void) => { listeners.push(listener); return () => undefined; }, mockSignOut: () => listeners.forEach((listener) => listener()) };
});
jest.mock('@/utils/ai-client', () => ({ askAi: jest.fn() }));
jest.mock('@/hooks/use-buddy', () => ({ useBuddy: () => ({ buddy: null }) }));
const mockContext = { applyWallet: jest.fn(), celebrate: jest.fn(), streakFreeze: null };
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext }));

const tiers = [{ percent: 60, amount: 10, label: 'Steady week' }, { percent: 75, amount: 20, label: 'Strong week' }, { percent: 90, amount: 30, label: 'Consistent week' }];
/** Last week (October 19 to 25) at 85%: the Strong week tier, still to claim. */
function bonus(lastWeek: Partial<WeeklyBonus['lastWeek']> = {}): WeeklyBonus {
  return {
    lastWeek: { weekStart: '2026-10-19', weekEnd: '2026-10-25', scheduled: 20, done: 17, percent: 85, activeDays: 6, eligible: true, reason: null, tier: tiers[1], claimed: false, claimedAmount: null, claimable: true, lapsesAt: new Date(2026, 10, 2).getTime(), ...lastWeek },
    thisWeek: { weekStart: '2026-10-26', weekEnd: '2026-11-01', dueSoFar: 3, doneSoFar: 2, dueWeek: 21, percentSoFar: 66, next: { percent: 75, amount: 20, checkInsNeeded: 14, reachable: true } },
    tiers,
  };
}
const notEarned = { percent: 50, done: 10, eligible: false, reason: 'low-rate' as const, tier: null, claimable: false };

// Monday, October 26, 2026. The app's own count (one habit: 5 of 7 last week, 4 of 7 the week
// before) differs from the server's: the card shows the server's rate, and the app's change and best day.
const monday = new Date(2026, 9, 26, 9);
const walk: Habit = {
  id: 'walk', label: 'Walk', startDate: '2026-10-01', meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'walk-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, reminderEnabled: false, reminderTime: '07:00 AM',
  completionDates: ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'],
};
const paid = { ok: true as const, amount: 20, alreadyClaimed: false, percent: 85, tier: tiers[1], tokens: 140, tokenHistory: [], points: 400 };

beforeEach(async () => {
  jest.requireMock<{ mockSignOut: () => void }>('@/authentication/session').mockSignOut();
  await AsyncStorage.clear();
});

describe('WeeklyRecapCard with the weekly bonus', () => {
  it("shows the server's numbers and the ladder, claims the bonus, then offers the AI planner", async () => {
    jest.mocked(getWeeklyBonus).mockResolvedValue({ ok: true, ...bonus() });
    jest.mocked(claimWeeklyBonus).mockResolvedValue(paid);
    const screen = render(<WeeklyRecapCard habits={[walk]} now={monday} />);

    expect(await screen.findByText('85%')).toBeTruthy();
    expect(getWeeklyBonus).toHaveBeenCalledWith('2026-10-26');
    expect(screen.getByText('17/20 done')).toBeTruthy();
    expect(screen.queryByText('71%')).toBeNull();
    expect(screen.getByText('▲14')).toBeTruthy();
    expect(screen.getByText('Tue')).toBeTruthy();
    expect(screen.getByLabelText('Weekly bonus: 60% pays 10 tokens, 75% pays 20 tokens, 90% pays 30 tokens. Last week reached 75%')).toBeTruthy();
    expect(screen.getByText('75% +20')).toBeTruthy();

    fireEvent.press(screen.getByText('Claim +20 tokens'));
    expect(await screen.findByText('Claimed +20 tokens')).toBeTruthy();
    expect(claimWeeklyBonus).toHaveBeenCalledWith('2026-10-26');
    expect(mockContext.applyWallet).toHaveBeenCalledWith(expect.objectContaining({ tokens: 140, points: 400 }));
    expect(mockContext.celebrate).toHaveBeenCalledWith(expect.objectContaining({ id: 'weekly-bonus:2026-10-19', kind: 'bonus', title: 'Weekly bonus!', message: 'Strong week: +20 tokens.' }));
    expect(screen.queryByText('Claim +20 tokens')).toBeNull();

    fireEvent.press(screen.getByText('Plan this week with AI'));
    expect(router.push).toHaveBeenCalledWith('/(tabs)/goals');
  });

  it('shows a bonus another device already claimed as claimed, without celebrating it again', async () => {
    jest.mocked(getWeeklyBonus).mockResolvedValue({ ok: true, ...bonus() });
    jest.mocked(claimWeeklyBonus).mockResolvedValue({ ...paid, alreadyClaimed: true });
    const screen = render(<WeeklyRecapCard habits={[walk]} now={monday} />);
    fireEvent.press(await screen.findByText('Claim +20 tokens'));
    expect(await screen.findByText('Claimed +20 tokens')).toBeTruthy();
    expect(mockContext.celebrate).not.toHaveBeenCalled();
  });

  it('shows the claimed state the server reports, with the planner', async () => {
    jest.mocked(getWeeklyBonus).mockResolvedValue({ ok: true, ...bonus({ claimed: true, claimedAmount: 20, claimable: false }) });
    const screen = render(<WeeklyRecapCard habits={[walk]} now={monday} />);
    expect(await screen.findByText('Claimed +20 tokens')).toBeTruthy();
    expect(screen.getByText('Plan this week with AI')).toBeTruthy();
    expect(screen.queryByText(/^Claim \+/)).toBeNull();
  });

  it('says what to reach this week when last week did not earn the bonus', async () => {
    jest.mocked(getWeeklyBonus).mockResolvedValue({ ok: true, ...bonus(notEarned) });
    const screen = render(<WeeklyRecapCard habits={[walk]} now={monday} />);
    expect(await screen.findByText('Reach 60% this week for +10 tokens.')).toBeTruthy();
    expect(screen.getByText('Habits added after Wednesday count from next week.')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByLabelText('Weekly bonus: 60% pays 10 tokens, 75% pays 20 tokens, 90% pays 30 tokens')).toBeTruthy();
    expect(screen.queryByText(/^Claim/)).toBeNull();
    expect(screen.queryByText('Plan this week with AI')).toBeNull();
  });

  it("asks the AI about the server's numbers", async () => {
    jest.mocked(getWeeklyBonus).mockResolvedValue({ ok: true, ...bonus() });
    jest.mocked(askAi).mockResolvedValue({ ok: true, answer: 'Walk right after lunch.' } as Awaited<ReturnType<typeof askAi>>);
    const screen = render(<WeeklyRecapCard habits={[walk]} now={monday} />);
    fireEvent.press(await screen.findByText('Get an AI tip for this week'));
    expect(await screen.findByText('Walk right after lunch.')).toBeTruthy();
    expect(askAi).toHaveBeenCalledWith('assistant', expect.stringContaining('I completed 17 of 20 scheduled habit check-ins (85%)'));
  });
});
