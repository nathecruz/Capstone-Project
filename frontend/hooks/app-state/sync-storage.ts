// Device-side sync bookkeeping, kept per account next to the saved app state:
//   - the base: the last state the server confirmed, so a later save can be merged on the
//     server (3-way) even when the app started offline or during a server cold start;
//   - the unsaved flag: local changes that have not reached the server yet, so they are
//     merged instead of being replaced by the server copy on the next launch.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppStateSyncBase } from '@/authentication/authService';

/** The account's saved copy of its habits and settings, for a quick start and offline use. */
export const APP_STATE_KEY_PREFIX = 'habitai_app_state:';
const BASE_KEY_PREFIX = 'habitai_sync_base:';
const UNSAVED_KEY_PREFIX = 'habitai_unsaved:';

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
    if ((await AsyncStorage.getItem(`${UNSAVED_KEY_PREFIX}${email}`)) === '1') return;
    await Promise.all([AsyncStorage.removeItem(`${APP_STATE_KEY_PREFIX}${email}`), AsyncStorage.removeItem(`${BASE_KEY_PREFIX}${email}`)]);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

export function clearSyncMeta(email: string) {
  persistSyncBase(email, null);
  persistUnsaved(email, false);
}
