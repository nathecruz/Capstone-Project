// The classmate card from the leaderboard (with and without a showcased Habi, and the student's own
// row), sending a treat to a classmate, and the Buddy Showcase sheet's switch.
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { sendBuddyGift } from '@/authentication/authService';
import { ClassmateSheet } from '@/components/classmate-sheet';
import { ShowcaseSheet } from '@/components/reward-sheets';
import { reloadBuddy } from '@/hooks/use-buddy';
import { BUDDY_STAGES, type Buddy } from '@/utils/buddy';
import { getLocalDateKey } from '@/utils/habit-visibility';
import type { Leader } from '@/utils/leaderboard-range';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/authentication/authService', () => ({ sendBuddyGift: jest.fn() }));
jest.mock('@/hooks/use-rewards', () => ({ useRewards: () => ({ frame: '' }), saveFrame: jest.fn(), saveTitle: jest.fn() }));
const mockContext = { tokens: 30, applyWallet: jest.fn(), preferences: {} as { showBuddy?: boolean }, updatePreferences: jest.fn() };
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext }));
const mockOwn: { buddy: Buddy | null } = { buddy: null };
jest.mock('@/hooks/use-buddy', () => ({ useBuddy: () => mockOwn, reloadBuddy: jest.fn() }));

const GIFT_MESSAGES = ['Keep going!', 'Proud of you!', 'Laban!', "Kaya mo 'yan!", 'Nice streak!'];
// The student's own buddy: its catalog draws classmates' items, and its treats are what can be sent.
const own: Buddy = {
  name: 'Habi', head: '', hand: '', room: '', accessory: '', owned: [], checkIns: 12,
  items: [{ id: 'top-hat', slot: 'head', name: 'Top hat', emoji: '🎩', cost: 150, stage: 'teen' }, { id: 'garden', slot: 'room', name: 'Garden', emoji: '🌳', cost: 80, stage: 'baby' }],
  drops: [{ id: 'drop-umbrella', slot: 'hand', name: 'Umbrella', emoji: '☔', cost: 150, stage: 'kid', drop: true }],
  stages: BUDDY_STAGES,
  treats: [
    { id: 'apple', name: 'Apple', emoji: '🍎', cost: 15, line: '' },
    { id: 'cupcake', name: 'Cupcake', emoji: '🧁', cost: 25, line: '' },
    { id: 'cake', name: 'Birthday cake', emoji: '🎂', cost: 50, line: '' },
  ],
  fedTreats: [], treatsFed: 0, giftMessages: GIFT_MESSAGES,
};
const maria: Leader = {
  id: '0a1b2c3d4e5f', rank: 2, name: 'Maria R.', points: 240, avatar: 'M', title: 'Early Riser', frame: 'gold', isYou: false, canGift: true,
  buddy: { stage: 'teen', checkIns: 50, head: 'top-hat', hand: 'drop-umbrella', accessory: 'unknown-item', room: 'garden' },
};

function open(leader: Leader, period: 'This Week' | 'This Month' | 'All Time' = 'This Week') {
  const onClose = jest.fn();
  const onSent = jest.fn();
  const screen = render(<ClassmateSheet leader={leader} period={period} onClose={onClose} onSent={onSent} />);
  return { screen, onClose, onSent };
}

beforeEach(() => {
  mockOwn.buddy = own;
  mockContext.tokens = 30;
  mockContext.preferences = {};
});

describe('classmate card', () => {
  it('shows the classmate, their standing and their Habi drawn from the own catalog', () => {
    const { screen } = open(maria);
    expect(screen.getByText('Maria R.')).toBeTruthy();
    expect(screen.getByText('Early Riser')).toBeTruthy();
    expect(screen.getByText('#2 · 240 points this week')).toBeTruthy();
    expect(screen.getByLabelText('Gold frame')).toBeTruthy();
    expect(screen.getByLabelText("Maria's Habi, feeling happy")).toBeTruthy();
    expect(screen.getByText("Maria's Habi · Teen stage")).toBeTruthy();
    // A shop item and a drop find their emoji; an id the catalog does not know draws nothing.
    expect(screen.getByText('🎩')).toBeTruthy();
    expect(screen.getByText('☔')).toBeTruthy();
    // The garden room shows its decor.
    expect(screen.getByText('🌳')).toBeTruthy();
    expect(screen.getByText('Send a treat')).toBeTruthy();
    expect(screen.queryByText('This is you')).toBeNull();
  });

  it('says when a classmate has not shown their Habi, and offers no treat when they take none', () => {
    const { screen } = open({ ...maria, buddy: null, canGift: false }, 'All Time');
    expect(screen.getByText('#2 · 240 points all time')).toBeTruthy();
    expect(screen.getByText('Maria has not shown their Habi yet.')).toBeTruthy();
    expect(screen.queryByLabelText(/Habi, feeling/)).toBeNull();
    expect(screen.queryByText('Send a treat')).toBeNull();
  });

  it("is the student's own on their row: no treat, a way to Habi instead", () => {
    const { screen, onClose } = open({ ...maria, name: 'Maria R. (You)', isYou: true, canGift: false, buddy: null }, 'This Month');
    expect(screen.getByText('Maria R.')).toBeTruthy();
    expect(screen.getByText('This is you')).toBeTruthy();
    expect(screen.getByText('#2 · 240 points this month')).toBeTruthy();
    expect(screen.getByText('Classmates do not see your Habi yet.')).toBeTruthy();
    expect(screen.queryByText('Send a treat')).toBeNull();
    fireEvent.press(screen.getByText('Open Habi'));
    expect(onClose).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/buddy');
  });
});

describe('sending a treat', () => {
  it("sends the picked treat and cheer, then shows the server's balance and a toast", async () => {
    jest.mocked(sendBuddyGift).mockResolvedValue({ ok: true, gift: { id: 'g1', treatId: 'cupcake', to: maria.id!, message: 'Proud of you!' }, sentToday: 1, leftToday: 2, tokens: 5, tokenHistory: [], points: 100 });
    const { screen, onClose, onSent } = open(maria);
    fireEvent.press(screen.getByText('Send a treat'));
    expect(screen.getByText('Send Maria a treat')).toBeTruthy();
    // 30 tokens: the birthday cake (50) cannot be picked.
    const cake = screen.getByLabelText('Birthday cake, 50 tokens, 20 more needed');
    expect(cake.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Pick a treat')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Cupcake, 25 tokens'));
    fireEvent.press(screen.getByText('Proud of you!'));
    await act(async () => {
      fireEvent.press(screen.getByText('Send 🧁 Cupcake · 25 tokens'));
    });
    expect(sendBuddyGift).toHaveBeenCalledWith({ to: '0a1b2c3d4e5f', treatId: 'cupcake', messageId: 1 }, getLocalDateKey());
    expect(mockContext.applyWallet).toHaveBeenCalledWith(expect.objectContaining({ tokens: 5 }));
    expect(reloadBuddy).toHaveBeenCalled();
    expect(onSent).toHaveBeenCalledWith('Treat sent to Maria R.!');
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's message when it refuses the treat", async () => {
    jest.mocked(sendBuddyGift).mockResolvedValue({ ok: false, code: 'GIFT_PAIR_LIMIT', message: 'You already sent Maria R. a treat this week.' });
    const { screen, onSent } = open(maria);
    fireEvent.press(screen.getByText('Send a treat'));
    fireEvent.press(screen.getByLabelText('Apple, 15 tokens'));
    await act(async () => {
      fireEvent.press(screen.getByText('Send 🍎 Apple · 15 tokens'));
    });
    expect(sendBuddyGift).toHaveBeenCalledWith({ to: '0a1b2c3d4e5f', treatId: 'apple', messageId: 0 }, getLocalDateKey());
    expect(screen.getByText('You already sent Maria R. a treat this week.')).toBeTruthy();
    expect(mockContext.applyWallet).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });
});

describe('Buddy Showcase sheet', () => {
  it('previews Habi and its switch writes preferences.showBuddy', () => {
    const screen = render(<ShowcaseSheet visible onClose={jest.fn()} />);
    expect(screen.getByLabelText('Habi, feeling happy')).toBeTruthy();
    // Shown when the preference is unset.
    const toggle = screen.getByLabelText('Show my Habi on the leaderboard');
    expect(toggle.props.value).toBe(true);
    fireEvent(toggle, 'valueChange', false);
    expect(mockContext.updatePreferences).toHaveBeenCalledWith({ showBuddy: false });
  });

  it('shows the switch off when Habi is hidden, and leads to dressing Habi up', () => {
    mockContext.preferences = { showBuddy: false };
    const onClose = jest.fn();
    const screen = render(<ShowcaseSheet visible onClose={onClose} />);
    expect(screen.getByLabelText('Show my Habi on the leaderboard').props.value).toBe(false);
    expect(screen.getByText('Hidden: classmates do not see Habi.')).toBeTruthy();
    fireEvent.press(screen.getByText('Dress up Habi'));
    expect(onClose).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/buddy');
  });
});
