import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import GoalsScreen from '@/app/(tabs)/goals';
import { DEFAULT_HABIT_CATEGORIES } from '@/constants/habit-categories';
import type { Goal, PlannedHabit } from '@/hooks/app-state/types';
import { getLocalDateKey } from '@/utils/habit-visibility';
import { weekEndKey } from '@/utils/habit-week';
import { habitFromPlan } from '@/utils/planned-habits';

const mockShowAlert = jest.fn();
const mockAddHabit = jest.fn();
const mockUpdateGoals = jest.fn();
const mockGenerateGoalPlan = jest.fn();
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockApp: { goals: Goal[]; currentHabits: { id: string; label: string }[] } = { goals: [], currentHabits: [] };

// A getter: the screen is imported (and expo-router mocked) before mockRouter is set.
jest.mock('expo-router', () => ({ get router() { return mockRouter; } }));
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => mockShowAlert }));
jest.mock('@/components/ai-chat', () => ({ TypingDots: () => null }));
jest.mock('@/utils/ai-client', () => ({ generateGoalPlan: (...args: unknown[]) => mockGenerateGoalPlan(...args) }));
jest.mock('@/hooks/use-habit-categories', () => ({ useHabitCategories: () => jest.requireActual('@/constants/habit-categories').DEFAULT_HABIT_CATEGORIES }));
jest.mock('@/hooks/color-scheme-context', () => ({
  useAppColorScheme: () => ({
    isDarkMode: false,
    goals: mockApp.goals,
    currentHabits: mockApp.currentHabits,
    addHabit: mockAddHabit,
    updateGoals: mockUpdateGoals,
    getAppStateSnapshot: jest.fn(),
    syncAppState: jest.fn(),
  }),
}));

// The first render of a test file can be slow on a busy machine.
jest.setTimeout(20000);

const PLAN: PlannedHabit[] = [
  { name: 'Morning walk', category: 'Health', frequency: 'Daily', days: [], time: '06:30 AM', reason: 'You walked 6 of 7 days last week.' },
  { name: 'Read 10 pages', category: 'Mind', frequency: 'Custom', days: ['Mon', 'Wed', 'Fri'], time: '08:00 PM', reason: 'Smaller than last week, so it fits your evenings.' },
  { name: 'Sleep by 11 PM', category: 'Health', frequency: 'Daily', days: [], time: '10:30 PM', reason: 'A fresh start.' },
];

const plan = (habits?: PlannedHabit[]) => ({
  category: 'Health',
  summary: 'A steady week built on what already works.',
  intensity: 'Balanced',
  focusAreas: ['Sleep', 'Movement', 'Reading'],
  actionPlan: ['Step one', 'Step two', 'Step three', 'Step four', 'Step five', 'Step six'],
  actionDueDates: ['Oct 21', 'Oct 22', 'Oct 24', 'Oct 26', 'Oct 28', 'Oct 31'],
  habitSuggestions: ['Morning walk', 'Read 10 pages', 'Sleep by 11 PM'],
  weeklyRoadmap: ['Start small.'],
  nextMilestone: 'Walk 5 mornings.',
  successMetric: 'Most days checked in.',
  motivation: 'Keep going.',
  risk: 'Late nights.',
  riskAction: 'Walk later instead.',
  timeline: '30-60 days',
  nextCheckIn: 'Oct 28, 2026',
  status: 'Fresh plan',
  ...(habits ? { habits } : {}),
});

const savedGoal = (changes: Partial<Goal> & Record<string, unknown> = {}): Goal => ({
  ...plan(),
  id: 'goal-1',
  title: 'Sleep better',
  intensity: 'Balanced',
  focusTarget: '3 habits',
  completedSteps: [false, false, false, false, false, false],
  progress: 0,
  ...changes,
});

/** Presses a button of the last dialog shown. */
const pressDialogButton = (text: string) => {
  const buttons = mockShowAlert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  const button = buttons.find((item) => item.text === text);
  if (!button) throw new Error(`No dialog button "${text}" in ${buttons.map((item) => item.text).join(', ')}`);
  act(() => button.onPress?.());
};

const sunday = () => new Date(`${weekEndKey(getLocalDateKey())}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

describe('Goals screen planner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApp.goals = [];
    mockApp.currentHabits = [];
  });

  it('plans this week\'s habits from the history and adds the new ones after one confirmation', async () => {
    mockApp.currentHabits = [{ id: 'h1', label: 'sleep by 11 pm' }];
    let answer: (value: unknown) => void = () => undefined;
    mockGenerateGoalPlan.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const screen = render(<GoalsScreen />);

    expect(screen.getByText('Your text and your recent habit history are sent to the AI.')).toBeTruthy();
    // An open request is a goal too.
    fireEvent.press(screen.getByLabelText('Use the example goal: Plan my week'));
    expect(screen.getByLabelText('Your goal').props.value).toBe('I want to create my habits for this week. What would you recommend based on my progress?');
    fireEvent.press(screen.getByLabelText('Habits to focus on: 3 habits'));
    fireEvent.press(screen.getByText('Generate plan'));

    await waitFor(() => expect(screen.getByText('Reading your habit history to pick 3 habits for this week')).toBeTruthy());
    expect(mockGenerateGoalPlan).toHaveBeenCalledWith({ goal: 'I want to create my habits for this week. What would you recommend based on my progress?', focusTarget: '3 habits', timeline: '30-60 days' });
    await act(async () => answer({ ok: true, plan: plan(PLAN) }));

    await waitFor(() => expect(screen.getByText('This week\'s habits')).toBeTruthy());
    expect(screen.getByText(`Until ${sunday()}`)).toBeTruthy();
    expect(screen.getByText('Morning walk')).toBeTruthy();
    expect(screen.getByText('Mon, Wed, Fri')).toBeTruthy();
    expect(screen.getByText('08:00 PM')).toBeTruthy();
    expect(screen.getByText('You walked 6 of 7 days last week.')).toBeTruthy();
    // The habit already in this week is marked and not counted; the old pills are not shown.
    expect(screen.getAllByText('In Habits')).toHaveLength(1);
    expect(screen.queryByText('Tap to add one')).toBeNull();

    fireEvent.press(screen.getByText('Add 2 habits to this week'));
    expect(mockAddHabit).not.toHaveBeenCalled();
    const [title, message] = mockShowAlert.mock.calls.at(-1) as [string, string];
    expect(title).toBe('Add these 2 habits?');
    expect(message).toContain(`They start today and run until ${sunday()}. You can edit or delete them in Habits.`);
    expect(message).toContain('• Morning walk\n• Read 10 pages');
    expect(message).toContain('Already in your habits this week, so not added again: Sleep by 11 PM.');

    pressDialogButton('Add 2 habits');
    const today = getLocalDateKey();
    expect(mockAddHabit).toHaveBeenCalledTimes(2);
    expect(mockAddHabit).toHaveBeenNthCalledWith(1, habitFromPlan(PLAN[0], DEFAULT_HABIT_CATEGORIES, today));
    expect(mockAddHabit).toHaveBeenNthCalledWith(2, expect.objectContaining({ label: 'Read 10 pages', startDate: today, meta: 'Selected days • 08:00 PM • Mon, Wed, Fri', reminderDays: ['Mon', 'Wed', 'Fri'], reminderEnabled: true }));
    // The plan was not saved yet, so only the screen's copy is marked.
    expect(mockUpdateGoals).not.toHaveBeenCalled();

    const [doneTitle, , doneButtons, variant] = mockShowAlert.mock.calls.at(-1) as [string, string, { text: string }[], string];
    expect(doneTitle).toBe('2 habits added');
    expect(doneButtons.map((button) => button.text)).toEqual(['Stay here', 'Go to Home']);
    expect(variant).toBe('success');
    pressDialogButton('Go to Home');
    expect(mockRouter.push).toHaveBeenCalledWith('/(tabs)');

    // Added once: the button is gone for good.
    await waitFor(() => expect(screen.getByText('Added to this week')).toBeTruthy());
    expect(screen.queryByText('Add 2 habits to this week')).toBeNull();
  });

  it('marks a saved plan as added', async () => {
    mockApp.goals = [savedGoal({ habitPlan: PLAN.slice(0, 1), habitPlanWeekEnds: weekEndKey(getLocalDateKey()) })];
    const screen = render(<GoalsScreen />);

    fireEvent.press(await screen.findByText('Add 1 habit to this week'));
    expect(mockShowAlert.mock.calls.at(-1)?.[0]).toBe('Add this habit?');
    expect(mockShowAlert.mock.calls.at(-1)?.[1]).toContain('It starts today and runs until');
    pressDialogButton('Add habit');

    expect(mockAddHabit).toHaveBeenCalledTimes(1);
    expect(mockUpdateGoals).toHaveBeenCalledTimes(1);
    const update = mockUpdateGoals.mock.calls[0][0] as (goals: Goal[]) => (Goal & { habitPlanAddedOn?: string })[];
    expect(update(mockApp.goals)[0].habitPlanAddedOn).toBe(getLocalDateKey());
    expect(mockShowAlert.mock.calls.at(-1)?.[0]).toBe('Habit added');
  });

  it('shows a saved plan that was added as added, and adds nothing more', async () => {
    mockApp.goals = [savedGoal({ habitPlan: PLAN, habitPlanWeekEnds: weekEndKey(getLocalDateKey()), habitPlanAddedOn: getLocalDateKey() })];
    const screen = render(<GoalsScreen />);
    expect(await screen.findByText('Added to this week')).toBeTruthy();
    expect(screen.queryByText(/^Add \d+ habits? to this week$/)).toBeNull();
  });

  it('does not add an earlier week\'s plan to this week', async () => {
    mockApp.goals = [savedGoal({ habitPlan: PLAN, habitPlanWeekEnds: '2026-01-04' })];
    const screen = render(<GoalsScreen />);
    expect(await screen.findByText('Week ending Sunday, Jan 4')).toBeTruthy();
    expect(screen.getByText(/planned for an earlier week/)).toBeTruthy();
    expect(screen.queryByText('Add 3 habits to this week')).toBeNull();
  });

  it('says so when every planned habit is already in this week', async () => {
    mockApp.goals = [savedGoal({ habitPlan: PLAN.slice(0, 2), habitPlanWeekEnds: weekEndKey(getLocalDateKey()) })];
    mockApp.currentHabits = [{ id: 'h1', label: 'Morning walk' }, { id: 'h2', label: 'Read 10 pages' }];
    const screen = render(<GoalsScreen />);
    expect(await screen.findByText('Already in your habits this week')).toBeTruthy();
    expect(screen.getAllByText('In Habits')).toHaveLength(2);
  });

  it('keeps the tap-to-add pills for plans without planned habits', async () => {
    mockApp.goals = [savedGoal()];
    const screen = render(<GoalsScreen />);
    expect(await screen.findByText('Tap to add one')).toBeTruthy();
    expect(screen.queryByText('This week\'s habits')).toBeNull();
    fireEvent.press(screen.getByLabelText('Add the habit Read 10 pages'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/add', params: { habit: 'Read 10 pages' } });
  });
});
