// The Add screen: a ready-made Health or Academics habit is added with one tap, a habit already this
// week is not added twice, and a habit of one's own carries the proof its name suggests (or the one
// picked). After adding, the follow-up questions set the habit as they are answered and end with a tip.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AddScreen from '@/app/(tabs)/add';
import { getHabitFollowUp, getHabitInsight } from '@/authentication/authService';
import type { Habit } from '@/hooks/app-state/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return { SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children) };
});
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('@/authentication', () => ({ getHabitCategories: jest.fn(async () => null) }));
jest.mock('@/components/reminder-time-sheet', () => ({ ReminderTimesEditor: () => null }));
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => jest.fn() }));
jest.mock('@/utils/ai-client', () => ({ classifyHabit: jest.fn(async () => ({ ok: false })) }));
jest.mock('@/authentication/authService', () => ({ getHabitFollowUp: jest.fn(async () => ({ ok: false })), getHabitInsight: jest.fn() }));
let mockContext: Record<string, unknown> & { habits: Partial<Habit>[] };
// Added habits are in the context's habits from then on, as in the app.
const mockAddHabit = jest.fn((habit: Partial<Habit>) => {
  const id = `habit-${habit.label}`;
  mockContext.habits.push({ ...habit, id, completionDates: [] });
  return id;
});
const mockUpdateHabit = jest.fn();
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext, requestNotificationAccess: jest.fn(async () => true) }));

beforeEach(() => {
  mockAddHabit.mockClear();
  mockUpdateHabit.mockClear();
  mockParams = {};
  mockContext = { isDarkMode: false, addHabit: mockAddHabit, updateHabit: mockUpdateHabit, ringInterval: 30, snoozeFrequency: 'Once', isFaculty: false, currentHabits: [], habits: [] };
});

describe('the Add screen', () => {
  it('adds a ready-made habit in one tap, with its reminder and proof', async () => {
    render(<AddScreen />);
    await act(async () => undefined);
    await act(async () => { fireEvent.press(screen.getByLabelText('Add Walk 2,000 steps, reminder 05:30 PM, proof 2,000 steps')); });
    expect(mockAddHabit).toHaveBeenCalledWith(expect.objectContaining({ label: 'Walk 2,000 steps', category: 'Health', frequency: 'Daily', reminderTime: '05:30 PM', proof: { type: 'steps', steps: 2000 } }));
    expect(screen.getByText('Habit added')).toBeTruthy();
    expect(screen.getByText('Check in by walking 2,000 steps with HabitAI open on your phone.')).toBeTruthy();
  });

  it('shows the Academics habits, opens on the area the balance card asks for, and never adds one twice', async () => {
    mockParams = { category: 'Academics' };
    mockContext = { ...mockContext, currentHabits: [{ label: 'Study for 30 minutes' }] };
    render(<AddScreen />);
    await act(async () => undefined);
    expect(screen.queryByText('Walk 2,000 steps')).toBeNull();
    fireEvent.press(screen.getByLabelText('Study for 30 minutes, already in your habits'));
    expect(mockAddHabit).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Health ready-made habits'));
    expect(screen.getByText('Walk 2,000 steps')).toBeTruthy();
  });

  it('gives a habit of one\'s own the proof its name suggests, or the one picked', async () => {
    render(<AddScreen />);
    await act(async () => undefined);
    fireEvent.changeText(screen.getByLabelText('Habit name'), 'Read for 15 minutes');
    expect(screen.getAllByText('15-minute Focus timer').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByLabelText('Five minutes more'));
    expect(screen.getAllByText('20-minute Focus timer').length).toBeGreaterThan(0);
    await act(async () => { fireEvent.press(screen.getByText('Add habit')); });
    expect(mockAddHabit).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'Read for 15 minutes', proof: { type: 'timer', minutes: 20 } }));

    fireEvent.changeText(screen.getByLabelText('Habit name'), 'Eat vegetables');
    fireEvent.press(screen.getByLabelText('Steps: Counted by your phone'));
    await act(async () => { fireEvent.press(screen.getByText('Add habit')); });
    expect(mockAddHabit).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'Eat vegetables', category: 'Health', proof: { type: 'steps', steps: 2000 } }));
  });

  it('asks the follow-up questions after adding: the answers set the reminder and the proof, then a tip', async () => {
    jest.mocked(getHabitFollowUp).mockResolvedValueOnce({ ok: true, source: 'ai', questions: [
      { id: 'time', text: 'When will you usually do it?', options: [{ id: 'morning', label: 'Morning', reminderTime: '07:00 AM' }, { id: 'evening', label: 'Evening', reminderTime: '07:00 PM' }] },
      { id: 'amount', text: 'How long can you do it each day for now?', options: [{ id: 'minutes-10', label: '10 minutes', proof: { type: 'timer', minutes: 10 } }, { id: 'minutes-30', label: '30 minutes', proof: { type: 'timer', minutes: 30 } }] },
      { id: 'ai', text: 'Where will you study?', options: [{ id: 'ai-0', label: 'Library' }, { id: 'ai-1', label: 'Home' }] },
    ] });
    jest.mocked(getHabitInsight).mockResolvedValueOnce({ ok: true, source: 'ai', insight: 'The library in the evening is a good spot: keep your notes in your bag.' });
    mockParams = { category: 'Academics' };
    render(<AddScreen />);
    await act(async () => undefined);
    await act(async () => { fireEvent.press(screen.getByLabelText('Add Study for 30 minutes, reminder 07:00 PM, proof 30-minute Focus timer')); });
    expect(getHabitFollowUp).toHaveBeenCalledWith({ label: 'Study for 30 minutes', category: 'Academics', proof: { type: 'timer', minutes: 30 } });
    expect(screen.getByText('AI')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Morning'));
    expect(mockUpdateHabit).toHaveBeenLastCalledWith('habit-Study for 30 minutes', expect.objectContaining({ reminderEnabled: true, reminderTime: '07:00 AM', reminderTimes: ['07:00 AM'] }));
    fireEvent.press(screen.getByLabelText('10 minutes'));
    expect(mockUpdateHabit).toHaveBeenLastCalledWith('habit-Study for 30 minutes', expect.objectContaining({ proof: { type: 'timer', minutes: 10 } }));
    expect(getHabitInsight).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByLabelText('Library')); });
    expect(getHabitInsight).toHaveBeenCalledWith({ label: 'Study for 30 minutes', category: 'Academics', proof: { type: 'timer', minutes: 30 } }, [
      { question: 'When will you usually do it?', answer: 'Morning' },
      { question: 'How long can you do it each day for now?', answer: '10 minutes' },
      { question: 'Where will you study?', answer: 'Library' },
    ]);
    expect(screen.getByText('The library in the evening is a good spot: keep your notes in your bag.')).toBeTruthy();
  });
});
