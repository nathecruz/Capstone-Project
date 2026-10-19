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
const KEEP_SIGNED_IN_KEY = 'habitai_keep_signed_in';

function isWebSessionAvailable(): boolean {
  return Platform.OS === 'web';
}

/**
 * An installed/standalone PWA (Add to Home Screen): its session persists so a student stays signed
 * in across launches. A normal browser tab stays ephemeral — the token lives in sessionStorage and
 * clears when the tab closes, which suits a shared/school computer — unless "Remember me" was ticked.
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

function browserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return window[kind] ?? null;
  } catch {
    return null;
  }
}

/** "Remember me" on a web sign-in: the phone browser keeps the session after its tab is closed. */
function keepsWebSignIn(local: Storage | null) {
  try {
    return local?.getItem(KEEP_SIGNED_IN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * A web sign-in is one of two kinds. A lasting one (the installed app, or "Remember me") keeps its
 * token in localStorage with the keep flag: it outlives the tab (mobile browsers also discard
 * background tabs, which emptied sessionStorage and signed the student out) and is shared by every tab
 * and the installed app. A tab sign-in keeps its token in that tab's sessionStorage and ends with the
 * tab, which suits a shared or school computer. A tab's own sign-in comes first, so a sign-in with
 * Remember me in another tab never moves a tab that is already signed in onto another account.
 */
function readWebToken(): string {
  const local = browserStorage('localStorage');
  const session = browserStorage('sessionStorage');
  const tabToken = session?.getItem(SESSION_TOKEN_KEY);
  if (tabToken) {
    if (isInstalledPwa() && local) {
      // Signed in in the browser before the app was installed: the installed app keeps it from now on.
      try {
        local.setItem(SESSION_TOKEN_KEY, tabToken);
        local.setItem(KEEP_SIGNED_IN_KEY, '1');
        session?.removeItem(SESSION_TOKEN_KEY);
      } catch {
        // It still works for this launch.
      }
    }
    return tabToken;
  }
  const savedToken = local?.getItem(SESSION_TOKEN_KEY);
  if (!savedToken) return '';
  // A token in localStorage without the keep flag was saved for a tab by an older version: it moves
  // into this tab only. One the installed app or Remember me saved stays where every tab (and the
  // installed app, which shares this storage with Chrome on Android) can find it.
  if (!keepsWebSignIn(local) && !isInstalledPwa() && session) {
    try {
      session.setItem(SESSION_TOKEN_KEY, savedToken);
      local?.removeItem(SESSION_TOKEN_KEY);
    } catch {
      // It still works for this tab.
    }
  }
  return savedToken;
}

/** Saves a web token as a lasting sign-in or a tab sign-in (see readWebToken); false if storage refused it. */
function writeWebToken(token: string, persist: boolean | undefined): boolean {
  const local = browserStorage('localStorage');
  const session = browserStorage('sessionStorage');
  // Left out (a refreshed profile, for example): the same kind as the current sign-in.
  const lasting = isInstalledPwa() || (persist ?? (!session?.getItem(SESSION_TOKEN_KEY) && keepsWebSignIn(local)));
  try {
    if (lasting && local) {
      local.setItem(SESSION_TOKEN_KEY, token);
      local.setItem(KEEP_SIGNED_IN_KEY, '1');
      session?.removeItem(SESSION_TOKEN_KEY);
      return true;
    }
    if (session) {
      // A lasting sign-in someone made earlier in this browser is left alone: this tab uses its own.
      session.setItem(SESSION_TOKEN_KEY, token);
      return true;
    }
  } catch {
    // Storage full or blocked.
  }
  return false;
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

/**
 * Saves the session. `persist` (the web sign-in's "Remember me") keeps a browser session after its
 * tab is closed; leaving it out keeps the choice made at sign-in (a refreshed profile, for example).
 */
export async function saveSessionToken(token: string, user: SessionUser, { persist }: { persist?: boolean } = {}) {
  if (isWebSessionAvailable()) {
    // Not through AsyncStorage: on the web it IS localStorage, under the same key, and its cleanup
    // deleted the token the installed app had just saved there, so every sign-in on a phone's Home
    // Screen app ended back on the sign-in screen. It only takes the token when storage refused it.
    if (!writeWebToken(token, persist)) await AsyncStorage.setItem(SESSION_TOKEN_KEY, token);
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
      return readWebToken() || (await AsyncStorage.getItem(SESSION_TOKEN_KEY)) || '';
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
  if (isWebSessionAvailable() && typeof window !== 'undefined') {
    // Signing out ends this browser's sign-ins: this tab's and a lasting one (Remember me, installed app).
    for (const storage of [browserStorage('sessionStorage'), browserStorage('localStorage')]) {
      try {
        storage?.removeItem(SESSION_TOKEN_KEY);
        storage?.removeItem(KEEP_SIGNED_IN_KEY);
      } catch {
        // Continue clearing the remaining session data.
      }
    }
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
