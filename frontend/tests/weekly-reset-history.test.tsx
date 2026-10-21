// Habits last one week (utils/habit-week.ts): the screens measure each past day by the habits of
// its own week, Home starts a new week with a fresh-start card, and the habit analysis can still
// pick the habits of the last four weeks.
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { analyzeHabit } from '@/authentication';
import { analysableHabits, HabitAnalysisPanel, pastWeekLabel } from '@/components/habit-analysis-panel';
import { TodayAgenda } from '@/components/today-agenda';
import { dayCompletion, periodShare, recentDayCompletion, weekCompletion } from '@/components/week-strip';
import type { Habit } from '@/hooks/app-state/types';

const mockPush = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@/authentication', () => ({ analyzeHabit: jest.fn() }));

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'habit', label: 'Habit', startDate: '2026-10-19', activeUntil: '2026-10-25', meta: 'Daily • 07:00 AM', category: 'Health', frequency: 'Daily',
  icon: 'heart-outline', color: '#E58D8D', goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: false, reminderTime: '07:00 AM',
  ...overrides,
});

// Wednesday 21 October 2026: this week is Mon 19 to Sun 25, last week Mon 12 to Sun 18.
const now = new Date(2026, 9, 21, 10, 0);
const today = '2026-10-21';
const lastWeek = habit({ id: 'read', label: 'Read', startDate: '2026-10-12', activeUntil: '2026-10-18', completionDates: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'] });
const thisWeek = habit({ id: 'walk', label: 'Walk', completionDates: ['2026-10-19', '2026-10-20'] });

describe('dayCompletion', () => {
  it('counts each day against the habits of its own week, not how many there are now', () => {
    const habits = [lastWeek, thisWeek];
    expect(dayCompletion(habits, '2026-10-15')).toEqual({ due: 1, done: 1, share: 1 });
    expect(dayCompletion(habits, '2026-10-18')).toEqual({ due: 1, done: 0, share: 0 });
    expect(dayCompletion(habits, '2026-10-20')).toEqual({ due: 1, done: 1, share: 1 });
    // Before any habit started, and after every week ended, nothing is due: no division by zero.
    expect(dayCompletion(habits, '2026-10-01')).toEqual({ due: 0, done: 0, share: 0 });
    expect(dayCompletion([lastWeek], '2026-10-20')).toEqual({ due: 0, done: 0, share: 0 });
  });

  it('counts a check-in on a day the habit was not scheduled as due and done', () => {
    const monday = habit({ id: 'mon', frequency: 'Weekly', meta: 'Weekly • 07:00 AM', reminderDays: ['Mon'], completionDates: ['2026-10-20'] });
    expect(dayCompletion([monday], '2026-10-19')).toEqual({ due: 1, done: 0, share: 0 });
    expect(dayCompletion([monday], '2026-10-20')).toEqual({ due: 1, done: 1, share: 1 });
    expect(dayCompletion([monday], '2026-10-21')).toEqual({ due: 0, done: 0, share: 0 });
  });

  it('gives the last seven days and their overall share', () => {
    const days = recentDayCompletion([lastWeek, thisWeek], 7, now);
    expect(days.map((day) => day.dateKey)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
    expect(days.map((day) => day.share)).toEqual([1, 1, 1, 0, 1, 1, 0]);
    // 5 of the 7 check-ins due were done; with "of every habit now" it used to read 5 of 14.
    expect(periodShare(days)).toBeCloseTo(5 / 7);
    expect(periodShare([])).toBe(0);
    expect(weekCompletion([lastWeek, thisWeek], now).filter((day) => day.isToday).map((day) => day.dateKey)).toEqual([today]);
  });
});

describe('analysableHabits', () => {
  const fourWeeksAgo = habit({ id: 'old', label: 'Journal', startDate: '2026-09-21', activeUntil: '2026-09-27' });
  const fiveWeeksAgo = habit({ id: 'older', label: 'Stretch', startDate: '2026-09-14', activeUntil: '2026-09-20' });
  const noEnd = habit({ id: 'legacy', label: 'Water', startDate: '2026-08-01', activeUntil: undefined });

  it('lists this week first, then the habits of the last four weeks, the newest first, each with its week', () => {
    const choices = analysableHabits([fourWeeksAgo, thisWeek, lastWeek, fiveWeeksAgo, noEnd], today);
    expect(choices.map(({ habit: item, week }) => [item.id, week])).toEqual([
      ['walk', null],
      ['legacy', null],
      ['read', 'Last week'],
      ['old', 'Sep 21 – Sep 27'],
    ]);
  });

  it('names last week, and older weeks by their Monday and Sunday', () => {
    expect(pastWeekLabel('2026-10-18', today)).toBe('Last week');
    expect(pastWeekLabel('2026-10-04', today)).toBe('Sep 28 – Oct 4');
  });
});

describe('TodayAgenda', () => {
  beforeEach(() => mockPush.mockClear());

  it('starts a week without habits with the fresh-start card: plan with AI first, or add one', () => {
    const screen = render(<TodayAgenda habits={[]} now={now} onCheck={jest.fn()} />);
    expect(screen.getByText('New week, fresh start.')).toBeTruthy();
    expect(screen.getByText("Plan this week's habits with AI or add your own.")).toBeTruthy();
    expect(screen.queryByText('Your habits today')).toBeNull();

    fireEvent.press(screen.getByLabelText("Plan this week's habits with AI"));
    expect(mockPush).toHaveBeenLastCalledWith('/(tabs)/goals');
    fireEvent.press(screen.getByLabelText('Add your own habit'));
    expect(mockPush).toHaveBeenLastCalledWith('/(tabs)/add');
  });

  it('shows the usual hero and list once the week has habits', () => {
    const screen = render(<TodayAgenda habits={[thisWeek]} now={now} onCheck={jest.fn()} />);
    expect(screen.queryByText('New week, fresh start.')).toBeNull();
    expect(screen.getByText('Your habits today')).toBeTruthy();
  });
});

describe('HabitAnalysisPanel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists this week first, then last week marked, and can still analyse an ended habit', async () => {
    (analyzeHabit as jest.Mock).mockImplementation(async () => ({ ok: false, message: 'Not now.' }));
    const screen = render(<HabitAnalysisPanel habits={[lastWeek, thisWeek]} now={now} />);
    await waitFor(() => expect(analyzeHabit).toHaveBeenCalledWith('walk'));
    expect(screen.getByLabelText('Walk')).toBeTruthy();
    expect(screen.getByText('Last week')).toBeTruthy();
    expect(screen.queryByText(/its week has ended/)).toBeNull();

    fireEvent.press(screen.getByLabelText('Read, Last week'));
    await waitFor(() => expect(analyzeHabit).toHaveBeenCalledWith('read'));
    expect(screen.getByText("Last week's habit: its week has ended. Its check-ins stay in your history.")).toBeTruthy();
  });

  it('opens on an ended habit when the week has none yet', async () => {
    (analyzeHabit as jest.Mock).mockImplementation(async () => ({ ok: false, message: 'Not now.' }));
    render(<HabitAnalysisPanel habits={[lastWeek]} now={now} />);
    await waitFor(() => expect(analyzeHabit).toHaveBeenCalledWith('read'));
  });
});
