// Today's daily challenges as the server counts them, shared by Home and the check-in flow (each
// check-in's answer brings the new progress). Cleared when the account changes.
import { useEffect, useSyncExternalStore } from 'react';
import { getDailyChallenges, subscribeToAuthChanges, type DailyChallenge } from '@/authentication';
import { getLocalDateKey } from '@/utils/habit-visibility';

type State = { date: string; challenges: DailyChallenge[] };
let state: State = { date: '', challenges: [] };
const listeners = new Set<() => void>();

function update(next: State) {
  state = next;
  listeners.forEach((listener) => listener());
}

subscribeToAuthChanges(() => update({ date: '', challenges: [] }));

/** The challenges known for today before this update (to tell which were just completed). */
export function getKnownChallenges() {
  return state.date === getLocalDateKey() ? state.challenges : [];
}

export function publishDailyChallenges(challenges: DailyChallenge[]) {
  update({ date: challenges[0]?.date ?? getLocalDateKey(), challenges });
}

export async function loadDailyChallenges() {
  const date = getLocalDateKey();
  const result = await getDailyChallenges(date);
  if (result.ok) update({ date, challenges: result.challenges });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Today's challenges; loads them when the day (or the account) changes. With load false it only
 * reads what another part of the screen loaded (no second request).
 */
export function useDailyChallenges(habitCount: number, load = true) {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  const today = getLocalDateKey();
  useEffect(() => {
    if (load && habitCount > 0) void loadDailyChallenges();
  }, [today, habitCount, load]);
  return snapshot.date === today ? snapshot.challenges : [];
}
