// The account streak's past (services/account-streak.js): a day that is over keeps the kind it had
// (counts: a check-in, breaks: a miss, neutral: nothing due) when a save of the habits would change
// it. Deleting a missed habit used to erase its miss (its days then had nothing due), and deleting a
// done one its check-in; a new schedule or start date could add misses after the fact. The kept
// days are in streak_kept_days and every account streak reads them (getKeptDays).
import { changedDayKinds } from './account-streak.js';
import { getFrozenDays, getKeptDays } from './streak-freeze.js';

// What a habit's due days depend on (isHabitActiveOn and habitSchedule read these).
const scheduleKey = (habit) => JSON.stringify([String(habit?.id ?? ''), habit?.startDate ?? '', habit?.activeUntil ?? '', habit?.frequency ?? '', habit?.reminderDays ?? [], habit?.meta ?? '']);
const scheduleKeys = (habits) => (Array.isArray(habits) ? habits : []).map(scheduleKey).sort().join('\n');

/**
 * Keeps the days before `today` whose kind a save changes, from the habits as stored (`before`) to
 * the habits saved (`after`), with the check-ins in the database (a deleted habit's go with it).
 * Call inside the save's transaction, after locking the user row and before the save changes the
 * tables. A save that adds, deletes or reschedules no habit changes no day and reads nothing more.
 * Returns how many days it kept.
 */
export async function keepStreakDays(db, userId, { before, after, today, now = Date.now() }) {
  if (scheduleKeys(before) === scheduleKeys(after)) return 0;
  const completions = await db.query('SELECT habit_id AS "habitId", completed_date::text AS date FROM habit_completions WHERE user_id=$1', [userId]);
  const datesByHabit = new Map();
  for (const row of completions.rows) {
    const habitId = String(row.habitId);
    if (!datesByHabit.has(habitId)) datesByHabit.set(habitId, []);
    datesByHabit.get(habitId).push(row.date);
  }
  const withDates = (habits) => (Array.isArray(habits) ? habits : []).filter((habit) => habit && typeof habit === 'object').map((habit) => ({ ...habit, completionDates: datesByHabit.get(String(habit.id).trim()) ?? [] }));
  const frozenDays = await getFrozenDays(db, userId);
  const keptDays = await getKeptDays(db, userId);
  const changed = Object.entries(changedDayKinds(withDates(before), withDates(after), today, frozenDays, keptDays));
  for (const [day, kind] of changed) {
    await db.query('INSERT INTO streak_kept_days(user_id, day, kind, kept_at) VALUES($1,$2,$3,$4) ON CONFLICT (user_id, day) DO NOTHING', [userId, day, kind, now]);
  }
  return changed.length;
}
