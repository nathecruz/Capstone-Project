import crypto from 'node:crypto';
import { z } from 'zod';
import { query, withTransaction } from '../db/client.js';
import { loginLimiter, registerLimiter, resendVerificationLimiter } from '../http/rate-limits.js';
import { authToken, hashToken, normalizeEmail, parse } from '../lib/http.js';
import { namesFromInput } from '../lib/names.js';
import { loginSchema, passwordSchema, profileSchema, registerSchema } from '../schemas.js';
import { createSession, findUser, requireAuth, userFromRow } from '../services/accounts.js';
import { passwordChangedEmail } from '../services/email-templates.js';
import { sendVerificationCode, verificationEnabled, verifyCode } from '../services/email-verification.js';
import { sendEmail } from '../services/mailer.js';
import { hashPassword, passwordStrength, verifyPassword } from '../services/passwords.js';

// A real hash, so unknown emails take as long to reject as wrong passwords.
const timingDummyHash = await hashPassword(crypto.randomUUID());

const deviceLabel = (input, request) => input.device || request.get('user-agent')?.slice(0, 160) || 'Unknown device';

export function notifyPasswordChanged(user) {
  const email = passwordChangedEmail({ name: user.firstName || user.fullName });
  sendEmail({ to: user.email, ...email }).catch((error) => console.warn(`[mail] password-changed notice failed: ${error?.code ?? error?.message}`));
}

/**
 * First and last name from the request (older app versions send one `fullName`, which is split).
 * Sends a 400 and returns null when a name is missing.
 */
function requireNames(input, response) {
  const names = namesFromInput(input);
  const usesSplitFields = input.firstName !== undefined || input.lastName !== undefined;
  if (!names.firstName || (usesSplitFields && !names.lastName)) {
    response.status(400).json({ ok: false, message: 'Please enter your first name and last name.' });
    return null;
  }
  return names;
}

export default function registerAuthRoutes(app) {
  app.post('/api/auth/register', registerLimiter, async (request, response) => {
    const input = parse(registerSchema, request, response);
    if (!input) return;
    // Data Privacy Act (RA 10173): personal data is only collected with the student's consent.
    if (input.privacyConsent !== true) return response.status(400).json({ ok: false, message: 'Please read and agree to the Privacy Notice to create an account.' });
    const names = requireNames(input, response);
    if (!names) return;
    const emailAddress = normalizeEmail(input.email);
    const passwordError = passwordStrength(input.password, { fullName: names.fullName, username: input.username, email: emailAddress });
    if (passwordError) return response.status(400).json({ ok: false, message: passwordError });

    const existing = await query('SELECT email FROM users WHERE email = $1 OR lower(username) = lower($2)', [emailAddress, input.username]);
    if (existing.rows.length) {
      const message = existing.rows.some((row) => row.email === emailAddress) ? 'An account with this email already exists.' : 'This username is already in use.';
      return response.status(409).json({ ok: false, message });
    }

    const user = {
      id: crypto.randomUUID(),
      ...names,
      username: input.username,
      email: emailAddress,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      region: input.region,
      about: '',
      passwordHash: await hashPassword(input.password),
    };
    const now = Date.now();
    const mustVerify = verificationEnabled();
    if (!mustVerify) console.warn('[auth] email verification skipped for a new account: SMTP is not configured or REQUIRE_EMAIL_VERIFICATION=false.');
    user.emailVerifiedAt = mustVerify ? null : now;
    user.privacyConsentAt = now;
    await withTransaction(async (db) => {
      await db.query(
        'INSERT INTO users (id, full_name, first_name, last_name, username, email, date_of_birth, gender, region, about, password_hash, created_at, email_verified_at, privacy_consent_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [user.id, user.fullName, user.firstName, user.lastName, user.username, user.email, user.dateOfBirth, user.gender, user.region, user.about, user.passwordHash, now, user.emailVerifiedAt, now],
      );
      await db.query('INSERT INTO login_activity (id,user_id,device,created_at) VALUES ($1,$2,$3,$4)', [crypto.randomUUID(), user.id, deviceLabel(input, request), now]);
    });
    const verification = mustVerify ? await sendVerificationCode(user, { respectCooldown: false }) : null;
    response.status(201).json({
      ok: true,
      message: mustVerify ? 'Account created. Enter the code we emailed you to confirm your address.' : 'Account created successfully.',
      token: await createSession(user.id),
      user: userFromRow(user),
      verification,
    });
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
    const session = await requireAuth(request, response, { allowUnverified: true });
    if (session) response.json({ ok: true, user: userFromRow(session) });
  });

  // Email verification ------------------------------------------------------------------
  app.post('/api/auth/email/resend', resendVerificationLimiter, async (request, response) => {
    const session = await requireAuth(request, response, { allowUnverified: true });
    if (!session) return;
    if (session.emailVerifiedAt) return response.json({ ok: true, alreadyVerified: true, message: 'Your email is already confirmed.' });
    const result = await sendVerificationCode({ id: session.userId, email: session.email, firstName: session.firstName, fullName: session.fullName });
    if (result.retryAfterSeconds && !result.sent) return response.status(429).json({ ok: false, retryAfterSeconds: result.retryAfterSeconds, message: `Please wait ${result.retryAfterSeconds} seconds before requesting another code.` });
    if (!result.sent) return response.status(503).json({ ok: false, message: 'We could not send the email right now. Please try again in a few minutes.' });
    response.json({ ok: true, message: `A new code was sent to ${session.email}.`, ...result });
  });

  app.post('/api/auth/email/verify', resendVerificationLimiter, async (request, response) => {
    const session = await requireAuth(request, response, { allowUnverified: true });
    if (!session) return;
    const input = parse(z.object({ otp: z.string().regex(/^\d{6}$/) }).strict(), request, response);
    if (!input) return;
    if (session.emailVerifiedAt) return response.json({ ok: true, user: userFromRow(session) });
    const result = await verifyCode(session.userId, input.otp);
    if (!result.ok) return response.status(result.status).json({ ok: false, message: result.message, attemptsLeft: result.attemptsLeft });
    response.json({ ok: true, message: 'Email confirmed. Welcome to HabitAI!', user: userFromRow({ ...session, emailVerifiedAt: Date.now() }) });
  });

  // Privacy consent for accounts created before the Privacy Notice was added.
  app.post('/api/auth/consent', async (request, response) => {
    const session = await requireAuth(request, response, { allowUnverified: true });
    if (!session) return;
    const input = parse(z.object({ accepted: z.literal(true) }).strict(), request, response);
    if (!input) return;
    const now = Date.now();
    await query('UPDATE users SET privacy_consent_at = COALESCE(privacy_consent_at, $1) WHERE id = $2', [now, session.userId]);
    response.json({ ok: true, user: userFromRow({ ...session, privacyConsentAt: session.privacyConsentAt ?? now }) });
  });

  app.get('/api/auth/login-activity', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const result = await query('SELECT device, created_at AS "createdAt", login_date_time AS "loginDateTime" FROM login_activity WHERE user_id = $1 ORDER BY login_date_time DESC LIMIT 10', [session.userId]);
    response.json({ ok: true, activities: result.rows });
  });

  // Allowed before verification so a mistyped sign-up email can be corrected.
  app.put('/api/auth/profile', async (request, response) => {
    const session = await requireAuth(request, response, { allowUnverified: true });
    if (!session) return;
    const input = parse(profileSchema, request, response);
    if (!input) return;
    const names = requireNames(input, response);
    if (!names) return;
    const emailAddress = normalizeEmail(input.email);
    const duplicate = await query('SELECT id FROM users WHERE (email = $1 OR lower(username) = lower($2)) AND id <> $3', [emailAddress, input.username, session.userId]);
    if (duplicate.rows[0]) return response.status(409).json({ ok: false, message: 'This email or username is already in use.' });
    const emailChanged = emailAddress !== session.email;
    const reverify = emailChanged && verificationEnabled();
    await query(
      'UPDATE users SET full_name=$1,username=$2,email=$3,date_of_birth=$4,gender=$5,about=$6, email_verified_at = CASE WHEN $8 THEN NULL ELSE email_verified_at END, first_name=$9, last_name=$10 WHERE id=$7',
      [names.fullName, input.username, emailAddress, input.dateOfBirth, input.gender, input.about, session.userId, reverify, names.firstName, names.lastName],
    );
    const user = await findUser(emailAddress);
    if (reverify) await sendVerificationCode(user, { respectCooldown: false });
    response.json({
      ok: true,
      message: reverify ? 'Profile updated. Enter the code we sent to your new email address to confirm it.' : 'Profile updated successfully.',
      user: userFromRow(user),
    });
  });

  // Data portability (RA 10173): everything stored about the student, as one JSON file.
  app.get('/api/auth/export', async (request, response) => {
    const session = await requireAuth(request, response, { allowUnverified: true });
    if (!session) return;
    const id = session.userId;
    const [profile, habits, completions, goals, tokens, achievements, notifications, logins, preferences, reports, suggestions] = await Promise.all([
      query('SELECT first_name AS "firstName", last_name AS "lastName", full_name AS "fullName", username, email, date_of_birth AS "dateOfBirth", gender, region, about, created_at AS "createdAt", privacy_consent_at AS "privacyConsentAt" FROM users WHERE id=$1', [id]),
      query('SELECT label, category, meta, goal, streak, reminder_enabled AS "reminderEnabled", reminder_time AS "reminderTime" FROM habits WHERE user_id=$1 ORDER BY sort_order', [id]),
      query('SELECT habit_id AS "habitId", completed_date::text AS date FROM habit_completions WHERE user_id=$1 ORDER BY completed_date', [id]),
      query('SELECT title, category, progress, status, details_json AS details FROM goals WHERE user_id=$1', [id]),
      query('SELECT amount, label, transaction_date AS date FROM token_transactions WHERE user_id=$1 ORDER BY transaction_date', [id]),
      query('SELECT a.name, ua.earned_at AS "earnedAt" FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id=$1', [id]),
      query('SELECT type, title, body, read_at AS "readAt", created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at DESC', [id]),
      query('SELECT device, login_date_time AS "loginAt" FROM login_activity WHERE user_id=$1 ORDER BY login_date_time DESC', [id]),
      query('SELECT preferences_json AS preferences FROM user_preferences WHERE user_id=$1', [id]),
      query('SELECT topic, timing, description, status, attachment_name AS "attachmentName", created_at AS "createdAt" FROM issue_reports WHERE user_id=$1', [id]),
      query('SELECT suggestion, created_at AS "createdAt" FROM feature_suggestions WHERE user_id=$1', [id]),
    ]);
    response.setHeader('Content-Disposition', `attachment; filename="habitai-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
    response.json({
      exportedAt: new Date().toISOString(),
      profile: profile.rows[0],
      preferences: preferences.rows[0]?.preferences ?? {},
      habits: habits.rows,
      checkIns: completions.rows,
      goals: goals.rows,
      tokenHistory: tokens.rows,
      achievements: achievements.rows,
      notifications: notifications.rows,
      signIns: logins.rows,
      issueReports: reports.rows,
      featureSuggestions: suggestions.rows,
    });
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
    const session = await requireAuth(request, response, { allowUnverified: true });
    if (!session) return;
    const input = parse(z.object({ currentPassword: z.string().min(1).max(128) }).strict(), request, response);
    if (!input) return;
    const user = await findUser(session.email);
    if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) return response.status(401).json({ ok: false, message: 'The current password is incorrect.' });
    await query('DELETE FROM users WHERE id=$1', [user.id]);
    response.json({ ok: true, message: 'Your account and associated data have been permanently deleted.' });
  });
}
