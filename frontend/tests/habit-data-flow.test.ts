import { applyVisibleOrder } from '@/hooks/app-state/habit-progress';
import { isHabitMissedYesterday } from '@/utils/habit-visibility';

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
  // Wednesday 2026-09-30, 09:00 local time; yesterday was Tuesday the 29th.
  const wednesdayMorning = new Date(2026, 8, 30, 9, 0);
  const base = { completionDates: [] as string[], startDate: '2026-09-01' };

  it('marks a daily habit missed the day after', () => {
    expect(isHabitMissedYesterday({ ...base, frequency: 'Daily' }, wednesdayMorning)).toBe(true);
  });

  it('does not mark a Mon/Wed/Fri habit missed for a Tuesday', () => {
    expect(isHabitMissedYesterday({ ...base, frequency: 'Custom', reminderDays: ['Mon', 'Wed', 'Fri'] }, wednesdayMorning)).toBe(false);
  });

  it('only marks a monthly habit missed for its day of the month', () => {
    expect(isHabitMissedYesterday({ ...base, frequency: 'Monthly', startDate: '2026-08-15' }, wednesdayMorning)).toBe(false);
    expect(isHabitMissedYesterday({ ...base, frequency: 'Monthly', startDate: '2026-08-29' }, wednesdayMorning)).toBe(true);
  });
});
