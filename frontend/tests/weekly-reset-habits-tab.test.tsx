// The Habits tab after the weekly reset (habits last one week): it lists this week's habits only,
// its hero shows the account streak, and a week with no habits yet says so.
import React from 'react';
import { render } from '@testing-library/react-native';
import HabitsScreen from '@/app/(tabs)/habits';
import type { Habit } from '@/hooks/app-state/types';

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
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => jest.fn() }));

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'habit', label: 'Habit', startDate: '2026-10-19', activeUntil: '2026-10-25', meta: 'Daily • 07:00 AM', category: 'Health', frequency: 'Daily',
  icon: 'heart-outline', color: '#E58D8D', goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: false, reminderTime: '07:00 AM',
  ...overrides,
});
const lastWeek = habit({ id: 'read', label: 'Read', startDate: '2026-10-12', activeUntil: '2026-10-18', streak: 6, completionDates: ['2026-10-12', '2026-10-13'] });
const thisWeek = habit({ id: 'walk', label: 'Walk', streak: 2, completionDates: ['2026-10-19', '2026-10-20'] });
const mockContext = {
  isDarkMode: false, toggleHabit: jest.fn(), reorderHabits: jest.fn(), canUndoCheckIn: () => false, isFaculty: false,
  habits: [lastWeek, thisWeek], currentHabits: [thisWeek], streak: 9,
};
jest.mock('@/hooks/color-scheme-context', () => {
  const visibility = jest.requireActual('@/utils/habit-visibility');
  return { useAppColorScheme: () => mockContext, isHabitMissedYesterday: visibility.isHabitMissedYesterday };
});

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 21, 10, 0) });
  mockContext.habits = [lastWeek, thisWeek];
  mockContext.currentHabits = [thisWeek];
});
afterEach(() => jest.useRealTimers());

describe('HabitsScreen', () => {
  it("lists this week's habits with the account streak in the hero", () => {
    const screen = render(<HabitsScreen />);
    expect(screen.getByText('Walk')).toBeTruthy();
    expect(screen.queryByText('Read')).toBeNull();
    expect(screen.getByText('1 habit · 0 done today')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
  });

  it('says a new week has no habits yet when only past weeks have some', () => {
    mockContext.currentHabits = [];
    const screen = render(<HabitsScreen />);
    expect(screen.getByText('No habits this week yet')).toBeTruthy();
    expect(screen.getByText("Add this week's habits")).toBeTruthy();
    expect(screen.queryByText('Read')).toBeNull();
  });
});
