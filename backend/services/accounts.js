import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { query } from '../db/client.js';
import { authToken, hashToken, normalizeEmail } from '../lib/http.js';

export function userFromRow(row) {
  return {
    id: row.id ?? row.userId,
    fullName: row.fullName,
    username: row.username || '',
    email: row.email,
    dateOfBirth: row.dateOfBirth || '',
    gender: row.gender || '',
    region: row.region || '',
    about: row.about || '',
  };
}

export async function findUser(emailAddress) {
  const result = await query(
    'SELECT id, full_name AS "fullName", username, email, date_of_birth AS "dateOfBirth", gender, region, about, password_hash AS "passwordHash", status FROM users WHERE email = $1',
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
    `SELECT s.user_id AS "userId", u.full_name AS "fullName", u.username, u.email, u.date_of_birth AS "dateOfBirth", u.gender, u.region, u.about
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.status <> 'deactivated'`,
    [tokenHash, now],
  );
  if (!result.rows[0]) await query('DELETE FROM sessions WHERE token_hash = $1 OR expires_at <= $2', [tokenHash, now]);
  return result.rows[0] || null;
}

/** Sends a 401 and returns null when the request is not signed in. */
export async function requireAuth(request, response) {
  const session = await currentSession(request);
  if (!session) {
    response.status(401).json({ ok: false, message: 'Authentication required.' });
    return null;
  }
  request.session = session;
  return session;
}
