// The student's streak across all their habits, including those of past weeks (habits last one
// week, utils/habit-week.ts): the number of days in a row with at least one check-in. The same
// rules live in backend/services/account-streak.js, which pays the streak milestone bonuses.
import { isHabitActiveOn } from './habit-week';
import { isHabitScheduledOn, type StreakHabit } from './streaks';

const MAX_LOOKBACK_DAYS = 1100;

type AccountStreakHabit = StreakHabit & { completionDates: string[] };

function shiftDay(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Walks the days from `from` to `to` (YYYY-MM-DD): a day with a check-in counts; a day breaks the
 * run only when some habit was due (active and scheduled) and none was checked in. Days with
 * nothing due, days a streak freeze covered and `today` (not over yet) neither count nor break it.
 */
function dayKinds(habits: AccountStreakHabit[], today: string, frozenDays: string[]) {
  const checkedIn = new Set(habits.flatMap((habit) => habit.completionDates));
  const frozen = new Set(frozenDays);
  return (day: string): 'counts' | 'neutral' | 'breaks' => {
    if (checkedIn.has(day)) return 'counts';
    if (day === today || frozen.has(day)) return 'neutral';
    return habits.some((habit) => isHabitActiveOn(habit, day) && isHabitScheduledOn(habit, day)) ? 'breaks' : 'neutral';
  };
}

/** The first day worth looking at: the earliest start date or check-in of any habit. */
function firstDay(habits: AccountStreakHabit[], today: string) {
  const days = habits.flatMap((habit) => [habit.startDate ?? '', ...habit.completionDates]).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today);
  const earliest = days.length ? days.reduce((min, day) => (day < min ? day : min)) : today;
  const limit = shiftDay(today, -(MAX_LOOKBACK_DAYS - 1));
  return earliest < limit ? limit : earliest;
}

/** The current streak: days in a row with a check-in, counting back from `today`. */
export function accountStreak(habits: AccountStreakHabit[], today: string, frozenDays: string[] = []) {
  const kind = dayKinds(habits, today, frozenDays);
  const first = firstDay(habits, today);
  let streak = 0;
  for (let day = today; day >= first; day = shiftDay(day, -1)) {
    const result = kind(day);
    if (result === 'counts') streak += 1;
    else if (result === 'breaks') break;
  }
  return streak;
}

/** The longest run of days with a check-in, up to `today`, under the same rules. */
export function longestAccountStreak(habits: AccountStreakHabit[], today: string, frozenDays: string[] = []) {
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
