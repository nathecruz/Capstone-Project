// Home after the weekly reset (habits last one week): today's cards get this week's habits only,
// the progress cards every habit, since their history includes past weeks.
import React from 'react';
import { render } from '@testing-library/react-native';
import HomeScreen from '@/app/(tabs)/index';
import type { Habit } from '@/hooks/app-state/types';

// What each Home card was given, by card.
const mockProps: Record<string, { habits?: Habit[]; middle?: React.ReactElement<{ habits: Habit[] }> }> = {};
// A function declaration, so the module factories below (run before this file's constants) can use it.
function mockCard(name: string) {
  return (props: object) => {
    mockProps[name] = props;
    return null;
  };
}
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('@/components/today-agenda', () => ({ TodayAgenda: mockCard('TodayAgenda') }));
jest.mock('@/components/bento-tiles', () => ({ BentoTiles: mockCard('BentoTiles') }));
jest.mock('@/components/week-strip', () => ({ WeekStrip: mockCard('WeekStrip') }));
jest.mock('@/components/rewards-hub', () => ({ RewardsHub: mockCard('RewardsHub') }));
jest.mock('@/components/device-reminders-banner', () => ({ DeviceRemindersBanner: mockCard('DeviceRemindersBanner') }));
jest.mock('@/components/engagement-cards', () => ({
  MysteryBoxCard: mockCard('MysteryBoxCard'),
  NextBadgeCard: mockCard('NextBadgeCard'),
  StreakRiskBanner: mockCard('StreakRiskBanner'),
  WeeklyRecapCard: mockCard('WeeklyRecapCard'),
}));
jest.mock('@/components/class-pulse-card', () => ({ ClassPulseCard: () => null }));
jest.mock('@/components/install-app', () => ({ InstallAppCard: () => null }));
jest.mock('@/components/streak-freeze-sheet', () => ({ StreakFreezeSheet: () => null }));
jest.mock('@/components/framed-avatar', () => ({ FramedAvatar: ({ children }: { children?: React.ReactNode }) => children }));
jest.mock('@/hooks/use-rewards', () => ({ useRewards: () => ({ frame: null }) }));
jest.mock('@/hooks/use-responsive-layout', () => ({ useResponsiveLayout: () => ({ isDesktop: false }) }));
jest.mock('@/utils/live-events', () => ({ useUnreadCount: () => 0 }));

const habit = (id: string, overrides: Partial<Habit> = {}): Habit => ({
  id, label: id, startDate: '2026-10-19', activeUntil: '2026-10-25', meta: 'Daily • 07:00 AM', category: 'Health', frequency: 'Daily',
  icon: 'heart-outline', color: '#E58D8D', goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: true, reminderTime: '07:00 AM',
  ...overrides,
});
const lastWeek = habit('read', { startDate: '2026-10-12', activeUntil: '2026-10-18', completionDates: ['2026-10-12'] });
const thisWeek = habit('walk');
const mockContext = {
  avatarImage: null, profile: { firstName: 'Ana', fullName: 'Ana Cruz' }, toggleHabit: jest.fn(), isFaculty: false, goals: [], tokenHistory: [], applyWallet: jest.fn(),
  preferences: { notificationsEnabled: true }, habits: [lastWeek, thisWeek], currentHabits: [thisWeek],
};
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext }));

describe('HomeScreen', () => {
  it("gives today's cards this week's habits and the progress cards every habit", () => {
    render(<HomeScreen />);
    for (const card of ['TodayAgenda', 'StreakRiskBanner', 'DeviceRemindersBanner', 'RewardsHub', 'MysteryBoxCard']) {
      expect([card, mockProps[card]?.habits]).toEqual([card, [thisWeek]]);
    }
    for (const card of ['WeekStrip', 'NextBadgeCard', 'WeeklyRecapCard']) {
      expect([card, mockProps[card]?.habits]).toEqual([card, [lastWeek, thisWeek]]);
    }
    // On phones the tiles sit inside Today; they count every check-in (their streak is the account's).
    expect(mockProps.TodayAgenda.middle?.props.habits).toEqual([lastWeek, thisWeek]);
  });
});
