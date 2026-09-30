import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.NODE_ENV !== 'test') {
  dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });
}

const isProduction = process.env.NODE_ENV === 'production';

function list(value, fallback) {
  return (value || fallback).split(',').map((item) => item.trim()).filter(Boolean);
}

export const config = {
  serverRoot,
  isProduction,
  // API_PORT wins over PORT so the Vite dev server (which may be handed PORT) and the API never collide.
  port: Number(process.env.API_PORT || process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL?.trim() || '',
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX || 5),
  timeZone: process.env.APP_TIME_ZONE?.trim() || 'Asia/Manila',
  appName: process.env.APP_NAME?.trim() || 'HabitAI',
  sessionCookie: 'habitai_admin_session',
  sessionTtlMs: Number(process.env.ADMIN_SESSION_HOURS || 12) * 60 * 60 * 1000,
  allowedOrigins: list(process.env.ALLOWED_ORIGINS, 'http://localhost:5174,http://127.0.0.1:5174'),
  clientDist: path.resolve(serverRoot, process.env.CLIENT_DIST || '../client/dist'),
  trustProxy: process.env.TRUST_PROXY === 'true' || isProduction,
};

export function assertConfig() {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy server/.env.example to server/.env and add the Neon connection string.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone });
  } catch {
    throw new Error(`APP_TIME_ZONE "${config.timeZone}" is not a valid IANA time zone.`);
  }
}
