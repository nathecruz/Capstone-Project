// Home's Daily quests card: each quest with what is left (or Missed), the quest chest, the quest
// streak, when new quests come, and Habi cheering them on.
import { render } from '@testing-library/react-native';
import React from 'react';
import type { DailyChallenge } from '@/authentication/authService';
import { DailyChallengesCard } from '@/components/daily-cards';
import type { DailyQuests } from '@/hooks/use-daily-challenges';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => ({ streakFreeze: null, applyWallet: jest.fn() }) }));
jest.mock('@/hooks/use-buddy', () => ({ useBuddy: () => ({ buddy: null }) }));
let mockQuests: DailyQuests;
jest.mock('@/hooks/use-daily-challenges', () => ({ useDailyQuests: () => mockQuests }));

const quest = (id: string, title: string, extra: Partial<DailyChallenge> = {}): DailyChallenge => ({ id, title, icon: 'trophy', target: 2, progress: 1, reward: 10, date: '2026-11-18', complete: false, reachable: true, ...extra });
// Wednesday 18 November 2026, 3:00 PM: the early-bird quest is over.
const now = new Date(2026, 10, 18, 15, 0);
const midnight = new Date(2026, 10, 19).getTime();
const picture = (screen: ReturnType<typeof render>) => String(screen.getByTestId('buddy-picture').props.source?.[0]?.testUri ?? '');

describe('DailyChallengesCard', () => {
  it('shows each quest with what is left, a missed one greyed out, and the chest closed for today', () => {
    mockQuests = {
      date: '2026-11-18', chestReward: 10, streak: 3, resetsAt: midnight,
      challenges: [
        quest('finish', 'Finish 2 habits today'),
        quest('early-bird', 'Check in before 10 AM', { target: 1, progress: 0, reward: 5 }),
        quest('streak-keeper', 'Keep your 4-day Read streak', { target: 1, progress: 1, reward: 8, complete: true }),
      ],
    };
    const screen = render(<DailyChallengesCard habits={[]} now={now} />);
    expect(screen.getByText('Daily quests')).toBeTruthy();
    expect(screen.getByText('1 of 3 done · new quests in 9h 0m')).toBeTruthy();
    expect(screen.getByText('1 more habit to go')).toBeTruthy();
    expect(screen.getByText('Missed today')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Closed for today: a quest was missed')).toBeTruthy();
    expect(screen.getByText('Your 3-day quest streak ends today')).toBeTruthy();
    expect(screen.getByText('One got away today, but the rest still pay!')).toBeTruthy();
    // 8 of the quests' 23 tokens, and the chest's 10.
    expect(screen.getByLabelText('8 of 33 tokens earned')).toBeTruthy();
    expect(picture(screen)).toContain('habi-');
  });

  it('opens the chest once every quest is done, with Habi thrilled', () => {
    mockQuests = {
      date: '2026-11-18', chestReward: 10, streak: 2, resetsAt: midnight,
      challenges: [quest('finish', 'Finish 2 habits today', { progress: 2, complete: true }), quest('comeback', 'Bounce back: do Read today', { target: 1, progress: 1, reward: 8, complete: true })],
    };
    const screen = render(<DailyChallengesCard habits={[]} now={now} />);
    expect(screen.getByText('All done! New quests in 9h 0m')).toBeTruthy();
    expect(screen.getByText('Quest chest opened!')).toBeTruthy();
    expect(screen.getByLabelText('Quest chest opened: 10 bonus tokens')).toBeTruthy();
    expect(screen.getByText('3 days in a row with the chest opened')).toBeTruthy();
    expect(screen.getByText('We opened the chest! +10 bonus tokens.')).toBeTruthy();
    expect(screen.getByLabelText('28 of 28 tokens earned')).toBeTruthy();
    expect(picture(screen)).toContain('habi-ecstatic.webp');
  });

  it('leaves the chest and streak out for an older server, and hides with no quests', () => {
    mockQuests = { date: '2026-11-18', chestReward: 0, streak: 0, resetsAt: 0, challenges: [quest('finish', 'Finish 2 habits today')] };
    const screen = render(<DailyChallengesCard habits={[]} now={now} />);
    expect(screen.getByText('1 more quest to go today!')).toBeTruthy();
    expect(screen.queryByText(/Quest chest/)).toBeNull();
    expect(screen.queryByText(/quest streak/)).toBeNull();
    mockQuests = { ...mockQuests, challenges: [] };
    expect(render(<DailyChallengesCard habits={[]} now={now} />).toJSON()).toBeNull();
  });
});
