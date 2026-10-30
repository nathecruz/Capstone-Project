import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
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
import type { KeptDays } from '@/utils/account-streak';

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

/** The deployed backend, for a production build made without EXPO_PUBLIC_API_URL. */
const DEFAULT_PRODUCTION_API_URL = 'https://habitai-backend.onrender.com';

const URL_HOST = /^([a-z][a-z0-9+.-]*:\/\/)(\[[^\]]+\]|[^:/?#]+)/i;

function isLocalHostname(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

// Read with a pattern, not new URL(): React Native's URL does not implement hostname.
function isLocalUrl(value: string) {
  const host = URL_HOST.exec(value.trim())?.[2];
  return Boolean(host && isLocalHostname(host));
}

function isLocalWebHost() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return isLocalHostname(window.location.hostname);
}

/** The development server's host as this device reaches it: the page's host on the web, Metro's in the app. */
function developmentHost() {
  if (Platform.OS === 'web') return typeof window === 'undefined' ? '' : window.location.hostname;
  return Constants.expoConfig?.hostUri?.split(':')[0] ?? '';
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
    // Development on a phone: "localhost" in .env is the laptop for the laptop's own browser, but the
    // phone itself for a phone on the same Wi-Fi, so the phone calls the development server's host.
    const devHost = process.env.NODE_ENV === 'production' ? '' : developmentHost();
    if (isLocalUrl(envUrl) && devHost && !isLocalHostname(devHost)) {
      return envUrl.replace(/\/$/, '').replace(URL_HOST, `$1${devHost}`);
    }
    return envUrl.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    if (isLocalWebHost()) {
      return `http://${window.location.hostname}:8787`;
    }
    // A build made without EXPO_PUBLIC_API_URL (a Vercel project or an EAS build missing it) still
    // signs in against the deployed backend, instead of failing every sign-in.
    return DEFAULT_PRODUCTION_API_URL;
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

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_EMAIL_DOMAINS = ['@psau.edu.ph', '@gmail.com', '@yahoo.com', '@outlook.com'];

/** An address new accounts may register with: a valid email at one of the accepted providers. */
export function isValidEmailFormat(email: string) {
  const trimmed = email.trim().toLowerCase();
  return emailPattern.test(trimmed) && ALLOWED_EMAIL_DOMAINS.some((domain) => trimmed.endsWith(domain));
}

/**
 * Any well-formed email address. The account the server confirms only has to pass this: it can hold
 * an address at another domain (an email changed later, or an Admin Panel account), and checking the
 * provider list here signed those students out on every launch.
 */
function isEmailAddress(email: string) {
  return emailPattern.test(email.trim());
}

function isValidSessionUser(value: unknown): value is SessionUser {
  if (typeof value !== 'object' || value === null) return false;
  const user = value as Partial<SessionUser>;
  return typeof user.id === 'string'
    && Boolean(user.id.trim())
    && typeof user.fullName === 'string'
    && Boolean(user.fullName.trim())
    && typeof user.email === 'string'
    && isEmailAddress(user.email);
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

/**
 * Whether the phone has an internet connection at all: Android's own validated-network check (so
 * Wi-Fi with no internet counts as none), iOS's network path, or navigator.onLine on the web.
 * Unknown counts as connected, so a check that cannot run never blocks anything.
 */
export async function deviceHasInternet() {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

/**
 * Waits until the server answers its health check, for up to `maxWaitMs`. A sleeping free server holds
 * the request until it is up (up to a minute or so), so one try may wait that long, and while it boots
 * the host answers for it with its own 502/503 page, which is asked again a few seconds later. A
 * connection refused again and again (a blocked host, wrong address, no route) is not a server
 * waking up, so that gives up after a few tries instead of holding the sign-in for the full wait.
 */
export async function waitForServer(maxWaitMs = 90_000, retryDelayMs = 3000) {
  const deadline = Date.now() + maxWaitMs;
  let refusals = 0;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    const startedAt = Date.now();
    try {
      const response = await fetch(`${getApiBaseUrl()}/healthz`, { signal: controller.signal, cache: 'no-store' });
      if (response.ok) return true;
      refusals = 0;
    } catch {
      if (controller.signal.aborted) return false;
      refusals = Date.now() - startedAt < 2000 ? refusals + 1 : 0;
      if (refusals >= 3) return false;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return false;
}

/** Whether HabitAI's server answers at all within `timeoutMs` (any HTTP answer counts). */
export async function serverAnswers(timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${getApiBaseUrl()}/healthz`, { signal: controller.signal, cache: 'no-store' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let requestsInFlight = 0;

/** Whether an API request is still waiting for its answer (e.g. a sign-in while the server wakes). */
export function hasRequestsInFlight() {
  return requestsInFlight > 0;
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
  requestsInFlight += 1;
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
    requestsInFlight -= 1;
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
    const text = typeof payload === 'string' ? payload.trim() : '';
    // The host's own error page (HTML, while the free server boots or redeploys) is not shown as is:
    // it filled the sign-in error with markup. A short plain-text message from the API still is.
    const message = typeof body.message === 'string'
      ? body.message
      : typeof body.error === 'string'
        ? body.error
        : response.status >= 500 && (!text || text.startsWith('<'))
          ? 'The HabitAI server is starting up. Please try again in a moment.'
          : text && !text.startsWith('<')
            ? text
            : `Request failed (HTTP ${response.status}).`;
    throw new ApiRequestError(message, response.status, body);
  }

  return payload as T;
}

// Long enough for an account request (sign-in, sign-up, password reset) to wake the free server
// itself: that can take over a minute, past the usual request timeout.
const ACCOUNT_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Sends the sign-in so it survives the free server waking up. One that was dropped on the way (the
 * host's "starting" error page, a restart, or the phone moving between Wi-Fi and mobile data) is
 * sent once more as soon as the server answers again.
 */
async function sendSignIn<T>(body: string) {
  const send = () => apiRequest<T>('/api/auth/login', { method: 'POST', body, timeoutMs: ACCOUNT_REQUEST_TIMEOUT_MS });
  // In flight for the whole sign-in, the wait between the two tries included, so the web app does
  // not reload itself for an update in the middle of it.
  requestsInFlight += 1;
  try {
    return await send();
  } catch (error) {
    const dropped = error instanceof TypeError || (error instanceof ApiRequestError && [502, 503, 504].includes(error.status));
    if (!dropped || !(await deviceHasInternet()) || !(await waitForServer())) throw error;
    return send();
  } finally {
    requestsInFlight -= 1;
  }
}

/**
 * What to tell the student when an account request got no answer: no internet on the phone, the free
 * server still starting, or the server not reachable (it used to say "Connect to the internet" for all
 * three, also on a working connection while the server woke up).
 */
async function connectionErrorMessage(error: unknown) {
  if (!(await deviceHasInternet())) return 'No internet connection. Connect to Wi-Fi or mobile data, then try again.';
  if (error instanceof Error && error.name === 'AbortError') return 'The HabitAI server is taking too long to start. Please try again in a few seconds.';
  return 'Could not reach the HabitAI server. Please try again in a moment.';
}

export async function signUp(user: { firstName: string; lastName: string; username: string; email: string; password: string; dateOfBirth: string; gender: string; region: string; privacyConsent: boolean }) {
  const email = user.email.trim();
  if (!isValidEmailFormat(email)) {
    return { ok: false, message: 'Please enter a valid email address.' };
  }

  try {
    const payload = await apiRequest<{ ok: boolean; message?: string; token?: string; user?: SessionUser }>('/api/auth/register', {
      method: 'POST',
      timeoutMs: ACCOUNT_REQUEST_TIMEOUT_MS,
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
      return { ok: false, message: await connectionErrorMessage(error) };
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to create account.',
    };
  }
}

export async function signIn(email: string, password: string, { keepSignedIn = false }: { keepSignedIn?: boolean } = {}) {
  const normalizedEmail = email.trim();
  if (!isValidEmailFormat(normalizedEmail)) {
    return { ok: false, message: 'Please enter a valid email address.' };
  }

  try {
    const payload = await sendSignIn<{ ok: boolean; message?: string; token?: string; user?: SessionUser }>(
      JSON.stringify({ email: normalizedEmail, password, device: getDeviceLabel() }),
    );

    if (typeof payload !== 'object' || payload === null || typeof payload.ok !== 'boolean') {
      // Not the API's answer (e.g. a Wi-Fi sign-in page): a correct password must not look wrong.
      return { ok: false, message: 'The sign-in service sent an unexpected answer. Please try again.' };
    }
    if (!payload.ok) {
      return { ok: false, message: payload.message || 'Incorrect email or password.' };
    }

    if (!payload.token || !isValidSessionUser(payload.user)) {
      return { ok: false, message: 'The account service returned an incomplete sign-in response.' };
    }
    // The app is for students and faculty; system admins use the Admin Panel (the server refuses them too).
    if (payload.user.role === 'admin') {
      return { ok: false, message: 'System admin accounts cannot sign in to the HabitAI app. Please use the HabitAI Admin Panel.' };
    }
    await saveSessionToken(payload.token, payload.user, { persist: keepSignedIn });

    return { ok: true, message: payload.message || 'Login successful.', user: payload.user };
  } catch (error) {
    if (isNetworkError(error)) {
      return { ok: false, message: await connectionErrorMessage(error) };
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
  // The server accepts up to 160 characters; a longer label would refuse the sign-in.
  return `${model} (${operatingSystem} ${version})`.slice(0, 160);
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
    // Validating the saved session must not hold the app on its loading screen: a short timeout keeps
    // start-up fast on slow mobile data or while the free server wakes, falling back to the saved
    // session below (the live check, getLiveVersions, signs out a session the server no longer has).
    const payload = await apiRequest<{ ok: boolean; user?: SessionUser }>('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 8000,
    });
    if (!payload.ok || !isValidSessionUser(payload.user)) {
      await logoutUser();
      return null;
    }
    // What the server says about the role, the email confirmation and the privacy consent is stored
    // when it changed (a role set later, verification turned off), so a later start-up that falls back
    // to the saved session routes the same way. Only on a change, to avoid a reload loop.
    const changed = (payload.user.role ?? 'user') !== (session.role ?? 'user')
      || (payload.user.emailVerified !== undefined && payload.user.emailVerified !== session.emailVerified)
      || (payload.user.privacyConsentAt !== undefined && (payload.user.privacyConsentAt ?? null) !== (session.privacyConsentAt ?? null));
    if (changed) await refreshStoredUser(payload.user);
    return payload.user;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      await logoutUser();
      return null;
    }

    // Server asleep or slow (or no connection): keep the saved session instead of signing the student out.
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
    if (isNetworkError(error)) return { ok: false, message: await connectionErrorMessage(error) };
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
    if (isNetworkError(error)) return { ok: false, message: await connectionErrorMessage(error) };
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

type BuddyResponse = import('@/utils/buddy').Buddy;
type WalletResponse = { tokens?: number; points?: number; tokenHistory?: object[] };
/**
 * A refusal keeps the server's code (DAY_CLOSED, BONUS_NOT_EARNED, DROP_LOCKED, ...) when it sent
 * one; a DAY_CLOSED one also the day the account is on (its today and time zone).
 */
type Result<T> = ({ ok: true } & T) | { ok: false; message: string; code?: string; today?: string; timeZone?: string };

const textField = (payload: Record<string, unknown>, key: string) => (typeof payload[key] === 'string' ? payload[key] as string : undefined);

async function authedRequest<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'Please sign in again.' };
  try {
    const body = await apiRequest<T>(path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
    return { ok: true, ...body };
  } catch (error) {
    if (!(error instanceof ApiRequestError)) return { ok: false, message: 'Could not reach HabitAI. Check your connection.' };
    const code = textField(error.payload, 'code');
    const day = code === 'DAY_CLOSED' ? { today: textField(error.payload, 'today'), timeZone: textField(error.payload, 'timeZone') } : {};
    return { ok: false, message: error.message, code, ...day };
  }
}

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
/** The device's today and time zone, which the server checks against the account's day. */
const todayQuery = (date: string, timeZone = deviceTimeZone()) => `date=${date}&timeZone=${encodeURIComponent(timeZone)}`;

/**
 * Habit Buddy: name, what it wears, what was bought, and the shop. With the device's today `date`
 * it also has this week's drop (null without a date, or for a day that is not the account's).
 */
export const getBuddy = (date?: string, timeZone = deviceTimeZone()) => authedRequest<{ buddy: BuddyResponse }>(`/api/buddy${date ? `?${todayQuery(date, timeZone)}` : ''}`);
/**
 * Buys an item with tokens (the server checks the price, stage and balance) and puts it on. A
 * weekly drop needs the device's today `date`: it is sold only in its week, once 2 quests are done.
 */
export const buyBuddyItem = (itemId: string, date?: string, timeZone = deviceTimeZone()) => authedRequest<{ buddy: BuddyResponse } & WalletResponse>('/api/buddy/items', {
  method: 'POST',
  body: JSON.stringify(date ? { itemId, date, timeZone } : { itemId }),
});
/** Renames the buddy or changes what it wears ('' takes an item off). */
export const saveBuddy = (changes: { name?: string; head?: string; hand?: string; room?: string; accessory?: string }) => authedRequest<{ buddy: BuddyResponse }>('/api/buddy', { method: 'PUT', body: JSON.stringify(changes) });
/** Feeds a treat to the buddy (the server charges the tokens); returns the line it says. */
export const feedBuddyTreat = (treatId: string) => authedRequest<{ buddy: BuddyResponse; line: string } & WalletResponse>('/api/buddy/treats', { method: 'POST', body: JSON.stringify({ treatId }) });
export type BuddyGiftSent = { gift: { id: string; treatId: string; to: string; message: string }; sentToday: number; leftToday: number } & WalletResponse;
/**
 * Sends a treat to a classmate's Habi: `to` is their leaderboard id, `messageId` one of the 5 fixed
 * cheers. Only the sender pays; the server checks the daily and weekly limits for the device's
 * today `date` and refuses with a code (SELF_GIFT, GIFTS_OFF, GIFT_DAILY_LIMIT, ...) and a message.
 */
export const sendBuddyGift = (gift: { to: string; treatId: string; messageId: number }, date: string, timeZone = deviceTimeZone()) => authedRequest<BuddyGiftSent>('/api/buddy/gifts', {
  method: 'POST',
  body: JSON.stringify({ ...gift, date, timeZone }),
});
/** Opens today's mystery box (after the day's first check-in); the server picks the tokens. */
export const openMysteryBox = (date: string) => authedRequest<{ amount: number; alreadyOpened: boolean } & WalletResponse>('/api/mystery-box/open', {
  method: 'POST',
  body: JSON.stringify({ date, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
});

export type ServerReward = { id: string; name: string; cost: number; description: string; permanent: boolean };
/** Token rewards on sale, the ones this student owns (Premium Themes, Custom Title) and their title. */
export const getRewards = () => authedRequest<{ rewards: ServerReward[]; owned: string[]; title: string; frame?: string }>('/api/rewards');
/** Chooses the frame around the student's photo ('' takes it off); needs the Profile Frames reward. */
export const saveRewardFrame = (frame: string) => authedRequest<{ frame: string }>('/api/rewards/frame', { method: 'PUT', body: JSON.stringify({ frame }) });
/** Sets the title under the student's name ('' removes it); needs the Custom Title reward. */
export const saveRewardTitle = (title: string) => authedRequest<{ title: string }>('/api/rewards/title', { method: 'PUT', body: JSON.stringify({ title }) });

/** `keptDays`: the days that are over and keep their kind in the account streak (utils/account-streak.ts). */
export type StreakFreezeStatus = { available: number; max: number; cost: number; frozenDays: string[]; keptDays?: KeptDays; used: string[] };
/** Uses held streak freezes for days missed before `date` (the device's today) and returns the status. */
export const syncStreakFreezes = (date: string) => authedRequest<StreakFreezeStatus>('/api/streak-freezes/sync', { method: 'POST', body: JSON.stringify({ date, timeZone: deviceTimeZone() }) });
/** A version of each kind of the student's data (changes whenever that data does), and unread notifications. */
/**
 * What changed on the server, asked every few seconds while the app is open. A 401 here means the
 * session expired or was signed out on another device: start-up keeps the saved session when the
 * server is slow to answer, so this is where the student is sent back to sign in, instead of every
 * request failing quietly.
 */
export async function getLiveVersions(): Promise<Result<{ versions: Record<string, string>; unread: number }>> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'Please sign in again.' };
  try {
    const body = await apiRequest<{ versions: Record<string, string>; unread: number }>('/api/live', { headers: { Authorization: `Bearer ${token}` } });
    return { ok: true, ...body };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401 && (await getSessionToken()) === token) await logoutUser();
    return { ok: false, message: error instanceof ApiRequestError ? error.message : 'Could not reach HabitAI. Check your connection.' };
  }
}

export type DailyChallenge = { id: string; title: string; icon: string; target: number; progress: number; reward: number; date: string; complete: boolean };
export type DailyClaim = { date: string; day: number; claimedToday: boolean; amount: number; rewards: number[]; alreadyClaimed?: boolean };
/** Today's three challenges and their progress, as the server counts (and pays) them. */
export const getDailyChallenges = (date: string) => authedRequest<{ challenges: DailyChallenge[] }>(`/api/daily-challenges?${todayQuery(date)}`);
/** The 7-day daily claim calendar for `date` (the device's today). */
export const getDailyClaim = (date: string) => authedRequest<DailyClaim>(`/api/daily-claim?${todayQuery(date)}`);
/** Claims today's reward (once a day); the server picks the day of the calendar and pays it. */
export const claimDailyReward = (date: string) => authedRequest<DailyClaim & WalletResponse>('/api/daily-claim', { method: 'POST', body: JSON.stringify({ date, timeZone: deviceTimeZone() }) });

/** Buys a streak freeze with tokens; it is used right away if yesterday's streak needs it. */
export const buyStreakFreeze = (date: string) => authedRequest<StreakFreezeStatus & WalletResponse>('/api/streak-freezes/buy', { method: 'POST', body: JSON.stringify({ date, timeZone: deviceTimeZone() }) });

export type WeeklyBonusTier = { percent: number; amount: number; label: string };
/**
 * The weekly consistency bonus as the server counts it: last week (claimable this week, from the
 * habits started by Wednesday) and this week so far, with the next tier still in reach.
 */
export type WeeklyBonus = {
  lastWeek: {
    weekStart: string;
    weekEnd: string;
    scheduled: number;
    done: number;
    percent: number;
    activeDays: number;
    eligible: boolean;
    reason: null | 'few-scheduled' | 'few-days' | 'low-rate';
    tier: WeeklyBonusTier | null;
    claimed: boolean;
    claimedAmount: number | null;
    claimable: boolean;
    /** When it can no longer be claimed (00:00 next Monday). */
    lapsesAt: number;
  };
  thisWeek: {
    weekStart: string;
    weekEnd: string;
    dueSoFar: number;
    doneSoFar: number;
    dueWeek: number;
    percentSoFar: number;
    next: null | { percent: number; amount: number; checkInsNeeded: number; reachable: boolean };
  };
  tiers: WeeklyBonusTier[];
};
export type WeeklyBonusClaim = { amount: number; alreadyClaimed: boolean; percent: number; tier: WeeklyBonusTier | null; updatedAt?: number | null } & WalletResponse;
/** Last week's bonus and this week so far, for `date` (the device's today). */
export const getWeeklyBonus = (date: string, timeZone = deviceTimeZone()) => authedRequest<WeeklyBonus>(`/api/weekly-bonus?${todayQuery(date, timeZone)}`);
/**
 * Claims last week's bonus: the server recounts the week and pays it once (a second claim answers
 * alreadyClaimed with the amount paid), or refuses with BONUS_NOT_EARNED.
 */
export const claimWeeklyBonus = (date: string, timeZone = deviceTimeZone()) => authedRequest<WeeklyBonusClaim>('/api/weekly-bonus/claim', { method: 'POST', body: JSON.stringify({ date, timeZone }) });

/** One way to earn tokens; its numbers come from the server's own constants (amount: '+5', '+2 to +15', ...). */
export type WalletEarnRow = { id: string; title: string; amount: string; detail: string };
export type WalletSpendStatus = 'owned' | 'ready' | 'short' | 'locked' | 'full';
/**
 * One thing to buy. `from`: the cost is the cheapest of several. `short`: tokens missing; held and
 * max: streak freezes. target: 'reward:<id>' | 'freeze' | 'buddy' | 'gift' | 'coach'.
 */
export type WalletSpendRow = { id: string; title: string; detail: string; cost: number; from: boolean; status: WalletSpendStatus; short?: number; held?: number; max?: number; target: string };
type Progress = { done: number; total: number; earned: number; available: number };
/**
 * The Tokens screen as the server counts it, for the account's today: every way to earn with
 * today's progress, everything to buy, this week's flow and the next goal. `balance` is the raw
 * ledger sum (below 0 after an undone check-in whose tokens were spent); `tokens` never is.
 */
export type WalletSummary = {
  balance: number;
  tokens: number;
  /** How many things to buy are 'ready'. */
  affordable: number;
  today: {
    date: string;
    checkIns: { paid: number; limit: number; perCheckIn: number; earned: number };
    dailyClaim: { claimed: boolean; day: number; amount: number; tomorrowAmount: number };
    challenges: Progress;
    mysteryBox: { status: 'locked' | 'ready' | 'opened'; amount: number | null; min: number; max: number };
    canStillEarn: number;
  };
  week: { start: string; end: string; resetsAt: number; earned: number; spent: number; bySource: Record<string, number>; bySink: Record<string, number>; quests: Progress; bonus: WeeklyBonus };
  streak: { days: number; next: { days: number; bonus: number; daysLeft: number } | null };
  earn: WalletEarnRow[];
  spend: WalletSpendRow[];
  pace: { perDay: number };
  nextGoal: { id: string; title: string; cost: number; short: number; days: number | null } | null;
};
/** The wallet for `date` (the device's today); a refused day (DAY_CLOSED) says which day the account is on. */
export const getWalletSummary = (date: string, timeZone = deviceTimeZone()) => authedRequest<WalletSummary>(`/api/wallet/summary?${todayQuery(date, timeZone)}`);

export type WalletHistoryFilter = 'all' | 'earned' | 'spent';
/** A ledger row, newest first; its id is shown without the account prefix. createdAt is in ms. */
export type WalletHistoryItem = { id: string; amount: number; kind: import('@/hooks/app-state/types').TokenKind; label: string; date: string; createdAt: number };
/** totals cover the whole ledger, not just this page. */
export type WalletHistory = { items: WalletHistoryItem[]; nextCursor: string | null; totals: { earned: number; spent: number; balance: number } };
/** One page of the token history (limit 1-50, 30 by default); `before` is the nextCursor of the page before. */
export function getWalletHistory({ filter = 'all', before, limit }: { filter?: WalletHistoryFilter; before?: string | null; limit?: number } = {}) {
  const query = [`filter=${filter}`, limit ? `limit=${limit}` : '', before ? `before=${encodeURIComponent(before)}` : ''].filter(Boolean).join('&');
  return authedRequest<WalletHistory>(`/api/wallet/history?${query}`);
}

/** Asks the server to send a test reminder to this device (or all of the account's devices) now. */
export async function sendTestWebPush(endpoint?: string): Promise<{ ok: boolean; message: string }> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'Please sign in again.' };
  try {
    await apiRequest('/api/web-push/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(endpoint ? { endpoint } : {}),
    });
    return { ok: true, message: 'A test reminder is on its way. It should appear within a few seconds.' };
  } catch (error) {
    return { ok: false, message: error instanceof ApiRequestError ? error.message : 'Could not send a test reminder. Check your connection.' };
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

/**
 * Saves the profile. Changing a confirmed email also needs the current password (code
 * PASSWORD_REQUIRED or PASSWORD_INCORRECT when it is missing or wrong).
 */
export async function updateAuthenticatedProfile(profile: { firstName: string; lastName: string; username: string; email: string; dateOfBirth: string; gender: string; about: string; currentPassword?: string }): Promise<{ ok: boolean; message?: string; user?: SessionUser; code?: string }> {
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
    const code = error instanceof ApiRequestError && typeof error.payload.code === 'string' ? error.payload.code : undefined;
    return { ok: false, code, message: error instanceof Error ? error.message : 'Unable to update your profile.' };
  }
}

export async function saveRemoteAppState(state: AppStateSyncPayload, base: AppStateSyncBase | null) {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    // `keptDays` comes when the save kept days of the account streak (a habit deleted or rescheduled).
    return await apiRequest<{ ok: boolean; state?: AppStateSyncPayload; updatedAt?: number; merged?: boolean; unchanged?: boolean; keptDays?: KeptDays }>('/api/app-state', {
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

/**
 * Why the server refused a check-in: its code (DAY_CLOSED, PAST_DEADLINE, CHECK_IN_LOCKED,
 * HABIT_ENDED; none for a rate limit) and, for DAY_CLOSED, the account's own today and time zone.
 */
export type CheckInRejection = { rejected: true; code?: string; message: string; today?: string; timeZone?: string };

export async function saveRemoteHabitCompletion(completion: HabitCompletion & { completed: boolean }) {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    // tokenCapped: this check-in was saved (and counts for streaks, challenges and quests) but
    // paid no tokens, as the day's paid check-ins (paidCheckInsLimit) were already used.
    return await apiRequest<{ ok: boolean; updatedAt?: number; state?: AppStateSyncPayload; completions?: HabitCompletion[]; points?: number; tokens?: number; tokenHistory?: object[]; habit?: { id: string; streak: number; done: boolean } | null; dailyChallenges?: DailyChallenge[]; tokenCapped?: boolean; paidCheckInsToday?: number; paidCheckInsLimit?: number }>('/api/habit-completions', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...completion, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
    });
  } catch (error) {
    // A definitive client rejection (the day is closed, the habit is missed, an undo is locked, or
    // too many check-ins) must undo the optimistic change; a network error keeps it so it can sync later.
    if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
      const rejection: CheckInRejection = { rejected: true, code: textField(error.payload, 'code'), message: error.message, today: textField(error.payload, 'today'), timeZone: textField(error.payload, 'timeZone') };
      return rejection;
    }
    return null;
  }
}

/** The signed-in student's place on the All Time leaderboard, or null when it cannot be read. */
export async function getMyLeaderboardRank(): Promise<{ rank: number; total: number } | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const payload = await apiRequest<{ leaders?: { rank: number; isYou?: boolean }[] }>('/api/leaderboard?period=All%20Time', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const leaders = Array.isArray(payload.leaders) ? payload.leaders : [];
    const you = leaders.find((leader) => leader.isYou);
    return you ? { rank: you.rank, total: leaders.length } : null;
  } catch {
    return null;
  }
}

export type HabitAnalysis = {
  habitId: string;
  stats: {
    completionRate: number;
    scheduledDays: number;
    completedDays: number;
    missedDays: number;
    streak: number;
    strongestWeekday: string | null;
    weakestWeekday: string | null;
    usualCheckInTime: string | null;
    last7Days: number[];
  };
  ml: { completionProbability: number; dropoutRisk: number | null; recommendedAction: string; suggestedReminderTime: string; source: 'model' | 'rules' } | null;
  /** 'ready': from the ML service; 'estimate': it was asleep, so the server used the same rules itself. */
  mlStatus?: 'ready' | 'estimate';
  ai: { headline: string; strength?: string; bestTime: string; steps: string[]; watchOut: string; encouragement?: string } | null;
  /** Why ai is missing: 'limited' (over the AI limit for a few minutes), 'unavailable' (the AI failed) or 'off'. */
  aiStatus?: 'ready' | 'limited' | 'unavailable' | 'off';
};

/** One habit analysed on the server: check-in facts, the ML forecast and the AI's advice. */
export async function analyzeHabit(habitId: string): Promise<{ ok: true; analysis: HabitAnalysis } | { ok: false; message: string }> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'You are not signed in.' };
  try {
    const analysis = await apiRequest<HabitAnalysis>('/api/insights/habit-analysis', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ habitId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
    });
    return { ok: true, analysis };
  } catch (error) {
    if (isNetworkError(error)) return { ok: false, message: 'Unable to reach the server. Try again in a moment.' };
    const message = error instanceof Error ? error.message : '';
    // A habit added a moment ago reaches the server with the next sync.
    if (/habit not found/i.test(message)) return { ok: false, message: 'This habit is still syncing. Try again in a few seconds.' };
    return { ok: false, message: message || 'The analysis is unavailable right now.' };
  }
}

export async function submitIssueReport(report: {
  topic: string;
  timing: string;
  description: string;
  /** `file` is the picked File on the web; the phone app sends the file by its `uri`. */
  attachment?: { uri: string; name: string; type?: string | null; file?: File };
}) {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'You are not signed in.' };

  try {
    const formData = new FormData();
    formData.append('topic', report.topic);
    formData.append('timing', report.timing);
    formData.append('description', report.description);
    if (report.attachment?.file) {
      // A browser's FormData takes the File itself; the { uri } object below would be sent as "[object Object]".
      formData.append('attachment', report.attachment.file, report.attachment.name);
    } else if (report.attachment) {
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
    const payload = await apiRequest<{ ok: boolean; activities?: LoginActivity[]; otherSessions?: number; message?: string }>('/api/auth/login-activity', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { ok: payload.ok, activities: payload.activities ?? [], otherSessions: payload.otherSessions ?? 0, message: payload.message };
  } catch (error) {
    return { ok: false, activities: [] as LoginActivity[], message: error instanceof Error ? error.message : 'Unable to load login activity.' };
  }
}

/** Signs out every other device; this one stays signed in. */
export async function signOutOtherDevices() {
  const token = await getSessionToken();
  if (!token) return { ok: false, signedOut: 0, message: 'You are not signed in.' };
  try {
    const payload = await apiRequest<{ ok: boolean; signedOut?: number; message?: string }>('/api/auth/sessions/others/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    return { ok: payload.ok, signedOut: payload.signedOut ?? 0, message: payload.message || 'Other devices were signed out.' };
  } catch (error) {
    return { ok: false, signedOut: 0, message: error instanceof Error ? error.message : 'Unable to sign out other devices.' };
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
      timeoutMs: ACCOUNT_REQUEST_TIMEOUT_MS,
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
      return { ok: false, message: await connectionErrorMessage(error) };
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
      timeoutMs: ACCOUNT_REQUEST_TIMEOUT_MS,
      body: JSON.stringify({ email: normalizedEmail, otp: normalizedOtp }),
    });

    return {
      ok: payload.ok,
      message: payload.message || 'OTP verified successfully.',
    };
  } catch (error) {
    if (isNetworkError(error)) {
      return { ok: false, message: await connectionErrorMessage(error) };
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
      timeoutMs: ACCOUNT_REQUEST_TIMEOUT_MS,
      body: JSON.stringify({ email: normalizedEmail, otp: normalizedOtp, newPassword }),
    });

    return {
      ok: payload.ok,
      message: payload.message || 'Your password has been reset successfully.',
    };
  } catch (error) {
    if (isNetworkError(error)) {
      return { ok: false, message: await connectionErrorMessage(error) };
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
