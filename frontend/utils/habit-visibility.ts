import { isHabitActiveOn } from './habit-week';
import { isHabitScheduledOn } from './streaks';

export type HabitVisibilityCandidate = {
  completionDates: string[];
  startDate?: string;
  /** The last day of the habit's week (utils/habit-week.ts). */
  activeUntil?: string;
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
 * A habit is missed only once its day is over: it was scheduled that day (and active: already
 * started, and its week not over) and was not completed. During the day it can be completed at any
 * time, even after its reminder time. Days after a habit's week ended are never missed.
 */
export function isHabitMissedOn(habit: HabitVisibilityCandidate, dateKey: string, now = new Date()) {
  if (dateKey >= getLocalDateKey(now)) return false;
  if (!isHabitActiveOn(habit, dateKey)) return false;
  if (habit.completionDates.includes(dateKey)) return false;
  return isHabitScheduledOn(habit, dateKey);
}

export function isHabitMissedYesterday(habit: HabitVisibilityCandidate, now = new Date()) {
  return isHabitMissedOn(habit, previousDateKey(now), now);
}

/**
 * Check-ins are open for today only: once a day is over, a missed habit stays missed and a done
 * one stays done (the server enforces the same rule).
 */
export function canCompleteHabitForDate(date: Date | string, now = new Date()) {
  const dateKey = typeof date === 'string' ? date : getLocalDateKey(date);
  return dateKey === getLocalDateKey(now);
}

/** How long a check-in can be undone after the tap; then it is locked for the day (the server allows a little more for slow networks). */
export const CHECK_IN_UNDO_MS = 10_000;
