// The web app can be deployed on Vercel from the repository root (vercel.json) or from frontend/
// (frontend/vercel.json): both must send the same security headers, and the Content Security
// Policy must let the app reach the backend it is built for (frontend/eas.json's API URL).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const headersFor = (config, source) => config.headers.find((entry) => entry.source === source)?.headers ?? [];

test('both Vercel configs send the same security headers', () => {
  const root = read('vercel.json');
  const frontend = read('frontend/vercel.json');
  assert.deepEqual(headersFor(root, '/(.*)'), headersFor(frontend, '/(.*)'));
  const names = headersFor(root, '/(.*)').map((header) => header.key);
  for (const name of ['Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) assert.ok(names.includes(name), name);
  for (const config of [root, frontend]) {
    assert.deepEqual(headersFor(config, '/service-worker.js'), [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }], 'a new service worker is picked up at once');
  }
});

test('the Content Security Policy lets the app reach its backend, and nothing else', () => {
  const policy = headersFor(read('vercel.json'), '/(.*)').find((header) => header.key === 'Content-Security-Policy').value;
  const connect = policy.split(';').map((part) => part.trim()).find((part) => part.startsWith('connect-src')).split(/\s+/).slice(1);
  const builds = read('frontend/eas.json').build;
  const apiUrls = new Set(Object.values(builds).map((profile) => profile.env?.EXPO_PUBLIC_API_URL).filter(Boolean));
  for (const url of apiUrls) assert.ok(connect.includes(new URL(url).origin), `${url} is allowed`);
  assert.deepEqual(connect.filter((source) => source !== "'self'" && !apiUrls.has(source)), [], 'no other origin');
  assert.match(policy, /script-src 'self';/, 'no inline or eval scripts');
  assert.match(policy, /frame-ancestors 'none'/);
});
