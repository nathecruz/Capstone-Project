import crypto from 'node:crypto';

/** Turns an email's local part (or any text) into a username: letters, digits, _ . - only. */
export function usernameBase(value, fallback = 'admin') {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 24) || fallback;
}

/** `base` if no account uses it yet, otherwise `base` plus a two-digit number. `run` is query or client.query. */
export async function availableUsername(run, base) {
  let username = base;
  while ((await run('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])).rowCount) {
    username = `${base}${crypto.randomInt(10, 99)}`;
  }
  return username;
}
