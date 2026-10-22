// The buddy screen's weekly drop: locked until 2 quests are done, bought with the device's today
// after a confirm, then collected and worn from the wardrobe with a Drop tag.
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import BuddyScreen from '@/app/buddy';
import { buyBuddyItem } from '@/authentication/authService';
import { publishBuddy, reloadBuddy } from '@/hooks/use-buddy';
import { BUDDY_STAGES, type Buddy, type BuddyDrop, type BuddyItem } from '@/utils/buddy';
import { getLocalDateKey } from '@/utils/habit-visibility';
import { weekStartOf } from '@/utils/quests';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('@/authentication/authService', () => ({ buyBuddyItem: jest.fn(), feedBuddyTreat: jest.fn(), saveBuddy: jest.fn() }));
jest.mock('@/components/buddy', () => ({ BuddyAvatar: () => null }));
jest.mock('@/components/confetti', () => ({ Confetti: () => null }));
const mockShowAlert = jest.fn();
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => mockShowAlert }));
const mockContext = { habits: [], currentHabits: [], tokens: 500, applyWallet: jest.fn(), streakFreeze: null };
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext }));
const mockBuddy: { buddy: Buddy | null } = { buddy: null };
jest.mock('@/hooks/use-buddy', () => ({ useBuddy: () => mockBuddy, publishBuddy: jest.fn(), reloadBuddy: jest.fn() }));

const umbrella: BuddyItem = { id: 'drop-umbrella', slot: 'hand', name: 'Umbrella', emoji: '☔', cost: 150, stage: 'kid', drop: true };
const rice: BuddyItem = { ...umbrella, id: 'drop-rice', name: 'Rice stalk', emoji: '🌾' };
const shift = (dateKey: string, days: number) => new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
// The device's week: the screen shows only the drop of today's week.
const weekStart = weekStartOf(getLocalDateKey());
function buddyWith(drop: Partial<BuddyDrop>, overrides: Partial<Buddy> = {}): Buddy {
  return {
    name: 'Habi', head: '', hand: '', room: '', accessory: '', owned: [], checkIns: 30, items: [{ id: 'cookie', slot: 'hand', name: 'Cookie', emoji: '🍪', cost: 45, stage: 'baby' }],
    stages: BUDDY_STAGES, treats: [], fedTreats: [], treatsFed: 0, drops: [umbrella, rice, ...Array.from({ length: 10 }, (_, index) => ({ ...rice, id: `drop-${index}` }))], dropsOwned: 0,
    drop: { item: umbrella, weekStart, weekEnd: shift(weekStart, 6), questsDone: 1, questsNeeded: 2, unlocked: false, owned: false, ...drop },
    ...overrides,
  };
}
/** Presses the confirm dialog's button `text`. */
async function confirm(text: string) {
  const buttons = mockShowAlert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => unknown }[];
  await act(async () => {
    await buttons.find((button) => button.text === text)?.onPress?.();
  });
}

describe('weekly drop on the buddy screen', () => {
  it('is locked until 2 of the 3 quests are done, and leads to the quests', () => {
    mockBuddy.buddy = buddyWith({ questsDone: 1 });
    const screen = render(<BuddyScreen />);
    expect(screen.getByText("This week's drop")).toBeTruthy();
    expect(screen.getByText('☔ Umbrella · 150 tokens · this week only')).toBeTruthy();
    expect(screen.getByText('Finish 2 of 3 weekly quests to unlock (1/2)')).toBeTruthy();
    expect(screen.getByText('Drops collected 0/12')).toBeTruthy();
    fireEvent.press(screen.getByLabelText("See this week's quests"));
    expect(router.navigate).toHaveBeenCalledWith('/(tabs)');
  });

  it('is bought after a confirm, with the device today', async () => {
    mockBuddy.buddy = buddyWith({ questsDone: 2, unlocked: true });
    const bought = buddyWith({ questsDone: 2, unlocked: true, owned: true }, { owned: ['drop-umbrella'], hand: 'drop-umbrella', dropsOwned: 1 });
    jest.mocked(buyBuddyItem).mockResolvedValue({ ok: true, buddy: bought, tokens: 350 });
    const screen = render(<BuddyScreen />);
    fireEvent.press(screen.getByLabelText('Umbrella: Get it'));
    expect(mockShowAlert).toHaveBeenCalledWith('Buy Umbrella for 150 tokens?', '☔  This week only. Habi will wear it right away.', expect.any(Array));
    await confirm('Get it');
    expect(buyBuddyItem).toHaveBeenCalledWith('drop-umbrella', getLocalDateKey());
    expect(publishBuddy).toHaveBeenCalledWith(bought);
    expect(mockContext.applyWallet).toHaveBeenCalledWith(expect.objectContaining({ tokens: 350 }));
  });

  it('loads the drop again when the server refuses it', async () => {
    mockBuddy.buddy = buddyWith({ questsDone: 2, unlocked: true });
    jest.mocked(buyBuddyItem).mockResolvedValue({ ok: false, code: 'DROP_GONE', message: 'This drop is gone for now. It comes back in 11 weeks.' });
    const screen = render(<BuddyScreen />);
    fireEvent.press(screen.getByLabelText('Umbrella: Get it'));
    await confirm('Get it');
    expect(mockShowAlert).toHaveBeenLastCalledWith('Not yet', 'This drop is gone for now. It comes back in 11 weeks.');
    expect(reloadBuddy).toHaveBeenCalled();
  });

  it("is not offered after its week (a buddy loaded before Monday still has last week's drop)", () => {
    mockBuddy.buddy = buddyWith({ questsDone: 2, unlocked: true, weekStart: shift(weekStart, -7), weekEnd: shift(weekStart, -1) });
    const screen = render(<BuddyScreen />);
    expect(screen.queryByText("This week's drop")).toBeNull();
    expect(screen.queryByLabelText('Umbrella: Get it')).toBeNull();
  });

  it('is collected, and worn from the wardrobe with a Drop tag', () => {
    mockBuddy.buddy = buddyWith({ questsDone: 3, unlocked: true, owned: true }, { owned: ['drop-umbrella'], dropsOwned: 1 });
    const screen = render(<BuddyScreen />);
    expect(screen.getByText('Collected')).toBeTruthy();
    expect(screen.getByText('Drops collected 1/12')).toBeTruthy();
    fireEvent.press(screen.getByText('To hold'));
    expect(screen.getByLabelText('Umbrella (weekly drop): Wear')).toBeTruthy();
    expect(screen.getByText('Drop')).toBeTruthy();
    // Drops not collected stay out of the wardrobe.
    expect(screen.queryByLabelText(/Rice stalk/)).toBeNull();
  });
});
