// Neon data layer for the synced app state.
//
// Data flow: the app sends its whole state (PUT /api/app-state). The server keeps
// ownership of everything that can be earned or faked:
//   - check-ins live in habit_completions (PUT /api/habit-completions); a synced state
//     can add offline check-ins but can never delete them,
//   - streaks are recomputed from check-ins and each habit's schedule,
//   - points and tokens come from the server ledger (services/wallet.js).
// The latest `user_app_state` snapshot, with those server values applied, is what the
// app reads; relational tables (habits, goals, achievements) mirror it for the
// leaderboard, reminders, AI context and the Admin Panel.
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { query, withTransaction } from '../db/client.js';
import { runAll } from '../db/run-all.js';
import { sameState } from './app-state-sync.js';
import { getDateKeyInTimeZone } from './completion-date.js';
import { computeStreak } from './streaks.js';
import { applyWallet, awardCheckIn, getWallet, POINTS_PER_CHECK_IN } from './wallet.js';

export { sameState, stableStringify } from './app-state-sync.js';

const DEFAULT_TIME_ZONE = 'Asia/Manila';

function todayFor(timeZone) {
  try {
    return getDateKeyInTimeZone(new Date(), timeZone || DEFAULT_TIME_ZONE);
  } catch {
    return getDateKeyInTimeZone(new Date(), DEFAULT_TIME_ZONE);
  }
}

export async function serverCompletionPoints(userId, runner = { query }) {
  const result = await runner.query('SELECT COUNT(*)::integer AS checkins FROM habit_completions WHERE user_id=$1', [userId]);
  return (result.rows[0]?.checkins || 0) * POINTS_PER_CHECK_IN;
}

export async function getServerCompletions(userId, runner = { query }) {
  const result = await runner.query('SELECT habit_id AS "habitId", completed_date::text AS date FROM habit_completions WHERE user_id=$1 ORDER BY completed_date DESC', [userId]);
  return result.rows;
}

export async function getLatestUpdatedAt(userId) {
  const result = await query('SELECT max(updated_at) AS "updatedAt" FROM user_app_state WHERE user_id=$1', [userId]);
  return result.rows[0]?.updatedAt ? Number(result.rows[0].updatedAt) : null;
}

export async function getLatestAppState(userId, runner = { query }) {
  const result = await runner.query('SELECT state_json AS "stateJson", updated_at AS "updatedAt" FROM user_app_state WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1', [userId]);
  const row = result.rows[0];
  return row ? { state: row.stateJson, updatedAt: Number(row.updatedAt) } : null;
}

function completionsByHabit(completions) {
  const map = new Map();
  for (const completion of completions) {
    if (!map.has(completion.habitId)) map.set(completion.habitId, []);
    map.get(completion.habitId).push(completion.date);
  }
  for (const dates of map.values()) dates.sort();
  return map;
}

/** Applies the server's check-ins and the derived fields (done, progress, streak) to one habit. */
export function withServerProgress(habit, completionDates) {
  const today = todayFor(habit.completionTimeZone);
  const done = completionDates.includes(today);
  const goal = Math.max(1, Number(habit.goal) || 1);
  return {
    ...habit,
    completionDates,
    done,
    progress: done ? 100 : 0,
    total: `${done ? goal : 0}/${goal}`,
    streak: computeStreak(habit, completionDates, today),
  };
}

/** Habits rebuilt from the relational tables, used when no synced state exists yet. */
export async function getCanonicalHabits(userId) {
  const [habitResult, completions] = await Promise.all([
    query('SELECT id, label, meta, category, icon, color, goal, progress, total, streak, done, reminder_enabled AS "reminderEnabled", reminder_time AS "reminderTime", sort_order AS "sortOrder", updated_at AS "updatedAt" FROM habits WHERE user_id=$1 ORDER BY sort_order ASC, id ASC', [userId]),
    getServerCompletions(userId),
  ]);
  const byHabit = completionsByHabit(completions);
  return habitResult.rows.map((habit) => {
    const id = String(habit.id).replace(`${userId}:habit:`, '');
    const frequency = String(habit.meta || '').split('•')[0].trim();
    return withServerProgress({ ...habit, id, frequency: ['Weekly', 'Monthly'].includes(frequency) ? frequency : 'Daily' }, byHabit.get(id) || []);
  });
}

/** The state as the app should see it: server check-ins, streaks, points and tokens applied. */
export async function buildServerState(userId, state, runner = { query }) {
  const [completions, wallet] = await runAll(runner, [() => getServerCompletions(userId, runner), () => getWallet(runner, userId)]);
  const byHabit = completionsByHabit(completions);
  const habits = (Array.isArray(state?.habits) ? state.habits : []).map((habit) => withServerProgress(habit, byHabit.get(String(habit.id)) || []));
  return applyWallet({ ...state, habits }, wallet);
}

const SERVER_OWNED_FIELDS = ['points', 'tokens', 'tokenHistory'];
const SERVER_OWNED_HABIT_FIELDS = ['done', 'progress', 'total', 'streak'];

/** The part of a state the app is allowed to change, for detecting no-op saves. */
export function clientOwnedPart(state) {
  if (!state || typeof state !== 'object') return state;
  const copy = { ...state };
  for (const key of SERVER_OWNED_FIELDS) delete copy[key];
  copy.habits = (Array.isArray(state.habits) ? state.habits : []).map((habit) => {
    const habitCopy = { ...habit };
    for (const key of SERVER_OWNED_HABIT_FIELDS) delete habitCopy[key];
    habitCopy.completionDates = [...new Set(Array.isArray(habit.completionDates) ? habit.completionDates : [])].sort();
    return habitCopy;
  });
  return copy;
}

export const sameClientState = (left, right) => sameState(clientOwnedPart(left), clientOwnedPart(right));

/**
 * Appends a state snapshot and prunes older ones. Only the newest snapshot is read;
 * a few recent ones are kept for recovery. (Previously every sync added a row forever.)
 */
export async function saveUserAppState(userId, state, updatedAt, connection) {
  await connection.query('INSERT INTO user_app_state(id,user_id,state_json,updated_at) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), userId, state, updatedAt]);
  await connection.query(
    `DELETE FROM user_app_state WHERE user_id=$1 AND id NOT IN (
       SELECT id FROM user_app_state WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2)`,
    [userId, config.appState.snapshotsToKeep],
  );
}

/**
 * Saves a fresh snapshot after a server-side change (reward redeemed, coach answered),
 * so the app's `?since=` poll picks up the new balance on every device.
 */
export async function refreshSnapshot(userId, connection) {
  const latest = await getLatestAppState(userId, connection);
  if (!latest) return null;
  const state = await buildServerState(userId, latest.state, connection);
  const updatedAt = Math.max(Date.now(), latest.updatedAt + 1);
  await saveUserAppState(userId, state, updatedAt, connection);
  return { state, updatedAt };
}

/** One-off cleanup for databases that accumulated snapshots before pruning existed. */
export async function pruneAllSnapshots() {
  const result = await query(
    `DELETE FROM user_app_state WHERE id IN (
       SELECT id FROM (
         SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY updated_at DESC) AS position FROM user_app_state
       ) ranked WHERE position > $1)`,
    [config.appState.snapshotsToKeep],
  );
  return result.rowCount;
}

export function earnedAchievements(habits) {
  const earned = new Set();
  if (habits.length > 0) earned.add('first-habit');
  if (habits.length >= 3) earned.add('habit-builder');
  if (habits.some((habit) => habit.reminderEnabled && /AM/i.test(habit.reminderTime || ''))) earned.add('early-bird');
  if (habits.some((habit) => habit.category === 'Mind' && habit.done)) earned.add('focus-master');
  if (habits.some((habit) => Number(habit.streak) >= 7)) earned.add('streak-week');
  return [...earned];
}

/** Valid, not-in-the-future check-in dates from a synced habit (offline check-ins). */
/**
 * New check-ins a synced state may add: today's only (in the habit's time zone), the same rule
 * as PUT /api/habit-completions. A missed day cannot be filled in later, even offline.
 */
function syncedCompletionDates(habit) {
  const today = todayFor(habit.completionTimeZone);
  return (Array.isArray(habit.completionDates) ? habit.completionDates : []).map(String).includes(today) ? [today] : [];
}

/** Mirrors the synced state into the relational tables inside the caller's transaction. */
export async function syncNormalizedState(userId, state, updatedAt, connection) {
  const rawHabits = Array.isArray(state.habits) ? state.habits : [];
  const seenHabitIds = new Set();
  const habits = rawHabits.filter((habit) => {
    const habitId = String(habit?.id || '').trim();
    if (!habitId || seenHabitIds.has(habitId)) return false;
    seenHabitIds.add(habitId);
    return true;
  });

  // Check-ins of deleted habits go with them; check-ins of existing habits are never
  // removed by a sync, only added (offline check-ins), so a stale device cannot erase them.
  const habitIds = habits.map((habit) => String(habit.id).trim());
  if (habitIds.length === 0) await connection.query('DELETE FROM habit_completions WHERE user_id=$1', [userId]);
  else await connection.query('DELETE FROM habit_completions WHERE user_id=$1 AND NOT (habit_id = ANY($2::text[]))', [userId, habitIds]);
  for (const habit of habits) {
    const habitId = String(habit.id).trim();
    for (const date of syncedCompletionDates(habit)) {
      const inserted = await connection.query(
        'INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING habit_id',
        [userId, habitId, date, updatedAt],
      );
      if (inserted.rowCount) await awardCheckIn(connection, userId, habitId, date, habit.label, updatedAt);
    }
  }

  const byHabit = completionsByHabit(await getServerCompletions(userId, connection));
  const serverHabits = habits.map((habit) => withServerProgress(habit, byHabit.get(String(habit.id)) || []));

  await connection.query('DELETE FROM habits WHERE user_id=$1', [userId]);
  for (const [sortOrder, habit] of serverHabits.entries()) {
    const goal = Math.max(1, Number(habit.goal) || 1);
    const habitId = String(habit.id).trim();
    await connection.query(
      `INSERT INTO habits(id,user_id,label,meta,category,icon,color,goal,progress,total,streak,done,reminder_enabled,reminder_time,sort_order,updated_at,frequency,start_date,reminder_days)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [`${userId}:habit:${habitId}`, userId, habit.label || habit.name || habitId, habit.meta || '', habit.category || '', habit.icon || 'ellipse-outline', habit.color || '', goal, habit.progress, habit.total, habit.streak, habit.done, Boolean(habit.reminderEnabled), habit.reminderTime || '', sortOrder, updatedAt,
        String(habit.frequency || ''), /^\d{4}-\d{2}-\d{2}$/.test(habit.startDate || '') ? habit.startDate : '', JSON.stringify(Array.isArray(habit.reminderDays) ? habit.reminderDays : [])],
    );
  }

  await connection.query('DELETE FROM goals WHERE user_id=$1', [userId]);
  for (const goal of state.goals || []) {
    const scopedGoalId = `${userId}:goal:${goal.id}`;
    await connection.query('INSERT INTO goals(id,user_id,title,category,progress,status,details_json,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [scopedGoalId, userId, goal.title || goal.id, goal.category || 'Personal Growth', Number(goal.progress) || 0, goal.status || 'Fresh plan', goal, updatedAt]);
    for (const [stepIndex, description] of (goal.actionPlan || []).entries()) {
      await connection.query('INSERT INTO goal_steps(id,goal_id,step_index,description,due_date,completed) VALUES($1,$2,$3,$4,$5,$6)', [`${scopedGoalId}:step:${stepIndex}`, scopedGoalId, stepIndex, description, goal.actionDueDates?.[stepIndex] || '', goal.completedSteps?.[stepIndex] || false]);
    }
  }

  const preferences = state.preferences || {};
  await connection.query('INSERT INTO user_preferences(user_id,preferences_json,ring_interval,snooze_frequency,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json,ring_interval=excluded.ring_interval,snooze_frequency=excluded.snooze_frequency,updated_at=excluded.updated_at', [userId, preferences, Number(state.ringInterval) || 30, state.snoozeFrequency || 'Once', updatedAt]);

  // Achievements are upserted, so earned dates and the read state of their
  // notifications survive later syncs (they used to be recreated every time).
  const earned = earnedAchievements(serverHabits);
  await connection.query('DELETE FROM user_achievements WHERE user_id=$1 AND NOT (achievement_id = ANY($2::text[]))', [userId, earned]);
  await connection.query(
    `DELETE FROM notifications WHERE user_id=$1 AND type='achievement'
       AND NOT (id = ANY(SELECT $1 || ':notification:achievement:' || unnest($2::text[])))`,
    [userId, earned],
  );
  for (const achievementId of earned) {
    await connection.query('INSERT INTO user_achievements(user_id,achievement_id,earned_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [userId, achievementId, updatedAt]);
    await connection.query(
      `INSERT INTO notifications(id,user_id,type,title,body,created_at)
       SELECT $1, $2, 'achievement', name, description, $4 FROM achievements WHERE id=$3
       ON CONFLICT (id) DO NOTHING`,
      [`${userId}:notification:achievement:${achievementId}`, userId, achievementId, updatedAt],
    );
  }
}

export { withTransaction };
