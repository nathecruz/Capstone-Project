import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

// Same cost factor the HabitAI app backend uses, so hashes are interchangeable.
const BCRYPT_COST = 12;

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password, hash) {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(password, hash);
}

export function passwordProblem(password, context = {}) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters long.';
  if (value.length > 128) return 'Password must be at most 128 characters long.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9\s]/].filter((pattern) => pattern.test(value)).length;
  if (classes < 4) return 'Use uppercase and lowercase letters, a number, and a symbol.';
  const lower = value.toLowerCase();
  const personal = [context.fullName, context.username, context.email?.split('@')[0]]
    .filter(Boolean)
    .flatMap((item) => String(item).toLowerCase().split(/[^a-z0-9]+/))
    .filter((part) => part.length >= 3);
  if (personal.some((part) => lower.includes(part))) return 'Password must not contain the name, username, or email.';
  if (/(.)\1{2,}/.test(value)) return 'Avoid repeating the same character three or more times.';
  return null;
}

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!#$%&*?@';

function pick(alphabet) {
  return alphabet[crypto.randomInt(alphabet.length)];
}

export function generatePassword(length = 14) {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  for (;;) {
    const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
    while (chars.length < length) chars.push(pick(all));
    for (let index = chars.length - 1; index > 0; index -= 1) {
      const swap = crypto.randomInt(index + 1);
      [chars[index], chars[swap]] = [chars[swap], chars[index]];
    }
    const candidate = chars.join('');
    if (!passwordProblem(candidate)) return candidate;
  }
}
