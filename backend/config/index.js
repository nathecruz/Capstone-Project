import { isTemplateValue, loadEnvironment } from './env.js';

loadEnvironment();

const env = process.env;
export const isProduction = env.NODE_ENV === 'production';

export function isLocalUrl(value) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

/** A secret that is set, is not a template value and (in production) is long enough. */
export function isConfiguredSecret(value, allowDevelopmentKey = false) {
  if (!value || isTemplateValue(value) || isLocalUrl(value)) return false;
  return allowDevelopmentKey || (value.trim().length >= 32 && !value.startsWith('dev-only-'));
}

function list(value, fallback) {
  return new Set((value || fallback).split(',').map((item) => item.trim()).filter(Boolean));
}

// Browsers send an origin in lower case with no trailing slash; an entry typed as
// "https://Example.vercel.app/" in the dashboard must still match it.
const normalizeOrigin = (origin) => origin.trim().replace(/\/+$/, '').toLowerCase();

/**
 * Builds the CORS check for ALLOWED_ORIGINS. An entry may hold `*` to accept every deployment
 * address of one project (Vercel gives each deploy its own URL), e.g.
 * https://capstone-project-*-team-c14.vercel.app. `*` only stands for letters, digits and
 * dashes, so it never crosses a dot or a slash into another domain.
 */
export function originMatcher(origins) {
  const exact = new Set();
  const patterns = [];
  for (const entry of origins) {
    const origin = normalizeOrigin(entry);
    if (!origin.includes('*')) {
      exact.add(origin);
      continue;
    }
    const source = origin.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]+');
    patterns.push(new RegExp(`^${source}$`));
  }
  return (value) => {
    const origin = normalizeOrigin(value);
    return exact.has(origin) || patterns.some((pattern) => pattern.test(origin));
  };
}

/** Whether the value is an IANA time zone this runtime knows (e.g. Asia/Manila). */
export function isTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const intBetween = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};
/**
 * A real calendar day (YYYY-MM-DD), else `fallback`. Date.parse rolls 2026-02-30 over to March 2,
 * but the database refuses it, so the day must come back unchanged.
 */
export function dateKeyOr(value, fallback) {
  const text = value?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fallback;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : fallback;
}

const allowedOrigins = list(env.ALLOWED_ORIGINS, 'http://localhost:19006,http://localhost:19080,http://localhost:8081');

export const config = {
  isProduction,
  port: Number(env.PORT || 8787),
  timeoutMs: Math.max(1000, Number(env.EXTERNAL_REQUEST_TIMEOUT_MS) || 15000),
  allowedOrigins,
  isAllowedOrigin: originMatcher(allowedOrigins),
  // The campus time zone: the leaderboard's weeks and months, and the account day of a student whose
  // app has not sent a time zone yet. The Admin Panel reads the same APP_TIME_ZONE.
  appTimeZone: isTimeZone(env.APP_TIME_ZONE?.trim()) ? env.APP_TIME_ZONE.trim() : 'Asia/Manila',
  ml: {
    url: env.ML_SERVICE_URL?.trim() || 'http://localhost:8000',
    key: env.ML_SERVICE_API_KEY?.trim() || '',
    // A sleeping free Render instance needs up to about a minute to start.
    timeoutMs: Math.max(1000, Number(env.ML_REQUEST_TIMEOUT_MS) || 60000),
  },
  session: {
    // A sign-in lasts 30 days (until the student signs out, changes the password or is deactivated).
    lifetimeMs: 30 * 24 * 60 * 60 * 1000,
  },
  checkIns: {
    // A check-in can be undone this long after it was made (the app offers Undo for 10 s);
    // after that it is locked, so tokens and streaks cannot be toggled back and forth.
    undoWindowMs: Math.max(1000, Number(env.CHECK_IN_UNDO_WINDOW_MS) || 30 * 1000),
    // Tokens are paid for this many check-ins a day; later ones still count for streaks, challenges
    // and quests (services/wallet.js).
    paidPerDay: intBetween(env.PAID_CHECK_INS_PER_DAY, 1, 50, 6),
    // From this day on (a Monday, so no week is split), a day counts at most paidPerDay check-ins
    // toward points, the leaderboard and Habi's growth.
    cappedFrom: dateKeyOr(env.CHECK_IN_CAP_FROM, '2026-10-26'),
  },
  passwordReset: {
    otpLifetimeMs: 10 * 60 * 1000,
    resendCooldownMs: 60 * 1000,
    maxAttempts: 5,
    verifiedWindowMs: 10 * 60 * 1000,
  },
  appState: {
    // Older snapshots are pruned; the latest one is the source of truth.
    snapshotsToKeep: 20,
  },
};

/**
 * Fails fast on configuration that would make the deployed API unusable.
 * Neon Auth (AUTH_URL / JWKS_URL) is not used by this API: sign-in uses the
 * app's own bcrypt accounts and hashed session tokens, so those are optional.
 */
export function assertProductionConfig() {
  if (!isProduction) return;
  const problems = [];
  if (!env.DATABASE_URL?.trim() || isTemplateValue(env.DATABASE_URL)) problems.push('DATABASE_URL must be configured.');
  if (!env.ML_SERVICE_URL?.trim()) problems.push('ML_SERVICE_URL must be configured.');
  else if (isLocalUrl(config.ml.url)) problems.push('ML_SERVICE_URL must not use localhost.');
  if (!isConfiguredSecret(config.ml.key)) problems.push('ML_SERVICE_API_KEY must be a real secret of at least 32 characters.');
  if (!env.ALLOWED_ORIGINS?.trim()) problems.push('ALLOWED_ORIGINS must be configured.');
  else if ([...config.allowedOrigins].some(isLocalUrl)) problems.push('ALLOWED_ORIGINS must not use localhost.');
  if (env.APP_TIME_ZONE?.trim() && !isTimeZone(env.APP_TIME_ZONE.trim())) problems.push(`APP_TIME_ZONE "${env.APP_TIME_ZONE.trim()}" is not a valid IANA time zone.`);
  if (problems.length) throw new Error(`Invalid production configuration:\n- ${problems.join('\n- ')}`);
}
