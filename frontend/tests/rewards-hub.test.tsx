import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RewardsHub } from '@/components/rewards-hub';

const mockClaim = { ready: true };

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
jest.mock('@/components/engagement-cards', () => {
  const { Text } = jest.requireActual('react-native');
  return { WeeklyQuestsCard: () => <Text>quests card</Text> };
});
jest.mock('@/hooks/use-daily-challenges', () => ({ useDailyChallenges: () => [{ complete: true }, { complete: false }, { complete: false }] }));
jest.mock('@/utils/quests', () => ({ weeklyQuests: () => [{ complete: false }, { complete: false }] }));

const selected = (screen: ReturnType<typeof render>, label: string) => screen.getByLabelText(label).props.accessibilityState?.selected;

describe('RewardsHub', () => {
  it('opens on the daily reward while it waits to be claimed', async () => {
    mockClaim.ready = true;
    const screen = render(<RewardsHub habits={[]} now={new Date(2026, 9, 5)} />);
    await waitFor(() => expect(screen.getByLabelText('Daily: Ready to claim')).toBeTruthy());
    expect(selected(screen, 'Daily: Ready to claim')).toBe(true);
    expect(selected(screen, 'Challenges: 1/3 done')).toBe(false);
  });

  it('opens on the challenges once the reward is claimed, and switches tabs on a tap', async () => {
    mockClaim.ready = false;
    const screen = render(<RewardsHub habits={[]} now={new Date(2026, 9, 5)} />);
    await waitFor(() => expect(screen.getByLabelText('Daily: Claimed today')).toBeTruthy());
    expect(selected(screen, 'Challenges: 1/3 done')).toBe(true);

    fireEvent.press(screen.getByLabelText('Quests: 0/2 done'));
    expect(selected(screen, 'Quests: 0/2 done')).toBe(true);
    expect(selected(screen, 'Challenges: 1/3 done')).toBe(false);
  });
});
