import { getHabitReminderDays, getHabitReminderSchedule, getHabitReminderTimes, getSnoozeLimit, isHabitReminderDay } from '@/hooks/color-scheme-context';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

describe('getHabitReminderTimes', () => {
  it('parses all configured reminder times', () => {
    expect(getHabitReminderTimes({ reminderTime: '07:00 AM', reminderTimes: ['07:00 AM', '08:30 PM'] })).toEqual([
      { hour: 7, minute: 0 },
      { hour: 20, minute: 30 },
    ]);
  });

  it('falls back to the saved single reminder time', () => {
    expect(getHabitReminderTimes({ reminderTime: '08:15 PM' })).toEqual([{ hour: 20, minute: 15 }]);
  });
});

describe('custom reminder days', () => {
  it('uses configured weekdays and supports legacy metadata', () => {
    const habit = { frequency: 'Custom', startDate: '2026-09-01', meta: 'Every week • 07:00 AM • Mon, Wed', reminderDays: ['Mon', 'Wed'] };
    expect(getHabitReminderDays(habit)).toEqual(['Mon', 'Wed']);
    expect(isHabitReminderDay(habit, new Date(2026, 8, 28))).toBe(true);
    expect(isHabitReminderDay(habit, new Date(2026, 8, 29))).toBe(false);
    expect(getHabitReminderDays({ frequency: 'Custom', meta: habit.meta })).toEqual(['Mon', 'Wed']);
  });
});

describe('habit reminder schedules', () => {
  it('uses selected weekdays for weekly schedules', () => {
    const weekly = { frequency: 'Weekly', startDate: '2026-09-28', meta: 'Weekly • 07:00 AM', reminderDays: ['Mon', 'Wed'] };
    expect(getHabitReminderSchedule(weekly)).toEqual({ type: 'weekly', days: ['Mon', 'Wed'] });
    expect(isHabitReminderDay(weekly, new Date(2026, 8, 30))).toBe(true);
    expect(isHabitReminderDay(weekly, new Date(2026, 9, 1))).toBe(false);
    expect(getHabitReminderSchedule({ ...weekly, reminderDays: [] })).toEqual({ type: 'weekly', days: ['Mon'] });
  });

  it('uses the start-date day for monthly schedules and every day for daily schedules', () => {
    const monthly = { frequency: 'Monthly', startDate: '2026-09-14', meta: 'Monthly • 07:00 AM', reminderDays: [] };
    expect(getHabitReminderSchedule(monthly)).toEqual({ type: 'monthly', day: 14 });
    expect(isHabitReminderDay(monthly, new Date(2026, 9, 14))).toBe(true);
    expect(isHabitReminderDay(monthly, new Date(2026, 9, 15))).toBe(false);
    expect(isHabitReminderDay({ ...monthly, frequency: 'Daily' }, new Date(2026, 9, 15))).toBe(true);
  });
});

describe('snooze limits', () => {
  it.each([['Once', 1], ['2 times', 2], ['3 times', 3], ['5 times', 5], ['invalid', 1]])('%s allows %i snoozes', (frequency, limit) => {
    expect(getSnoozeLimit(frequency)).toBe(limit);
  });
});