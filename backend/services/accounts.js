import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { query } from '../db/client.js';
import { authToken, hashToken, normalizeEmail } from '../lib/http.js';
import { namesFromRow } from '../lib/names.js';

const USER_COLUMNS = `u.full_name AS "fullName", u.first_name AS "firstName", u.last_name AS "lastName", u.username, u.email, u.date_of_birth AS "dateOfBirth", u.gender, u.region, u.about,
  u.email_verified_at AS "emailVerifiedAt", u.privacy_consent_at AS "privacyConsentAt"`;

export function userFromRow(row) {
  return {
    id: row.id ?? row.userId,
    ...namesFromRow(row),
    username: row.username || '',
    email: row.email,
    dateOfBirth: row.dateOfBirth || '',
    gender: row.gender || '',
    region: row.region || '',
    about: row.about || '',
    emailVerified: Boolean(row.emailVerifiedAt),
    privacyConsentAt: row.privacyConsentAt ? Number(row.privacyConsentAt) : null,
  };
}

export async function findUser(emailAddress) {
  const result = await query(
    `SELECT u.id, ${USER_COLUMNS}, u.password_hash AS "passwordHash", u.status FROM users u WHERE u.email = $1`,
    [normalizeEmail(emailAddress)],
  );
  return result.rows[0] || null;
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, Date.now() + config.session.lifetimeMs]);
  return token;
}

/** The signed-in user for a Bearer token, or null. Deactivated accounts have no valid sessions. */
export async function currentSession(request) {
  const token = authToken(request);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const result = await query(
    `SELECT s.user_id AS "userId", ${USER_COLUMNS}
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.status <> 'deactivated'`,
    [tokenHash, now],
  );
  if (!result.rows[0]) await query('DELETE FROM sessions WHERE token_hash = $1 OR expires_at <= $2', [tokenHash, now]);
  return result.rows[0] || null;
}

const verificationRequired = () => process.env.REQUIRE_EMAIL_VERIFICATION !== 'false';

/**
 * Sends a 401 and returns null when the request is not signed in. Accounts that have
 * not confirmed their email get a 403 EMAIL_NOT_VERIFIED, except on the few routes
 * needed to finish verification (`allowUnverified`).
 */
export async function requireAuth(request, response, { allowUnverified = false } = {}) {
  const session = await currentSession(request);
  if (!session) {
    response.status(401).json({ ok: false, message: 'Authentication required.' });
    return null;
  }
  if (!allowUnverified && verificationRequired() && !session.emailVerifiedAt) {
    response.status(403).json({ ok: false, code: 'EMAIL_NOT_VERIFIED', message: 'Please confirm your email address first.' });
    return null;
  }
  request.session = session;
  return session;
}
