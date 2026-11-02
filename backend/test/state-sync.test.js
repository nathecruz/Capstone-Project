// The Android app's background reminder sync asks whether the account's state changed with a
// signed token, answered from memory: no database per question (services/sync-token.js,
// services/state-versions.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { clearStateVersions, noteStateVersion, STATE_VERSIONS_REFRESH_MS, stateVersionOf } from '../services/state-versions.js';
import { makeSyncToken, readSyncToken, SYNC_TOKEN_LIFETIME_MS } from '../services/sync-token.js';

const SECRET = 'habitai-sync-token:test-secret';
const NOW = Date.parse('2026-11-02T03:00:00Z');

test('a sync token names its account until it expires, and only with its own key', () => {
  const { token, expiresAt } = makeSyncToken('user-1', SECRET, NOW);
  assert.equal(expiresAt, NOW + SYNC_TOKEN_LIFETIME_MS);
  assert.equal(readSyncToken(token, SECRET, NOW + 1000), 'user-1');
  assert.equal(readSyncToken(token, SECRET, expiresAt), null, 'expired');
  assert.equal(readSyncToken(token, 'another-key', NOW), null);
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'user-2', e: expiresAt, k: 'state-sync' })).toString('base64url');
  for (const bad of [`${forged}.${signature}`, `${payload}.${signature}.x`, payload, '', null, 'x'.repeat(600)]) assert.equal(readSyncToken(bad, SECRET, NOW), null, String(bad));
  assert.equal(readSyncToken(token, null, NOW), null, 'no key, no token');
});

test('the latest save time of each account comes from memory, read from the database once every few hours', async () => {
  clearStateVersions();
  let reads = 0;
  const db = { query: async () => { reads += 1; return { rows: [{ userId: 'a', updatedAt: '100' }, { userId: 'b', updatedAt: '300' }] }; } };
  assert.equal(await stateVersionOf(db, 'a', NOW), 100);
  assert.equal(await stateVersionOf(db, 'nobody', NOW), null);
  // Saves through this API move it, never back.
  noteStateVersion('a', 250);
  noteStateVersion('a', 200);
  noteStateVersion('c', 0);
  assert.deepEqual([await stateVersionOf(db, 'a', NOW + 1), await stateVersionOf(db, 'c', NOW + 1)], [250, null]);
  assert.equal(reads, 1, 'one query for all of them');
  // Hours later it is read again (a snapshot saved by another instance during a deploy).
  assert.equal(await stateVersionOf(db, 'b', NOW + STATE_VERSIONS_REFRESH_MS + 1), 300);
  assert.equal(reads, 2);
  // Questions asked together share one read.
  clearStateVersions();
  await Promise.all([stateVersionOf(db, 'a', NOW), stateVersionOf(db, 'b', NOW), stateVersionOf(db, 'c', NOW)]);
  assert.equal(reads, 3);
  clearStateVersions();
});
