import { getHabitReminderDays, getHabitReminderTimes, isHabitReminderDay } from '@/hooks/color-scheme-context';

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
    const habit = { frequency: 'Custom', meta: 'Every week • 07:00 AM • Mon, Wed', reminderDays: ['Mon', 'Wed'] };
    expect(getHabitReminderDays(habit)).toEqual(['Mon', 'Wed']);
    expect(isHabitReminderDay(habit, new Date(2026, 8, 28))).toBe(true);
    expect(isHabitReminderDay(habit, new Date(2026, 8, 29))).toBe(false);
    expect(getHabitReminderDays({ frequency: 'Custom', meta: habit.meta })).toEqual(['Mon', 'Wed']);
  });
});