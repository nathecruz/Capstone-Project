// Device-side sync bookkeeping, kept per account next to the saved app state:
//   - the base: the last state the server confirmed, so a later save can be merged on the
//     server (3-way) even when the app started during a server cold start;
//   - the unsaved flag: local changes that have not reached the server yet, so they are
//     merged instead of being replaced by the server copy on the next launch.
// Also the day the daily token limit was last shown, which signing out removes with the rest.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppStateSyncBase, StateSyncToken } from '@/authentication/authService';

/** The account's saved copy of its habits and settings, for a quick start and while the server wakes. */
export const APP_STATE_KEY_PREFIX = 'habitai_app_state:';
const BASE_KEY_PREFIX = 'habitai_sync_base:';
const UNSAVED_KEY_PREFIX = 'habitai_unsaved:';
/** The day the daily token limit was last shown to the account here: once a day, not once per visit. */
export const TOKEN_CAP_SHOWN_KEY_PREFIX = 'habitai_token_cap_shown:';
/**
 * The Android background reminder sync's token (hooks/app-state/reminder-sync.ts) and the last
 * state time the server told it, so a time it was told already is not fetched again.
 */
const SYNC_TOKEN_KEY_PREFIX = 'habitai_state_sync:';

export type StoredSyncToken = StateSyncToken & { seenVersion?: number | null };

export async function loadSyncToken(email: string): Promise<StoredSyncToken | null> {
  try {
    const raw = await AsyncStorage.getItem(`${SYNC_TOKEN_KEY_PREFIX}${email}`);
    const stored = raw ? JSON.parse(raw) as StoredSyncToken : null;
    return stored && typeof stored.token === 'string' && typeof stored.expiresAt === 'number' ? stored : null;
  } catch {
    return null;
  }
}

export async function saveSyncToken(email: string, stored: StoredSyncToken | null) {
  if (!email) return;
  const key = `${SYNC_TOKEN_KEY_PREFIX}${email}`;
  await (stored ? AsyncStorage.setItem(key, JSON.stringify(stored)) : AsyncStorage.removeItem(key)).catch(() => undefined);
}

export async function loadSyncMeta(email: string): Promise<{ base: AppStateSyncBase | null; unsaved: boolean }> {
  try {
    const [rawBase, unsaved] = await Promise.all([
      AsyncStorage.getItem(`${BASE_KEY_PREFIX}${email}`),
      AsyncStorage.getItem(`${UNSAVED_KEY_PREFIX}${email}`),
    ]);
    const base = rawBase ? JSON.parse(rawBase) as AppStateSyncBase : null;
    return { base: base && typeof base.updatedAt === 'number' && base.state ? base : null, unsaved: unsaved === '1' };
  } catch {
    return { base: null, unsaved: false };
  }
}

export function persistSyncBase(email: string, base: AppStateSyncBase | null) {
  if (!email) return;
  const key = `${BASE_KEY_PREFIX}${email}`;
  void (base ? AsyncStorage.setItem(key, JSON.stringify(base)) : AsyncStorage.removeItem(key)).catch(() => undefined);
}

export function persistUnsaved(email: string, unsaved: boolean) {
  if (!email) return;
  const key = `${UNSAVED_KEY_PREFIX}${email}`;
  void (unsaved ? AsyncStorage.setItem(key, '1') : AsyncStorage.removeItem(key)).catch(() => undefined);
}

/**
 * Signing out (a shared or school computer, say): remove the account's saved copy from this
 * device. Changes that have not reached the server yet are kept, so they are not lost; they are
 * sent the next time this account signs in here.
 */
export async function forgetAccountOnDevice(email: string) {
  if (!email) return;
  try {
    // Signed out, this device no longer asks for the account's state in the background.
    await AsyncStorage.removeItem(`${SYNC_TOKEN_KEY_PREFIX}${email}`);
    if ((await AsyncStorage.getItem(`${UNSAVED_KEY_PREFIX}${email}`)) === '1') return;
    await Promise.all([APP_STATE_KEY_PREFIX, BASE_KEY_PREFIX, TOKEN_CAP_SHOWN_KEY_PREFIX].map((prefix) => AsyncStorage.removeItem(`${prefix}${email}`)));
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

export function clearSyncMeta(email: string) {
  persistSyncBase(email, null);
  persistUnsaved(email, false);
}
