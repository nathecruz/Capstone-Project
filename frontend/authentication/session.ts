// Local session storage only. All network calls live in authService.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SESSION_KEY = 'habitai_session';
const SESSION_TOKEN_KEY = 'habitai_session_token';
const ACCOUNTS_KEY = 'habitai_accounts';
const REMEMBERED_EMAIL_KEY = 'habitai_remembered_email';
const PASSWORD_RESET_KEY = 'habitai_password_reset';

function isWebSessionAvailable(): boolean {
  return Platform.OS === 'web';
}

function getWebSessionStorage(): Storage | null {
  if (!isWebSessionAvailable() || typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export type SessionUser = {
  id?: string;
  fullName: string;
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

    return {
      id: parsed.id ? String(parsed.id) : undefined,
      fullName: String(parsed.fullName),
      username: parsed.username ? String(parsed.username) : undefined,
      email: String(parsed.email),
      region: parsed.region ? String(parsed.region) : '',
      dateOfBirth: parsed.dateOfBirth ? String(parsed.dateOfBirth) : '',
      gender: parsed.gender ? String(parsed.gender) : '',
      about: parsed.about ? String(parsed.about) : '',
      emailVerified: typeof parsed.emailVerified === 'boolean' ? parsed.emailVerified : undefined,
      privacyConsentAt: typeof parsed.privacyConsentAt === 'number' || parsed.privacyConsentAt === null ? parsed.privacyConsentAt : undefined,
    };
  } catch {
    return null;
  }
}

export async function saveSessionToken(token: string, user: SessionUser) {
  const webStorage = getWebSessionStorage();
  if (isWebSessionAvailable() && webStorage) {
    webStorage.setItem(SESSION_TOKEN_KEY, token);
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
      const webStorage = getWebSessionStorage();
      const sessionToken = webStorage?.getItem(SESSION_TOKEN_KEY);
      if (sessionToken) return sessionToken;

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
  const webStorage = getWebSessionStorage();
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
  } catch {
    // Continue clearing the remaining session data.
  }

  const cleanup = [
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
