import bcrypt from 'bcryptjs';

const BCRYPT_COST = 12;

// Async bcrypt keeps the event loop free while hashing (the sync versions block every request).
export const hashPassword = (value) => bcrypt.hash(value, BCRYPT_COST);
export const verifyPassword = (value, hash) => (hash ? bcrypt.compare(value, hash) : Promise.resolve(false));

/** Returns a user-facing problem with the password, or null when it is acceptable. */
export function passwordStrength(value, context = {}) {
  const pass = String(value || '').trim();
  if (!pass) return 'Password is required.';
  if (pass.length < 8) return 'Password must be at least 8 characters long.';
  const lower = pass.toLowerCase();
  const characterClasses = [/[a-z]/.test(pass), /[A-Z]/.test(pass), /\d/.test(pass), /[^A-Za-z0-9\s]/.test(pass)].filter(Boolean).length;
  const seeds = [context.fullName, context.username, context.email?.split('@')[0], context.email, 'habitai', 'habit', 'habits', 'tracker', 'goals', 'progress', 'account', 'password', 'admin', 'qwerty', 'welcome', 'letmein', 'login', '123456']
    .filter(Boolean)
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((seed) => seed.length >= 3);
  if (seeds.some((seed) => lower.includes(seed))) return 'Choose a stronger password that avoids common words, personal details, dates, and app-specific terms.';
  if (/(?:19\d{2}|20\d{2})/.test(pass)) return 'Avoid years such as your birth year in your password.';
  if (characterClasses < 4) return 'Use at least 8 characters with uppercase letters, lowercase letters, numbers, and symbols.';
  if (/(.)\1{2,}/.test(pass) || (/(?:123|456|789)/.test(lower) && pass.length <= 24)) return 'Avoid repeated or predictable patterns such as repeated characters or common numeric sequences.';
  return null;
}
