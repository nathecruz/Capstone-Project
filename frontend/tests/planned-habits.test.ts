import { DEFAULT_HABIT_CATEGORIES } from '@/constants/habit-categories';
import type { PlannedHabit } from '@/hooks/app-state/types';
import { habitFromPlan, newPlannedHabits, plannedDaysText, plannedHabitLook, readPlannedHabits } from '@/utils/planned-habits';

const planned = (changes: Partial<PlannedHabit> = {}): PlannedHabit => ({
  name: 'Morning walk', category: 'Health', frequency: 'Daily', days: [], time: '07:30 AM', reason: 'You walked 6 of 7 days last week.', ...changes,
});

describe('habitFromPlan', () => {
  it('builds a daily habit like the Add habit screen, starting today with a reminder', () => {
    expect(habitFromPlan(planned(), DEFAULT_HABIT_CATEGORIES, '2026-10-21')).toEqual({
      startDate: '2026-10-21',
      label: 'Morning walk',
      meta: 'Daily • 07:30 AM',
      category: 'Health',
      frequency: 'Daily',
      icon: 'heart-outline',
      color: '#E58D8D',
      goal: 1,
      reminderEnabled: true,
      reminderTime: '07:30 AM',
      reminderTimes: ['07:30 AM'],
      reminderDays: [],
      reminderSoundEnabled: true,
      smartReminderEnabled: false,
      isBadHabit: false,
    });
  });

  it('keeps the days of a weekly habit as reminder days, and lists a custom habit\'s days in the meta', () => {
    const weekly = habitFromPlan(planned({ name: 'Review notes', category: 'Academics', frequency: 'Weekly', days: ['Sat'], time: '04:00 PM' }), DEFAULT_HABIT_CATEGORIES, '2026-10-21');
    expect(weekly).toMatchObject({ meta: 'Weekly • 04:00 PM', frequency: 'Weekly', reminderDays: ['Sat'], icon: 'school-outline', color: '#57B991' });

    const custom = habitFromPlan(planned({ name: 'Stretch', frequency: 'Custom', days: ['Wed', 'Mon'], time: '09:30 PM' }), DEFAULT_HABIT_CATEGORIES, '2026-10-21');
    expect(custom).toMatchObject({ meta: 'Selected days • 09:30 PM • Mon, Wed', frequency: 'Custom', reminderDays: ['Mon', 'Wed'], reminderTime: '09:30 PM' });
  });

  it('leaves the end of the week to addHabit', () => {
    expect(habitFromPlan(planned(), DEFAULT_HABIT_CATEGORIES, '2026-10-21')).not.toHaveProperty('activeUntil');
  });

  it('makes a weekly or custom habit without days a daily one', () => {
    expect(habitFromPlan(planned({ frequency: 'Custom', days: [] }), DEFAULT_HABIT_CATEGORIES, '2026-10-21')).toMatchObject({ meta: 'Daily • 07:30 AM', frequency: 'Daily', reminderDays: [] });
  });

  it('uses the managed categories, and a category the app does not know keeps its label with an icon from the name', () => {
    const managed = [{ label: 'Fitness', icon: 'barbell-outline', color: '#FF7A45' }];
    expect(habitFromPlan(planned({ category: 'fitness' }), managed, '2026-10-21')).toMatchObject({ category: 'Fitness', icon: 'barbell-outline', color: '#FF7A45' });

    const unknown = habitFromPlan(planned({ name: 'Drink water', category: 'Wellness' }), DEFAULT_HABIT_CATEGORIES, '2026-10-21');
    expect(unknown).toMatchObject({ category: 'Wellness', icon: 'water-outline', color: '#57B991' });
    expect(plannedHabitLook(planned({ category: '  ' }), DEFAULT_HABIT_CATEGORIES)).toMatchObject({ category: 'Other', icon: 'ellipsis-horizontal' });
  });
});

describe('newPlannedHabits', () => {
  it('skips names already among this week\'s habits, in any case, and repeats within the plan', () => {
    const plan = [planned({ name: 'Morning walk' }), planned({ name: 'Read 10 pages' }), planned({ name: ' read 10  PAGES ' }), planned({ name: 'Sleep by 11 PM' })];
    const result = newPlannedHabits(plan, [{ label: 'MORNING WALK' }]);
    expect(result.map((item) => item.name)).toEqual(['Read 10 pages', 'Sleep by 11 PM']);
    // The plan's own objects, so a screen can tell which planned habits are already in Habits.
    expect(result[0]).toBe(plan[1]);
  });

  it('keeps every planned habit when none is in Habits yet', () => {
    const plan = [planned(), planned({ name: 'Journal' })];
    expect(newPlannedHabits(plan, [])).toEqual(plan);
  });
});

describe('readPlannedHabits', () => {
  it('reads the server\'s planned habits and leaves out malformed ones', () => {
    expect(readPlannedHabits([
      { name: '  Morning   walk ', category: 'Health', frequency: 'Daily', days: [], time: '7:30 am', reason: ' You walked 6 of 7 days. ' },
      { name: 'Stretch', category: 'Mind', frequency: 'Custom', days: ['Fri', 'Mon', 'Mon', 'Funday'], time: '21:30', reason: 'A fresh start.' },
      { name: 'Review notes', category: '', frequency: 'Weekly', days: [], time: 'soon' },
      { name: 'MORNING WALK', category: 'Health', frequency: 'Daily', days: [], time: '08:00 AM' },
      { name: '   ' },
      'Drink water',
      null,
    ])).toEqual([
      { name: 'Morning walk', category: 'Health', frequency: 'Daily', days: [], time: '07:30 AM', reason: 'You walked 6 of 7 days.' },
      { name: 'Stretch', category: 'Mind', frequency: 'Custom', days: ['Mon', 'Fri'], time: '09:30 PM', reason: 'A fresh start.' },
      { name: 'Review notes', category: 'Other', frequency: 'Daily', days: [], time: '07:00 AM', reason: '' },
    ]);
  });

  it('gives nothing for an older server\'s plan or an empty list, and at most 5 habits', () => {
    expect(readPlannedHabits(undefined)).toBeUndefined();
    expect(readPlannedHabits([])).toBeUndefined();
    expect(readPlannedHabits(Array.from({ length: 7 }, (_, index) => planned({ name: `Habit ${index + 1}` })))).toHaveLength(5);
  });
});

describe('plannedDaysText', () => {
  it('says every day for daily habits and lists the days of the others', () => {
    expect(plannedDaysText(planned())).toBe('Every day');
    expect(plannedDaysText(planned({ frequency: 'Custom', days: ['Mon', 'Wed', 'Fri'] }))).toBe('Mon, Wed, Fri');
    expect(plannedDaysText(planned({ frequency: 'Weekly', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }))).toBe('Every day');
  });
});
