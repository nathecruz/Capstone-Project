import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** True for values copied from `.env.example` templates that must never be treated as real config. */
export function isTemplateValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return true;
  return /^x+$/.test(normalized)
    || normalized.includes('replace-with')
    || /(^|[^a-z])your[-_]/.test(normalized)
    || normalized.includes('ep-example')
    || normalized.includes('@example.')
    || normalized.includes('example.com')
    || normalized.includes('user:password@');
}

let loaded = false;

/**
 * Loads `backend/.env`, then the repository-root `.env`, without overriding real
 * environment variables. A template placeholder in one file never hides a real
 * value in the other, so local development works with either file.
 * Tests pass their own environment and skip file loading entirely.
 */
export function loadEnvironment({
  files = [path.join(backendRoot, '.env'), path.join(backendRoot, '..', '.env')],
  target = process.env,
  force = false,
} = {}) {
  if ((loaded && !force) || target.NODE_ENV === 'test') return;
  loaded = true;
  for (const file of files) {
    if (!existsSync(file)) continue;
    const parsed = dotenv.parse(readFileSync(file));
    for (const [key, value] of Object.entries(parsed)) {
      const current = target[key];
      const unset = current === undefined || current === '';
      if (unset || (isTemplateValue(current) && !isTemplateValue(value))) {
        if (value !== '' || unset) target[key] = value;
      }
    }
  }
}
