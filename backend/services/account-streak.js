// The student's streak across all their habits, including those of past weeks (habits last one
// week, services/habit-week.js): the number of days in a row with at least one check-in. The same
// rules live in frontend/utils/account-streak.ts; the streak milestone bonuses follow this streak.
import { isHabitActiveOn } from './habit-week.js';
import { habitSchedule, isScheduledDay } from './streaks.js';

const MAX_LOOKBACK_DAYS = 1100;
const isDateKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * A day with a check-in counts; a day breaks the run only when some habit was due (active and
 * scheduled) and none was checked in. Days with nothing due, days a streak freeze covered and
 * `today` (not over yet) neither count nor break it. `habits` carry their `completionDates`.
 */
function dayKinds(habits, today, frozenDays) {
  const checkedIn = new Set(habits.flatMap((habit) => (Array.isArray(habit.completionDates) ? habit.completionDates : [])));
  const frozen = new Set(frozenDays);
  const schedules = habits.map((habit) => ({ habit, schedule: habitSchedule(habit) }));
  return (day) => {
    if (checkedIn.has(day)) return 'counts';
    if (day === today || frozen.has(day)) return 'neutral';
    return schedules.some(({ habit, schedule }) => isHabitActiveOn(habit, day) && isScheduledDay(schedule, day)) ? 'breaks' : 'neutral';
  };
}

function firstDay(habits, today) {
  const days = habits.flatMap((habit) => [habit.startDate, ...(Array.isArray(habit.completionDates) ? habit.completionDates : [])]).filter((day) => isDateKey(day) && day <= today);
  const earliest = days.length ? days.reduce((min, day) => (day < min ? day : min)) : today;
  const limit = shiftDay(today, -(MAX_LOOKBACK_DAYS - 1));
  return earliest < limit ? limit : earliest;
}

/** The current streak and the day it started, counting back from `today` (YYYY-MM-DD). */
export function accountStreakRun(habits, today, frozenDays = []) {
  const kind = dayKinds(habits, today, frozenDays);
  const first = firstDay(habits, today);
  let streak = 0;
  let start = null;
  for (let day = today; day >= first; day = shiftDay(day, -1)) {
    const result = kind(day);
    if (result === 'counts') {
      streak += 1;
      start = day;
    } else if (result === 'breaks') break;
  }
  return { streak, start };
}

/** The current streak: days in a row with a check-in, counting back from `today`. */
export function accountStreak(habits, today, frozenDays = []) {
  return accountStreakRun(habits, today, frozenDays).streak;
}

/** The longest run of days with a check-in, up to `today`, under the same rules. */
export function longestAccountStreak(habits, today, frozenDays = []) {
  const kind = dayKinds(habits, today, frozenDays);
  let best = 0;
  let run = 0;
  for (let day = firstDay(habits, today); day <= today; day = shiftDay(day, 1)) {
    const result = kind(day);
    if (result === 'counts') best = Math.max(best, (run += 1));
    else if (result === 'breaks') run = 0;
  }
  return best;
}
