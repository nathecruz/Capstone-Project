// Habits last one week: a habit is active from its start date to the Sunday of that week (weeks
// run Monday to Sunday, as for weekly quests), then it leaves the app's Home and habit lists. It
// stays in the synced state and the habits table with its check-ins, so stats, streaks, the AI and
// the ML predictions keep its history. The same rules live in frontend/utils/habit-week.ts.
// (No imports: the reminder and check-in modules use it.)

const DEFAULT_TIME_ZONE = 'Asia/Manila';

export const isDateKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The Sunday ending the Monday-to-Sunday week of this date (YYYY-MM-DD). */
export function weekEndKey(dateKey) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return shiftDay(dateKey, (7 - weekday) % 7);
}

/** The last day a habit is active: the end of the week it starts in (this week for a past start date). */
export function habitActiveUntil(startDate, today) {
  return weekEndKey(isDateKey(startDate) && startDate > today ? startDate : today);
}

/** Whether the habit is active on this day: on or after its start date, and not past its week. */
export function isHabitActiveOn(habit, dateKey) {
  if (isDateKey(habit?.startDate) && dateKey < habit.startDate) return false;
  return !isDateKey(habit?.activeUntil) || dateKey <= habit.activeUntil;
}

/** Whether the habit's week has ended by `today` (it is then only history). */
export function hasHabitEnded(habit, today) {
  return isDateKey(habit?.activeUntil) && today > habit.activeUntil;
}

/**
 * The last active day the server keeps for a saved habit (`stored` is the server's copy, or null for
 * a new habit; `today` is the account's day). A habit whose week has ended stays ended, whatever the
 * app sends. Otherwise it is the end of the week the habit starts in, or the app's own day when that
 * is earlier (the app sends none in older builds: then the stored one): ending early is allowed,
 * extending never is. Honest app builds already send exactly this day.
 */
export function allowedActiveUntil(habit, stored, today) {
  if (stored && hasHabitEnded(stored, today)) return stored.activeUntil;
  const limit = habitActiveUntil(habit?.startDate, today);
  const sent = isDateKey(habit?.activeUntil) ? habit.activeUntil : isDateKey(stored?.activeUntil) ? stored.activeUntil : null;
  return sent && sent < limit ? sent : limit;
}

/** `date`'s day (YYYY-MM-DD) in the time zone, or in Manila for an unknown one. */
function dateKeyIn(date, timeZone) {
  const format = (zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  try {
    return format(timeZone || DEFAULT_TIME_ZONE);
  } catch {
    return format(DEFAULT_TIME_ZONE);
  }
}

/**
 * Gives every habit without a last active day one: the end of the week it starts in, in the
 * habit's time zone. Habits from app versions before weekly habits (and ones they still create)
 * get it here, so they leave the lists when their week ends like the rest.
 */
export function withActiveUntil(state, now = new Date()) {
  if (!state || !Array.isArray(state.habits)) return state;
  let changed = false;
  const habits = state.habits.map((habit) => {
    if (!habit || typeof habit !== 'object' || isDateKey(habit.activeUntil)) return habit;
    changed = true;
    return { ...habit, activeUntil: habitActiveUntil(habit.startDate, dateKeyIn(now, habit.completionTimeZone)) };
  });
  return changed ? { ...state, habits } : state;
}
