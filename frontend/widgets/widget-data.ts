// Shared data for the Android home-screen widget: what the app stores and what the widget renders.
// No native imports here, so it is safe to use from web and iOS too.
import type { Habit } from '@/hooks/app-state/types';
import { getLocalDateKey } from '@/utils/habit-visibility';
import { isHabitScheduledOn } from '@/utils/streaks';

export const WIDGET_STORAGE_KEY = 'habitai.widget.v1';
export const WIDGET_NAME = 'HabitProgress';
/** iOS App Group that the app and the WidgetKit extension both read/write. */
export const APP_GROUP = 'group.com.habitmind.app';

export type WidgetData = {
  doneToday: number;
  totalToday: number;
  bestStreak: number;
  dateLabel: string;
};

export const EMPTY_WIDGET_DATA: WidgetData = { doneToday: 0, totalToday: 0, bestStreak: 0, dateLabel: '' };

/** Today's done/total scheduled habits and the best current streak, for the widget. */
export function computeWidgetData(habits: Habit[], now = new Date()): WidgetData {
  const today = getLocalDateKey(now);
  const scheduled = habits.filter((habit) => (!habit.startDate || habit.startDate <= today) && isHabitScheduledOn(habit, today));
  const doneToday = scheduled.filter((habit) => habit.completionDates.includes(today)).length;
  const bestStreak = habits.reduce((max, habit) => Math.max(max, habit.streak || 0), 0);
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return { doneToday, totalToday: scheduled.length, bestStreak, dateLabel };
}
