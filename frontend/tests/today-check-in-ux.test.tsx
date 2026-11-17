// What the student sees for today, the same on Home, the Habits tab and Insights: the habits due
// today (not every habit of the week), a check-in button that says what it starts (a habit's proof,
// or just marking it done), and when today's check-ins close (at each habit's last reminder).
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import HabitsScreen from '@/app/(tabs)/habits';
import { checkInAction, TodayAgenda } from '@/components/today-agenda';
import type { Habit } from '@/hooks/app-state/types';
import { isHabitOpenToday } from '@/utils/engagement';
import { isHabitMissedYesterday } from '@/utils/habit-visibility';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
// A plain list instead of the draggable one (it needs the native gesture handler).
type MockListProps = { data: { id: string }[]; renderItem: (info: { item: { id: string }; drag: () => void; isActive: boolean }) => React.ReactNode; ListHeaderComponent?: React.ReactNode; ListEmptyComponent?: React.ReactNode; ListFooterComponent?: React.ReactNode };
jest.mock('react-native-draggable-flatlist', () => {
  const ReactActual = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent, ListFooterComponent }: MockListProps) => ReactActual.createElement(View, null,
      ListHeaderComponent,
      data.length ? data.map((item) => ReactActual.createElement(ReactActual.Fragment, { key: item.id }, renderItem({ item, drag: () => undefined, isActive: false }))) : ListEmptyComponent,
      ListFooterComponent),
    ScaleDecorator: ({ children }: { children?: React.ReactNode }) => children,
  };
});
jest.mock('@/components/edit-habit-sheet', () => ({ EditHabitSheet: () => null }));
jest.mock('@/authentication/authService', () => ({ getHabitFollowUp: jest.fn(async () => ({ ok: false })), getHabitInsight: jest.fn() }));
jest.mock('@/hooks/use-habit-categories', () => ({ useHabitCategories: () => jest.requireActual('@/constants/habit-categories').DEFAULT_HABIT_CATEGORIES }));
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => jest.fn() }));
const mockContext: Record<string, unknown> = {};
jest.mock('@/hooks/color-scheme-context', () => {
  const visibility = jest.requireActual('@/utils/habit-visibility');
  return { useAppColorScheme: () => mockContext, isHabitMissedYesterday: visibility.isHabitMissedYesterday };
});

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'habit', label: 'Habit', startDate: '2026-10-21', activeUntil: '2026-10-25', meta: 'Daily • 07:00 PM', category: 'Health', frequency: 'Daily',
  icon: 'heart-outline', color: '#E58D8D', goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: false, reminderTime: '07:00 PM',
  ...overrides,
});

// Wednesday 21 October 2026, 10:00.
const now = new Date(2026, 9, 21, 10, 0);
const today = '2026-10-21';
// Due Mondays and Fridays only: not due today.
const gym = habit({ id: 'gym', label: 'Gym', frequency: 'Weekly', reminderDays: ['Mon', 'Fri'], meta: 'Weekly • 06:00 PM' });

describe('a check-in for today', () => {
  it('is open while due today, not done and before its last reminder', () => {
    expect(isHabitOpenToday(habit(), now)).toBe(true);
    expect(isHabitOpenToday(gym, now)).toBe(false);
    expect(isHabitOpenToday(habit({ completionDates: [today], done: true }), now)).toBe(false);
    // Its last reminder was at 8 AM: missed, and closed for today.
    expect(isHabitOpenToday(habit({ reminderEnabled: true, reminderTime: '08:00 AM' }), now)).toBe(false);
    expect(isHabitOpenToday(habit({ reminderEnabled: true, reminderTime: '08:00 AM', reminderTimes: ['08:00 AM', '08:00 PM'] }), now)).toBe(true);
  });

  it("says what checking a habit in starts: its proof, or marking it done", () => {
    expect(checkInAction({})).toEqual({ label: 'Mark done', icon: 'checkmark' });
    expect(checkInAction({ proof: { type: 'timer', minutes: 25 } })).toEqual({ label: 'Start 25-min timer', icon: 'timer-outline' });
    expect(checkInAction({ proof: { type: 'steps', steps: 2000 } }).label).toBe('Start walk');
    expect(checkInAction({ proof: { type: 'photo' } }).label).toBe('Take photo');
  });
});

describe("Home's Today", () => {
  it('starts a habit with a proof from its own button, and keeps the focus timer for the others', () => {
    const onCheck = jest.fn();
    // Planned for 9 AM: late, so it is up next.
    const study = habit({ id: 'study', label: 'Study notes', meta: 'Daily • 09:00 AM', proof: { type: 'timer', minutes: 25 } });
    const water = habit({ id: 'water', label: 'Drink water', meta: 'Daily • 06:00 PM' });
    const walk = habit({ id: 'walk', label: 'Walk', meta: 'Daily • 05:00 PM', proof: { type: 'steps', steps: 2000 } });
    render(<TodayAgenda habits={[study, water, walk]} now={now} onCheck={onCheck} />);

    expect(screen.getByText('Start 25-min timer')).toBeTruthy();
    expect(screen.queryByText('Focus')).toBeNull();
    expect(screen.getByText('Also today')).toBeTruthy();
    expect(screen.getByLabelText('Start a focus session for Drink water')).toBeTruthy();
    expect(screen.queryByLabelText('Start a focus session for Walk')).toBeNull();

    fireEvent.press(screen.getByLabelText('Start 25-min timer: Study notes'));
    expect(onCheck).toHaveBeenCalledWith(study);
    // Checked in once the timer ends, so there is nothing to undo yet.
    expect(screen.queryByText('Undo')).toBeNull();
  });

  it('marks a habit without a proof done, with the focus timer next to it', () => {
    render(<TodayAgenda habits={[habit({ id: 'read', label: 'Read', meta: 'Daily • 09:00 AM' })]} now={now} onCheck={jest.fn()} />);
    expect(screen.getByLabelText('Mark done: Read')).toBeTruthy();
    expect(screen.getByText('Focus')).toBeTruthy();
  });

  it("says today's check-ins are closed once the only open habit is missed", () => {
    const read = habit({ id: 'read', label: 'Read', meta: 'Daily • 08:00 AM', reminderEnabled: true, reminderTime: '08:00 AM' });
    const walk = habit({ id: 'walk', label: 'Walk', completionDates: [today], done: true });
    render(<TodayAgenda habits={[read, walk, gym]} now={now} onCheck={jest.fn()} />);
    expect(screen.getByText('1 of 2 done · 1 missed')).toBeTruthy();
    expect(screen.getByText("Today's check-ins are closed")).toBeTruthy();
    expect(screen.queryByText('All done for today! 🎉')).toBeNull();
  });
});

describe('the Habits tab', () => {
  const walk = habit({ id: 'walk', label: 'Walk', meta: 'Daily • 08:00 PM', reminderEnabled: true, reminderTime: '08:00 PM' });
  const water = habit({ id: 'water', label: 'Drink water', completionDates: [today], done: true });
  const photo = habit({ id: 'meal', label: 'Healthy lunch', meta: 'Daily • 12:00 PM', reminderEnabled: true, reminderTime: '09:00 PM', proof: { type: 'photo' } });

  beforeEach(() => {
    jest.useFakeTimers({ now });
    Object.assign(mockContext, {
      isDarkMode: false, toggleHabit: jest.fn(), reorderHabits: jest.fn(), canUndoCheckIn: () => false, isFaculty: false, addHabit: jest.fn(), streak: 0,
      habits: [walk, water, photo, gym], currentHabits: [walk, water, photo, gym],
    });
  });
  afterEach(() => jest.useRealTimers());

  it("counts today's habits like Home, says which check-in closes next, and marks a habit not due today", () => {
    render(<HabitsScreen />);
    expect(screen.getByText('1/3')).toBeTruthy();
    expect(screen.getByText('2 habits still open today')).toBeTruthy();
    expect(screen.getByText("Check-ins close at each habit's last reminder. Next: Walk at 8:00 PM.")).toBeTruthy();
    expect(screen.getByText('Not due today')).toBeTruthy();
    // This week so far counts today's due habits, done or not, like the weekly bonus: 1 of 3.
    expect(screen.getByLabelText('33% this week')).toBeTruthy();
    // The photo habit is checked in with its photo, so only Walk has a focus timer.
    expect(screen.getByLabelText('Start a focus session for Walk')).toBeTruthy();
    expect(screen.queryByLabelText('Start a focus session for Healthy lunch')).toBeNull();
  });

  it('says a habit is not due today before saying it was missed yesterday', () => {
    // Due Tuesdays and Thursdays: missed yesterday, and not due this Wednesday.
    const research = habit({ id: 'research', label: 'Write research', startDate: '2026-10-19', frequency: 'Custom', reminderDays: ['Tue', 'Thu'], meta: 'Selected days • 07:00 PM • Tue, Thu' });
    expect(isHabitMissedYesterday(research, now)).toBe(true);
    Object.assign(mockContext, { habits: [research], currentHabits: [research] });
    render(<HabitsScreen />);
    expect(screen.getByText('Not due today')).toBeTruthy();
    expect(screen.queryByText('Missed yesterday')).toBeNull();
  });

  it('lists under "To do" only what can still be checked in today', () => {
    render(<HabitsScreen />);
    fireEvent.press(screen.getByText('To do 2'));
    expect(screen.getByText('Walk')).toBeTruthy();
    expect(screen.getByText('Healthy lunch')).toBeTruthy();
    expect(screen.queryByText('Gym')).toBeNull();
    expect(screen.queryByText('Drink water')).toBeNull();
  });
});
