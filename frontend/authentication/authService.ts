import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
// The app's single API client: every backend request goes through apiRequest below.
// session.ts only stores the session token and profile on the device.
import {
  getCurrentSession,
  getRememberedEmail,
  getSessionToken,
  logoutUser,
  saveSessionToken,
  setRememberedEmail,
  subscribeToAuthChanges,
  type SessionUser,
} from './session';

export {
  getCurrentSession,
  getRememberedEmail,
  logoutUser,
  setRememberedEmail,
  subscribeToAuthChanges,
};

export type { SessionUser };

export type AppStateSyncPayload = {
  avatarImage: string | null;
  profile: object;
  preferences: object;
  habits: object[];
  points: number;
  tokens: number;
  tokenHistory: object[];
  darkModeOverride: boolean | null;
  ringInterval: number;
  snoozeFrequency: string;
  goals?: object[];
};

export type AppStateSyncBase = {
  updatedAt: number;
  state: AppStateSyncPayload;
};

export type HabitCompletion = { habitId: string; date: string };

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

let lastWarmUpAt = 0;

/**
 * Starts waking the free backend as soon as a sign-in screen opens. It sleeps after 15 idle
 * minutes and then needs up to a minute, so without this the user's first sign-in or
 * reset-code request carries the whole wake-up. Fire and forget: errors are ignored.
 */
export function warmUpServer(now = Date.now()) {
  if (now - lastWarmUpAt < 60_000) return;
  lastWarmUpAt = now;
  try {
    void fetch(`${getApiBaseUrl()}/healthz`).catch(() => undefined);
  } catch {
    // No API configured: there is nothing to wake.
  }
}

export function getApiBaseUrl() {
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

function isValidSessionUser(value: unknown): value is SessionUser {
  if (typeof value !== 'object' || value === null) return false;
  const user = value as Partial<SessionUser>;
  return typeof user.id === 'string'
    && Boolean(user.id.trim())
    && typeof user.fullName === 'string'
    && Boolean(user.fullName.trim())
    && typeof user.email === 'string'
    && isValidEmailFormat(user.email);
}

export class ApiRequestError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(message: string, status: number, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.payload = payload;
  }
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && error.name === 'AbortError');
}

// Long enough for a sleeping free-tier server to start (the banner explains the wait).
const DEFAULT_TIMEOUT_MS = 60000;
// Free hosting puts the API to sleep; the first request after that can take ~30-60 s.
const SLOW_REQUEST_MS = 4000;
export type ServerStatus = 'ok' | 'waking';
const serverStatusListeners = new Set<(status: ServerStatus) => void>();
let slowRequests = 0;

/** Notifies when requests are unusually slow (server waking up) and when they recover. */
export function subscribeToServerStatus(listener: (status: ServerStatus) => void) {
  serverStatusListeners.add(listener);
  return () => {
    serverStatusListeners.delete(listener);
  };
}

function setSlowRequests(delta: number) {
  const before = slowRequests;
  slowRequests = Math.max(0, slowRequests + delta);
  if ((before === 0) !== (slowRequests === 0)) {
    serverStatusListeners.forEach((listener) => listener(slowRequests > 0 ? 'waking' : 'ok'));
  }
}

export async function apiRequest<T>(path: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let markedSlow = false;
  const slowTimer = setTimeout(() => {
    markedSlow = true;
    setSlowRequests(1);
  }, SLOW_REQUEST_MS);
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(slowTimer);
    if (markedSlow) setSlowRequests(-1);
  }

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
    const body = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
    const message = typeof body.message === 'string'
      ? body.message
      : typeof body.error === 'string'
        ? body.error
        : typeof payload === 'string' && payload.trim()
          ? payload.trim()
          : 'Request failed.';
    throw new ApiRequestError(message, response.status, body);
  }

  return payload as T;
}

export async function signUp(user: { firstName: string; lastName: string; username: string; email: string; password: string; dateOfBirth: string; gender: string; region: string; privacyConsent: boolean }) {
  const email = user.email.trim();
  if (!isValidEmailFormat(email)) {
    return { ok: false, message: 'Please enter a valid email address.' };
  }

  try {
    const payload = await apiRequest<{ ok: boolean; message?: string; token?: string; user?: SessionUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        firstName: user.firstName.trim(),
        lastName: user.lastName.trim(),
        username: user.username.trim(),
        email,
        password: user.password,
        dateOfBirth: user.dateOfBirth.trim(),
        gender: user.gender.trim(),
        region: user.region.trim(),
        privacyConsent: user.privacyConsent,
      }),
    });

    if (!payload.ok) {
      return { ok: false, message: payload.message || 'Unable to create account.' };
    }

    if (!payload.token || !isValidSessionUser(payload.user)) {
      return { ok: false, message: 'The account service returned an incomplete registration response.' };
    }
    await saveSessionToken(payload.token, payload.user);

    return { ok: true, message: payload.message || 'Account created successfully.', user: payload.user };
  } catch (error) {
    if (isNetworkError(error)) {
      return { ok: false, message: 'Unable to reach the account service. Connect to the internet and try again.' };
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to create account.',
    };
  }
}

export async function signIn(email: string, password: string) {
  const normalizedEmail = email.trim();
  if (!isValidEmailFormat(normalizedEmail)) {
    return { ok: false, message: 'Please enter a valid email address.' };
  }

  try {
    const payload = await apiRequest<{ ok: boolean; message?: string; token?: string; user?: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: normalizedEmail, password, device: getDeviceLabel() }),
    });

    if (!payload.ok) {
      return { ok: false, message: payload.message || 'Incorrect email or password.' };
    }

    if (!payload.token || !isValidSessionUser(payload.user)) {
      return { ok: false, message: 'The account service returned an incomplete sign-in response.' };
    }
    await saveSessionToken(payload.token, payload.user);

    return { ok: true, message: payload.message || 'Login successful.', user: payload.user };
  } catch (error) {
    if (isNetworkError(error)) {
      return { ok: false, message: 'Unable to reach the account service. Connect to the internet and try again.' };
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to sign in.',
    };
  }
}

function getDeviceLabel() {
  const model = Device.modelName || Device.deviceName || (Platform.OS === 'web' ? 'Web browser' : `${Platform.OS} device`);
  const operatingSystem = Device.osName || Platform.OS;
  const version = Device.osVersion || String(Platform.Version);
  return `${model} (${operatingSystem} ${version})`;
}

export async function signOut() {
  const token = await getSessionToken();

  if (token) {
    try {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token }),
      });
    } catch {
      // Fall through to clearing local session state.
    }
  }

  await logoutUser();
}

export async function getSession() {
  const session = await getCurrentSession();
  const token = await getSessionToken();
  if (!session || !token) {
    return null;
  }

  try {
    const payload = await apiRequest<{ ok: boolean; user?: SessionUser }>('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!payload.ok || !isValidSessionUser(payload.user)) {
      await logoutUser();
      return null;
    }
    return payload.user;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      await logoutUser();
      return null;
    }

    // Offline or server asleep: keep the saved session instead of signing the student out.
    return session;
  }
}

async function refreshStoredUser(user: SessionUser | undefined) {
  const token = await getSessionToken();
  if (token && user && isValidSessionUser(user)) await saveSessionToken(token, user);
}

export async function verifyEmailCode(otp: string) {
  try {
    const payload = await apiRequest<{ ok: boolean; message?: string; user?: SessionUser }>('/api/auth/email/verify', {
      method: 'POST',
      headers: await getAuthenticatedHeaders(),
      body: JSON.stringify({ otp: otp.trim() }),
    });
    await refreshStoredUser(payload.user);
    return { ok: true, message: payload.message || 'Email confirmed.' };
  } catch (error) {
    if (isNetworkError(error)) return { ok: false, message: 'Unable to reach the account service. Connect to the internet and try again.' };
    const payload = error instanceof ApiRequestError ? error.payload : {};
    return { ok: false, message: error instanceof Error ? error.message : 'Unable to verify the code.', attemptsLeft: typeof payload.attemptsLeft === 'number' ? payload.attemptsLeft : undefined };
  }
}

export async function resendEmailVerification() {
  try {
    const payload = await apiRequest<{ ok: boolean; message?: string; retryAfterSeconds?: number; alreadyVerified?: boolean }>('/api/auth/email/resend', {
      method: 'POST',
      headers: await getAuthenticatedHeaders(),
      body: JSON.stringify({}),
    });
    return { ok: true, message: payload.message || 'A new code was sent.', retryAfterSeconds: payload.retryAfterSeconds ?? 60, alreadyVerified: Boolean(payload.alreadyVerified) };
  } catch (error) {
    if (isNetworkError(error)) return { ok: false, message: 'Unable to reach the account service. Connect to the internet and try again.' };
    const payload = error instanceof ApiRequestError ? error.payload : {};
    return { ok: false, message: error instanceof Error ? error.message : 'Unable to send a new code.', retryAfterSeconds: typeof payload.retryAfterSeconds === 'number' ? payload.retryAfterSeconds : undefined };
  }
}

/** Records that the student accepted the Privacy Notice (accounts created before it existed). */
export async function acceptPrivacyNotice() {
  try {
    const payload = await apiRequest<{ ok: boolean; user?: SessionUser }>('/api/auth/consent', {
      method: 'POST',
      headers: await getAuthenticatedHeaders(),
      body: JSON.stringify({ accepted: true }),
    });
    await refreshStoredUser(payload.user);
    return { ok: true, message: 'Thank you.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unable to save your choice.' };
  }
}

export async function redeemReward(reward: { id: string; title: string; cost: number }) {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'You are not signed in.', forwarded: false };
  try {
    return await apiRequest<{ ok: boolean; tokens?: number; tokenHistory?: object[]; points?: number; message?: string }>('/api/rewards/redeem', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rewardId: reward.id, rewardName: reward.title, tokenCost: reward.cost }),
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unable to redeem this reward.' };
  }
}

export type HabitCategory = { label: string; icon: string; color: string };

/** Active habit categories managed from the HabitAI Admin Panel, or null when the backend is unreachable. */
export async function getHabitCategories() {
  try {
    const payload = await apiRequest<{ ok: boolean; categories?: HabitCategory[] }>('/api/habit-categories');
    return (payload.categories ?? []).filter((item) => item && typeof item.label === 'string' && item.label.trim());
  } catch {
    return null;
  }
}

export async function getPersistedNotifications() {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const payload = await apiRequest<{ ok: boolean; notifications?: object[] }>('/api/notifications', { headers: { Authorization: `Bearer ${token}` } });
    return payload.notifications ?? [];
  } catch {
    return null;
  }
}

export async function markPersistedNotification(id: string, read: boolean) {
  const token = await getSessionToken();
  if (!token) return false;
  try {
    await apiRequest(`/api/notifications/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ read }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function submitFeatureSuggestion(suggestion: string) {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'You are not signed in.' };
  try {
    return await apiRequest<{ ok: boolean; message?: string }>('/api/support/suggestions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ suggestion }),
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unable to submit your suggestion.' };
  }
}

export async function rememberEmail(email: string) {
  await setRememberedEmail(email);
}

export async function getAuthenticatedHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getWebPushVapidPublicKey() {
  try {
    const payload = await apiRequest<{ ok: boolean; publicKey?: string }>('/api/web-push/public-key');
    return payload.publicKey || null;
  } catch {
    return null;
  }
}

export async function saveWebPushSubscription(
  subscription: { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } },
  timeZone: string,
) {
  const token = await getSessionToken();
  if (!token) return false;
  try {
    await apiRequest('/api/web-push/subscriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subscription, timeZone }),
    });
    return true;
  } catch {
    return false;
  }
}

export type RemoteAppState = {
  ok: boolean;
  /** True when nothing changed since `since`; state and completions are then omitted. */
  unchanged?: boolean;
  state?: AppStateSyncPayload | null;
  updatedAt?: number | null;
  completions?: HabitCompletion[];
};

/**
 * Fetches the synced state. Pass the last known `updatedAt` as `since` to poll cheaply:
 * the server answers `{ unchanged: true }` unless another device saved something newer.
 */
export async function getRemoteAppState(since?: number | null) {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const query = since ? `?since=${encodeURIComponent(String(since))}` : '';
    return await apiRequest<RemoteAppState>(`/api/app-state${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
}

export async function updateAuthenticatedProfile(profile: { firstName: string; lastName: string; username: string; email: string; dateOfBirth: string; gender: string; about: string }) {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'You are not signed in.' };

  try {
    const payload = await apiRequest<{ ok: boolean; message?: string; user?: SessionUser }>('/api/auth/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(profile),
    });
    if (payload.ok && payload.user) {
      await saveSessionToken(token, payload.user);
    }
    return { ok: payload.ok, message: payload.message, user: payload.user };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unable to update your profile.' };
  }
}

export async function saveRemoteAppState(state: AppStateSyncPayload, base: AppStateSyncBase | null) {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    return await apiRequest<{ ok: boolean; state?: AppStateSyncPayload; updatedAt?: number; merged?: boolean; unchanged?: boolean }>('/api/app-state', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...state,
        clientUpdatedAt: Date.now(),
        baseUpdatedAt: base?.updatedAt ?? null,
        baseState: base?.state ?? null,
      }),
    });
  } catch {
    return null;
  }
}

export async function getRemoteHabitCompletions() {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const payload = await apiRequest<{ ok: boolean; completions?: HabitCompletion[] }>('/api/habit-completions', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return payload.completions ?? [];
  } catch {
    return null;
  }
}

export async function saveRemoteHabitCompletion(completion: HabitCompletion & { completed: boolean }) {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await apiRequest<{ ok: boolean; updatedAt?: number; state?: AppStateSyncPayload; completions?: HabitCompletion[]; points?: number; tokens?: number; tokenHistory?: object[]; habit?: { id: string; streak: number; done: boolean } | null }>('/api/habit-completions', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...completion, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
    });
  } catch {
    return null;
  }
}

export async function submitIssueReport(report: {
  topic: string;
  timing: string;
  description: string;
  attachment?: { uri: string; name: string; type?: string | null };
}) {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'You are not signed in.' };

  try {
    const formData = new FormData();
    formData.append('topic', report.topic);
    formData.append('timing', report.timing);
    formData.append('description', report.description);
    if (report.attachment) {
      formData.append('attachment', {
        uri: report.attachment.uri,
        name: report.attachment.name,
        type: report.attachment.type || 'application/octet-stream',
      } as unknown as Blob);
    }
    const response = await fetch(`${getApiBaseUrl()}/api/support/reports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiRequestError(payload?.message || 'Request failed.', response.status);
    return { ok: payload.ok, message: payload.message, forwarded: payload.forwarded === true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unable to submit your report.', forwarded: false };
  }
}

export type LoginActivity = {
  device: string;
  createdAt: number;
};

export async function getLoginActivity() {
  const token = await getSessionToken();
  if (!token) {
    return { ok: false, activities: [] as LoginActivity[], message: 'You are not signed in.' };
  }

  try {
    const payload = await apiRequest<{ ok: boolean; activities?: LoginActivity[]; message?: string }>('/api/auth/login-activity', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { ok: payload.ok, activities: payload.activities ?? [], message: payload.message };
  } catch (error) {
    return { ok: false, activities: [] as LoginActivity[], message: error instanceof Error ? error.message : 'Unable to load login activity.' };
  }
}

export async function clearRememberedEmail() {
  await setRememberedEmail('');
}

export async function resetPassword(email: string) {
  const normalizedEmail = email.trim();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, message: 'Please enter a valid email address.' };
  }

  try {
    const payload = await apiRequest<{ ok: boolean; message?: string; email?: string; expiresInSeconds?: number; retryAfterSeconds?: number }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: normalizedEmail }),
    });

    return {
      ok: payload.ok,
      message: payload.message || 'A verification code was sent to your email.',
      email: payload.email || normalizedEmail,
      expiresInSeconds: payload.expiresInSeconds ?? 600,
      retryAfterSeconds: payload.retryAfterSeconds ?? 60,
    };
  } catch (error) {
    if (isNetworkError(error)) {
      return { ok: false, message: 'Unable to reach the account service. Connect to the internet and try again.' };
    }
    const retryAfterSeconds = error instanceof ApiRequestError && typeof error.payload.retryAfterSeconds === 'number' ? error.payload.retryAfterSeconds : undefined;
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to connect to the account service.',
      retryAfterSeconds,
    };
  }
}

export async function verifyPasswordReset(email: string, otp: string) {
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

    const payload = error instanceof ApiRequestError ? error.payload : {};
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to verify the reset code.',
      attemptsLeft: typeof payload.attemptsLeft === 'number' ? payload.attemptsLeft : undefined,
      // 404/410/429: the code is gone, so the user has to request a new one.
      mustRequestNewCode: error instanceof ApiRequestError && [404, 410, 429].includes(error.status),
    };
  }
}

export async function updatePasswordWithOtp(email: string, otp: string, newPassword: string) {
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

export async function changePassword(currentPassword: string, newPassword: string) {
  const token = await getSessionToken();
  if (!token || !currentPassword || !newPassword) {
    return { ok: false, message: 'Please provide your current and new password.' };
  }

  try {
    const payload = await apiRequest<{ ok: boolean; message?: string }>('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    await logoutUser();
    return { ok: payload.ok, message: payload.message || 'Your password has been updated. Please sign in again.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unable to update your password.' };
  }
}

export async function deleteAccount(currentPassword: string) {
  const token = await getSessionToken();
  if (!token || !currentPassword) {
    return { ok: false, message: 'Please provide your current password.' };
  }

  try {
    const payload = await apiRequest<{ ok: boolean; message?: string }>('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword }),
    });
    if (payload.ok) {
      await logoutUser();
    }
    return { ok: payload.ok, message: payload.message || 'Your account has been deleted.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unable to delete your account.' };
  }
}

/** Downloads everything HabitAI stores about the student (web) or opens the share sheet (mobile). */
export async function exportMyData() {
  try {
    const data = await apiRequest<object>('/api/auth/export', { headers: await getAuthenticatedHeaders() });
    const json = JSON.stringify(data, null, 2);
    const fileName = `habitai-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true, message: `Saved ${fileName}.` };
    }
    const { Share } = await import('react-native');
    await Share.share({ title: fileName, message: json });
    return { ok: true, message: 'Your data is ready to save or share.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unable to export your data.' };
  }
}
