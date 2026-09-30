import { withTransaction } from '../db/client.js';
import { parse } from '../lib/http.js';
import { habitCompletionSchema, stateSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { mergeAppState, normalizeAppState } from '../services/app-state-sync.js';
import {
  getCanonicalHabits,
  getLatestAppState,
  getLatestUpdatedAt,
  getServerCompletions,
  reconcileHabitState,
  sameState,
  saveUserAppState,
  serverCompletionPoints,
  syncNormalizedState,
} from '../services/app-state-store.js';
import { recordActivity } from '../services/activity.js';
import { getDateKeyInTimeZone, isValidCompletionDate } from '../services/completion-date.js';

export default function registerAppStateRoutes(app) {
  // `?since=<updatedAt>` lets clients poll cheaply: when nothing is newer the
  // response is just { unchanged: true } instead of the whole state.
  app.get('/api/app-state', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    void recordActivity(session.userId);
    const since = Number(request.query.since);
    if (Number.isFinite(since) && since > 0) {
      const latest = await getLatestUpdatedAt(session.userId);
      if (latest !== null && latest <= since) return response.json({ ok: true, unchanged: true, updatedAt: latest });
    }

    const [saved, canonicalHabits, completions] = await Promise.all([
      getLatestAppState(session.userId),
      getCanonicalHabits(session.userId),
      getServerCompletions(session.userId),
    ]);
    const state = saved?.state
      ? { ...saved.state, habits: reconcileHabitState(saved.state.habits, canonicalHabits) }
      : canonicalHabits.length ? { habits: canonicalHabits } : null;
    response.json({ ok: true, state, updatedAt: saved?.updatedAt ?? null, completions });
  });

  app.put('/api/app-state', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(stateSchema, request, response);
    if (!input) return;
    const { clientUpdatedAt, baseUpdatedAt, baseState, ...incomingState } = input;

    const result = await withTransaction(async (connection) => {
      // Serialises concurrent saves from several devices of the same user.
      await connection.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const existing = await getLatestAppState(session.userId, connection);
      const existingUpdatedAt = existing?.updatedAt ?? null;
      const currentState = existing?.state ?? null;
      const merged = Boolean(existing && baseState && Number(baseUpdatedAt) !== existingUpdatedAt);
      const state = merged ? mergeAppState(baseState, currentState, incomingState) : normalizeAppState(incomingState);

      // Echoed or repeated saves change nothing: skip the write and the table resync.
      if (existing && sameState(state, currentState)) return { state: currentState, updatedAt: existingUpdatedAt, merged, unchanged: true };

      const updatedAt = Math.max(clientUpdatedAt || 0, Date.now());
      const savedUpdatedAt = Math.max(updatedAt, existingUpdatedAt || 0) + (existingUpdatedAt === updatedAt ? 1 : 0);
      await saveUserAppState(session.userId, state, savedUpdatedAt, connection);
      await syncNormalizedState(session.userId, state, savedUpdatedAt, connection);
      return { state, updatedAt: savedUpdatedAt, merged, unchanged: false };
    });
    response.json({ ok: true, ...result });
  });

  app.get('/api/habit-completions', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    response.json({ ok: true, completions: await getServerCompletions(session.userId) });
  });

  app.put('/api/habit-completions', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(habitCompletionSchema, request, response);
    if (!input) return;
    if (!isValidCompletionDate(input.date, input.timeZone)) return response.status(400).json({ ok: false, message: 'Completion date must be a valid date up to today.' });

    const updated = await withTransaction(async (connection) => {
      await connection.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const saved = await getLatestAppState(session.userId, connection);
      const state = saved?.state;
      const habit = state?.habits?.find((entry) => entry.id === input.habitId);
      if (!habit) return false;
      habit.completionTimeZone = input.timeZone || habit.completionTimeZone || 'UTC';

      if (input.completed) {
        await connection.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [session.userId, input.habitId, input.date, Date.now()]);
      } else {
        await connection.query('DELETE FROM habit_completions WHERE user_id=$1 AND habit_id=$2 AND completed_date=$3', [session.userId, input.habitId, input.date]);
      }

      const completionDates = new Set(Array.isArray(habit.completionDates) ? habit.completionDates.filter((date) => typeof date === 'string') : []);
      if (input.completed) completionDates.add(input.date);
      else completionDates.delete(input.date);
      habit.completionDates = Array.from(completionDates).sort();
      const today = getDateKeyInTimeZone(new Date(), input.timeZone);
      habit.done = habit.completionDates.includes(today);
      const goal = Math.max(1, Number(habit.goal) || 1);
      habit.progress = habit.done ? 100 : 0;
      habit.total = `${habit.done ? goal : 0}/${goal}`;
      const updatedAt = Math.max(Date.now(), Number(saved.updatedAt) + 1);
      await saveUserAppState(session.userId, state, updatedAt, connection);
      await syncNormalizedState(session.userId, state, updatedAt, connection);
      return true;
    });
    if (!updated) return response.status(404).json({ ok: false, message: 'Habit not found.' });
    response.json({ ok: true, completions: await getServerCompletions(session.userId), points: await serverCompletionPoints(session.userId) });
  });
}
