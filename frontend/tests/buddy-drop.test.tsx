// The buddy screen's weekly drop: locked until 2 quests are done, bought with the device's today
// after a confirm, then collected and worn from the wardrobe with a Drop tag. Also the treats
// classmates sent today and the Buddy Showcase switch (or where to get it).
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
jest.mock('expo-router', () => ({ router: { dismissTo: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('@/authentication/authService', () => ({ buyBuddyItem: jest.fn(), feedBuddyTreat: jest.fn(), saveBuddy: jest.fn() }));
jest.mock('@/components/buddy', () => ({ BuddyAvatar: () => null }));
jest.mock('@/components/confetti', () => ({ Confetti: () => null }));
const mockShowAlert = jest.fn();
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => mockShowAlert }));
const mockContext = { habits: [], currentHabits: [], tokens: 500, applyWallet: jest.fn(), streakFreeze: null, preferences: {}, updatePreferences: jest.fn() };
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext }));
const mockBuddy: { buddy: Buddy | null } = { buddy: null };
jest.mock('@/hooks/use-buddy', () => ({ useBuddy: () => mockBuddy, publishBuddy: jest.fn(), reloadBuddy: jest.fn() }));
const mockRewards: { rewards: { id: string; name: string; cost: number; description: string; permanent: boolean }[]; owned: string[] } = { rewards: [], owned: [] };
jest.mock('@/hooks/use-rewards', () => ({
  useRewards: () => ({ ...mockRewards, frame: '', owns: (id: string) => mockRewards.owned.includes(id) }),
  saveFrame: jest.fn(),
  saveTitle: jest.fn(),
}));

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
    // Back to Home below this screen, not a second copy of the tabs on top.
    expect(router.dismissTo).toHaveBeenCalledWith('/(tabs)');
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

describe('treats from classmates and Buddy Showcase on the buddy screen', () => {
  const cupcake = { id: 'cupcake', name: 'Cupcake', emoji: '🧁', cost: 25, line: 'So sweet!' };
  const apple = { id: 'apple', name: 'Apple', emoji: '🍎', cost: 15, line: 'Crunchy!' };
  const showcase = { id: 'buddy-showcase', name: 'Buddy Showcase', cost: 300, description: 'Show your Habi', permanent: true };

  beforeEach(() => {
    mockRewards.rewards = [showcase];
    mockRewards.owned = [];
  });

  it("puts today's gifts in Habi's room and says the newest one", () => {
    mockBuddy.buddy = buddyWith({}, {
      treats: [apple, cupcake],
      giftsToday: [{ treatId: 'apple', emoji: '🍎', from: 'Maria R.', message: 'Laban!' }, { treatId: 'cupcake', emoji: '🧁', from: 'Jose P.', message: 'Keep going!' }],
      giftsSent: 2,
      giftsReceived: 5,
    });
    const screen = render(<BuddyScreen />);
    expect(screen.getByLabelText('Treats from classmates today: 🍎 🧁')).toBeTruthy();
    expect(screen.getByText('Maria R. sent me an apple! Laban!')).toBeTruthy();
    expect(screen.getByText('Gifts sent 2 · received 5')).toBeTruthy();
  });

  it('says its own line on a day without gifts', () => {
    mockBuddy.buddy = buddyWith({}, { treats: [cupcake], giftsToday: [], giftsSent: 0, giftsReceived: 0 });
    const screen = render(<BuddyScreen />);
    expect(screen.queryByLabelText(/Treats from classmates today/)).toBeNull();
    expect(screen.queryByText(/sent me/)).toBeNull();
    expect(screen.getByText('Gifts sent 0 · received 0')).toBeTruthy();
  });

  it('leads to Buddy Showcase on the leaderboard until it is bought', () => {
    mockBuddy.buddy = buddyWith({});
    const screen = render(<BuddyScreen />);
    expect(screen.queryByLabelText('Show my Habi on the leaderboard')).toBeNull();
    fireEvent.press(screen.getByText('Buddy Showcase · 300 tokens: let classmates see Habi'));
    expect(router.push).toHaveBeenCalledWith('/leaderboards?reward=buddy-showcase');
  });

  it('has the showcase switch once bought', () => {
    mockRewards.owned = ['buddy-showcase'];
    mockBuddy.buddy = buddyWith({});
    const screen = render(<BuddyScreen />);
    expect(screen.queryByText(/let classmates see Habi/)).toBeNull();
    fireEvent(screen.getByLabelText('Show my Habi on the leaderboard'), 'valueChange', false);
    expect(mockContext.updatePreferences).toHaveBeenCalledWith({ showBuddy: false });
  });
});
