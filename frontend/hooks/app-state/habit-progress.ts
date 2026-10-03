// Pure helpers that derive habit progress from check-in dates.
import { normalizeHabitFields } from '@/utils/habit-data';
import { computeStreak } from '@/utils/streaks';
import type { Habit, Preferences } from './types';

export function getHabitProgressSummary(habits: Habit[]) {
  const completed = habits.filter((habit) => habit.done).length;
  const completionPercent = habits.length ? Math.round((completed / habits.length) * 100) : 0;
  const averageProgress = habits.length
    ? Math.round(habits.reduce((sum, habit) => sum + habit.progress, 0) / habits.length)
    : 0;
  const maxStreak = habits.length ? Math.max(...habits.map((habit) => habit.streak)) : 0;

  return { completed, completionPercent, averageProgress, maxStreak };
}

export function getHabitCompletionHistory(habits: Habit[], days = 7, weekStartsOn: Preferences['weekStartsOn'] = 'Monday') {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentDay = today.getDay();
  const weekStartDay = weekStartsOn === 'Sunday' ? 0 : 1;
  const daysSinceWeekStart = (currentDay - weekStartDay + 7) % 7;
  const firstDate = new Date(today);
  firstDate.setDate(today.getDate() - daysSinceWeekStart);

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(firstDate);
    date.setDate(firstDate.getDate() + index);
    const dateKey = getLocalDateKey(date);
    const count = habits.reduce((total, habit) => total + (habit.completionDates.includes(dateKey) ? 1 : 0), 0);
    return {
      dateKey,
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      count,
    };
  });
}

/** Check-ins per day for the `days` days ending today (oldest first), unlike the calendar week above. */
export function getRecentCompletionHistory(habits: Habit[], days = 7, today = new Date()) {
  const lastDate = new Date(today);
  lastDate.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(lastDate);
    date.setDate(lastDate.getDate() - (days - 1 - index));
    const dateKey = getLocalDateKey(date);
    const count = habits.reduce((total, habit) => total + (habit.completionDates.includes(dateKey) ? 1 : 0), 0);
    return { dateKey, label: date.toLocaleDateString('en-US', { weekday: 'short' }), count };
  });
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Applies the server's check-ins to a habit and recomputes the fields derived from them. Dates are
 * kept oldest first, as the server stores them: in another order every comparison with the
 * server's copy differed, and the app re-sent its state in an endless loop.
 */
export function applyRemoteCompletionDates(habit: Habit, remoteDates: string[]) {
  const completionDates = [...new Set(remoteDates)].sort();
  const today = getLocalDateKey();
  const done = completionDates.includes(today);
  const goal = Math.max(1, Number(habit.goal) || 1);
  return normalizeHabitFields({
    ...habit,
    completionDates,
    done,
    progress: done ? 100 : 0,
    total: `${done ? goal : 0}/${goal}`,
    streak: computeStreak(habit, completionDates, today),
  }) as Habit;
}

/**
 * Applies the order of the habits shown on screen, which may be a filtered subset (active only,
 * one tab, a search). Habits that are not shown keep their places; they used to be dropped,
 * and the sync then deleted them and their check-ins on the server.
 */
export function applyVisibleOrder<T extends { id: string }>(current: T[], shownInOrder: { id: string }[]) {
  const shownIds = new Set(shownInOrder.map((habit) => habit.id));
  const byId = new Map(current.map((habit) => [habit.id, habit]));
  const reordered = shownInOrder.map((habit) => byId.get(habit.id)).filter((habit): habit is T => Boolean(habit));
  let next = 0;
  return current.map((habit) => (shownIds.has(habit.id) ? reordered[next++] ?? habit : habit));
}
