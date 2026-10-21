// Home's cards after the weekly reset (habits last one week): the streak tile is the account
// streak, and the evening streak alert only promises a freeze when a freeze can still help (it
// covers a day with no check-in at all).
import React from 'react';
import { render } from '@testing-library/react-native';
import { BentoTiles } from '@/components/bento-tiles';
import { StreakRiskBanner } from '@/components/engagement-cards';
import type { Habit } from '@/hooks/app-state/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/authentication/authService', () => ({ openMysteryBox: jest.fn() }));
jest.mock('@/utils/ai-client', () => ({ askAi: jest.fn() }));
jest.mock('@/hooks/use-buddy', () => ({ useBuddy: () => ({ buddy: null }) }));

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'habit', label: 'Habit', startDate: '2026-10-19', activeUntil: '2026-10-25', meta: 'Daily • 10:00 PM', category: 'Health', frequency: 'Daily',
  icon: 'heart-outline', color: '#E58D8D', goal: 1, progress: 0, total: '0/1', streak: 2, done: false, completionDates: [], reminderEnabled: true, reminderTime: '10:00 PM',
  ...overrides,
});
// Wednesday 21 October 2026, 7 PM: "Walk" was done Monday and Tuesday and is still open tonight.
const now = new Date(2026, 9, 21, 19, 0);
const walk = habit({ id: 'walk', label: 'Walk', completionDates: ['2026-10-19', '2026-10-20'] });
const read = habit({ id: 'read', label: 'Read', completionDates: ['2026-10-21'] });
const lastWeek = habit({ id: 'old', label: 'Stretch', startDate: '2026-10-12', activeUntil: '2026-10-18', streak: 7, completionDates: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'] });
// Faculty mode: the third tile counts check-ins instead of tokens.
const mockContext = {
  points: 0, tokens: 0, isFaculty: true, streakFreeze: { frozenDays: [] as string[], available: 1 },
  currentHabits: [walk], streak: 9, bestStreak: 11,
};
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext }));

beforeEach(() => jest.useFakeTimers({ now }));
afterEach(() => jest.useRealTimers());

describe('BentoTiles', () => {
  it("shows the account streak and its best, and counts every week's check-ins", () => {
    const screen = render(<BentoTiles habits={[lastWeek, walk]} onFreeze={jest.fn()} />);
    expect(screen.getByLabelText('9-day streak, best 11, 1 streak freezes. Open Streak Freeze')).toBeTruthy();
    expect(screen.getByLabelText('9 check-ins. Open progress')).toBeTruthy();
  });
});

describe('StreakRiskBanner', () => {
  it('says a held freeze covers tonight while nothing is checked in today', () => {
    const screen = render(<StreakRiskBanner habits={[walk]} now={now} />);
    expect(screen.getByText('Keep your streak alive tonight')).toBeTruthy();
    expect(screen.getByText('🧊 Your streak freeze covers you if you miss tonight.')).toBeTruthy();
  });

  it('promises no freeze once another habit is checked in today (the day is no longer missed)', () => {
    const screen = render(<StreakRiskBanner habits={[walk, read]} now={now} onFreeze={jest.fn()} />);
    expect(screen.getByText('Keep your streak alive tonight')).toBeTruthy();
    expect(screen.queryByText(/streak freeze/)).toBeNull();
  });
});
