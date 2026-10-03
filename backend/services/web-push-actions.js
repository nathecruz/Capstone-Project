// The "Done" button on a reminder notification checks the habit off without opening the app.
// The notification carries a signed token (user, habit, day, time zone) instead of a session; it
// is signed with a key derived from the Web Push private key, which both the backend and the
// GitHub Actions dispatcher have. Checking in is idempotent, so the token needs no storage.
import crypto from 'node:crypto';
import { getConfiguredVapidDetails } from './web-push-reminders.js';

const TOKEN_LIFETIME_MS = 36 * 60 * 60 * 1000;

/** The signing key, or null when Web Push is not configured. */
export function doneActionSecret(environment = process.env) {
  const details = getConfiguredVapidDetails(environment);
  return details ? `habitai-done-action:${details.privateKey}` : null;
}

const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

export function makeDoneToken({ userId, habitId, date, timeZone }, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: userId, h: habitId, d: date, z: timeZone || 'UTC', e: now + TOKEN_LIFETIME_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** { userId, habitId, date, timeZone } from a valid, unexpired token, else null. */
export function readDoneToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.u !== 'string' || typeof data.h !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.d) || !(Number(data.e) > now)) return null;
    return { userId: data.u, habitId: data.h, date: data.d, timeZone: typeof data.z === 'string' ? data.z : 'UTC' };
  } catch {
    return null;
  }
}

/** Where the notification's Done button posts (same base URL as the Snooze action). */
export function getWebPushDoneUrl(environment = process.env) {
  const configuredUrl = environment.WEB_PUSH_API_URL?.trim() || environment.RENDER_EXTERNAL_URL?.trim();
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) return null;
    return new URL('/api/web-push/done', url).toString();
  } catch {
    return null;
  }
}

/** The subscriber's calendar day at `now`. */
export function localDateIn(timeZone, now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
