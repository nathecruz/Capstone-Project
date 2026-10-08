import { DEFAULT_HABIT_CATEGORIES } from '@/constants/habit-categories';
import type { Habit } from '@/hooks/app-state/types';
import { filterHabitsByStatus, normalizeHabitFields } from '@/utils/habit-data';
import { editedHabitFields } from '@/utils/habit-edit';

describe('normalizeHabitFields', () => {
  it('recovers category and frequency from legacy habits', () => {
    expect(normalizeHabitFields({
      category: 'Daily',
      icon: 'heart-outline',
      meta: 'Daily • 09:00 AM',
    })).toMatchObject({ category: 'Health', frequency: 'Daily' });
  });

  it('preserves explicit category and frequency for new habits', () => {
    expect(normalizeHabitFields({
      category: 'Academics',
      frequency: 'Weekly',
      icon: 'school-outline',
      meta: 'Weekly • 09:00 AM',
    })).toMatchObject({ category: 'Academics', frequency: 'Weekly' });
  });

  it('recovers legacy quick-add categories from their icons', () => {
    expect(normalizeHabitFields({ category: 'Daily', icon: 'wallet', meta: 'Daily • Anytime' }))
      .toMatchObject({ category: 'Finance', frequency: 'Daily' });
    expect(normalizeHabitFields({ category: 'Weekly', icon: 'water', meta: 'Weekly • Anytime' }))
      .toMatchObject({ category: 'Lifestyle', frequency: 'Weekly' });
  });
});

describe('editedHabitFields', () => {
  const habit: Habit = {
    id: 'habit-1',
    startDate: '2026-09-01',
    label: 'Drink Water',
    meta: 'Daily • 07:00 AM',
    category: 'Health',
    frequency: 'Daily',
    icon: 'heart-outline',
    color: '#E58D8D',
    goal: 1,
    progress: 0,
    total: '0/1',
    streak: 0,
    done: false,
    completionDates: [],
    reminderEnabled: true,
    reminderTime: '07:00 AM',
    reminderTimes: ['07:00 AM'],
  };

  it('keeps a custom start date when a habit is edited', () => {
    expect(editedHabitFields(habit, { label: 'Drink Water', category: 'Health', frequency: 'Daily', startDate: '2026-10-12' }, DEFAULT_HABIT_CATEGORIES))
      .toMatchObject({ startDate: '2026-10-12' });
  });
});

describe('filterHabitsByStatus', () => {
  const habits = [{ done: false }, { done: true }];

  it('keeps active and completed habits in All mode', () => {
    expect(filterHabitsByStatus(habits, 'all')).toEqual(habits);
  });

  it('filters active and completed habits only in their respective modes', () => {
    expect(filterHabitsByStatus(habits, 'active')).toEqual([{ done: false }]);
    expect(filterHabitsByStatus(habits, 'done')).toEqual([{ done: true }]);
  });
});