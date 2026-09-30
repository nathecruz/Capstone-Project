import crypto from 'node:crypto';
import { z } from 'zod';
import { query, withTransaction } from '../db/client.js';
import { loginLimiter, registerLimiter } from '../http/rate-limits.js';
import { authToken, hashToken, normalizeEmail, parse } from '../lib/http.js';
import { loginSchema, passwordSchema, profileSchema, registerSchema } from '../schemas.js';
import { createSession, findUser, requireAuth, userFromRow } from '../services/accounts.js';
import { passwordChangedEmail } from '../services/email-templates.js';
import { sendEmail } from '../services/mailer.js';
import { hashPassword, passwordStrength, verifyPassword } from '../services/passwords.js';

// A real hash, so unknown emails take as long to reject as wrong passwords.
const timingDummyHash = await hashPassword(crypto.randomUUID());

const deviceLabel = (input, request) => input.device || request.get('user-agent')?.slice(0, 160) || 'Unknown device';

export function notifyPasswordChanged(user) {
  const email = passwordChangedEmail({ name: user.fullName });
  sendEmail({ to: user.email, ...email }).catch((error) => console.warn(`[mail] password-changed notice failed: ${error?.code ?? error?.message}`));
}

export default function registerAuthRoutes(app) {
  app.post('/api/auth/register', registerLimiter, async (request, response) => {
    const input = parse(registerSchema, request, response);
    if (!input) return;
    const emailAddress = normalizeEmail(input.email);
    const passwordError = passwordStrength(input.password, { fullName: input.fullName, username: input.username, email: emailAddress });
    if (passwordError) return response.status(400).json({ ok: false, message: passwordError });

    const existing = await query('SELECT email FROM users WHERE email = $1 OR lower(username) = lower($2)', [emailAddress, input.username]);
    if (existing.rows.length) {
      const message = existing.rows.some((row) => row.email === emailAddress) ? 'An account with this email already exists.' : 'This username is already in use.';
      return response.status(409).json({ ok: false, message });
    }

    const user = {
      id: crypto.randomUUID(),
      fullName: input.fullName,
      username: input.username,
      email: emailAddress,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      region: input.region,
      about: '',
      passwordHash: await hashPassword(input.password),
    };
    await withTransaction(async (db) => {
      await db.query(
        'INSERT INTO users (id, full_name, username, email, date_of_birth, gender, region, about, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [user.id, user.fullName, user.username, user.email, user.dateOfBirth, user.gender, user.region, user.about, user.passwordHash, Date.now()],
      );
      await db.query('INSERT INTO login_activity (id,user_id,device,created_at) VALUES ($1,$2,$3,$4)', [crypto.randomUUID(), user.id, deviceLabel(input, request), Date.now()]);
    });
    response.status(201).json({ ok: true, message: 'Account created successfully.', token: await createSession(user.id), user: userFromRow(user) });
  });

  app.post('/api/auth/login', loginLimiter, async (request, response) => {
    const input = parse(loginSchema, request, response);
    if (!input) return;
    const user = await findUser(input.email);
    const passwordOk = await verifyPassword(input.password, user?.passwordHash || timingDummyHash);
    if (!user || !passwordOk) return response.status(401).json({ ok: false, message: 'Incorrect email or password.' });
    if (user.status === 'deactivated') return response.status(403).json({ ok: false, message: 'This account has been deactivated. Please contact the HabitAI administrator.' });
    await query('INSERT INTO login_activity (id,user_id,device,created_at) VALUES ($1,$2,$3,$4)', [crypto.randomUUID(), user.id, deviceLabel(input, request), Date.now()]);
    response.json({ ok: true, message: 'Login successful.', token: await createSession(user.id), user: userFromRow(user) });
  });

  app.get('/api/auth/me', async (request, response) => {
    const session = await requireAuth(request, response);
    if (session) response.json({ ok: true, user: userFromRow(session) });
  });

  app.get('/api/auth/login-activity', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const result = await query('SELECT device, created_at AS "createdAt", login_date_time AS "loginDateTime" FROM login_activity WHERE user_id = $1 ORDER BY login_date_time DESC LIMIT 10', [session.userId]);
    response.json({ ok: true, activities: result.rows });
  });

  app.put('/api/auth/profile', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(profileSchema, request, response);
    if (!input) return;
    const emailAddress = normalizeEmail(input.email);
    const duplicate = await query('SELECT id FROM users WHERE (email = $1 OR lower(username) = lower($2)) AND id <> $3', [emailAddress, input.username, session.userId]);
    if (duplicate.rows[0]) return response.status(409).json({ ok: false, message: 'This email or username is already in use.' });
    await query('UPDATE users SET full_name=$1,username=$2,email=$3,date_of_birth=$4,gender=$5,about=$6 WHERE id=$7', [input.fullName, input.username, emailAddress, input.dateOfBirth, input.gender, input.about, session.userId]);
    const user = await findUser(emailAddress);
    response.json({ ok: true, message: 'Profile updated successfully.', user: userFromRow(user) });
  });

  app.post('/api/auth/logout', async (request, response) => {
    const token = authToken(request);
    if (token) await query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(token)]);
    response.json({ ok: true, message: 'Logged out successfully.' });
  });

  app.post('/api/auth/change-password', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict(), request, response);
    if (!input) return;
    const user = await findUser(session.email);
    if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) return response.status(401).json({ ok: false, message: 'The current password is incorrect.' });
    const error = passwordStrength(input.newPassword, user);
    if (error) return response.status(400).json({ ok: false, message: error });
    const hash = await hashPassword(input.newPassword);
    await withTransaction(async (db) => {
      await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
      await db.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    });
    notifyPasswordChanged(user);
    response.json({ ok: true, message: 'Your password has been updated. Please sign in again.' });
  });

  app.delete('/api/auth/account', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(z.object({ currentPassword: z.string().min(1).max(128) }).strict(), request, response);
    if (!input) return;
    const user = await findUser(session.email);
    if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) return response.status(401).json({ ok: false, message: 'The current password is incorrect.' });
    await query('DELETE FROM users WHERE id=$1', [user.id]);
    response.json({ ok: true, message: 'Your account and associated data have been permanently deleted.' });
  });
}
