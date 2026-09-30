import { canCompleteHabitForDate, isHabitMissedOn, isHabitMissedYesterday } from '@/utils/habit-visibility';

describe('canCompleteHabitForDate', () => {
  const now = new Date('2026-09-26T23:30:00');

  it('allows completion all day, even after the reminder time', () => {
    expect(canCompleteHabitForDate(now, now)).toBe(true);
    expect(canCompleteHabitForDate('2026-09-26', now)).toBe(true);
  });

  it('keeps past dates completable', () => {
    expect(canCompleteHabitForDate('2026-09-25', now)).toBe(true);
  });

  it('does not allow future dates', () => {
    expect(canCompleteHabitForDate('2026-09-27', now)).toBe(false);
  });
});

describe('missed habits', () => {
  const habit = { completionDates: ['2026-09-24'], startDate: '2026-09-01', frequency: 'Daily' };
  const now = new Date('2026-09-26T08:30:00');

  it('are never missed while their day is still going', () => {
    expect(isHabitMissedOn(habit, '2026-09-26', now)).toBe(false);
  });

  it('are missed once a scheduled day ended without a check-in', () => {
    expect(isHabitMissedOn(habit, '2026-09-25', now)).toBe(true);
    expect(isHabitMissedYesterday(habit, now)).toBe(true);
    expect(isHabitMissedOn(habit, '2026-09-24', now)).toBe(false);
  });

  it('are not missed before the habit started', () => {
    expect(isHabitMissedOn({ ...habit, startDate: '2026-09-26' }, '2026-09-25', now)).toBe(false);
  });
});
