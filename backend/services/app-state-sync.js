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

export function mergeAppState(base, current, incoming) {
  const merged = { ...current };
  merged.profile = mergeObject(base.profile, current.profile, incoming.profile);
  merged.preferences = mergeObject(base.preferences, current.preferences, incoming.preferences);
  merged.habits = mergeIdentifiedArray(base.habits, current.habits, incoming.habits);
  merged.tokenHistory = mergeIdentifiedArray(base.tokenHistory, current.tokenHistory, incoming.tokenHistory);
  for (const key of ['avatarImage', 'darkModeOverride', 'ringInterval', 'snoozeFrequency']) {
    merged[key] = valuesEqual(incoming[key], base[key]) ? current[key] : valuesEqual(current[key], base[key]) ? incoming[key] : current[key];
  }
  if ('goals' in incoming) {
    merged.goals = valuesEqual(incoming.goals, base.goals) ? current.goals : valuesEqual(current.goals, base.goals) ? incoming.goals : current.goals;
  }
  for (const key of ['points', 'tokens']) {
    const incomingChanged = incoming[key] !== base[key];
    const currentChanged = current[key] !== base[key];
    merged[key] = incomingChanged && currentChanged ? current[key] + (incoming[key] - base[key]) : incomingChanged ? incoming[key] : current[key];
  }
  return normalizeAppState(merged);
}
