// The Habit Buddy as the server has it, kept for the session so Home shows it right away. It is
// loaded for the device's today, so it also has this week's drop.
import { useCallback, useEffect, useState } from 'react';
import { getBuddy } from '@/authentication/authService';
import { keepTodayGifts, keepWeekDrop, type Buddy } from '@/utils/buddy';
import { getLocalDateKey } from '@/utils/habit-visibility';

let cached: Buddy | null = null;
const listeners = new Set<(buddy: Buddy) => void>();

/**
 * Shares a buddy from the server (after a purchase or a change) with every screen showing it. An
 * answer without the week's drop or today's gifts (a change of look) keeps the ones already known.
 */
export function publishBuddy(buddy: Buddy) {
  cached = keepTodayGifts(keepWeekDrop(buddy, cached, getLocalDateKey()), cached);
  for (const listener of listeners) listener(cached);
}

/** The buddy last loaded this session, or null. */
export function getCachedBuddy() {
  return cached;
}

/** A check-in (+1) or its undo (-1) changes the count right away; the server's count replaces it on the next load. */
export function adjustBuddyCheckIns(delta: number) {
  if (cached) publishBuddy({ ...cached, checkIns: Math.max(0, cached.checkIns + delta) });
}

/** Loads the buddy again (it changed on the server) and shares it with every screen. */
export async function reloadBuddy() {
  const result = await getBuddy(getLocalDateKey());
  if (result.ok) publishBuddy(result.buddy);
}

/**
 * The buddy, loaded again when a screen showing it opens and when the day changes. With load false
 * it only reads the buddy another part of the screen loaded (no second request).
 */
export function useBuddy(load = true) {
  const [buddy, setBuddy] = useState<Buddy | null>(cached);
  const today = getLocalDateKey();
  const refresh = useCallback(async () => {
    const result = await getBuddy(getLocalDateKey());
    if (result.ok) publishBuddy(result.buddy);
    return result;
  }, []);
  useEffect(() => {
    listeners.add(setBuddy);
    return () => {
      listeners.delete(setBuddy);
    };
  }, []);
  useEffect(() => {
    if (load) void refresh();
  }, [load, refresh, today]);
  return { buddy, refresh };
}
