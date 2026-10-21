// The weekly reset of habits (services/habit-week.js): every saved habit gets the last day it is
// active, and keeps it. Pure helpers for PUT /api/app-state and the one-time migration of the
// snapshots saved before weekly habits (services/app-state-store.js stampLatestSnapshot).
import { config } from '../config/index.js';
import { getDateKeyInTimeZone } from './completion-date.js';
import { allowedActiveUntil, hasHabitEnded, withActiveUntil } from './habit-week.js';

/**
 * The state to save: every habit gets the last active day the server allows for the account's
 * `today` (allowedActiveUntil): the end of the week it starts in, or an earlier day the app sent; a
 * habit sent without one (older app versions) keeps the stored one. A habit whose stored week has
 * ended keeps its stored start date and last day, so no app can move it back into this week.
 */
export function stampActiveUntil(state, current, now = new Date(), today = getDateKeyInTimeZone(now, config.appTimeZone)) {
  if (!Array.isArray(state?.habits)) return state;
  const stored = new Map((Array.isArray(current?.habits) ? current.habits : []).filter((habit) => habit?.id).map((habit) => [habit.id, habit]));
  let changed = false;
  const habits = state.habits.map((habit) => {
    if (!habit || typeof habit !== 'object') return habit;
    const previous = stored.get(habit.id) ?? null;
    const startDate = previous && hasHabitEnded(previous, today) ? previous.startDate : habit.startDate;
    const activeUntil = allowedActiveUntil(habit, previous, today);
    if (startDate === habit.startDate && activeUntil === habit.activeUntil) return habit;
    changed = true;
    const next = { ...habit, activeUntil };
    if (startDate === undefined) delete next.startDate;
    else next.startDate = startDate;
    return next;
  });
  return changed ? { ...state, habits } : state;
}

/**
 * The latest snapshot ({ state, updatedAt }) with a last active day on every habit, saved as a
 * newer snapshot so the apps rebase on it; null when every habit already has one.
 */
export function weeklyResetSnapshot(latest, now = Date.now()) {
  if (!latest?.state) return null;
  const state = withActiveUntil(latest.state, new Date(now));
  if (state === latest.state) return null;
  return { state, updatedAt: Math.max(now, Number(latest.updatedAt) + 1) };
}
