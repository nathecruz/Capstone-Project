// Habits last one week: a habit is active from its start date to the Sunday of that week (weeks
// run Monday to Sunday, as for weekly quests), then it leaves Home and the habit lists. It stays in
// the synced state with its check-ins, so stats, streaks, the AI and the ML predictions keep its
// history. The same rules live in backend/services/habit-week.js.

const isDateKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function shiftDay(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The Sunday ending the Monday-to-Sunday week of this date (YYYY-MM-DD). */
export function weekEndKey(dateKey: string) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return shiftDay(dateKey, (7 - weekday) % 7);
}

/**
 * The last day a habit is active: the end of the week it starts in. A habit made today with a
 * start date in the past starts this week.
 */
export function habitActiveUntil(startDate: string | undefined, today: string) {
  return weekEndKey(isDateKey(startDate) && startDate > today ? startDate : today);
}

type WeekHabit = { startDate?: string; activeUntil?: string };

/** Whether the habit is active on this day: on or after its start date, and not past its week. */
export function isHabitActiveOn(habit: WeekHabit, dateKey: string) {
  if (isDateKey(habit.startDate) && dateKey < habit.startDate) return false;
  return !isDateKey(habit.activeUntil) || dateKey <= habit.activeUntil;
}

/** Whether the habit's week has ended by `today` (it is then only history). */
export function hasHabitEnded(habit: WeekHabit, today: string) {
  return isDateKey(habit.activeUntil) && today > habit.activeUntil;
}

/** The habits shown and acted on today: those whose week has not ended (including ones starting later). */
export function currentHabits<T extends WeekHabit>(habits: T[], today: string) {
  return habits.filter((habit) => !hasHabitEnded(habit, today));
}
