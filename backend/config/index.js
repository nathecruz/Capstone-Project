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

export const config = {
  isProduction,
  port: Number(env.PORT || 8787),
  timeoutMs: Math.max(1000, Number(env.EXTERNAL_REQUEST_TIMEOUT_MS) || 15000),
  allowedOrigins: list(env.ALLOWED_ORIGINS, 'http://localhost:19006,http://localhost:19080,http://localhost:8081'),
  ml: {
    url: env.ML_SERVICE_URL?.trim() || 'http://localhost:8000',
    key: env.ML_SERVICE_API_KEY?.trim() || '',
    // A sleeping free Render instance needs up to about a minute to start.
    timeoutMs: Math.max(1000, Number(env.ML_REQUEST_TIMEOUT_MS) || 60000),
  },
  session: {
    lifetimeMs: 7 * 24 * 60 * 60 * 1000,
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
  if (problems.length) throw new Error(`Invalid production configuration:\n- ${problems.join('\n- ')}`);
}
