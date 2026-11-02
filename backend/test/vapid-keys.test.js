// Web Push needs a VAPID key pair: the deployment's, else one the API makes once and keeps in the
// database, so web reminders work without setting keys by hand (services/vapid-keys.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureVapidKeys, vapidSubject } from '../services/vapid-keys.js';

function fakeDb() {
  const rows = new Map();
  const db = {
    calls: 0,
    async query(text, values) {
      db.calls += 1;
      if (text.startsWith('SELECT')) return { rows: rows.has(values[0]) ? [{ value: rows.get(values[0]) }] : [] };
      if (!rows.has(values[0])) rows.set(values[0], values[1]);
      return { rows: [] };
    },
  };
  return db;
}
let made = 0;
const generate = () => {
  made += 1;
  return { publicKey: `public-${made}`, privateKey: `private-${made}` };
};

test('the deployment\'s keys are used as they are', async () => {
  const db = fakeDb();
  const environment = { WEB_PUSH_VAPID_PUBLIC_KEY: 'pub', WEB_PUSH_VAPID_PRIVATE_KEY: 'priv', WEB_PUSH_VAPID_SUBJECT: 'mailto:team@example.com' };
  assert.equal(await ensureVapidKeys(db, { environment, generate }), 'environment');
  assert.equal(db.calls, 0);
  // A pair without its contact keeps the pair (browsers subscribed with it) and gets a contact.
  const noSubject = { WEB_PUSH_VAPID_PUBLIC_KEY: 'pub', WEB_PUSH_VAPID_PRIVATE_KEY: 'priv', EMAIL_FROM: 'HabitAI <team@example.com>' };
  assert.equal(await ensureVapidKeys(db, { environment: noSubject, generate }), 'environment');
  assert.deepEqual([noSubject.WEB_PUSH_VAPID_PUBLIC_KEY, noSubject.WEB_PUSH_VAPID_SUBJECT], ['pub', 'mailto:team@example.com']);
});

test('without keys, a pair is made once, kept in the database and used after a restart', async () => {
  const db = fakeDb();
  const first = { RENDER_EXTERNAL_URL: 'https://habitai-backend.onrender.com' };
  assert.equal(await ensureVapidKeys(db, { environment: first, generate }), 'created');
  assert.ok(first.WEB_PUSH_VAPID_PUBLIC_KEY.startsWith('public-'));
  assert.equal(first.WEB_PUSH_VAPID_SUBJECT, 'https://habitai-backend.onrender.com');
  const restarted = {};
  assert.equal(await ensureVapidKeys(db, { environment: restarted, generate }), 'database');
  assert.deepEqual([restarted.WEB_PUSH_VAPID_PUBLIC_KEY, restarted.WEB_PUSH_VAPID_PRIVATE_KEY], [first.WEB_PUSH_VAPID_PUBLIC_KEY, first.WEB_PUSH_VAPID_PRIVATE_KEY]);
  assert.equal(restarted.WEB_PUSH_VAPID_SUBJECT, 'mailto:habitai@example.com', 'a contact is always set');
});

test('two instances starting together keep the pair written first', async () => {
  const db = fakeDb();
  const [one, two] = [{}, {}];
  await Promise.all([ensureVapidKeys(db, { environment: one, generate }), ensureVapidKeys(db, { environment: two, generate })]);
  assert.equal(one.WEB_PUSH_VAPID_PUBLIC_KEY, two.WEB_PUSH_VAPID_PUBLIC_KEY);
});

test('the contact is an email address when there is one, else the API\'s address', () => {
  assert.equal(vapidSubject({ SUPPORT_EMAIL: 'help@psau.edu.ph' }), 'mailto:help@psau.edu.ph');
  assert.equal(vapidSubject({ RENDER_EXTERNAL_URL: 'https://api.example.com' }), 'https://api.example.com');
  assert.equal(vapidSubject({ RENDER_EXTERNAL_URL: 'http://insecure.example.com' }), 'mailto:habitai@example.com');
});
