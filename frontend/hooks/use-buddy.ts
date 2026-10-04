// The Habit Buddy as the server has it, kept for the session so Home shows it right away.
import { useCallback, useEffect, useState } from 'react';
import { getBuddy } from '@/authentication/authService';
import type { Buddy } from '@/utils/buddy';

let cached: Buddy | null = null;
const listeners = new Set<(buddy: Buddy) => void>();

/** Shares a buddy from the server (after a purchase or a change) with every screen showing it. */
export function publishBuddy(buddy: Buddy) {
  cached = buddy;
  for (const listener of listeners) listener(buddy);
}

/** The buddy last loaded this session, or null. */
export function getCachedBuddy() {
  return cached;
}

/** A check-in (+1) or its undo (-1) changes the count right away; the server's count replaces it on the next load. */
export function adjustBuddyCheckIns(delta: number) {
  if (cached) publishBuddy({ ...cached, checkIns: Math.max(0, cached.checkIns + delta) });
}

export function useBuddy() {
  const [buddy, setBuddy] = useState<Buddy | null>(cached);
  const refresh = useCallback(async () => {
    const result = await getBuddy();
    if (result.ok) publishBuddy(result.buddy);
    return result;
  }, []);
  useEffect(() => {
    listeners.add(setBuddy);
    void refresh();
    return () => {
      listeners.delete(setBuddy);
    };
  }, [refresh]);
  return { buddy, refresh };
}
