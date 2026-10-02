import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { analyzeHabit } from '@/authentication';
import { HabitAnalysisPanel } from '@/components/habit-analysis-panel';
import type { Habit } from '@/hooks/app-state/types';

jest.mock('@/authentication', () => ({ analyzeHabit: jest.fn() }));

const habit = (id: string, label: string): Habit => ({
  id, label, startDate: '2026-09-01', meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 2, done: false, completionDates: [], reminderEnabled: false, reminderTime: '07:00 AM',
});

const analysis = (habitId: string) => ({
  habitId,
  stats: { completionRate: 0.75, scheduledDays: 20, completedDays: 15, missedDays: 5, streak: 4, strongestWeekday: 'Mon', weakestWeekday: 'Fri', usualCheckInTime: '6:00 PM', last7Days: [1, 1, 0, 1, 1, 1, 0] },
  ml: { completionProbability: 0.72, dropoutRisk: 0.18, recommendedAction: 'Keep your time.', suggestedReminderTime: '06:00 PM', source: 'model' as const },
  ai: { headline: 'You are steady on weekdays.', bestTime: 'Right after your last class, around 6 PM.', steps: ['Lay out your shoes', 'Walk the same route', 'Log it right away'], watchOut: 'Fridays slip; plan a shorter walk.' },
});

describe('HabitAnalysisPanel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('analyses the first habit by itself and shows the ML forecast and the AI advice', async () => {
    (analyzeHabit as jest.Mock).mockImplementation(async (id: string) => ({ ok: true, analysis: analysis(id) }));
    const screen = render(<HabitAnalysisPanel habits={[habit('h1', 'Morning walk'), habit('h2', 'Read')]} />);

    // The first render of a test file can be slow on a busy machine.
    await waitFor(() => expect(screen.getByText('You are steady on weekdays.')).toBeTruthy(), { timeout: 5000 });
    expect(analyzeHabit).toHaveBeenCalledWith('h1');
    expect(screen.getByText('72%')).toBeTruthy();
    expect(screen.getByText('15/20')).toBeTruthy();
    expect(screen.getByText('Right after your last class, around 6 PM.')).toBeTruthy();
    expect(screen.getByText('Walk the same route')).toBeTruthy();
    expect(screen.getByText(/ML model forecast · dropout risk 18%/)).toBeTruthy();
    expect(screen.getByText('Best on Mon · hardest on Fri · usually done around 6:00 PM')).toBeTruthy();

    // Another habit is analysed when picked; going back uses the result already loaded.
    fireEvent.press(screen.getByText('Read'));
    await waitFor(() => expect(analyzeHabit).toHaveBeenCalledWith('h2'));
    fireEvent.press(screen.getByText('Morning walk'));
    await waitFor(() => expect(screen.getByText('You are steady on weekdays.')).toBeTruthy());
    expect(analyzeHabit).toHaveBeenCalledTimes(2);
  });

  it('shows the reason and a retry when the analysis fails', async () => {
    (analyzeHabit as jest.Mock).mockResolvedValueOnce({ ok: false, message: 'This habit is still syncing. Try again in a few seconds.' });
    const screen = render(<HabitAnalysisPanel habits={[habit('h1', 'Morning walk')]} />);
    await waitFor(() => expect(screen.getByText('This habit is still syncing. Try again in a few seconds.')).toBeTruthy());
    expect(analyzeHabit).toHaveBeenCalledTimes(1);

    (analyzeHabit as jest.Mock).mockResolvedValueOnce({ ok: true, analysis: analysis('h1') });
    fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('You are steady on weekdays.')).toBeTruthy());
  });

  it('asks for a habit when there is none', () => {
    const screen = render(<HabitAnalysisPanel habits={[]} />);
    expect(screen.getByText('Add a habit and check it in for a few days to get its analysis.')).toBeTruthy();
    expect(analyzeHabit).not.toHaveBeenCalled();
  });
});
