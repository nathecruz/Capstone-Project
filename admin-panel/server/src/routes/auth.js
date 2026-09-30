import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, validate } from '../lib/http.js';
import { hashPassword, passwordProblem, verifyPassword } from '../lib/passwords.js';
import { ROLE_LABELS, STAFF_ROLES } from '../lib/permissions.js';
import { createAdminSession, destroyAdminSession, requireAuth } from '../middleware/auth.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
}).strict();

// A real bcrypt hash of a random string, so unknown emails take as long as wrong passwords.
const TIMING_DUMMY_HASH = await hashPassword(crypto.randomUUID());

function publicAdmin(admin) {
  return {
    id: admin.id,
    fullName: admin.fullName,
    username: admin.username,
    email: admin.email,
    role: admin.role,
    roleLabel: ROLE_LABELS[admin.role],
    permissions: admin.permissions,
  };
}

router.post('/login', loginLimiter, async (request, response) => {
  const input = validate(loginSchema, request.body);
  const result = await query(
    'SELECT id, full_name AS "fullName", email, role, status, password_hash AS "passwordHash" FROM users WHERE email = $1',
    [input.email],
  );
  const user = result.rows[0];
  const passwordOk = await verifyPassword(input.password, user?.passwordHash || TIMING_DUMMY_HASH);

  if (!user || !passwordOk) {
    await audit(request, { action: 'auth.login_failed', targetType: 'user', targetId: user?.id ?? null, summary: `Failed sign-in for ${input.email}`, details: { email: input.email } });
    throw new HttpError(401, 'Incorrect email or password.');
  }
  if (!STAFF_ROLES.includes(user.role)) {
    await audit(request, { action: 'auth.login_denied', targetType: 'user', targetId: user.id, summary: `${input.email} has no admin panel access`, details: { email: input.email } });
    throw new HttpError(403, 'This account does not have access to the Admin Panel.');
  }
  if (user.status !== 'active') {
    await audit(request, { action: 'auth.login_denied', targetType: 'user', targetId: user.id, summary: `${input.email} is deactivated`, details: { email: input.email } });
    throw new HttpError(403, 'This account has been deactivated.');
  }

  await createAdminSession(response, request, user.id);
  request.admin = { id: user.id, email: user.email };
  await audit(request, { action: 'auth.login', targetType: 'user', targetId: user.id, summary: `${user.fullName} signed in` });
  response.json({ ok: true });
});

router.post('/logout', async (request, response) => {
  if (request.admin) await audit(request, { action: 'auth.logout', targetType: 'user', targetId: request.admin.id, summary: `${request.admin.fullName} signed out` });
  await destroyAdminSession(request, response);
  response.json({ ok: true });
});

router.get('/me', requireAuth, (request, response) => {
  response.json({ ok: true, admin: publicAdmin(request.admin) });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
}).strict();

router.post('/change-password', requireAuth, async (request, response) => {
  const input = validate(changePasswordSchema, request.body);
  const { rows } = await query('SELECT full_name AS "fullName", username, email, password_hash AS "passwordHash" FROM users WHERE id = $1', [request.admin.id]);
  const user = rows[0];
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'The current password is incorrect.');
  }
  const problem = passwordProblem(input.newPassword, user);
  if (problem) throw new HttpError(400, problem);
  const hash = await hashPassword(input.newPassword);

  await withTransaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, request.admin.id]);
    // The password is shared with the mobile app account, so app sessions are signed out too.
    await client.query('DELETE FROM sessions WHERE user_id = $1', [request.admin.id]);
    await client.query('DELETE FROM admin_sessions WHERE user_id = $1 AND token_hash <> $2', [request.admin.id, request.admin.sessionHash]);
    await audit(request, { action: 'auth.password_changed', targetType: 'user', targetId: request.admin.id, summary: 'Changed own password' }, client);
  });
  response.json({ ok: true, message: 'Password updated. Other sessions have been signed out.' });
});

export default router;
