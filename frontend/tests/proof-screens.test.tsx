// The screens that prove a check-in: the Walk screen counts steps with the phone's step counter in a
// session started on the server, and checks the habit in at its target (or, where steps cannot be
// counted, with a photo); the Focus timer of a habit proven by it runs the habit's own minutes in a
// server session and checks in with it.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import FocusScreen from '@/app/focus';
import WalkScreen from '@/app/walk';
import { startProofSession } from '@/authentication/authService';
import { getLocalDateKey } from '@/hooks/app-state/habit-progress';
import type { Habit, HabitProof } from '@/hooks/app-state/types';
import { Pedometer } from 'expo-sensors';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { takeProofPhoto } from '@/utils/proof-photo';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return { SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children) };
});
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true }, useLocalSearchParams: () => mockParams }));
jest.mock('@/components/confetti', () => ({ Confetti: () => null }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
let mockSteps: (result: { steps: number }) => void = () => undefined;
const mockRemove = jest.fn();
jest.mock('expo-sensors', () => ({
  Pedometer: {
    isAvailableAsync: jest.fn(async () => true),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    watchStepCount: jest.fn((callback: (result: { steps: number }) => void) => { mockSteps = callback; return { remove: mockRemove }; }),
  },
}));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn(async () => undefined) }));
jest.mock('@/authentication/authService', () => ({ startProofSession: jest.fn() }));
jest.mock('@/utils/proof-photo', () => ({ takeProofPhoto: jest.fn() }));
const mockCheckInWithProof = jest.fn();
const mockToggleHabit = jest.fn();
let mockHabits: Habit[] = [];
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => ({ currentHabits: mockHabits, checkInWithProof: mockCheckInWithProof, toggleHabit: mockToggleHabit }) }));

const today = getLocalDateKey();
const habit = (id: string, proof: HabitProof): Habit => ({
  id, startDate: today, label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'walk-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: false, reminderTime: '07:00 AM', proof,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

describe('the Walk screen', () => {
  it('counts the steps of a walk started on the server and checks the habit in at its target', async () => {
    mockHabits = [habit('Walk 2,000 steps', { type: 'steps', steps: 2000 })];
    mockParams = { id: 'Walk 2,000 steps' };
    jest.mocked(startProofSession).mockResolvedValueOnce({ ok: true, sessionId: 'walk-1', kind: 'steps', target: 2000, startedAt: 0 });
    render(<WalkScreen />);
    await act(async () => { fireEvent.press(screen.getByText('Start walking')); });
    expect(startProofSession).toHaveBeenCalledWith('Walk 2,000 steps', today);
    expect(activateKeepAwakeAsync).toHaveBeenCalled();
    act(() => mockSteps({ steps: 1200 }));
    expect(screen.getByText('1,200')).toBeTruthy();
    expect(mockCheckInWithProof).not.toHaveBeenCalled();
    act(() => mockSteps({ steps: 2050 }));
    expect(mockCheckInWithProof).toHaveBeenCalledWith('Walk 2,000 steps', { sessionId: 'walk-1', steps: 2050 });
    expect(screen.getByText('Walk complete')).toBeTruthy();
    expect(mockRemove).toHaveBeenCalled();
    expect(deactivateKeepAwake).toHaveBeenCalled();
    act(() => mockSteps({ steps: 2100 }));
    expect(mockCheckInWithProof).toHaveBeenCalledTimes(1);
  });

  it('says so when the phone has no step counter, starts no session, and checks in with a photo instead', async () => {
    mockHabits = [habit('walk', { type: 'steps', steps: 2000 })];
    mockParams = { id: 'walk' };
    jest.mocked(Pedometer.isAvailableAsync).mockResolvedValueOnce(false);
    render(<WalkScreen />);
    expect(screen.queryByText('Check in with a photo')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByText('Start walking')); });
    expect(screen.getByText(/no step counter HabitAI can use/)).toBeTruthy();
    expect(startProofSession).not.toHaveBeenCalled();
    // The camera closed without a photo: nothing is checked in.
    jest.mocked(takeProofPhoto).mockResolvedValueOnce(null).mockResolvedValueOnce({ ok: true, proof: { photo: 'abc123', type: 'image/jpeg' } });
    await act(async () => { fireEvent.press(screen.getByText('Check in with a photo')); });
    expect(mockCheckInWithProof).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByText('Check in with a photo')); });
    expect(mockCheckInWithProof).toHaveBeenCalledWith('walk', { photo: 'abc123', type: 'image/jpeg' });
    expect(screen.getByText("Your photo was sent as proof of today's check-in.")).toBeTruthy();
  });

  it('offers the photo when physical activity access is turned off', async () => {
    mockHabits = [habit('walk', { type: 'steps', steps: 2000 })];
    mockParams = { id: 'walk' };
    jest.mocked(Pedometer.requestPermissionsAsync).mockResolvedValueOnce({ granted: false } as Awaited<ReturnType<typeof Pedometer.requestPermissionsAsync>>);
    render(<WalkScreen />);
    await act(async () => { fireEvent.press(screen.getByText('Start walking')); });
    expect(screen.getByText(/or check in with a photo instead/)).toBeTruthy();
    expect(screen.getByText('Check in with a photo')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(startProofSession).not.toHaveBeenCalled();
  });
});

describe('the Focus timer of a habit proven by it', () => {
  afterEach(() => jest.useRealTimers());

  it('runs the habit\'s own minutes in a server session and checks in with it at the end', async () => {
    jest.useFakeTimers();
    mockHabits = [habit('study', { type: 'timer', minutes: 20 })];
    mockParams = { id: 'study' };
    jest.mocked(startProofSession).mockResolvedValueOnce({ ok: true, sessionId: 'focus-1', kind: 'timer', target: 20, startedAt: 0 });
    render(<FocusScreen />);
    expect(screen.queryByText('5 min')).toBeNull();
    expect(screen.getByText(/Focus for the full 20 minutes/)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Start focus')); });
    expect(startProofSession).toHaveBeenCalledWith('study', today);
    act(() => { jest.advanceTimersByTime(19 * 60_000); });
    expect(mockCheckInWithProof).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(60_000 + 500); });
    expect(mockCheckInWithProof).toHaveBeenCalledWith('study', { sessionId: 'focus-1' });
    expect(mockToggleHabit).not.toHaveBeenCalled();
  });

  it('does not start when the server cannot start the session', async () => {
    mockHabits = [habit('study', { type: 'timer', minutes: 20 })];
    mockParams = { id: 'study' };
    jest.mocked(startProofSession).mockResolvedValueOnce({ ok: false, message: 'Could not reach HabitAI. Check your connection.' });
    render(<FocusScreen />);
    await act(async () => { fireEvent.press(screen.getByText('Start focus')); });
    expect(screen.getByText('Could not reach HabitAI. Check your connection.')).toBeTruthy();
    expect(screen.getByText('Start focus')).toBeTruthy();
  });
});
