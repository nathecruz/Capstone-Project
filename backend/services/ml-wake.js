// The ML service runs on a free Render instance: it sleeps after about 15 minutes without
// requests and then needs up to a minute to start. While someone is using the app it is woken
// in the background (at most once every 10 minutes), so a forecast is ready when they open
// Insights. It is not kept awake around the clock: free instance hours are shared by all
// services and running out suspends them.
import { config } from '../config/index.js';

const WAKE_EVERY_MS = 10 * 60 * 1000;
/** After a failed wake-up, try again sooner than the usual interval. */
const RETRY_AFTER_MS = 60 * 1000;

export function createMlWaker({ enabled, url, fetchImpl = fetch, everyMs = WAKE_EVERY_MS, retryAfterMs = RETRY_AFTER_MS }) {
  let nextWake = 0;
  return function wake(now = Date.now()) {
    if (!enabled || now < nextWake) return false;
    nextWake = now + everyMs;
    Promise.resolve()
      .then(() => fetchImpl(`${url.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(90_000) }))
      .catch(() => { nextWake = Math.min(nextWake, Date.now() + retryAfterMs); });
    return true;
  };
}

// Only in production: the local ML service does not sleep.
export const wakeMlService = createMlWaker({ enabled: config.isProduction && Boolean(config.ml.key), url: config.ml.url });
