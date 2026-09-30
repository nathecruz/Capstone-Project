import { isHabitScheduledOn } from './streaks';

export type HabitVisibilityCandidate = {
  completionDates: string[];
  startDate?: string;
  frequency?: string;
  meta?: string;
  reminderDays?: string[];
};

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function previousDateKey(now: Date) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return getLocalDateKey(yesterday);
}

/**
 * A habit is missed only once its day is over: it was scheduled that day (and already
 * started) and was not completed. During the day it can be completed at any time, even
 * after its reminder time.
 */
export function isHabitMissedOn(habit: HabitVisibilityCandidate, dateKey: string, now = new Date()) {
  if (dateKey >= getLocalDateKey(now)) return false;
  if (habit.startDate && habit.startDate > dateKey) return false;
  if (habit.completionDates.includes(dateKey)) return false;
  return isHabitScheduledOn(habit, dateKey);
}

export function isHabitMissedYesterday(habit: HabitVisibilityCandidate, now = new Date()) {
  return isHabitMissedOn(habit, previousDateKey(now), now);
}

/** Check-ins are allowed for today and earlier days, never for the future (the server rejects those too). */
export function canCompleteHabitForDate(date: Date | string, now = new Date()) {
  const dateKey = typeof date === 'string' ? date : getLocalDateKey(date);
  return dateKey <= getLocalDateKey(now);
}
