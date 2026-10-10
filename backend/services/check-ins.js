// Checking a habit in (or undoing it): check-ins, tokens, daily challenge, weekly quests, streak
// and the state snapshot change together. Used by the app (PUT /api/habit-completions) and by
// the Done button on reminder notifications.
import { config } from '../config/index.js';
import { buildServerState, getLatestAppState, saveUserAppState, syncNormalizedState } from './app-state-store.js';
import { isPastHabitDeadline } from './completion-date.js';
import { syncWeeklyQuests } from './quests.js';
import { syncDailyChallenges } from './daily-challenges.js';
import { awardCheckIn, revokeCheckIn } from './wallet.js';

/**
 * Returns null when the habit does not exist, { locked: true } when an undo is too late, else
 * { serverState, updatedAt, label, dailyChallenges }. Call inside a transaction; the date must already be checked
 * to be the user's today.
 */
export async function setCheckIn(connection, { userId, habitId, date, timeZone, completed, now = Date.now() }) {
  // Serialises concurrent check-ins and saves from several devices of the same user.
  await connection.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
  const saved = await getLatestAppState(userId, connection);
  const habit = saved?.state?.habits?.find((entry) => entry.id === habitId);
  if (!habit) return null;

  // A new check-in is closed once the habit's last reminder time has passed for today; an undo
  // still follows the undo-window rule below.
  if (completed && isPastHabitDeadline(habit, date, timeZone, new Date(now))) return { pastDeadline: true };

  if (!completed) {
    const existing = await connection.query('SELECT completed_at AS "completedAt" FROM habit_completions WHERE user_id=$1 AND habit_id=$2 AND completed_date=$3', [userId, habitId, date]);
    const completedAt = Number(existing.rows[0]?.completedAt);
    if (existing.rowCount && now - completedAt > config.checkIns.undoWindowMs) return { locked: true };
  }

  if (completed) {
    const inserted = await connection.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING habit_id', [userId, habitId, date, now]);
    if (inserted.rowCount) await awardCheckIn(connection, userId, habitId, date, habit.label, now);
  } else {
    const removed = await connection.query('DELETE FROM habit_completions WHERE user_id=$1 AND habit_id=$2 AND completed_date=$3', [userId, habitId, date]);
    if (removed.rowCount) await revokeCheckIn(connection, userId, habitId, date, habit.label, now);
  }

  // Reflect the change in the snapshot too, so the sync below cannot re-add an undone check-in.
  const state = {
    ...saved.state,
    habits: saved.state.habits.map((entry) => {
      if (entry.id !== habitId) return entry;
      const dates = new Set(Array.isArray(entry.completionDates) ? entry.completionDates : []);
      if (completed) dates.add(date);
      else dates.delete(date);
      return { ...entry, completionDates: [...dates].sort(), completionTimeZone: timeZone || entry.completionTimeZone || 'UTC' };
    }),
  };
  const updatedAt = Math.max(now, Number(saved.updatedAt) + 1);
  await syncNormalizedState(userId, state, updatedAt, connection);
  const dailyChallenges = await syncDailyChallenges(connection, userId, date, timeZone || 'UTC', now);
  await syncWeeklyQuests(connection, userId, date, now);
  const serverState = await buildServerState(userId, state, connection);
  await saveUserAppState(userId, serverState, updatedAt, connection);
  return { serverState, updatedAt, label: habit.label, dailyChallenges };
}
