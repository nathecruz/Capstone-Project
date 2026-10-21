// Habits last one week in the app (backend/services/habit-week.js): a habit is active from its
// start date to `habits.active_until`, the Sunday of its week, and then it has ended. It stays in
// the habits table with its check-ins, so history (check-ins, completion over time) keeps it, but
// it is only due up to its last day and it is no longer one of the habits a student tracks now.
// Habits without `active_until` (synced before weekly habits) have no end yet.
// (No imports: lib/metrics.js and lib/streaks.js both use it.)

export const isDateKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The habit row's last active day (YYYY-MM-DD), or null when it has none. */
export function activeUntilOf(row) {
  return isDateKey(row?.active_until) ? row.active_until : null;
}

/** Whether the habit's week ended before `today`: it is then only history. */
export function hasHabitEnded(row, today) {
  const activeUntil = activeUntilOf(row);
  return Boolean(activeUntil) && today > activeUntil;
}

/** The last day the habit can be due by `today`: today, or its last active day once it has ended. */
export function lastDueDay(row, today) {
  const activeUntil = activeUntilOf(row);
  return activeUntil && activeUntil < today ? activeUntil : today;
}

/** SQL condition: the habit (table alias `alias`) has not ended by the date in `todayParam`. */
export function currentHabitSql(alias, todayParam) {
  return `(${alias}.active_until !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR ${alias}.active_until >= ${todayParam})`;
}
