// Neon data layer for the synced app state.
//
// Data flow: the app sends its whole state (PUT /api/app-state). The latest
// `user_app_state` row is the source of truth for the app; `syncNormalizedState`
// mirrors it into relational tables (habits, goals, tokens, achievements) that the
// leaderboard, reminders, AI context and the Admin Panel read. Habit check-ins are
// authoritative in `habit_completions` (PUT /api/habit-completions).
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { query, withTransaction } from '../db/client.js';
import { getDateKeyInTimeZone } from './completion-date.js';

export { sameState, stableStringify } from './app-state-sync.js';

export async function serverCompletionPoints(userId) {
  const result = await query('SELECT COUNT(*)::integer * 20 AS points FROM habit_completions WHERE user_id=$1', [userId]);
  return result.rows[0]?.points || 0;
}

export async function getServerCompletions(userId) {
  const result = await query('SELECT habit_id AS "habitId", completed_date::text AS date FROM habit_completions WHERE user_id=$1 ORDER BY completed_date DESC', [userId]);
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

/** Habits rebuilt from the relational tables, used when no synced state exists yet. */
export async function getCanonicalHabits(userId) {
  const [habitResult, completionResult] = await Promise.all([
    query('SELECT id, label, meta, category, icon, color, goal, progress, total, streak, done, reminder_enabled AS "reminderEnabled", reminder_time AS "reminderTime", sort_order AS "sortOrder", updated_at AS "updatedAt" FROM habits WHERE user_id=$1 ORDER BY sort_order ASC, id ASC', [userId]),
    query('SELECT habit_id AS "habitId", completed_date::text AS date FROM habit_completions WHERE user_id=$1 ORDER BY completed_date ASC', [userId]),
  ]);
  const completionsByHabit = new Map();
  for (const completion of completionResult.rows) {
    const dates = completionsByHabit.get(completion.habitId) || [];
    dates.push(completion.date);
    completionsByHabit.set(completion.habitId, dates);
  }
  return habitResult.rows.map((habit) => {
    const id = String(habit.id).replace(`${userId}:habit:`, '');
    const completionDates = completionsByHabit.get(id) || [];
    const done = completionDates.includes(new Date().toISOString().slice(0, 10));
    const goal = Math.max(1, Number(habit.goal) || 1);
    return { ...habit, id, goal, completionDates, done, progress: done ? 100 : 0, total: `${done ? goal : 0}/${goal}` };
  });
}

/** Overlays the authoritative check-ins onto the habits of a saved state. */
export function reconcileHabitState(savedHabits, canonicalHabits) {
  if (!Array.isArray(savedHabits) || savedHabits.length === 0) return canonicalHabits;
  const canonicalById = new Map(canonicalHabits.map((habit) => [habit.id, habit]));
  return savedHabits.map((habit) => {
    const canonical = canonicalById.get(habit.id);
    if (!canonical) return habit;
    const done = canonical.completionDates.includes(getDateKeyInTimeZone(new Date(), habit.completionTimeZone));
    const goal = Math.max(1, Number(habit.goal) || 1);
    return { ...habit, completionDates: canonical.completionDates, done, progress: done ? 100 : 0, total: `${done ? goal : 0}/${goal}` };
  });
}

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

  await connection.query('DELETE FROM habits WHERE user_id=$1', [userId]);
  const habitIds = habits.map((habit) => String(habit.id).trim()).filter(Boolean);
  if (habitIds.length === 0) await connection.query('DELETE FROM habit_completions WHERE user_id=$1', [userId]);
  else await connection.query('DELETE FROM habit_completions WHERE user_id=$1 AND NOT (habit_id = ANY($2::text[]))', [userId, habitIds]);
  for (const [sortOrder, habit] of habits.entries()) {
    const goal = Math.max(1, Number(habit.goal) || 1);
    const habitId = String(habit.id || '').trim();
    if (!habitId) continue;
    await connection.query(
      `INSERT INTO habits(id,user_id,label,meta,category,icon,color,goal,progress,total,streak,done,reminder_enabled,reminder_time,sort_order,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label, meta = EXCLUDED.meta, category = EXCLUDED.category, icon = EXCLUDED.icon,
         color = EXCLUDED.color, goal = EXCLUDED.goal, progress = EXCLUDED.progress, total = EXCLUDED.total,
         streak = EXCLUDED.streak, done = EXCLUDED.done, reminder_enabled = EXCLUDED.reminder_enabled,
         reminder_time = EXCLUDED.reminder_time, sort_order = EXCLUDED.sort_order, updated_at = EXCLUDED.updated_at`,
      [`${userId}:habit:${habitId}`, userId, habit.label || habit.name || habitId, habit.meta || '', habit.category || '', habit.icon || 'ellipse-outline', habit.color || '', goal, Number(habit.progress) || 0, habit.total || `0/${goal}`, Number(habit.streak) || 0, Boolean(habit.done), Boolean(habit.reminderEnabled), habit.reminderTime || '', sortOrder, updatedAt],
    );
    await connection.query('DELETE FROM habit_completions WHERE user_id=$1 AND habit_id=$2', [userId, habitId]);
    for (const completionDate of Array.isArray(habit.completionDates) ? habit.completionDates : []) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(completionDate))) {
        await connection.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [userId, habitId, completionDate, updatedAt]);
      }
    }
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

  await connection.query('DELETE FROM token_transactions WHERE user_id=$1', [userId]);
  for (const transaction of state.tokenHistory || []) {
    await connection.query('INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING', [`${userId}:token:${transaction.id || crypto.randomUUID()}`, userId, Number(transaction.amount) || 0, transaction.label || '', transaction.date || '', updatedAt]);
  }

  // Achievements are upserted, so earned dates and the read state of their
  // notifications survive later syncs (they used to be recreated every time).
  const earned = earnedAchievements(habits);
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
