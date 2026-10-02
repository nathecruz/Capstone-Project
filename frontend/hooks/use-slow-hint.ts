import { useEffect, useState } from 'react';

/**
 * True once `active` has lasted `afterMs`. The free server sleeps when nobody uses it and the
 * first request then takes up to a minute, so long waits get an explanation instead of looking stuck.
 */
export function useSlowHint(active: boolean, afterMs = 6000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(timer);
  }, [active, afterMs]);
  return slow;
}

export const SLOW_SERVER_HINT = 'The server is waking up. The first sign-in after a while can take up to a minute.';
