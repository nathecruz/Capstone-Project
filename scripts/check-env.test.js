import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const validatorPath = fileURLToPath(new URL('./check-env.js', import.meta.url));
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^EXPO_PUBLIC_.*(?:API_KEY|SECRET|PASSWORD|TOKEN)/i.test(name)),
);
const productionEnvironment = {
  ...inheritedEnvironment,
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://release:test@db.invalid/habitai?sslmode=require',
  ML_SERVICE_API_KEY: 'release-ml-key-0123456789abcdef-strong',
  ML_MODEL_RELEASE_APPROVED: 'true',
  ML_SERVICE_URL: 'https://ml.example.org',
  ALLOWED_ORIGINS: 'https://habit.example.org',
  AUTH_URL: 'https://auth.example.org/habit/auth',
  JWKS_URL: 'https://auth.example.org/habit/.well-known/jwks.json',
  EXPO_PUBLIC_API_URL: 'https://api.example.org',
  EXPO_PUBLIC_AUTH_URL: 'https://auth.example.org/habit/auth',
  GEMINI_API_KEY: 'release-gemini-key-for-validation',
  SMTP_USER: 'release-smtp-user',
  SMTP_PASSWORD: 'release-smtp-password',
};

function runValidator(environment) {
  return spawnSync(process.execPath, [validatorPath, '--production'], {
    env: environment,
    encoding: 'utf8',
  });
}

function runDeploymentValidator(environment) {
  return spawnSync(process.execPath, [validatorPath, '--deployment'], {
    env: environment,
    encoding: 'utf8',
  });
}

test('accepts valid production settings supplied by the platform environment', () => {
  const result = runValidator(productionEnvironment);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Environment configuration passed validation/);
});

test('allows initial deployment with ML disabled and optional Gemini/email unavailable', () => {
  const environment = {
    ...productionEnvironment,
    ML_MODEL_RELEASE_APPROVED: 'false',
    GEMINI_API_KEY: '',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
  };
  const result = runDeploymentValidator(environment);
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /Deployment preflight passed/);
  assert.match(output, /Live ML predictions are intentionally disabled/);
  assert.match(output, /Gemini Coach, Assistant, and Goal generation will be unavailable/);
  assert.match(output, /password-reset emails will be unavailable/);
});

test('keeps ML release approval separate from the initial deployment preflight', () => {
  const result = runDeploymentValidator({ ...productionEnvironment, ML_MODEL_RELEASE_APPROVED: 'true' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Keep ML_MODEL_RELEASE_APPROVED=false for the initial deployment/);
});

test('rejects development ML credentials and local production endpoints without printing secrets', () => {
  const environment = {
    ...productionEnvironment,
    ML_SERVICE_API_KEY: 'dev-only-local-key',
    ML_SERVICE_URL: 'http://localhost:8000',
    EXPO_PUBLIC_API_URL: 'http://localhost:8787',
  };
  const result = runValidator(environment);
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /ML_SERVICE_API_KEY/);
  assert.match(output, /ML_SERVICE_URL/);
  assert.match(output, /EXPO_PUBLIC_API_URL/);
  assert.equal(output.includes(environment.ML_SERVICE_API_KEY), false);
});

test('rejects private API keys exposed through Expo public variables', () => {
  const environment = {
    ...productionEnvironment,
    EXPO_PUBLIC_GEMINI_API_KEY: 'do-not-print-this-secret',
  };
  const result = runValidator(environment);
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /Do not expose API keys/);
  assert.equal(output.includes(environment.EXPO_PUBLIC_GEMINI_API_KEY), false);
});
