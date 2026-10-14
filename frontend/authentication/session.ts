// Local session storage only. All network calls live in authService.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { forgetAccountOnDevice } from '@/hooks/app-state/sync-storage';

const SESSION_KEY = 'habitai_session';
const SESSION_TOKEN_KEY = 'habitai_session_token';
const ACCOUNTS_KEY = 'habitai_accounts';
const REMEMBERED_EMAIL_KEY = 'habitai_remembered_email';
const PASSWORD_RESET_KEY = 'habitai_password_reset';

function isWebSessionAvailable(): boolean {
  return Platform.OS === 'web';
}

/**
 * An installed/standalone PWA (Add to Home Screen): its session should persist so a student stays
 * signed in across launches and the app works offline. A normal browser tab stays ephemeral — the
 * token lives in sessionStorage and clears when the tab closes, which suits a shared/school computer.
 */
function isInstalledPwa(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true;
    return (window.navigator as { standalone?: boolean } | undefined)?.standalone === true;
  } catch {
    return false;
  }
}

/**
 * Where the web session token lives: localStorage for an installed PWA (persists across launches, so
 * it works offline after one online sign-in), sessionStorage for a normal tab. `other` is the one not
 * in use, so a token left there (e.g. before the app was installed) can be migrated and cleared.
 */
function getWebTokenStorages(): { active: Storage | null; other: Storage | null } {
  if (!isWebSessionAvailable() || typeof window === 'undefined') return { active: null, other: null };
  let local: Storage | null = null;
  let session: Storage | null = null;
  try { local = window.localStorage ?? null; } catch { local = null; }
  try { session = window.sessionStorage ?? null; } catch { session = null; }
  if (isInstalledPwa()) return { active: local ?? session, other: local ? session : null };
  return { active: session, other: local };
}

export type SessionUser = {
  id?: string;
  /** "First Last"; kept for older sessions and screens that show the whole name. */
  fullName: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  email: string;
  region?: string;
  dateOfBirth?: string;
  gender?: string;
  about?: string;
  /** false until the sign-up email is confirmed (undefined for sessions saved by older app versions). */
  emailVerified?: boolean;
  /** null when the account has not accepted the Privacy Notice yet. */
  privacyConsentAt?: number | null;
  /** 'faculty' turns on Faculty mode; older sessions have no role and count as students. */
  role?: 'user' | 'faculty' | 'admin';
};

export type SessionRecord = {
  token: string;
  user: SessionUser;
};

async function purgeLegacyCredentialStorage() {
  await Promise.all([
    AsyncStorage.removeItem(ACCOUNTS_KEY),
    AsyncStorage.removeItem(PASSWORD_RESET_KEY),
  ]);
}

export async function getRememberedEmail(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(REMEMBERED_EMAIL_KEY)) ?? '';
  } catch {
    return '';
  }
}

export async function setRememberedEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    await AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY);
    return;
  }

  await AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, normalizedEmail);
}

type AuthListener = () => void;
const authListeners = new Set<AuthListener>();

export function subscribeToAuthChanges(listener: AuthListener) {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

function notifyAuthListeners() {
  authListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore listener errors so auth state changes remain resilient.
    }
  });
}

export async function getCurrentSession(): Promise<SessionUser | null> {
  try {
    await purgeLegacyCredentialStorage();
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<SessionUser>;
    if (!parsed?.email || !parsed?.fullName) {
      return null;
    }
    // A system admin session (from before admins were refused) does not open the app.
    if (parsed.role === 'admin') {
      return null;
    }

    return {
      id: parsed.id ? String(parsed.id) : undefined,
      fullName: String(parsed.fullName),
      firstName: parsed.firstName ? String(parsed.firstName) : undefined,
      lastName: parsed.lastName ? String(parsed.lastName) : undefined,
      username: parsed.username ? String(parsed.username) : undefined,
      email: String(parsed.email),
      region: parsed.region ? String(parsed.region) : '',
      dateOfBirth: parsed.dateOfBirth ? String(parsed.dateOfBirth) : '',
      gender: parsed.gender ? String(parsed.gender) : '',
      about: parsed.about ? String(parsed.about) : '',
      emailVerified: typeof parsed.emailVerified === 'boolean' ? parsed.emailVerified : undefined,
      privacyConsentAt: typeof parsed.privacyConsentAt === 'number' || parsed.privacyConsentAt === null ? parsed.privacyConsentAt : undefined,
      role: parsed.role === 'faculty' ? 'faculty' : 'user',
    };
  } catch {
    return null;
  }
}

export async function saveSessionToken(token: string, user: SessionUser) {
  const { active: webStorage, other: otherWebStorage } = getWebTokenStorages();
  if (isWebSessionAvailable() && webStorage) {
    webStorage.setItem(SESSION_TOKEN_KEY, token);
    // Don't leave a copy in the other web storage (e.g. sessionStorage from before the app was installed).
    try { otherWebStorage?.removeItem(SESSION_TOKEN_KEY); } catch { /* storage unavailable */ }
    await AsyncStorage.removeItem(SESSION_TOKEN_KEY);
  } else if (isWebSessionAvailable()) {
    await AsyncStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
    await AsyncStorage.removeItem(SESSION_TOKEN_KEY);
  }
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(user));
  notifyAuthListeners();
}

export async function getSessionToken(): Promise<string> {
  try {
    if (isWebSessionAvailable()) {
      const { active: webStorage, other: otherWebStorage } = getWebTokenStorages();
      const activeToken = webStorage?.getItem(SESSION_TOKEN_KEY);
      if (activeToken) return activeToken;

      // A token left in the other web storage (e.g. saved in sessionStorage before the app was
      // installed as a PWA) moves into the active one so it persists from now on.
      const otherToken = otherWebStorage?.getItem(SESSION_TOKEN_KEY);
      if (otherToken && webStorage) {
        webStorage.setItem(SESSION_TOKEN_KEY, otherToken);
        try { otherWebStorage?.removeItem(SESSION_TOKEN_KEY); } catch { /* storage unavailable */ }
        return otherToken;
      }
      if (otherToken) return otherToken;

      const legacyToken = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
      if (legacyToken && webStorage) {
        webStorage.setItem(SESSION_TOKEN_KEY, legacyToken);
        await AsyncStorage.removeItem(SESSION_TOKEN_KEY);
      }
      return legacyToken ?? '';
    }

    const secureToken = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
    if (secureToken) {
      return secureToken;
    }

    const legacyToken = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
    if (legacyToken) {
      await SecureStore.setItemAsync(SESSION_TOKEN_KEY, legacyToken);
      await AsyncStorage.removeItem(SESSION_TOKEN_KEY);
      return legacyToken;
    }

    return '';
  } catch {
    return '';
  }
}

export async function logoutUser() {
  const { active: webStorage, other: otherWebStorage } = getWebTokenStorages();
  const signedOutEmail = (await getCurrentSession().catch(() => null))?.email.trim().toLowerCase() ?? '';
  if (isWebSessionAvailable() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
    } catch {
      // Continue clearing the session if browser push cleanup is unavailable.
    }
  }
  try {
    webStorage?.removeItem(SESSION_TOKEN_KEY);
    otherWebStorage?.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Continue clearing the remaining session data.
  }

  const cleanup = [
    forgetAccountOnDevice(signedOutEmail),
    AsyncStorage.removeItem(SESSION_KEY),
    AsyncStorage.removeItem(SESSION_TOKEN_KEY),
    AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY),
  ];
  if (!isWebSessionAvailable()) {
    cleanup.push(SecureStore.deleteItemAsync(SESSION_TOKEN_KEY));
  }
  await Promise.allSettled(cleanup);
  notifyAuthListeners();
}
