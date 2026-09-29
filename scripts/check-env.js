import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendEnvPath = path.join(projectRoot, 'backend', '.env');
const rootEnvPath = path.join(projectRoot, '.env');
const mlServiceEnvPath = path.join(projectRoot, 'ml-service', '.env');
const isPlaceholderValue = (value) => {
  if (!value) return true;
  const normalized = String(value).trim().toLowerCase();
  return normalized === ''
    || normalized.includes('replace-with')
    || normalized.includes('your-')
    || normalized.includes('your_')
    || normalized.includes('yourrealgmail')
    || normalized.includes('@example.')
    || normalized.includes('ep-example')
    || normalized.includes('user:password')
    || normalized.includes('localhost')
    || normalized.includes('dev-only-');
};
const parseEnv = (filePath) => {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return separator < 0 ? [line.trim(), ''] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
};
const hasEnvFile = existsSync(rootEnvPath) || existsSync(backendEnvPath) || existsSync(mlServiceEnvPath);
const values = { ...parseEnv(rootEnvPath), ...parseEnv(backendEnvPath), ...parseEnv(mlServiceEnvPath), ...process.env };
const nodeEnv = String(values.NODE_ENV || 'development').toLowerCase();
const isDeployment = process.argv.includes('--deployment');
const isStrictProduction = process.argv.includes('--production') || (nodeEnv === 'production' && !isDeployment);
const isProduction = isDeployment || isStrictProduction;
const deployIssues = [];
const warnings = [];
const isLocalUrl = (value) => {
  if (!value) return true;
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
};
const isHttpsUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !isLocalUrl(value);
  } catch {
    return false;
  }
};
const isValidServiceUrl = (value) => {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !isLocalUrl(value);
  } catch {
    return false;
  }
};
const isValidProductionOrigin = (value) => {
  try {
    const origin = value.trim();
    const parsed = new URL(origin);
    return parsed.protocol === 'https:'
      && parsed.origin === origin.replace(/\/$/, '')
      && !isLocalUrl(origin);
  } catch {
    return false;
  }
};
const hasProductionDatabaseUrl = (value) => {
  if (!value || isPlaceholderValue(value)) return false;
  try {
    const databaseUrl = new URL(value);
    const usesPostgres = databaseUrl.protocol === 'postgres:' || databaseUrl.protocol === 'postgresql:';
    const sslMode = databaseUrl.searchParams.get('sslmode');
    const sslEnabled = databaseUrl.searchParams.get('ssl')?.toLowerCase() === 'true';
    return usesPostgres && Boolean(databaseUrl.hostname) && (sslEnabled || ['require', 'verify-ca', 'verify-full'].includes(sslMode || ''));
  } catch {
    return false;
  }
};

if (!hasEnvFile && !isProduction && Object.keys(process.env).length === 0) {
  console.error('No .env file found. Run npm run setup:env and populate the deployment values.');
  process.exit(1);
}

if (isProduction && !hasProductionDatabaseUrl(values.DATABASE_URL)) {
  deployIssues.push('DATABASE_URL must be a real PostgreSQL URL with TLS enabled in production.');
} else if (!isProduction && !values.DATABASE_URL && !values.DATABASE_PATH) {
  deployIssues.push('Set DATABASE_URL or DATABASE_PATH in the backend environment.');
}
if (process.argv.includes('--production') && nodeEnv !== 'production') {
  deployIssues.push('NODE_ENV must be explicitly set to production for a production deployment.');
}
if (isDeployment && nodeEnv !== 'production') {
  deployIssues.push('NODE_ENV must be set to production for a deployment preflight.');
}
if (!values.ML_SERVICE_API_KEY || isPlaceholderValue(values.ML_SERVICE_API_KEY)) {
  if (isProduction) deployIssues.push('ML_SERVICE_API_KEY must be set to the deployed ML service key in production.');
  else warnings.push('ML_SERVICE_API_KEY is still a placeholder or dev-only value. Replace it before deployment.');
} else if (isProduction && String(values.ML_SERVICE_API_KEY).trim().length < 32) {
  deployIssues.push('ML_SERVICE_API_KEY must contain at least 32 characters in production.');
}
const mlModelApproved = String(values.ML_MODEL_RELEASE_APPROVED || '').trim().toLowerCase() === 'true';
if (isStrictProduction && !mlModelApproved) {
  deployIssues.push('ML_MODEL_RELEASE_APPROVED must be true only after verifying real approved training outcomes and an independent holdout evaluation.');
}
if (isDeployment && mlModelApproved) {
  deployIssues.push('Keep ML_MODEL_RELEASE_APPROVED=false for the initial deployment; use npm run check:env:production only after the model has passed independent real-data evaluation.');
} else if (isDeployment) {
  warnings.push('Live ML predictions are intentionally disabled until an approved real-data model evaluation is available.');
}
if (!values.ML_SERVICE_URL || isPlaceholderValue(values.ML_SERVICE_URL) || (isProduction && !isValidServiceUrl(values.ML_SERVICE_URL))) {
  if (isProduction) deployIssues.push('ML_SERVICE_URL must point to the deployed ML service, not localhost, in production.');
  else warnings.push('ML_SERVICE_URL is a local placeholder. Replace it with the live ML URL before deployment.');
}
const allowedOrigins = String(values.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
if (allowedOrigins.length === 0 || isPlaceholderValue(values.ALLOWED_ORIGINS) || (isProduction && allowedOrigins.some((origin) => !isValidProductionOrigin(origin)))) {
  if (isProduction) deployIssues.push('ALLOWED_ORIGINS must use the deployed frontend origins in production.');
  else warnings.push('ALLOWED_ORIGINS still contains local-only origins. Replace it with deployed origins before release.');
}
const publicApiUrl = values.EXPO_PUBLIC_API_URL || values.EXPO_PUBLIC_AI_API_URL;
if (isProduction && (!publicApiUrl || !isHttpsUrl(publicApiUrl))) {
  deployIssues.push('EXPO_PUBLIC_API_URL must be a deployed HTTPS backend URL in production.');
}
const publicAuthUrl = values.EXPO_PUBLIC_AUTH_URL || values.AUTH_URL;
if (isProduction && (!publicAuthUrl || !isHttpsUrl(publicAuthUrl))) {
  deployIssues.push('EXPO_PUBLIC_AUTH_URL or AUTH_URL must be a deployed HTTPS Neon Auth URL in production.');
}
const jwksUrl = values.JWKS_URL || values.AUTH_JWKS_URL || values.NEON_JWKS_URL;
if (isProduction && (!jwksUrl || !isHttpsUrl(jwksUrl) || !String(jwksUrl).includes('/.well-known/jwks.json'))) {
  deployIssues.push('JWKS_URL/AUTH_JWKS_URL must point to the Neon Auth JWKS endpoint in production.');
}
const publicSecretVariables = Object.keys(values).filter((name) => (
  /^EXPO_PUBLIC_.*(?:API_KEY|SECRET|PASSWORD|TOKEN)/i.test(name) && Boolean(values[name])
));
if (publicSecretVariables.length > 0) {
  deployIssues.push('Do not expose API keys, secrets, passwords, or tokens in EXPO_PUBLIC_ variables.');
}
const configuredGeminiKeys = ['GEMINI_API_KEY', 'GEMINI_API_KEY_GOALS', 'GEMINI_API_KEY_COACH', 'GEMINI_API_KEY_ASSISTANT']
  .map((name) => values[name])
  .filter((value) => value && !isPlaceholderValue(value));
if (configuredGeminiKeys.length === 0) {
  if (isStrictProduction) deployIssues.push('At least one Gemini API key must be set for the production AI feature.');
  else if (isDeployment) warnings.push('GEMINI_API_KEY is missing; Gemini Coach, Assistant, and Goal generation will be unavailable.');
  else warnings.push('GEMINI_API_KEY is missing or placeholder; AI features will fall back locally.');
}
if ((!values.SMTP_USER || isPlaceholderValue(values.SMTP_USER)) && (!values.GMAIL_USER || isPlaceholderValue(values.GMAIL_USER))) {
  if (isStrictProduction) deployIssues.push('SMTP_USER or GMAIL_USER must be configured for production email delivery.');
  else if (isDeployment) warnings.push('SMTP/Gmail credentials are missing; password-reset emails will be unavailable.');
  else warnings.push('SMTP/Gmail credentials are not configured; password reset emails will be disabled until set.');
}
const emailUser = values.SMTP_USER || values.GMAIL_USER;
const emailPassword = values.SMTP_PASSWORD || values.GMAIL_APP_PASSWORD;
if ((!emailUser || isPlaceholderValue(emailUser)) || (!emailPassword || isPlaceholderValue(emailPassword))) {
  if (isStrictProduction) deployIssues.push('A complete SMTP_USER/SMTP_PASSWORD or GMAIL_USER/GMAIL_APP_PASSWORD pair is required for production email delivery.');
  else if (isDeployment && !warnings.some((warning) => warning.includes('password-reset emails'))) warnings.push('A complete SMTP/Gmail credential pair is required for password-reset emails.');
}
if (deployIssues.length > 0) {
  console.error('Environment validation failed:');
  for (const item of deployIssues) console.error(`- ${item}`);
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn(isDeployment
    ? 'Deployment preflight passed with optional capabilities disabled or warnings:'
    : 'Environment validation passed for local/dev mode with warnings:');
  for (const item of warnings) console.warn(`- ${item}`);
} else {
  console.log('Environment configuration passed validation.');
}
