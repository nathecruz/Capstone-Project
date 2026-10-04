/** JSON with sorted keys, so JSONB (which reorders keys) compares equal to the same JS object. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export const sameState = (left, right) => stableStringify(left) === stableStringify(right);

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeObject(base, current, incoming) {
  const result = { ...current };
  for (const key of new Set([...Object.keys(base || {}), ...Object.keys(current || {}), ...Object.keys(incoming || {})])) {
    const baseValue = base?.[key];
    const currentValue = current?.[key];
    const incomingValue = incoming?.[key];
    if (valuesEqual(incomingValue, baseValue)) {
      result[key] = currentValue;
    } else if (valuesEqual(currentValue, baseValue)) {
      result[key] = incomingValue;
    } else {
      result[key] = currentValue;
    }
  }
  return result;
}

function mergeIdentifiedArray(base, current, incoming) {
  const baseById = new Map((base || []).map((item) => [item.id, item]));
  const currentById = new Map((current || []).map((item) => [item.id, item]));
  const incomingById = new Map((incoming || []).map((item) => [item.id, item]));
  const merged = [];

  for (const id of new Set([...baseById.keys(), ...currentById.keys(), ...incomingById.keys()])) {
    const baseValue = baseById.get(id);
    const currentValue = currentById.get(id);
    const incomingValue = incomingById.get(id);
    let value;
    if (valuesEqual(incomingValue, baseValue)) value = currentValue;
    else if (valuesEqual(currentValue, baseValue)) value = incomingValue;
    else value = currentValue ?? incomingValue;
    if (value) merged.push(value);
  }

  return merged;
}

const orderOf = (items, ids) => (items || []).map((item) => item?.id).filter((id) => ids.has(id));

/** Keeps a reorder made on the incoming side (the id-based merge above follows the base order). */
function applyIncomingOrder(merged, base, current, incoming) {
  const ids = new Set(merged.map((item) => item.id));
  const baseOrder = orderOf(base, ids);
  const incomingOrder = orderOf(incoming, ids);
  if (valuesEqual(incomingOrder, baseOrder) || !valuesEqual(orderOf(current, ids), baseOrder)) return merged;
  const rank = new Map(incomingOrder.map((id, index) => [id, index]));
  return merged
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (rank.get(a.item.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.item.id) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(({ item }) => item);
}

export function normalizeAppState(state) {
  if (!state || typeof state !== 'object') return state;
  const seenHabitIds = new Set();
  const habits = Array.isArray(state.habits) ? state.habits.filter((habit) => {
    const habitId = String(habit?.id || '').trim();
    if (!habitId || seenHabitIds.has(habitId)) return false;
    seenHabitIds.add(habitId);
    return true;
  }) : [];

  return {
    ...state,
    habits,
  };
}

const datesOf = (habit) => (Array.isArray(habit?.completionDates) ? habit.completionDates.filter((date) => typeof date === 'string') : []);

/**
 * Check-ins the device added since its base (made offline) are kept even when the server's
 * copy of the habit wins the merge. Dates the base already had are not re-added, so a check-in
 * undone on another device stays undone.
 */
export function withNewIncomingCheckIns(state, base, incoming) {
  const baseById = new Map((base?.habits || []).map((habit) => [habit?.id, habit]));
  const incomingById = new Map((incoming?.habits || []).map((habit) => [habit?.id, habit]));
  return {
    ...state,
    habits: (state.habits || []).map((habit) => {
      const known = new Set(datesOf(baseById.get(habit.id)));
      const added = datesOf(incomingById.get(habit.id)).filter((date) => !known.has(date));
      const dates = new Set(datesOf(habit));
      if (added.every((date) => dates.has(date))) return habit;
      return { ...habit, completionDates: [...new Set([...dates, ...added])].sort() };
    }),
  };
}

export function mergeAppState(base, current, incoming) {
  const merged = { ...current };
  merged.profile = mergeObject(base.profile, current.profile, incoming.profile);
  merged.preferences = mergeObject(base.preferences, current.preferences, incoming.preferences);
  merged.habits = applyIncomingOrder(mergeIdentifiedArray(base.habits, current.habits, incoming.habits), base.habits, current.habits, incoming.habits);
  merged.tokenHistory = mergeIdentifiedArray(base.tokenHistory, current.tokenHistory, incoming.tokenHistory);
  for (const key of ['avatarImage', 'darkModeOverride', 'ringInterval', 'snoozeFrequency']) {
    merged[key] = valuesEqual(incoming[key], base[key]) ? current[key] : valuesEqual(current[key], base[key]) ? incoming[key] : current[key];
  }
  if ('goals' in incoming) {
    merged.goals = valuesEqual(incoming.goals, base.goals) ? current.goals : valuesEqual(current.goals, base.goals) ? incoming.goals : current.goals;
  }
  // Points and tokens come from the server's ledger (services/wallet.js), never from a device.
  merged.points = current.points;
  merged.tokens = current.tokens;
  return normalizeAppState(merged);
}

const goalStatus = (progress) => (progress >= 100 ? 'Completed' : progress >= 67 ? 'On track' : progress > 0 ? 'In progress' : 'Fresh plan');

/**
 * A goal step, once done, stays done: no device (or an older copy of the state) can uncheck it.
 * Progress and status follow the steps. Deleting a whole goal is still allowed.
 */
export function keepCompletedGoalSteps(state, current) {
  const doneById = new Map((current?.goals || []).filter((goal) => goal?.id).map((goal) => [goal.id, Array.isArray(goal.completedSteps) ? goal.completedSteps : []]));
  if (!Array.isArray(state?.goals) || !doneById.size) return state;
  let changed = false;
  const goals = state.goals.map((goal) => {
    const done = doneById.get(goal?.id);
    if (!done) return goal;
    const incoming = Array.isArray(goal.completedSteps) ? goal.completedSteps : [];
    const steps = Array.from({ length: Math.max(incoming.length, done.length) }, (_, index) => Boolean(incoming[index]) || Boolean(done[index]));
    if (steps.length === incoming.length && steps.every((value, index) => value === Boolean(incoming[index]))) return goal;
    changed = true;
    const progress = Math.round((steps.filter(Boolean).length / Math.max(1, steps.length)) * 100);
    return { ...goal, completedSteps: steps, progress, status: goalStatus(progress) };
  });
  return changed ? { ...state, goals } : state;
}
