// Streaks are derived from check-in dates and the habit's schedule (same rules as the
// server's backend/services/streaks.js), so a missed scheduled day resets them.
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MAX_LOOKBACK_DAYS = 1100;

export type StreakHabit = {
  frequency?: string;
  meta?: string;
  reminderDays?: string[];
  startDate?: string;
  /** The last day of the habit's week (utils/habit-week.ts): it is not due after it. */
  activeUntil?: string;
};

type Schedule = { type: 'daily' } | { type: 'weekly'; days: string[] } | { type: 'monthly'; day: number };

function shiftDay(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const weekdayOf = (dateKey: string) => DAY_LABELS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()];
const isDateKey = (value: string | undefined): value is string => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');
/** Days in the month of this date key (28-31). */
const daysInMonthOf = (dateKey: string) => new Date(Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)), 0)).getUTCDate();

function scheduledDays(habit: StreakHabit) {
  const configured = habit.reminderDays?.length
    ? habit.reminderDays
    : habit.frequency === 'Custom'
      ? String(habit.meta ?? '').split(' • ').at(-1)?.split(',').map((day) => day.trim()) ?? []
      : [];
  return configured.filter((day) => (DAY_LABELS as readonly string[]).includes(day));
}

export function habitSchedule(habit: StreakHabit): Schedule {
  if (habit.frequency === 'Monthly') {
    const day = isDateKey(habit.startDate) ? Number(habit.startDate.slice(8, 10)) : 1;
    return { type: 'monthly', day: day >= 1 && day <= 31 ? day : 1 };
  }
  if (habit.frequency === 'Weekly' || habit.frequency === 'Custom') {
    const days = scheduledDays(habit);
    if (!days.length && habit.frequency === 'Weekly' && isDateKey(habit.startDate)) return { type: 'weekly', days: [weekdayOf(habit.startDate)] };
    return { type: 'weekly', days };
  }
  return { type: 'daily' };
}

function isScheduledDay(schedule: Schedule, dateKey: string) {
  if (schedule.type === 'weekly') return schedule.days.includes(weekdayOf(dateKey));
  // A monthly day past the month's length (29-31) falls on the last day of that month instead.
  if (schedule.type === 'monthly') return Number(dateKey.slice(8, 10)) === Math.min(schedule.day, daysInMonthOf(dateKey));
  return true;
}

/** Whether the habit is due on this day (YYYY-MM-DD) according to its schedule (never after its week ended). */
export function isHabitScheduledOn(habit: StreakHabit, dateKey: string) {
  if (isDateKey(habit.activeUntil) && dateKey > habit.activeUntil) return false;
  return isScheduledDay(habitSchedule(habit), dateKey);
}

/**
 * Consecutive scheduled days completed, counting back from `today` (YYYY-MM-DD).
 * An unfinished today never breaks the streak unless `todayMissed` is set (its deadline passed with
 * no check-in); unscheduled days are skipped, and so are days covered by a streak freeze
 * (`frozenDays`): they neither count nor break the streak. A habit whose week has ended keeps the
 * streak it had on its last day.
 */
export function computeStreak(habit: StreakHabit, completionDates: string[], today: string, frozenDays: string[] = [], todayMissed = false) {
  if (isDateKey(habit.activeUntil) && today > habit.activeUntil) return computeStreak({ ...habit, activeUntil: undefined }, completionDates, habit.activeUntil, frozenDays, true);
  const done = new Set(completionDates);
  if (!done.size) return 0;
  const frozen = new Set(frozenDays);
  const schedule = habitSchedule(habit);
  if (schedule.type === 'weekly' && !schedule.days.length) return 0;
  const startDate = isDateKey(habit.startDate) ? habit.startDate : null;
  let streak = 0;
  for (let offset = 0; offset < MAX_LOOKBACK_DAYS; offset += 1) {
    const day = shiftDay(today, -offset);
    if (startDate && day < startDate && !done.has(day)) break;
    if (!isScheduledDay(schedule, day)) continue;
    if (frozen.has(day) && !done.has(day)) continue;
    if (done.has(day)) streak += 1;
    else if (day !== today || todayMissed) break;
  }
  return streak;
}
