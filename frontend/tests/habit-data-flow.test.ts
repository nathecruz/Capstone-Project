import { applyRemoteCompletionDates, applyVisibleOrder } from '@/hooks/app-state/habit-progress';
import type { Habit } from '@/hooks/app-state/types';
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

describe("the server's check-ins", () => {
  // The server sends them newest first and stores them oldest first; in any other order every
  // comparison with its copy differed and the app re-sent its state in an endless loop.
  it('are kept oldest first, without duplicates', () => {
    const habit = { id: 'read', label: 'Read', meta: 'Daily • Anytime', frequency: 'Daily', startDate: '2026-09-01', goal: 1, completionDates: [] } as unknown as Habit;
    const result = applyRemoteCompletionDates(habit, ['2026-10-02', '2026-09-20', '2026-10-01', '2026-10-02']);
    expect(result.completionDates).toEqual(['2026-09-20', '2026-10-01', '2026-10-02']);
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
