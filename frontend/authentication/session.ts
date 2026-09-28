import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
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

export type StoredUser = {
  fullName: string;
  email: string;
};

export type SessionUser = {
  id?: string;
  fullName: string;
  username?: string;
  email: string;
  region?: string;
  dateOfBirth?: string;
  gender?: string;
  about?: string;
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

export async function readSavedAccounts(): Promise<StoredUser[]> {
  try {
    await purgeLegacyCredentialStorage();
    return [];
  } catch {
    return [];
  }
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

function isLocalUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function isLocalWebHost() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isAllowedLocalWebApiUrl(value: string) {
  return isLocalWebHost() && isLocalUrl(value);
}

function isPlaceholderUrl(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.includes('replace-with')
    || normalized.includes('your-')
    || normalized.includes('your_')
    || normalized.includes('@example.')
    || normalized.includes('example.com')
    || normalized.includes('localhost')
    || normalized.includes('127.0.0.1')
    || normalized.includes('::1');
}

function getApiBaseUrl() {
  const envUrl = (process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_AI_API_URL)?.trim();
  if (envUrl) {
    const hasInvalidProductionUrl = !envUrl.startsWith('https://') || isPlaceholderUrl(envUrl) || isLocalUrl(envUrl);
    if (process.env.NODE_ENV === 'production' && hasInvalidProductionUrl && !isAllowedLocalWebApiUrl(envUrl)) {
      throw new Error('Production API is not configured. Set EXPO_PUBLIC_API_URL to the deployed backend URL.');
    }
    return envUrl.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    if (isLocalWebHost()) {
      return `http://${window.location.hostname}:8787`;
    }
    throw new Error('Production API is not configured. Set EXPO_PUBLIC_API_URL to the deployed backend URL.');
  }

  if (Platform.OS === 'web') {
    const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
    return `http://${host}:8787`;
  }

  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:8787`;
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8787';
  }

  return 'http://localhost:8787';
}

function isValidEmailFormat(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError;
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const rawBody = await response.text();
  let payload: unknown = {};

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = rawBody;
    }
  }

  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : typeof payload === 'string' && payload.trim()
        ? payload.trim()
        : 'Request failed.';
    throw new ApiRequestError(message, response.status);
  }

  return payload as T;
}

export async function requestPasswordReset(email: string) {
  const normalizedEmail = email.trim();
  if (!normalizedEmail || !isValidEmailFormat(normalizedEmail)) {
    return { ok: false, message: 'Please enter a valid email address.' };
  }

  try {
    const payload = await apiRequest<{ ok: boolean; message?: string; email?: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: normalizedEmail }),
    });

    return {
      ok: payload.ok,
      message: payload.message || 'A verification code was sent to your email.',
      email: payload.email || normalizedEmail,
    };
  } catch (error) {
    if (isNetworkError(error)) {
      return { ok: false, message: 'Unable to reach the account service. Connect to the internet and try again.' };
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to process your password reset request.',
    };
  }
}

export async function verifyResetCode(email: string, otp: string) {
  const normalizedEmail = email.trim();
  const normalizedOtp = otp.trim();

  if (!normalizedEmail || !normalizedOtp) {
    return { ok: false, message: 'Please enter the OTP and email address.' };
  }

  try {
    const payload = await apiRequest<{ ok: boolean; message?: string }>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: normalizedEmail, otp: normalizedOtp }),
    });

    return {
      ok: payload.ok,
      message: payload.message || 'OTP verified successfully.',
    };
  } catch (error) {
    if (isNetworkError(error)) {
      return { ok: false, message: 'Password reset requires a connection to the account service.' };
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to verify the reset code.',
    };
  }
}

export async function completePasswordReset(email: string, otp: string, newPassword: string) {
  const normalizedEmail = email.trim();
  const normalizedOtp = otp.trim();

  if (!normalizedEmail || !normalizedOtp || !newPassword.trim()) {
    return { ok: false, message: 'Please provide the email, OTP, and new password.' };
  }

  try {
    const payload = await apiRequest<{ ok: boolean; message?: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: normalizedEmail, otp: normalizedOtp, newPassword }),
    });

    return {
      ok: payload.ok,
      message: payload.message || 'Your password has been reset successfully.',
    };
  } catch (error) {
    if (isNetworkError(error)) {
      return { ok: false, message: 'Unable to reach the account service. Connect to the internet and try again.' };
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to reset your password.',
    };
  }
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

export async function saveNewAccount(user: { fullName: string; email: string; password: string }) {
  return { ok: false, message: 'Connect to the account service to create your account.' };
}

export async function loginWithStoredAccount(email: string, password: string) {
  return { ok: false, message: 'Connect to the account service to sign in.' };
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
