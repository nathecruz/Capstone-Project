// Shared data for the Android home-screen widget: what the app stores and what the widget renders.
// No native imports here, so it is safe to use from web and iOS too.
import type { Habit } from '@/hooks/app-state/types';
import { getLocalDateKey } from '@/utils/habit-visibility';
import { isHabitActiveOn } from '@/utils/habit-week';
import { isHabitScheduledOn } from '@/utils/streaks';

export const WIDGET_STORAGE_KEY = 'habitai.widget.v1';
export const WIDGET_NAME = 'HabitProgress';
/** iOS App Group that the app and the WidgetKit extension both read/write. */
export const APP_GROUP = 'group.com.habitmind.app';

export type WidgetData = {
  doneToday: number;
  totalToday: number;
  /**
   * The account streak: days in a row with a check-in, across all habits and weeks
   * (utils/account-streak.ts). Stored under this name, which the iOS widget reads.
   */
  bestStreak: number;
  dateLabel: string;
};

export const EMPTY_WIDGET_DATA: WidgetData = { doneToday: 0, totalToday: 0, bestStreak: 0, dateLabel: '' };

/**
 * Today's done/total habits (those active and due today; a habit whose week has ended is never
 * due) and the account `streak`, for the widget.
 */
export function computeWidgetData(habits: Habit[], streak: number, now = new Date()): WidgetData {
  const today = getLocalDateKey(now);
  const scheduled = habits.filter((habit) => isHabitActiveOn(habit, today) && isHabitScheduledOn(habit, today));
  const doneToday = scheduled.filter((habit) => habit.completionDates.includes(today)).length;
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return { doneToday, totalToday: scheduled.length, bestStreak: Math.max(0, streak || 0), dateLabel };
}
