// When each account last saved its state, kept in memory for GET /api/app-state/version (the Android
// app's background reminder sync, services/sync-token.js), so that question is answered without
// the database. Every snapshot is saved by this API (app-state-store.js saveUserAppState notes it
// here). The whole map is read from the database at the first question and again at most every few
// hours, which also catches a snapshot another instance saved during a deploy: one query each time.
const versions = new Map();
let loadedAt = 0;
let loading = null;

export const STATE_VERSIONS_REFRESH_MS = 6 * 60 * 60 * 1000;

/** Notes a snapshot saved at `updatedAt` (a later one is never replaced by an earlier one). */
export function noteStateVersion(userId, updatedAt) {
  const at = Number(updatedAt);
  if (!userId || !(at > 0)) return;
  const key = String(userId);
  if (!(versions.get(key) >= at)) versions.set(key, at);
}

/** Reads every account's latest save time into the map (one query). */
export async function loadStateVersions(db, now = Date.now()) {
  const result = await db.query('SELECT user_id AS "userId", max(updated_at) AS "updatedAt" FROM user_app_state GROUP BY user_id');
  for (const row of result.rows) noteStateVersion(row.userId, row.updatedAt);
  loadedAt = now;
  return result.rows.length;
}

/** When the account last saved its state (null: never), from memory. */
export async function stateVersionOf(db, userId, now = Date.now()) {
  if (!loadedAt || now - loadedAt > STATE_VERSIONS_REFRESH_MS) {
    loading ??= loadStateVersions(db, now).finally(() => {
      loading = null;
    });
    await loading;
  }
  return versions.get(String(userId)) ?? null;
}

/** Forgets everything (tests). */
export function clearStateVersions() {
  versions.clear();
  loadedAt = 0;
}
