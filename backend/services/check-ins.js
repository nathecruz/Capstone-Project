// Checking a habit in (or undoing it): check-ins, tokens, daily challenge, weekly quests, streak
// and the state snapshot change together. Used by the app (PUT /api/habit-completions) and by
// the Done button on reminder notifications.
import { config } from '../config/index.js';
import { accountStreakRun } from './account-streak.js';
import { buildServerState, getLatestAppState, getServerCompletions, saveUserAppState, syncNormalizedState } from './app-state-store.js';
import { isPastHabitDeadline } from './completion-date.js';
import { hasHabitEnded } from './habit-week.js';
import { syncWeeklyQuests } from './quests.js';
import { syncDailyChallenges } from './daily-challenges.js';
import { getFrozenDays } from './streak-freeze.js';
import { awardAccountStreakMilestones, awardCheckIn, paidCheckIns, PAID_CHECK_INS_PER_DAY, revokeCheckIn } from './wallet.js';

/** The snapshot's habits (also those of past weeks) with their check-ins from the database. */
function withCompletionDates(habits, completions) {
  const datesByHabit = new Map();
  for (const completion of completions) {
    if (!datesByHabit.has(completion.habitId)) datesByHabit.set(completion.habitId, []);
    datesByHabit.get(completion.habitId).push(completion.date);
  }
  return habits.map((entry) => ({ ...entry, completionDates: datesByHabit.get(String(entry.id)) ?? [] }));
}

/**
 * Returns null when the habit does not exist, { pastDeadline: true } or { ended: true } when a new
 * check-in is closed, { locked: true } when an undo is too late, else { serverState, updatedAt,
 * label, dailyChallenges, tokenCapped, paidCheckInsToday }. tokenCapped is true when this request
 * made a check-in that is over the day's paid limit (it counts, but pays no tokens). Call inside a
 * transaction; the date must already be checked to be the account's today (services/account-day.js)
 * and `timeZone` is the account day's zone.
 */
export async function setCheckIn(connection, { userId, habitId, date, timeZone, completed, now = Date.now() }) {
  // Serialises concurrent check-ins and saves from several devices of the same user.
  await connection.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
  const saved = await getLatestAppState(userId, connection);
  const habit = saved?.state?.habits?.find((entry) => entry.id === habitId);
  if (!habit) return null;

  // A new check-in is closed once the habit's last reminder time has passed for today (one made
  // before then stands, so Done tapped again later is not "missed"), and once the habit's week has
  // ended (it is only history then); an undo still follows the undo-window rule below.
  const ended = hasHabitEnded(habit, date);
  if (completed && (ended || isPastHabitDeadline(habit, date, timeZone, new Date(now)))) {
    const done = await connection.query('SELECT 1 FROM habit_completions WHERE user_id=$1 AND habit_id=$2 AND completed_date=$3', [userId, habitId, date]);
    if (!done.rowCount) return ended ? { ended: true } : { pastDeadline: true };
  }

  if (!completed) {
    const existing = await connection.query('SELECT completed_at AS "completedAt" FROM habit_completions WHERE user_id=$1 AND habit_id=$2 AND completed_date=$3', [userId, habitId, date]);
    const completedAt = Number(existing.rows[0]?.completedAt);
    if (existing.rowCount && now - completedAt > config.checkIns.undoWindowMs) return { locked: true };
  }

  let award = null;
  if (completed) {
    const inserted = await connection.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING habit_id', [userId, habitId, date, now]);
    if (inserted.rowCount) {
      award = await awardCheckIn(connection, userId, habitId, date, habit.label, now);
      // Bonus tokens when this check-in pushes the account streak (days in a row with a check-in,
      // across all habits and weeks) past a milestone: once per run of the streak and milestone.
      const after = withCompletionDates(saved.state.habits, await getServerCompletions(userId, connection));
      const before = after.map((entry) => (entry.id === habitId ? { ...entry, completionDates: entry.completionDates.filter((day) => day !== date) } : entry));
      const frozen = await getFrozenDays(connection, userId);
      await awardAccountStreakMilestones(connection, userId, accountStreakRun(before, date, frozen), accountStreakRun(after, date, frozen), now);
    }
  } else {
    const removed = await connection.query('DELETE FROM habit_completions WHERE user_id=$1 AND habit_id=$2 AND completed_date=$3', [userId, habitId, date]);
    if (removed.rowCount) await revokeCheckIn(connection, userId, habitId, date);
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
  return {
    serverState,
    updatedAt,
    label: habit.label,
    dailyChallenges,
    tokenCapped: Boolean(award && !award.paid && award.paidToday >= PAID_CHECK_INS_PER_DAY),
    paidCheckInsToday: award?.paidToday ?? await paidCheckIns(connection, userId, date),
  };
}
