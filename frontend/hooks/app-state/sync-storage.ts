// Device-side sync bookkeeping, kept per account next to the saved app state:
//   - the base: the last state the server confirmed, so a later save can be merged on the
//     server (3-way) even when the app started offline or during a server cold start;
//   - the unsaved flag: local changes that have not reached the server yet, so they are
//     merged instead of being replaced by the server copy on the next launch.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppStateSyncBase } from '@/authentication/authService';

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

export function clearSyncMeta(email: string) {
  persistSyncBase(email, null);
  persistUnsaved(email, false);
}
