// The Rewards Shop (app/rewards-shop.tsx): rewards that help with school, work and health, redeemed
// in one place. A made reward (a quiz here) is made by the server and opens in My Rewards; one kept
// for good (the Wellness Pack) is confirmed, then opened; a certificate opens its link and can be
// deleted. The Wellness Pack's routines run step by step once it is unlocked.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import RewardsShopScreen from '@/app/rewards-shop';
import WellnessScreen from '@/app/wellness';
import { redeemReward, type ServerReward } from '@/authentication';
import { deleteRewardItem, getRewardItems, redeemMadeReward, type RewardItem } from '@/utils/rewards-client';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => undefined) }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return { SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('@/components/reward-sheets', () => ({ FrameSheet: () => null, ShowcaseSheet: () => null, ThemeSheet: () => null, TitleSheet: () => null }));
jest.mock('@/components/streak-freeze-sheet', () => ({ StreakFreezeSheet: () => null }));
const mockDialog = jest.fn();
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => mockDialog }));
jest.mock('@/authentication', () => ({ redeemReward: jest.fn() }));
jest.mock('@/utils/rewards-client', () => ({ redeemMadeReward: jest.fn(), getRewardItems: jest.fn(async () => []), deleteRewardItem: jest.fn(async () => true) }));
let mockContext: Record<string, unknown>;
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext }));
const mockMarkOwned = jest.fn();
let mockCatalog: { status: string; rewards: ServerReward[]; owned: string[]; title: string; frame: string };
jest.mock('@/hooks/use-rewards', () => ({
  useRewards: () => ({ ...mockCatalog, owns: (id: string) => mockCatalog.owned.includes(id) }),
  loadRewards: jest.fn(),
  markRewardOwned: (id: string) => mockMarkOwned(id),
}));

const reward = (id: string, name: string, cost: number, made: boolean, description = `${name} helps.`): ServerReward => ({ id, name, cost, description, permanent: !made, ...(made ? { made: true } : {}) });
const quizItem: RewardItem = {
  id: 'item-1',
  rewardId: 'practice-quiz',
  title: 'Photosynthesis',
  createdAt: Date.parse('2026-11-14T08:00:00Z'),
  output: { title: 'Photosynthesis', topic: 'Photosynthesis', questions: [{ question: 'What does chlorophyll absorb?', choices: ['Light', 'Water', 'Soil', 'Oxygen'], answerIndex: 0, explanation: 'It absorbs light.' }] },
};
const certificateItem: RewardItem = {
  id: 'item-2',
  rewardId: 'certificate',
  title: 'Certificate of Achievement · 2026-11-14',
  createdAt: Date.parse('2026-11-14T09:00:00Z'),
  code: 'ABCDEFGH23',
  url: 'https://api.example.test/certificates/ABCDEFGH23',
  output: { name: 'Ana Santos', role: 'Student', checkIns: 42, activeDays: 20, habits: 6, health: 30, academics: 12, streak: 5, since: '2026-10-01', issuedOn: '2026-11-14' },
};
const settle = () => act(async () => { await new Promise<void>((resolve) => setImmediate(() => resolve())); });

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockContext = { tokens: 120, applyWallet: jest.fn(), isFaculty: false, streakFreeze: { available: 0, max: 2, cost: 30 } };
  mockCatalog = {
    status: 'ready',
    rewards: [
      reward('practice-quiz', 'AI Practice Quiz', 15, true),
      reward('study-planner', 'AI Study & Work Planner', 30, true),
      reward('certificate', 'Certificate of Achievement', 100, true),
      reward('wellness-pack', 'Wellness Pack', 120, false),
      reward('premium-theme', 'Premium Themes', 200, false),
    ],
    owned: [],
    title: '',
    frame: '',
  };
});

describe('the Rewards Shop', () => {
  it('sorts the rewards by what they help with, and says what is still missing', async () => {
    render(<RewardsShopScreen />);
    await settle();
    for (const text of ['Study and work', 'Health and focus', 'Recognition', 'Make it yours', 'AI Practice Quiz', 'Wellness Pack', 'Streak Freeze', "Habi's shop", 'Check in your habits to earn more.']) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getAllByText('120 tokens')).toHaveLength(2);
    expect(screen.getByText('15 tokens each time')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Premium Themes: 80 more tokens needed'));
    expect(screen.getByText('80 more tokens for Premium Themes. Check in your habits to earn them.')).toBeTruthy();
  });

  it('makes a practice quiz on a topic and opens it in My Rewards, ready to answer', async () => {
    jest.mocked(redeemMadeReward).mockResolvedValueOnce({ ok: true, item: quizItem, wallet: { tokens: 105, tokenHistory: [] } });
    render(<RewardsShopScreen />);
    await settle();
    fireEvent.press(screen.getByLabelText('Redeem AI Practice Quiz for 15 tokens'));
    expect(screen.getByLabelText('Redeem for 15 tokens').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByLabelText('Topic'), 'Photosynthesis');
    await act(async () => { fireEvent.press(screen.getByLabelText('Redeem for 15 tokens')); });
    expect(redeemMadeReward).toHaveBeenCalledWith({ rewardId: 'practice-quiz', topic: 'Photosynthesis' });
    expect(mockContext.applyWallet).toHaveBeenCalledWith({ tokens: 105, tokenHistory: [] });
    expect(screen.getByText('1. What does chlorophyll absorb?')).toBeTruthy();
    fireEvent.press(screen.getByText('B. Water'));
    expect(screen.getByLabelText('Light, correct answer')).toBeTruthy();
    expect(screen.getByText('It absorbs light.')).toBeTruthy();
    expect(screen.getByText('Score: 0 of 1')).toBeTruthy();
  });

  it('shows why a reward could not be made, with the tokens given back', async () => {
    jest.mocked(redeemMadeReward).mockResolvedValueOnce({ ok: false, refunded: true, message: 'Try a subject you are studying. Your 15 tokens were returned.', wallet: { tokens: 120 } });
    render(<RewardsShopScreen />);
    await settle();
    fireEvent.press(screen.getByLabelText('Redeem AI Practice Quiz for 15 tokens'));
    fireEvent.changeText(screen.getByLabelText('Topic'), 'asdf qwer');
    await act(async () => { fireEvent.press(screen.getByText('Redeem for 15 tokens')); });
    expect(screen.getByText('Try a subject you are studying. Your 15 tokens were returned.')).toBeTruthy();
    expect(mockContext.applyWallet).toHaveBeenCalledWith({ tokens: 120 });
  });

  it('confirms a reward kept for good, then opens it', async () => {
    jest.mocked(redeemReward).mockResolvedValueOnce({ ok: true, tokens: 0, tokenHistory: [] });
    render(<RewardsShopScreen />);
    await settle();
    fireEvent.press(screen.getByLabelText('Redeem Wellness Pack for 120 tokens'));
    expect(screen.getByText('120 − 120 = 0 tokens left. Yours to keep.')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Redeem for 120')); });
    expect(redeemReward).toHaveBeenCalledWith({ id: 'wellness-pack', title: 'Wellness Pack', cost: 120 });
    expect(mockMarkOwned).toHaveBeenCalledWith('wellness-pack');
    expect(router.push).toHaveBeenCalledWith('/wellness');
  });

  it('opens a certificate from My Rewards, and deleting it stops its link', async () => {
    jest.mocked(getRewardItems).mockResolvedValueOnce([certificateItem]);
    mockDialog.mockImplementation((_title: string, _body: string, buttons?: { text: string; onPress?: () => void }[]) => buttons?.find((button) => button.text === 'Delete')?.onPress?.());
    mockParams = { tab: 'mine' };
    render(<RewardsShopScreen />);
    await settle();
    fireEvent.press(screen.getByLabelText('Open Certificate: Certificate of Achievement · 2026-11-14'));
    expect(screen.getByText('Certificate of Achievement for Ana Santos, issued Sat, Nov 14.')).toBeTruthy();
    fireEvent.press(screen.getByText('Open certificate'));
    expect(openBrowserAsync).toHaveBeenCalledWith('https://api.example.test/certificates/ABCDEFGH23');
    await act(async () => { fireEvent.press(screen.getByText('Delete')); });
    await settle();
    expect(deleteRewardItem).toHaveBeenCalledWith('item-2');
    expect(screen.queryByLabelText('Open Certificate: Certificate of Achievement · 2026-11-14')).toBeNull();
  });

  it('opens the reward a link names, once the catalog is in', async () => {
    mockParams = { reward: 'study-planner' };
    render(<RewardsShopScreen />);
    await settle();
    expect(screen.getByLabelText('What is it?')).toBeTruthy();
    expect(screen.getByText('30 min')).toBeTruthy();
  });
});

describe('the Wellness Pack', () => {
  it('shows what it has and where to unlock it, then runs a routine step by step', async () => {
    const locked = render(<WellnessScreen />);
    fireEvent.press(locked.getByText('Unlock in the Rewards Shop'));
    expect(router.push).toHaveBeenCalledWith('/rewards-shop?reward=wellness-pack');
    locked.unmount();

    jest.useFakeTimers();
    try {
      mockCatalog.owned = ['wellness-pack'];
      render(<WellnessScreen />);
      fireEvent.press(screen.getByLabelText('Start 20-20-20 eye break, 0.5 minutes'));
      fireEvent.press(screen.getByText('Start'));
      expect(screen.getByText('Look at something about 20 feet (6 meters) away')).toBeTruthy();
      act(() => { jest.advanceTimersByTime(20_000); });
      expect(screen.getByText('Close your eyes and blink slowly')).toBeTruthy();
      act(() => { jest.advanceTimersByTime(10_000); });
      expect(screen.getByText('Well done. Take that calm back to your work.')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
