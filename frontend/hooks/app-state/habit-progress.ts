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

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Applies the server's check-ins to a habit and recomputes the fields derived from them. */
export function applyRemoteCompletionDates(habit: Habit, completionDates: string[]) {
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
