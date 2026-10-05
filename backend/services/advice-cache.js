// AI advice for a habit, kept while nothing about the habit has changed: opening Insights again,
// or switching between habits, shows the same advice without asking the AI (or counting toward
// the AI limit) again. It lives in memory, so a restart simply asks again.
import crypto from 'node:crypto';

const ADVICE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;

/** The key for one student's habit as it is now (its facts and forecast, and the day). */
export function adviceKey(userId, habitId, facts) {
  return `${userId}:${habitId}:${crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 32)}`;
}

export function createAdviceCache({ ttlMs = ADVICE_TTL_MS, maxEntries = MAX_ENTRIES, now = Date.now } = {}) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return null;
      }
      return entry.advice;
    },
    set(key, advice) {
      entries.delete(key);
      entries.set(key, { advice, expiresAt: now() + ttlMs });
      // Oldest first: drop the oldest entries once the cache is full.
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    get size() {
      return entries.size;
    },
  };
}

export const habitAdviceCache = createAdviceCache();
