// Email ownership check after sign-up (and after changing the account email).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from '../db/client.js';
import { emailVerificationCodeEmail } from './email-templates.js';
import { getEmailConfig, sendEmail } from './mailer.js';

const CODE_LIFETIME_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * Verification is enforced unless REQUIRE_EMAIL_VERIFICATION=false. Without working
 * email delivery it cannot be completed, so new accounts are then marked verified automatically
 * (logged as a warning) instead of being locked out.
 */
export function verificationEnabled() {
  return process.env.REQUIRE_EMAIL_VERIFICATION !== 'false' && getEmailConfig().configured;
}

export async function markVerified(userId, runner = { query }) {
  await runner.query('UPDATE users SET email_verified_at = $1 WHERE id = $2', [Date.now(), userId]);
  await runner.query('DELETE FROM email_verification_codes WHERE user_id = $1', [userId]);
}

/** Creates a fresh code and emails it. Returns { sent, retryAfterSeconds? }. */
export async function sendVerificationCode(user, { respectCooldown = true } = {}) {
  const now = Date.now();
  if (respectCooldown) {
    const previous = await query('SELECT created_at AS "createdAt" FROM email_verification_codes WHERE user_id = $1', [user.id]);
    const createdAt = previous.rows[0]?.createdAt;
    if (createdAt && now - createdAt < RESEND_COOLDOWN_MS) {
      return { sent: false, retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - (now - createdAt)) / 1000) };
    }
  }
  const code = crypto.randomInt(100000, 1000000).toString();
  await query(
    `INSERT INTO email_verification_codes(user_id, code_hash, expires_at, attempts, created_at) VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
    [user.id, await bcrypt.hash(code, 10), now + CODE_LIFETIME_MS, now],
  );
  try {
    await sendEmail({ to: user.email, ...emailVerificationCodeEmail({ name: user.firstName || user.fullName, code, minutes: CODE_LIFETIME_MS / 60000 }) });
    return { sent: true, expiresInSeconds: CODE_LIFETIME_MS / 1000, retryAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
  } catch (error) {
    console.error(`[mail] verification email failed: ${error?.code ?? ''} ${error?.message ?? ''}`.trim());
    return { sent: false };
  }
}

/** Checks a code. Returns { ok: true } or { ok: false, status, message, attemptsLeft? }. */
export async function verifyCode(userId, otp) {
  const result = await query('SELECT code_hash AS "codeHash", expires_at AS "expiresAt", attempts FROM email_verification_codes WHERE user_id = $1', [userId]);
  const row = result.rows[0];
  if (!row) return { ok: false, status: 404, message: 'No verification code is active. Tap Resend code.' };
  if (Date.now() > row.expiresAt) return { ok: false, status: 410, message: 'This code has expired. Tap Resend code for a new one.' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, status: 429, message: 'Too many incorrect attempts. Tap Resend code for a new one.' };
  if (!(await bcrypt.compare(otp, row.codeHash))) {
    await query('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE user_id = $1', [userId]);
    const attemptsLeft = MAX_ATTEMPTS - row.attempts - 1;
    return attemptsLeft > 0
      ? { ok: false, status: 401, attemptsLeft, message: `The code is incorrect. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.` }
      : { ok: false, status: 429, message: 'Too many incorrect attempts. Tap Resend code for a new one.' };
  }
  await markVerified(userId);
  return { ok: true };
}
