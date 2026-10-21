// The progress screens after the weekly reset (habits last one week): a day's rate is the
// check-ins of the habits due that day, not of how many habits there are now; what is about today
// uses this week's habits; the streak shown is the account streak.
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import InsightsScreen from '@/app/(tabs)/insights';
import StatsProgressScreen from '@/app/stats-progress';
import TodayProgressScreen from '@/app/today-progress';
import type { Habit } from '@/hooks/app-state/types';

const mockParams: { date?: string } = {};
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return { SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children) };
});
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => jest.fn() }));
// Insights: no server forecast, and no AI chat.
jest.mock('@/authentication', () => ({ getApiBaseUrl: () => '', getAuthenticatedHeaders: jest.fn(), analyzeHabit: jest.fn(async () => ({ ok: false, message: 'Not now.' })) }));
jest.mock('@/utils/ai-client', () => ({ askAi: jest.fn() }));
jest.mock('@/components/ai-chat', () => ({ AiChatSheet: () => null, AskAiCard: () => null, useAiChat: () => ({ send: jest.fn() }) }));

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'habit', label: 'Habit', startDate: '2026-10-19', activeUntil: '2026-10-25', meta: 'Daily • 07:00 AM', category: 'Health', frequency: 'Daily',
  icon: 'heart-outline', color: '#E58D8D', goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: false, reminderTime: '07:00 AM',
  ...overrides,
});
// Wednesday 21 October 2026: "Read" was last week's habit (6 of 7 days), "Walk" is this week's
// (done Monday and Tuesday, not yet today).
const lastWeek = habit({ id: 'read', label: 'Read', startDate: '2026-10-12', activeUntil: '2026-10-18', streak: 6, completionDates: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'] });
const thisWeek = habit({ id: 'walk', label: 'Walk', streak: 2, completionDates: ['2026-10-19', '2026-10-20'] });
const mockToggle = jest.fn();
const mockContext = {
  isDarkMode: false, preferences: { hideProgress: false }, streakFreeze: { frozenDays: [], available: 0 },
  habits: [lastWeek, thisWeek], currentHabits: [thisWeek], streak: 9, bestStreak: 11,
  toggleHabitForDate: (...args: unknown[]) => mockToggle(...args), canUndoCheckIn: () => true,
};
jest.mock('@/hooks/color-scheme-context', () => {
  const progress = jest.requireActual('@/hooks/app-state/habit-progress');
  return { useAppColorScheme: () => mockContext, getHabitProgressSummary: progress.getHabitProgressSummary, getRecentCompletionHistory: progress.getRecentCompletionHistory };
});

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 21, 10, 0) });
  mockToggle.mockClear();
  delete mockParams.date;
});
afterEach(() => jest.useRealTimers());

describe('TodayProgressScreen', () => {
  it("lists today's habits of this week only, checks them in, and shows the account streak", () => {
    const screen = render(<TodayProgressScreen />);
    expect(screen.queryByText('Read')).toBeNull();
    expect(screen.getByText('0 / 1 habits')).toBeTruthy();
    // This week: Walk is due every day from Monday, done twice; last week's habit is not due.
    expect(screen.getByText('2 of 7 check-ins')).toBeTruthy();
    expect(screen.getByText("You're on a 9-day streak!")).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Walk, Open on Oct 21, 2026'));
    expect(mockToggle).toHaveBeenCalledWith('walk', expect.any(Date));
  });

  it("shows a past date with that week's own habits, ended ones included, as a record", () => {
    mockParams.date = '2026-10-15';
    const screen = render(<TodayProgressScreen />);
    expect(screen.queryByText('Walk')).toBeNull();
    expect(screen.getByText('1 / 1 habits')).toBeTruthy();
    expect(screen.getByText('6 of 7 check-ins')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Read, Done on Oct 15, 2026'));
    expect(mockToggle).not.toHaveBeenCalled();
  });
});

describe('StatsProgressScreen', () => {
  it("rates each day by its own habits, counts today from this week's, and shows the account streak", () => {
    const screen = render(<StatsProgressScreen />);
    // Thu-Sun last week: 3 of 4; Mon-Wed: 2 of 3. Of every habit now it used to read 5 of 14 (36%).
    expect(screen.getByText('71%')).toBeTruthy();
    expect(screen.getByText('0 of 1 done today')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('11')).toBeTruthy();
  });
});

describe('InsightsScreen', () => {
  it("uses this week's habits for today and the account streak, and each day's own habits for the week", () => {
    const screen = render(<InsightsScreen />);
    expect(screen.getByText('You did 71% of your habits over the last 7 days. Today: 0 of 1 done.')).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('11')).toBeTruthy();
    expect(screen.getByText('0 of 1 done today')).toBeTruthy();
    // Strongest and weakest are this week's: last week's habit is not suggested.
    expect(screen.queryByText(/Read/)).toBeNull();

    // The habit analysis lists this week's habit, then last week's, marked.
    fireEvent.press(screen.getByText('Predictions'));
    expect(screen.getByLabelText('Walk')).toBeTruthy();
    expect(screen.getByLabelText('Read, Last week')).toBeTruthy();
  });
});
