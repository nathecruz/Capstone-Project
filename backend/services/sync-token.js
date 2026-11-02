// The Android app's background reminder sync (frontend/hooks/app-state/reminder-sync.ts) asks every
// hour or so whether the account's saved state changed (GET /api/app-state/version). It asks with
// this signed token instead of its session, so the answer needs no database: a session is looked up
// in the database, and hundreds of phones asking around the clock would keep the free database
// awake and use up its monthly compute (DEPLOYMENT.md). The token lets its holder learn only when
// the account last saved its state.
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { getConfiguredVapidDetails } from './web-push-reminders.js';

export const SYNC_TOKEN_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * The signing key, derived from a secret the API already has (the ML service key, which production
 * requires, or the Web Push private key); a fixed one outside production; else null.
 */
export function syncTokenSecret(environment = process.env) {
  const base = config.ml.key || getConfiguredVapidDetails(environment)?.privateKey || (config.isProduction ? '' : 'habitai-development');
  return base ? `habitai-sync-token:${base}` : null;
}

const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

/** A token for the account `userId`: { token, expiresAt }. */
export function makeSyncToken(userId, secret, now = Date.now()) {
  const expiresAt = now + SYNC_TOKEN_LIFETIME_MS;
  const payload = Buffer.from(JSON.stringify({ u: String(userId), e: expiresAt, k: 'state-sync' })).toString('base64url');
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt };
}

/** The account of a valid, unexpired token, else null. */
export function readSyncToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret || token.length > 512) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data?.k === 'state-sync' && typeof data.u === 'string' && data.u && Number(data.e) > now ? data.u : null;
  } catch {
    return null;
  }
}
