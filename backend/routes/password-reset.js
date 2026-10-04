// Password reset with an emailed one-time code (OTP).
//
// 1. POST /api/auth/forgot-password  { email }              -> emails a 6-digit code
// 2. POST /api/auth/verify-otp       { email, otp }         -> marks the code verified
// 3. POST /api/auth/reset-password   { email, otp, newPassword }
//
// Responses never reveal whether an email has an account: unknown and deactivated
// emails get the same answer (and the same resend cooldown) as real ones, but no email.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config/index.js';
import { query, withTransaction } from '../db/client.js';
import { resetRequestLimiter, resetVerificationLimiter } from '../http/rate-limits.js';
import { normalizeEmail, parse } from '../lib/http.js';
import { emailSchema, otpSchema, passwordSchema } from '../schemas.js';
import { findUser } from '../services/accounts.js';
import { passwordResetCodeEmail } from '../services/email-templates.js';
import { clearFailedLogins } from '../services/login-protection.js';
import { sendEmail } from '../services/mailer.js';
import { hashPassword, passwordStrength } from '../services/passwords.js';
import { notifyPasswordChanged } from './auth.js';

const { otpLifetimeMs, resendCooldownMs, maxAttempts, verifiedWindowMs } = config.passwordReset;
const minutes = Math.round(otpLifetimeMs / 60_000);

async function getReset(emailAddress) {
  const result = await query('SELECT email, otp_hash AS "otpHash", expires_at AS "expiresAt", attempts, verified_at AS "verifiedAt", created_at AS "createdAt" FROM password_reset_requests WHERE email=$1', [emailAddress]);
  return result.rows[0] ?? null;
}

const clearReset = (emailAddress) => query('DELETE FROM password_reset_requests WHERE email=$1', [emailAddress]);

/**
 * Shared checks for steps 2 and 3. Sends the error response and returns null when the
 * code is missing, expired, locked or wrong; otherwise returns the reset request.
 */
async function checkCode(emailAddress, otp, response) {
  const reset = await getReset(emailAddress);
  if (!reset) {
    response.status(404).json({ ok: false, message: 'No active reset request was found. Please request a new code.' });
    return null;
  }
  if (Date.now() > reset.expiresAt) {
    await clearReset(emailAddress);
    response.status(410).json({ ok: false, message: 'This code has expired. Please request a new one.' });
    return null;
  }
  if (reset.attempts >= maxAttempts) {
    await clearReset(emailAddress);
    response.status(429).json({ ok: false, message: 'Too many incorrect attempts. Please request a new code.' });
    return null;
  }
  if (!(await bcrypt.compare(otp, reset.otpHash))) {
    const attemptsLeft = maxAttempts - (reset.attempts + 1);
    if (attemptsLeft <= 0) {
      await clearReset(emailAddress);
      response.status(429).json({ ok: false, message: 'Too many incorrect attempts. Please request a new code.' });
      return null;
    }
    await query('UPDATE password_reset_requests SET attempts=attempts+1 WHERE email=$1', [emailAddress]);
    response.status(401).json({ ok: false, attemptsLeft, message: `The code is incorrect. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.` });
    return null;
  }
  return reset;
}

export default function registerPasswordResetRoutes(app) {
  app.post('/api/auth/forgot-password', resetRequestLimiter, async (request, response) => {
    const input = parse(z.object({ email: emailSchema }).strict(), request, response);
    if (!input) return;
    const emailAddress = normalizeEmail(input.email);
    const now = Date.now();

    const previous = await getReset(emailAddress);
    if (previous && now - previous.createdAt < resendCooldownMs) {
      const retryAfterSeconds = Math.ceil((resendCooldownMs - (now - previous.createdAt)) / 1000);
      return response.status(429).json({ ok: false, retryAfterSeconds, message: `Please wait ${retryAfterSeconds} seconds before requesting another code.` });
    }

    const user = await findUser(emailAddress);
    const canReset = Boolean(user && user.status !== 'deactivated');
    const otp = crypto.randomInt(100000, 1000000).toString();
    // Unknown emails still get a (random, never sent) code so every email behaves the same.
    const otpHash = await bcrypt.hash(canReset ? otp : crypto.randomUUID(), 10);
    await query(
      `INSERT INTO password_reset_requests(email,otp_hash,expires_at,attempts,verified_at,created_at) VALUES($1,$2,$3,0,NULL,$4)
       ON CONFLICT(email) DO UPDATE SET otp_hash=excluded.otp_hash,expires_at=excluded.expires_at,attempts=0,verified_at=NULL,created_at=excluded.created_at`,
      [emailAddress, otpHash, now + otpLifetimeMs, now],
    );

    if (canReset) {
      try {
        await sendEmail({ to: emailAddress, ...passwordResetCodeEmail({ name: user.firstName || user.fullName, code: otp, minutes }) });
      } catch (error) {
        await clearReset(emailAddress);
        console.error(`[mail] password reset email failed: ${error?.code ?? ''} ${error?.responseCode ?? ''} ${error?.message ?? ''}`.trim());
        return response.status(503).json({ ok: false, message: 'We could not send the verification email right now. Please try again in a few minutes.' });
      }
    }

    response.json({
      ok: true,
      message: `If an account exists for ${emailAddress}, a 6-digit code has been sent. It expires in ${minutes} minutes.`,
      email: emailAddress,
      expiresInSeconds: otpLifetimeMs / 1000,
      retryAfterSeconds: resendCooldownMs / 1000,
    });
  });

  app.post('/api/auth/verify-otp', resetVerificationLimiter, async (request, response) => {
    const input = parse(otpSchema, request, response);
    if (!input) return;
    const emailAddress = normalizeEmail(input.email);
    if (!(await checkCode(emailAddress, input.otp, response))) return;
    await query('UPDATE password_reset_requests SET verified_at=$1 WHERE email=$2', [Date.now(), emailAddress]);
    response.json({ ok: true, message: 'Code verified. You can now set a new password.', resetWindowSeconds: verifiedWindowMs / 1000 });
  });

  app.post('/api/auth/reset-password', resetVerificationLimiter, async (request, response) => {
    const input = parse(z.object({ email: emailSchema, otp: z.string().regex(/^\d{6}$/), newPassword: passwordSchema }).strict(), request, response);
    if (!input) return;
    const emailAddress = normalizeEmail(input.email);
    const reset = await checkCode(emailAddress, input.otp, response);
    if (!reset) return;
    if (!reset.verifiedAt || Date.now() - reset.verifiedAt > verifiedWindowMs) {
      return response.status(401).json({ ok: false, message: 'Please verify the code before setting a new password.' });
    }

    const user = await findUser(emailAddress);
    if (!user || user.status === 'deactivated') {
      await clearReset(emailAddress);
      return response.status(400).json({ ok: false, message: 'This password reset request is no longer valid.' });
    }
    const problem = passwordStrength(input.newPassword, user);
    if (problem) return response.status(400).json({ ok: false, message: problem });

    const hash = await hashPassword(input.newPassword);
    await withTransaction(async (db) => {
      await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
      await db.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
      await db.query('DELETE FROM password_reset_requests WHERE email=$1', [emailAddress]);
      await clearFailedLogins(user.id, db);
    });
    notifyPasswordChanged(user);
    response.json({ ok: true, message: 'Your password has been reset. You can now sign in with your new password.' });
  });
}
