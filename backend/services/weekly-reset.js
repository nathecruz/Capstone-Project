// The weekly reset of habits (services/habit-week.js): every saved habit gets the last day it is
// active, and keeps it. Pure helpers for PUT /api/app-state and the one-time migration of the
// snapshots saved before weekly habits (services/app-state-store.js stampLatestSnapshot).
import { isDateKey, withActiveUntil } from './habit-week.js';

/**
 * A habit sent without a last active day keeps the one the server already gave it. App versions
 * from before weekly habits may send a habit without it; stamping it again would move an ended
 * habit into the current week and bring it back to the lists.
 */
export function keepActiveUntil(state, current) {
  const stored = new Map((Array.isArray(current?.habits) ? current.habits : [])
    .filter((habit) => habit?.id && isDateKey(habit.activeUntil))
    .map((habit) => [habit.id, habit.activeUntil]));
  if (!Array.isArray(state?.habits) || !stored.size) return state;
  let changed = false;
  const habits = state.habits.map((habit) => {
    if (!habit || isDateKey(habit.activeUntil) || !stored.has(habit.id)) return habit;
    changed = true;
    return { ...habit, activeUntil: stored.get(habit.id) };
  });
  return changed ? { ...state, habits } : state;
}

/** The state to save: stored last active days kept, the end of their week for habits without one. */
export function stampActiveUntil(state, current, now = new Date()) {
  return withActiveUntil(keepActiveUntil(state, current), now);
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
