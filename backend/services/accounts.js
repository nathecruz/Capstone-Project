import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { query } from '../db/client.js';
import { authToken, hashToken, normalizeEmail } from '../lib/http.js';
import { namesFromRow } from '../lib/names.js';

const USER_COLUMNS = `u.full_name AS "fullName", u.first_name AS "firstName", u.last_name AS "lastName", u.username, u.email, u.date_of_birth AS "dateOfBirth", u.gender, u.region, u.about,
  u.email_verified_at AS "emailVerifiedAt", u.privacy_consent_at AS "privacyConsentAt", u.role`;

// REQUIRE_EMAIL_VERIFICATION=false turns verification off for every account, also those that never
// confirmed: one rule here and in requireAuth, so the app never sends a student to a code screen
// the server does not require (they were stuck there after signing in).
const verificationRequired = () => process.env.REQUIRE_EMAIL_VERIFICATION !== 'false';

/**
 * When the current Privacy Notice took effect: it added the proofs of check-ins (Focus timer and
 * walk sessions, photos) and the AI's follow-up questions (frontend/app/privacy-notice.tsx,
 * "Effective November 2, 2026", in use from 11 AM Manila time). Consent given before it was to an
 * earlier notice, so the app asks again (Data Privacy Act, RA 10173).
 */
export const PRIVACY_NOTICE_UPDATED_AT = Date.parse('2026-11-02T03:00:00Z');

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
    emailVerified: Boolean(row.emailVerifiedAt) || !verificationRequired(),
    // When the account accepted the current Privacy Notice; null when it has not (or accepted only
    // an earlier one), which makes every app version show the notice to accept.
    privacyConsentAt: Number(row.privacyConsentAt) >= PRIVACY_NOTICE_UPDATED_AT ? Number(row.privacyConsentAt) : null,
    // 'faculty' turns on the app's Faculty mode (their own habits, faculty AI advice, no student leaderboards).
    role: row.role || 'user',
  };
}

export async function findUser(emailAddress) {
  const result = await query(
    `SELECT u.id, ${USER_COLUMNS}, u.password_hash AS "passwordHash", u.status, u.failed_logins AS "failedLogins", u.login_locked_until AS "loginLockedUntil" FROM users u WHERE u.email = $1`,
    [normalizeEmail(emailAddress)],
  );
  return result.rows[0] || null;
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, Date.now() + config.session.lifetimeMs]);
  return token;
}

/**
 * The HabitAI app is for students and faculty. System admins use the Admin Panel (its own
 * sign-in and sessions) and cannot sign in to the app.
 */
export const ADMIN_APP_MESSAGE = 'System admin accounts cannot sign in to the HabitAI app. Please use the HabitAI Admin Panel.';

/** The signed-in user for a Bearer token, or null. Deactivated and system admin accounts have no valid sessions. */
export async function currentSession(request) {
  const token = authToken(request);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const result = await query(
    `SELECT s.user_id AS "userId", ${USER_COLUMNS}
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.status <> 'deactivated' AND u.role <> 'admin'`,
    [tokenHash, now],
  );
  if (!result.rows[0]) await query('DELETE FROM sessions WHERE token_hash = $1 OR expires_at <= $2', [tokenHash, now]);
  return result.rows[0] || null;
}

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
