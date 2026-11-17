// Faculty mode: faculty use HabitAI for their own habits and see their class in Class Pulse (the
// Admin Panel, with the same email and password). They are not on the student leaderboard, so what
// shows only there is not promised to them. Also the All Habits check of today, for everyone.
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import AllHabitsScreen from '@/app/all-habits';
import { ClassPulseCard } from '@/components/class-pulse-card';
import { FrameSheet, TitleSheet } from '@/components/reward-sheets';
import { ADMIN_PANEL_URL } from '@/constants/faculty';
import { findFaq } from '@/constants/help-faq';
import type { Habit } from '@/hooks/app-state/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return { SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children) };
});
jest.mock('@/components/buddy', () => ({ BuddyAvatar: () => null }));
jest.mock('@/components/habit-added-sheet', () => ({ HabitAddedSheet: () => null }));
jest.mock('@/hooks/use-buddy', () => ({ useBuddy: () => ({ buddy: null }) }));
jest.mock('@/hooks/use-rewards', () => ({ useRewards: () => ({ frame: '' }), saveFrame: jest.fn(async () => ({ ok: true })), saveTitle: jest.fn(async () => ({ ok: true, title: '' })) }));
jest.mock('@/hooks/use-habit-categories', () => ({ useHabitCategories: () => jest.requireActual('@/constants/habit-categories').DEFAULT_HABIT_CATEGORIES }));
let mockContext: Record<string, unknown>;
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext }));

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'habit', label: 'Habit', startDate: '2026-10-19', activeUntil: '2026-10-25', meta: 'Daily • 07:00 PM', category: 'Academics', frequency: 'Daily',
  icon: 'book-outline', color: '#5B42D8', goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: false, reminderTime: '07:00 PM',
  ...overrides,
});

beforeEach(() => {
  mockContext = { isDarkMode: false, isFaculty: true, avatarImage: null, profile: { firstName: 'Maria', fullName: 'Maria Reyes' }, currentHabits: [], addHabit: jest.fn() };
});

describe('Class Pulse', () => {
  it('says what it shows and how to sign in, and opens it in the Admin Panel', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    render(<ClassPulseCard />);
    expect(screen.getByText('How your students are doing with their habits, as a group. No student is named.')).toBeTruthy();
    expect(screen.getByText('Opens the Admin Panel · sign in with this email and password')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Open Class Pulse in the HabitAI Admin Panel'));
    expect(openURL).toHaveBeenCalledWith(`${ADMIN_PANEL_URL}/class-pulse`);
  });

  it('is explained in Help, with Faculty mode', () => {
    const answer = findFaq('What is Faculty mode?')?.answer ?? '';
    expect(answer).toContain('Class Pulse');
    expect(answer).toContain('never names a student');
    expect(answer).toContain('same email and password');
  });
});

describe('frames and titles for faculty', () => {
  it('do not promise faculty a place on the student leaderboard', () => {
    const frames = render(<FrameSheet visible onClose={jest.fn()} />);
    expect(frames.getByText('Shown around your photo on Home and your profile.')).toBeTruthy();
    expect(frames.queryByText('Other students see your frame on the leaderboard.')).toBeNull();
    frames.unmount();
    render(<TitleSheet current="" onClose={jest.fn()} />);
    expect(screen.getByText('Shown under your name on your profile.')).toBeTruthy();
  });

  it('still tell students where others see them', () => {
    mockContext = { ...mockContext, isFaculty: false };
    const frames = render(<FrameSheet visible onClose={jest.fn()} />);
    expect(frames.getByText('Other students see your frame on the leaderboard.')).toBeTruthy();
    frames.unmount();
    render(<TitleSheet current="" onClose={jest.fn()} />);
    expect(screen.getByText('Shown under your name on your profile and the leaderboard.')).toBeTruthy();
  });
});

describe("All Habits' check of today", () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date(2026, 9, 21, 10, 0) }));
  afterEach(() => jest.useRealTimers());

  it("counts the habits due today, and says what a habit missed yesterday can do today", () => {
    mockContext = {
      ...mockContext,
      currentHabits: [
        // Due Tuesdays and Thursdays: missed yesterday, not due this Wednesday.
        habit({ id: 'research', label: 'Write research', frequency: 'Custom', reminderDays: ['Tue', 'Thu'], meta: 'Selected days • 07:00 PM • Tue, Thu' }),
        // Daily, missed yesterday, still open today.
        habit({ id: 'lesson', label: 'Prepare a lesson', completionDates: ['2026-10-19'] }),
        // Daily and done today.
        habit({ id: 'water', label: 'Drink water', completionDates: ['2026-10-19', '2026-10-20', '2026-10-21'], done: true }),
      ],
    };
    render(<AllHabitsScreen />);
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByText('Missed yesterday · Not due today')).toBeTruthy();
    expect(screen.getByText('Missed yesterday · You can still do it today')).toBeTruthy();
    // A teacher's day: the faculty ideas.
    expect(screen.getByText('Teaching, research and grading.')).toBeTruthy();
  });
});
