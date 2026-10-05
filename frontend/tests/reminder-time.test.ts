import { DEFAULT_HABIT_CATEGORIES } from '@/constants/habit-categories';
import type { Habit } from '@/hooks/app-state/types';
import { editedHabitFields } from '@/utils/habit-edit';
import { formatReminderTime, metaWithReminders, nextTimeFieldText, partOfDay, readTimeField, reminderParts, shiftReminderParts, sortReminderTimes, timeUntil } from '@/utils/reminder-time';

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'h1', startDate: '2026-09-01', label: 'Drink water', meta: 'Daily • 07:00 AM', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
  goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: true, reminderTime: '07:00 AM', reminderTimes: ['07:00 AM'], ...overrides,
});

describe('reminder times', () => {
  it('builds, reads and names times', () => {
    expect(formatReminderTime(7, 5, 'AM')).toBe('07:05 AM');
    expect(reminderParts('09:30 PM')).toEqual({ hour: 9, minute: 30, period: 'PM' });
    expect(reminderParts('12:00 AM')).toEqual({ hour: 12, minute: 0, period: 'AM' });
    expect(reminderParts('nonsense')).toEqual({ hour: 7, minute: 0, period: 'AM' });
    // 1 PM is the afternoon, not the evening.
    expect(['06:00 AM', '01:00 PM', '07:30 PM', '11:00 PM', '02:00 AM'].map(partOfDay)).toEqual(['Morning', 'Afternoon', 'Evening', 'Night', 'Night']);
    expect(sortReminderTimes(['09:30 PM', '07:00 AM', '12:00 PM'])).toEqual(['07:00 AM', '12:00 PM', '09:30 PM']);
  });

  it('says how long until a time next comes round', () => {
    const now = new Date(2026, 9, 4, 18, 45);
    expect(timeUntil('09:00 PM', now)).toBe('in 2 h 15 min');
    expect(timeUntil('07:00 PM', now)).toBe('in 15 min');
    expect(timeUntil('06:45 PM', now)).toBe('in 24 h');
    expect(timeUntil('07:00 AM', now)).toBe('in 12 h');
  });

  it('moves a time by single minutes, across hours, noon and midnight', () => {
    expect(shiftReminderParts({ hour: 7, minute: 12, period: 'AM' }, 1)).toEqual({ hour: 7, minute: 13, period: 'AM' });
    expect(shiftReminderParts({ hour: 7, minute: 59, period: 'AM' }, 1)).toEqual({ hour: 8, minute: 0, period: 'AM' });
    expect(shiftReminderParts({ hour: 11, minute: 59, period: 'AM' }, 1)).toEqual({ hour: 12, minute: 0, period: 'PM' });
    expect(shiftReminderParts({ hour: 11, minute: 59, period: 'PM' }, 1)).toEqual({ hour: 12, minute: 0, period: 'AM' });
    expect(shiftReminderParts({ hour: 12, minute: 0, period: 'AM' }, -1)).toEqual({ hour: 11, minute: 59, period: 'PM' });
    expect(shiftReminderParts({ hour: 1, minute: 0, period: 'PM' }, -1)).toEqual({ hour: 12, minute: 59, period: 'PM' });
  });

  it('starts a full time field over with the digits just typed, wherever the cursor was', () => {
    expect(nextTimeFieldText('', '7')).toBe('7');
    expect(nextTimeFieldText('7', '75')).toBe('75');
    expect(nextTimeFieldText('75', '754')).toBe('4');
    expect(nextTimeFieldText('75', '745')).toBe('4');
    expect(nextTimeFieldText('75', '475')).toBe('4');
    expect(nextTimeFieldText('4', '47')).toBe('47');
    expect(nextTimeFieldText('07', '1a2')).toBe('12');
    expect(nextTimeFieldText('07', '1234')).toBe('34');
  });

  it('reads a typed hour or minute only when it is one', () => {
    expect(['1', '07', '12'].map((text) => readTimeField(text, 'hour'))).toEqual([1, 7, 12]);
    expect(['0', '00', '13', '', '1a', '123'].map((text) => readTimeField(text, 'hour'))).toEqual([null, null, null, null, null, null]);
    expect(['0', '07', '12', '59'].map((text) => readTimeField(text, 'minute'))).toEqual([0, 7, 12, 59]);
    expect(['60', '75', '', '-1'].map((text) => readTimeField(text, 'minute'))).toEqual([null, null, null, null]);
  });

  it('puts the times in the meta and keeps a custom schedule\'s days', () => {
    expect(metaWithReminders('Daily • 07:00 AM', ['09:30 PM', '06:00 AM'])).toBe('Daily • 06:00 AM, 09:30 PM');
    expect(metaWithReminders('Weekdays only • 07:00 AM • Mon, Tue', ['08:00 AM'])).toBe('Weekdays only • 08:00 AM • Mon, Tue');
    expect(metaWithReminders('Daily • 07:00 AM', null)).toBe('Daily • Anytime');
  });
});

describe('editing a habit\'s reminders', () => {
  it('changes the times, turns reminders off, and leaves them alone when not edited', () => {
    const edit = { label: 'Drink water', category: 'Health', frequency: 'Daily' };
    expect(editedHabitFields(habit(), { ...edit, reminders: ['09:30 PM', '07:30 AM'] }, DEFAULT_HABIT_CATEGORIES)).toMatchObject({
      meta: 'Daily • 07:30 AM, 09:30 PM', reminderEnabled: true, reminderTime: '07:30 AM', reminderTimes: ['07:30 AM', '09:30 PM'],
    });
    const off = editedHabitFields(habit(), { ...edit, reminders: null }, DEFAULT_HABIT_CATEGORIES);
    expect(off).toMatchObject({ meta: 'Daily • Anytime', reminderEnabled: false });
    expect(off).not.toHaveProperty('reminderTimes');
    expect(editedHabitFields(habit(), edit, DEFAULT_HABIT_CATEGORIES)).not.toHaveProperty('reminderEnabled');
  });
});
