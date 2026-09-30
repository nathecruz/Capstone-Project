import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError, clientIp } from '../lib/http.js';
import { STAFF_ROLES, hasPermission, permissionsFor } from '../lib/permissions.js';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction,
    path: '/',
    maxAge: config.sessionTtlMs,
  };
}

export async function createAdminSession(response, request, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await query(
    `INSERT INTO admin_sessions(token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $3, $4, $5, $6)`,
    [hashToken(token), userId, now, now + config.sessionTtlMs, clientIp(request), String(request.get('user-agent') || '').slice(0, 200)],
  );
  response.cookie(config.sessionCookie, token, sessionCookieOptions());
}

export async function destroyAdminSession(request, response) {
  const token = request.cookies?.[config.sessionCookie];
  if (token) await query('DELETE FROM admin_sessions WHERE token_hash = $1', [hashToken(token)]);
  response.clearCookie(config.sessionCookie, { ...sessionCookieOptions(), maxAge: undefined });
}

/** Loads the signed-in staff member (if any) onto request.admin. */
export async function loadAdmin(request, _response, next) {
  const token = request.cookies?.[config.sessionCookie];
  if (!token) return next();
  const now = Date.now();
  const result = await query(
    `SELECT u.id, u.full_name AS "fullName", u.username, u.email, u.role, u.status, s.token_hash AS "tokenHash", s.last_seen_at AS "lastSeenAt"
       FROM admin_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [hashToken(token), now],
  );
  const row = result.rows[0];
  if (!row || row.status !== 'active' || !STAFF_ROLES.includes(row.role)) {
    await query('DELETE FROM admin_sessions WHERE token_hash = $1 OR expires_at <= $2', [hashToken(token), now]);
    return next();
  }
  if (now - row.lastSeenAt > 60_000) {
    query('UPDATE admin_sessions SET last_seen_at = $2 WHERE token_hash = $1', [row.tokenHash, now]).catch(() => {});
  }
  request.admin = {
    id: row.id,
    fullName: row.fullName,
    username: row.username,
    email: row.email,
    role: row.role,
    permissions: permissionsFor(row.role),
    sessionHash: row.tokenHash,
  };
  return next();
}

export function requireAuth(request, _response, next) {
  if (!request.admin) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  next();
}

export function requirePermission(permission) {
  return (request, _response, next) => {
    if (!request.admin) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    if (!hasPermission(request.admin.role, permission)) {
      throw new HttpError(403, 'You do not have permission to perform this action.');
    }
    next();
  };
}

/**
 * CSRF defence: the session cookie is SameSite=Strict, and every state-changing
 * request must also carry a custom header that cross-site forms cannot set.
 */
export function requireCsrfHeader(request, _response, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  if (request.get('x-requested-with') !== 'habitai-admin') {
    throw new HttpError(403, 'Missing request verification header.');
  }
  next();
}
