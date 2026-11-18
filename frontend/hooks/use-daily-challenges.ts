// Today's daily quests (challenges, as the server calls them) as the server counts them, shared by
// Home and the check-in flow (each check-in's answer brings the new progress), with the quest chest,
// the quest streak and when they reset. Cleared when the account changes.
import { useEffect, useSyncExternalStore } from 'react';
import { getDailyChallenges, subscribeToAuthChanges, type DailyChallenge } from '@/authentication';
import { getLocalDateKey } from '@/utils/habit-visibility';

/**
 * `chestReward`: the bonus for finishing every quest (0 when the server does not have the chest),
 * `streak`: days in a row before today with the chest opened, `resetsAt`: the next midnight of the
 * account day (epoch ms, 0 when unknown).
 */
export type DailyQuests = { date: string; challenges: DailyChallenge[]; chestReward: number; streak: number; resetsAt: number };

const EMPTY: DailyQuests = { date: '', challenges: [], chestReward: 0, streak: 0, resetsAt: 0 };
let state: DailyQuests = EMPTY;
const listeners = new Set<() => void>();

function update(next: DailyQuests) {
  state = next;
  listeners.forEach((listener) => listener());
}

subscribeToAuthChanges(() => update(EMPTY));

/** The challenges known for today before this update (to tell which were just completed). */
export function getKnownChallenges() {
  return state.date === getLocalDateKey() ? state.challenges : [];
}

/** The quest chest's bonus as last loaded for today (0 when unknown). */
export function getKnownChestReward() {
  return state.date === getLocalDateKey() ? state.chestReward : 0;
}

/** A check-in's answer: the new progress. The chest, streak and reset time of the same day are kept. */
export function publishDailyChallenges(challenges: DailyChallenge[]) {
  const date = challenges[0]?.date ?? getLocalDateKey();
  const kept = state.date === date ? state : { ...EMPTY, date };
  update({ ...kept, date, challenges });
}

export async function loadDailyChallenges() {
  const date = getLocalDateKey();
  const result = await getDailyChallenges(date);
  if (result.ok) update({ date, challenges: result.challenges, chestReward: result.chest?.reward ?? 0, streak: result.streak ?? 0, resetsAt: result.resetsAt ?? 0 });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Today's quests with the chest, streak and reset time; loads them when the day (or the account)
 * changes. With load false it only reads what another part of the screen loaded (no second request).
 */
export function useDailyQuests(habitCount: number, load = true): DailyQuests {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  const today = getLocalDateKey();
  useEffect(() => {
    if (load && habitCount > 0) void loadDailyChallenges();
  }, [today, habitCount, load]);
  return snapshot.date === today ? snapshot : { ...EMPTY, date: today };
}

/** Today's challenges only (see useDailyQuests). */
export function useDailyChallenges(habitCount: number, load = true) {
  return useDailyQuests(habitCount, load).challenges;
}
