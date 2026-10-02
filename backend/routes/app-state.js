import { config } from '../config/index.js';
import { query, withTransaction } from '../db/client.js';
import { parse } from '../lib/http.js';
import { habitCompletionSchema, stateSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { recordActivity } from '../services/activity.js';
import { mergeAppState, normalizeAppState, withNewIncomingCheckIns } from '../services/app-state-sync.js';
import {
  buildServerState,
  getCanonicalHabits,
  getLatestAppState,
  getLatestUpdatedAt,
  getServerCompletions,
  sameClientState,
  saveUserAppState,
  syncNormalizedState,
} from '../services/app-state-store.js';
import { isOpenCheckInDate } from '../services/completion-date.js';
import { applyWallet, awardCheckIn, getWallet, revokeCheckIn } from '../services/wallet.js';

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

    const [saved, completions] = await Promise.all([getLatestAppState(session.userId), getServerCompletions(session.userId)]);
    let state = null;
    if (saved?.state) {
      state = await buildServerState(session.userId, saved.state);
    } else {
      const canonicalHabits = await getCanonicalHabits(session.userId);
      if (canonicalHabits.length) state = applyWallet({ habits: canonicalHabits }, await getWallet({ query }, session.userId));
    }
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
      // A save without a base (a device that never loaded the server state, e.g. offline or during
      // a cold start) must not replace it: an empty or stale habit list would delete other
      // devices' habits and their check-ins. Merge it instead, with the server winning conflicts.
      const merged = Boolean(existing && (!baseState || Number(baseUpdatedAt) !== existingUpdatedAt));
      const state = merged
        ? withNewIncomingCheckIns(mergeAppState(baseState || {}, currentState, incomingState), baseState, incomingState)
        : normalizeAppState(incomingState);

      // Nothing the app owns changed (points, tokens and streaks are the server's): skip the write.
      if (existing && sameClientState(state, currentState)) return { state: currentState, updatedAt: existingUpdatedAt, merged, unchanged: true };

      const updatedAt = Math.max(clientUpdatedAt || 0, Date.now());
      const savedUpdatedAt = Math.max(updatedAt, existingUpdatedAt || 0) + (existingUpdatedAt === updatedAt ? 1 : 0);
      await syncNormalizedState(session.userId, state, savedUpdatedAt, connection);
      const serverState = await buildServerState(session.userId, state, connection);
      await saveUserAppState(session.userId, serverState, savedUpdatedAt, connection);
      return { state: serverState, updatedAt: savedUpdatedAt, merged, unchanged: false };
    });
    response.json({ ok: true, ...result });
  });

  app.get('/api/habit-completions', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    response.json({ ok: true, completions: await getServerCompletions(session.userId) });
  });

  // The authoritative way to check in or undo: updates check-ins, tokens, streak and the snapshot together.
  app.put('/api/habit-completions', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(habitCompletionSchema, request, response);
    if (!input) return;
    if (!isOpenCheckInDate(input.date, input.timeZone)) {
      return response.status(409).json({ ok: false, code: 'DAY_CLOSED', message: 'Only today can be checked in. A missed day stays missed.' });
    }

    const result = await withTransaction(async (connection) => {
      await connection.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const saved = await getLatestAppState(session.userId, connection);
      const habit = saved?.state?.habits?.find((entry) => entry.id === input.habitId);
      if (!habit) return null;
      const now = Date.now();

      if (!input.completed) {
        const existing = await connection.query('SELECT completed_at AS "completedAt" FROM habit_completions WHERE user_id=$1 AND habit_id=$2 AND completed_date=$3', [session.userId, input.habitId, input.date]);
        const completedAt = Number(existing.rows[0]?.completedAt);
        if (existing.rowCount && now - completedAt > config.checkIns.undoWindowMs) return { locked: true };
      }

      if (input.completed) {
        const inserted = await connection.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING habit_id', [session.userId, input.habitId, input.date, now]);
        if (inserted.rowCount) await awardCheckIn(connection, session.userId, input.habitId, input.date, habit.label, now);
      } else {
        const removed = await connection.query('DELETE FROM habit_completions WHERE user_id=$1 AND habit_id=$2 AND completed_date=$3', [session.userId, input.habitId, input.date]);
        if (removed.rowCount) await revokeCheckIn(connection, session.userId, input.habitId, input.date, habit.label, now);
      }

      // Reflect the change in the snapshot too, so the sync below cannot re-add an undone check-in.
      const state = {
        ...saved.state,
        habits: saved.state.habits.map((entry) => {
          if (entry.id !== input.habitId) return entry;
          const dates = new Set(Array.isArray(entry.completionDates) ? entry.completionDates : []);
          if (input.completed) dates.add(input.date);
          else dates.delete(input.date);
          return { ...entry, completionDates: [...dates].sort(), completionTimeZone: input.timeZone || entry.completionTimeZone || 'UTC' };
        }),
      };
      const updatedAt = Math.max(now, Number(saved.updatedAt) + 1);
      await syncNormalizedState(session.userId, state, updatedAt, connection);
      const serverState = await buildServerState(session.userId, state, connection);
      await saveUserAppState(session.userId, serverState, updatedAt, connection);
      return { serverState, updatedAt };
    });
    if (!result) return response.status(404).json({ ok: false, message: 'Habit not found.' });
    if (result.locked) return response.status(409).json({ ok: false, code: 'CHECK_IN_LOCKED', message: 'This check-in is locked. A check-in can only be undone right after it is made.' });

    const { serverState, updatedAt } = result;
    const habit = serverState.habits.find((entry) => entry.id === input.habitId);
    response.json({
      ok: true,
      updatedAt,
      // The new snapshot, so the app can use it as its sync base (its next save is then not a merge).
      state: serverState,
      completions: await getServerCompletions(session.userId),
      points: serverState.points,
      tokens: serverState.tokens,
      tokenHistory: serverState.tokenHistory,
      habit: habit ? { id: habit.id, streak: habit.streak, done: habit.done, completionDates: habit.completionDates } : null,
    });
  });
}
