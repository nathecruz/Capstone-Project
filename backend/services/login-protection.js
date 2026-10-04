// Sign-in protection for one account, whatever network the attempts come from (the rate limit
// only counts per network): after too many wrong passwords in a row, sign-in to the account is
// paused for a while and its owner gets an email. Resetting the password ends the pause.
import { query } from '../db/client.js';
import { signInPausedEmail } from './email-templates.js';
import { sendEmail } from './mailer.js';

/** Wrong passwords within FAILURE_WINDOW_MS before sign-in is paused. */
export const MAX_FAILED_LOGINS = 8;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

/** Milliseconds sign-in to this account stays paused (0 when it is not paused). */
export function lockedFor(user, now = Date.now()) {
  const until = Number(user?.loginLockedUntil ?? 0);
  return until > now ? until - now : 0;
}

export function lockedMessage(milliseconds) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60000));
  return `For your security, sign-in to this account is paused for ${minutes} minute${minutes === 1 ? '' : 's'} after too many wrong passwords. Try again later or use "Forgot password".`;
}

/** Counts a wrong password; pauses sign-in when it is one too many. Returns the pause in ms (0 if none). */
export async function recordFailedLogin(user, now = Date.now()) {
  const result = await query(
    `UPDATE users
        SET failed_logins = CASE WHEN failed_login_at IS NULL OR failed_login_at < $2 THEN 1 ELSE failed_logins + 1 END,
            failed_login_at = $3
      WHERE id = $1
  RETURNING failed_logins AS "failedLogins"`,
    [user.id, now - FAILURE_WINDOW_MS, now],
  );
  if ((result.rows[0]?.failedLogins ?? 0) < MAX_FAILED_LOGINS) return 0;
  await query('UPDATE users SET login_locked_until = $2, failed_logins = 0, failed_login_at = NULL WHERE id = $1', [user.id, now + LOCK_MS]);
  const email = signInPausedEmail({ name: user.firstName || user.fullName, minutes: LOCK_MS / 60000, when: new Date(now) });
  sendEmail({ to: user.email, ...email }).catch((error) => console.warn(`[mail] sign-in paused notice failed: ${error?.code ?? error?.message}`));
  return LOCK_MS;
}

/** A correct password (or a password reset) starts the count again. */
export async function clearFailedLogins(userId, db = { query }) {
  await db.query('UPDATE users SET failed_logins = 0, failed_login_at = NULL, login_locked_until = NULL WHERE id = $1 AND (failed_logins > 0 OR login_locked_until IS NOT NULL)', [userId]);
}
