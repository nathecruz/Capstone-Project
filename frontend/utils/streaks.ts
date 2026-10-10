// Streaks are derived from check-in dates and the habit's schedule (same rules as the
// server's backend/services/streaks.js), so a missed scheduled day resets them.
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MAX_LOOKBACK_DAYS = 1100;

export type StreakHabit = {
  frequency?: string;
  meta?: string;
  reminderDays?: string[];
  startDate?: string;
};

type Schedule = { type: 'daily' } | { type: 'weekly'; days: string[] } | { type: 'monthly'; day: number };

function shiftDay(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const weekdayOf = (dateKey: string) => DAY_LABELS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()];
const isDateKey = (value: string | undefined): value is string => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');

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
  if (schedule.type === 'monthly') return Number(dateKey.slice(8, 10)) === schedule.day;
  return true;
}

/** Whether the habit is due on this day (YYYY-MM-DD) according to its schedule. */
export function isHabitScheduledOn(habit: StreakHabit, dateKey: string) {
  return isScheduledDay(habitSchedule(habit), dateKey);
}

/**
 * Consecutive scheduled days completed, counting back from `today` (YYYY-MM-DD).
 * An unfinished today never breaks the streak unless `todayMissed` is set (its deadline passed with
 * no check-in); unscheduled days are skipped, and so are days covered by a streak freeze
 * (`frozenDays`): they neither count nor break the streak.
 */
export function computeStreak(habit: StreakHabit, completionDates: string[], today: string, frozenDays: string[] = [], todayMissed = false) {
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
