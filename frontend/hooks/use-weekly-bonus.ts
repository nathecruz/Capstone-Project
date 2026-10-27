// The weekly consistency bonus as the server counts it (last week, claimable this week, and this
// week so far), shared by the Monday recap and the Quests tab. Loaded for the device's today and
// again when check-ins change; cleared when the account changes.
import { useEffect, useSyncExternalStore } from 'react';
import { claimWeeklyBonus, getWeeklyBonus, type WeeklyBonus } from '@/authentication/authService';
import { subscribeToAuthChanges } from '@/authentication/session';

type State = { date: string; bonus: WeeklyBonus | null; claiming: boolean; error: string };
const EMPTY: State = { date: '', bonus: null, claiming: false, error: '' };
let state = EMPTY;
// The day being loaded (a second card asking for it sends no second request), whether a change came
// in meanwhile (it is loaded again after that answer), the latest load (an answer for an older day
// is dropped) and the account's version, so an answer for a signed-out account is dropped.
let loadingDate = '';
let loadAgain = false;
let latestLoad = 0;
let account = 0;
const listeners = new Set<() => void>();

function update(changes: Partial<State>) {
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener());
}

subscribeToAuthChanges(() => {
  account += 1;
  loadingDate = '';
  loadAgain = false;
  update(EMPTY);
});

/**
 * A bonus this store saw claimed stays claimed: an answer the server counted before the claim
 * (sent just before it, answered just after) must not bring the Claim button back.
 */
function keepClaimed(next: WeeklyBonus, known: WeeklyBonus | null): WeeklyBonus {
  const last = known?.lastWeek;
  if (!last?.claimed || next.lastWeek.claimed || next.lastWeek.weekStart !== last.weekStart) return next;
  return { ...next, lastWeek: { ...next.lastWeek, claimed: true, claimable: false, claimedAmount: last.claimedAmount } };
}

async function fetchBonus(date: string) {
  const asked = account;
  latestLoad += 1;
  const load = latestLoad;
  loadingDate = date;
  loadAgain = false;
  const result = await getWeeklyBonus(date);
  // Dropped when the account changed or another day was asked for meanwhile.
  if (asked !== account || load !== latestLoad) return;
  loadingDate = '';
  if (result.ok) {
    const bonus = keepClaimed({ lastWeek: result.lastWeek, thisWeek: result.thisWeek, tiers: result.tiers }, state.bonus);
    // A refused claim of another day (e.g. sent just before midnight) says nothing about this one.
    update(date === state.date ? { bonus } : { date, bonus, error: '' });
  }
  if (loadAgain) void fetchBonus(date);
}

/** Loads the bonus for `date` again, after the load already on its way if there is one. */
function refresh(date: string) {
  if (loadingDate === date) loadAgain = true;
  else void fetchBonus(date);
}

/** Loads the bonus for `date` (the device's today), unless it is being loaded already. */
export async function loadWeeklyBonus(date: string) {
  if (loadingDate !== date) await fetchBonus(date);
}

/** After a check-in or a payment: loads the bonus again, if a screen loaded it. */
export function reloadWeeklyBonus() {
  if (state.date) refresh(state.date);
}

/**
 * Claims last week's bonus for `date`; the server recounts the week and pays it once. Returns the
 * server's answer (null while a claim is already on its way); the store then shows it claimed.
 */
export async function claimLastWeekBonus(date: string) {
  if (state.claiming) return null;
  // The week this claim is for: when the day changed before the answer, the new day's last week is
  // another one, still to claim.
  const weekStart = state.date === date ? state.bonus?.lastWeek.weekStart : undefined;
  update({ claiming: true, error: '' });
  const asked = account;
  const result = await claimWeeklyBonus(date);
  if (asked !== account) return null;
  if (!result.ok) {
    update({ claiming: false, error: result.message });
    // Not earned, or another day: show the server's numbers as they are now.
    refresh(date);
    return result;
  }
  const bonus = state.bonus;
  update({
    claiming: false,
    bonus: bonus && weekStart && bonus.lastWeek.weekStart === weekStart
      ? { ...bonus, lastWeek: { ...bonus.lastWeek, claimed: true, claimable: false, claimedAmount: result.amount } }
      : bonus,
  });
  return result;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The bonus for `date` (the device's today; null until the server answered), loaded when the day changes. */
export function useWeeklyBonus(date: string) {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    void loadWeeklyBonus(date);
  }, [date]);
  return { bonus: snapshot.date === date ? snapshot.bonus : null, claiming: snapshot.claiming, error: snapshot.error };
}
