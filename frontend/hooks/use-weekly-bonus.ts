// The weekly consistency bonus as the server counts it (last week, claimable this week, and this
// week so far), shared by the Monday recap and the Quests tab. Loaded for the device's today and
// again when check-ins change; cleared when the account changes.
import { useEffect, useSyncExternalStore } from 'react';
import { claimWeeklyBonus, getWeeklyBonus, type WeeklyBonus } from '@/authentication/authService';
import { subscribeToAuthChanges } from '@/authentication/session';

type State = { date: string; bonus: WeeklyBonus | null; claiming: boolean; error: string };
const EMPTY: State = { date: '', bonus: null, claiming: false, error: '' };
let state = EMPTY;
// The day being loaded (a second card asking for it sends no second request), and the account's
// version, so an answer for a signed-out account is dropped.
let loadingDate = '';
let account = 0;
const listeners = new Set<() => void>();

function update(changes: Partial<State>) {
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener());
}

subscribeToAuthChanges(() => {
  account += 1;
  loadingDate = '';
  update(EMPTY);
});

/** Loads the bonus for `date` (the device's today). */
export async function loadWeeklyBonus(date: string) {
  if (loadingDate === date) return;
  loadingDate = date;
  const asked = account;
  const result = await getWeeklyBonus(date);
  // Dropped when the account changed or a newer day was asked for meanwhile.
  if (asked !== account || loadingDate !== date) return;
  loadingDate = '';
  if (result.ok) update({ date, bonus: { lastWeek: result.lastWeek, thisWeek: result.thisWeek, tiers: result.tiers } });
}

/** After a check-in or a payment: loads the bonus again, if a screen loaded it. */
export function reloadWeeklyBonus() {
  if (state.date) void loadWeeklyBonus(state.date);
}

/**
 * Claims last week's bonus for `date`; the server recounts the week and pays it once. Returns the
 * server's answer (null while a claim is already on its way); the store then shows it claimed.
 */
export async function claimLastWeekBonus(date: string) {
  if (state.claiming) return null;
  update({ claiming: true, error: '' });
  const asked = account;
  const result = await claimWeeklyBonus(date);
  if (asked !== account) return null;
  if (!result.ok) {
    update({ claiming: false, error: result.message });
    // Not earned, or another day: show the server's numbers as they are now.
    void loadWeeklyBonus(date);
    return result;
  }
  const bonus = state.bonus;
  update({
    claiming: false,
    bonus: bonus && { ...bonus, lastWeek: { ...bonus.lastWeek, claimed: true, claimable: false, claimedAmount: result.amount } },
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
