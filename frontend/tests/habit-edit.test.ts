import { weekCompletion } from '@/components/week-strip';
import { DEFAULT_HABIT_CATEGORIES } from '@/constants/habit-categories';
import type { Habit } from '@/hooks/app-state/types';
import { editedHabitFields } from '@/utils/habit-edit';

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    startDate: '2026-09-01',
    label: 'Drink water',
    meta: 'Daily • 07:00 AM',
    category: 'Health',
    frequency: 'Daily',
    icon: 'heart-outline',
    color: '#E58D8D',
    goal: 1,
    progress: 100,
    total: '1/1',
    streak: 4,
    done: true,
    completionDates: ['2026-10-01', '2026-10-02'],
    reminderEnabled: true,
    reminderTime: '07:00 AM',
    ...overrides,
  };
}

describe('editedHabitFields', () => {
  it('renames a habit and keeps its look when the category stays', () => {
    expect(editedHabitFields(habit({ color: '#123456' }), { label: '  Drink 8 glasses  ', category: 'Health', frequency: 'Daily' }, DEFAULT_HABIT_CATEGORIES))
      .toEqual({ label: 'Drink 8 glasses', category: 'Health', icon: 'heart-outline', color: '#123456', frequency: 'Daily', meta: 'Daily • 07:00 AM' });
  });

  it('takes the icon and color of a new category', () => {
    expect(editedHabitFields(habit(), { label: 'Read', category: 'Mind', frequency: 'Daily' }, DEFAULT_HABIT_CATEGORIES))
      .toMatchObject({ category: 'Mind', icon: 'bulb-outline', color: '#7A6AED' });
  });

  it('renames the schedule in meta and keeps the reminder times', () => {
    expect(editedHabitFields(habit(), { label: 'Drink water', category: 'Health', frequency: 'Weekly' }, DEFAULT_HABIT_CATEGORIES).meta).toBe('Weekly • 07:00 AM');
    // A custom schedule's days are dropped with the custom schedule.
    const custom = habit({ frequency: 'Custom', meta: 'Weekdays only • Anytime • Mon, Tue, Wed' });
    expect(editedHabitFields(custom, { label: 'Drink water', category: 'Health', frequency: 'Daily' }, DEFAULT_HABIT_CATEGORIES).meta).toBe('Daily • Anytime');
    // Unchanged schedule: meta is left exactly as it was.
    expect(editedHabitFields(custom, { label: 'Drink water', category: 'Health', frequency: 'Custom' }, DEFAULT_HABIT_CATEGORIES).meta).toBe(custom.meta);
  });

  it('keeps a chosen start date when editing a habit', () => {
    expect(editedHabitFields(habit(), { label: 'Drink water', category: 'Health', frequency: 'Daily', startDate: '2026-10-12' }, DEFAULT_HABIT_CATEGORIES))
      .toMatchObject({ startDate: '2026-10-12' });
  });

  it('never saves an empty or overlong name', () => {
    expect(editedHabitFields(habit(), { label: '   ', category: 'Health', frequency: 'Daily' }, DEFAULT_HABIT_CATEGORIES).label).toBe('Drink water');
    expect(editedHabitFields(habit(), { label: 'x'.repeat(80), category: 'Health', frequency: 'Daily' }, DEFAULT_HABIT_CATEGORIES).label).toHaveLength(60);
  });

  it('keeps a category the list no longer offers', () => {
    expect(editedHabitFields(habit({ category: 'Finance', icon: 'wallet', color: '#F2A95B' }), { label: 'Save', category: 'Finance', frequency: 'Daily' }, DEFAULT_HABIT_CATEGORIES))
      .toMatchObject({ category: 'Finance', icon: 'wallet', color: '#F2A95B' });
  });
});

describe('weekCompletion', () => {
  it('gives each of the last seven days the share of habits done, ending today', () => {
    const habits = [habit(), habit({ id: 'habit-2', completionDates: ['2026-10-02'] })];
    const days = weekCompletion(habits, new Date(2026, 9, 2, 15, 0));
    expect(days).toHaveLength(7);
    expect(days.map((day) => day.dateKey)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(days.map((day) => day.share)).toEqual([0, 0, 0, 0, 0, 0.5, 1]);
    expect(days.filter((day) => day.isToday).map((day) => day.dateKey)).toEqual(['2026-10-02']);
  });

  it('is empty, not dividing by zero, without habits', () => {
    expect(weekCompletion([], new Date(2026, 9, 2)).every((day) => day.share === 0)).toBe(true);
  });
});
