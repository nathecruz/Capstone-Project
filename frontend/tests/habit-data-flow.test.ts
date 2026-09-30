import { applyVisibleOrder } from '@/hooks/app-state/habit-progress';
import { canCompleteHabitForDate, isHabitMissedToday } from '@/utils/habit-visibility';

describe('reordering a filtered habit list', () => {
  const habits = [{ id: 'a' }, { id: 'done-today' }, { id: 'b' }, { id: 'weekly' }, { id: 'c' }];

  it('keeps habits that were not on screen', () => {
    const shown = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
    expect(applyVisibleOrder(habits, shown).map((habit) => habit.id)).toEqual(['c', 'done-today', 'a', 'weekly', 'b']);
  });

  it('ignores habits deleted meanwhile and returns the same objects', () => {
    const result = applyVisibleOrder(habits, [{ id: 'gone' }, { id: 'b' }, { id: 'a' }]);
    expect(result.map((habit) => habit.id)).toEqual(['b', 'done-today', 'a', 'weekly', 'c']);
    expect(result).toHaveLength(habits.length);
    expect(result[0]).toBe(habits[2]);
  });
});

describe('missed habits follow the schedule', () => {
  // Tuesday 2026-09-29, 09:00 local time
  const tuesdayMorning = new Date(2026, 8, 29, 9, 0);
  const base = { completionDates: [] as string[], startDate: '2026-09-01', reminderEnabled: true, reminderTimes: ['08:00 AM'], reminderTime: '08:00 AM' };

  it('marks a daily habit missed after its reminder time', () => {
    expect(isHabitMissedToday({ ...base, frequency: 'Daily' }, tuesdayMorning)).toBe(true);
  });

  it('does not mark a Mon/Wed/Fri habit missed on a Tuesday', () => {
    const habit = { ...base, frequency: 'Custom', reminderDays: ['Mon', 'Wed', 'Fri'] };
    expect(isHabitMissedToday(habit, tuesdayMorning)).toBe(false);
    expect(canCompleteHabitForDate(habit, tuesdayMorning, tuesdayMorning)).toBe(true);
  });

  it('does not mark a monthly habit missed on another day of the month', () => {
    expect(isHabitMissedToday({ ...base, frequency: 'Monthly', startDate: '2026-09-15' }, tuesdayMorning)).toBe(false);
    expect(isHabitMissedToday({ ...base, frequency: 'Monthly', startDate: '2026-08-29' }, tuesdayMorning)).toBe(true);
  });
});
