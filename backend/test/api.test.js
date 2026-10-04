// End-to-end API test against a real PostgreSQL database.
//
// Set TEST_DATABASE_URL (a Neon branch or any Postgres). The test creates a private,
// randomly named schema, runs the real server against it and drops it afterwards, so
// no existing table is touched. Without TEST_DATABASE_URL the test is skipped.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { goalPlanSchema } from '../schemas.js';
import { normalizeAppState } from '../services/app-state-sync.js';
import { isValidCompletionDate } from '../services/completion-date.js';
import { weeklyQuests } from '../services/quests.js';
import { retireRewards } from '../services/rewards.js';
import { doneActionSecret, makeDoneToken } from '../services/web-push-actions.js';
import { getSupportEmailConfig } from '../services/support-email.js';

test('habit completion dates use the client time zone', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');
  assert.equal(isValidCompletionDate('2026-10-01', 'Pacific/Kiritimati', now), true);
  assert.equal(isValidCompletionDate('2026-10-01', 'UTC', now), false);
  assert.equal(isValidCompletionDate('2026-10-02', 'Pacific/Kiritimati', now), false);
  assert.equal(isValidCompletionDate('2026-10-01', 'Invalid/TimeZone', now), false);
});

test('goal plan schema strips uncalibrated numeric score fields', () => {
  const plan = {
    category: 'Health',
    summary: 'Build a realistic routine with repeatable steps.',
    intensity: 'Balanced',
    focusAreas: ['Movement', 'Sleep', 'Planning'],
    actionPlan: ['Walk today', 'Set a bedtime', 'Plan meals', 'Review progress'],
    actionDueDates: ['Today', 'Tomorrow', 'In 3 days', 'In 7 days'],
    nextMilestone: 'Complete the first week.',
    risk: 'A busy day may interrupt the routine.',
    riskAction: 'Restart with a five-minute walk.',
    timeline: '30-60 days',
    nextCheckIn: 'Oct 4, 2026',
    status: 'Fresh plan',
  };
  const parsed = goalPlanSchema.safeParse({ ...plan, score: 91, confidence: 88 });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data, plan);
});

test('support email uses the configured inbox or falls back to the SMTP sender', () => {
  const explicitInbox = getSupportEmailConfig({ SMTP_USER: 'mailer@habitai.app', SMTP_PASSWORD: 'smtp-secret-value', SUPPORT_EMAIL: 'support@habitai.app' });
  assert.equal(explicitInbox.configured, true);
  assert.equal(explicitInbox.recipient, 'support@habitai.app');
  const senderFallback = getSupportEmailConfig({ SMTP_USER: 'mailer@habitai.app', SMTP_PASSWORD: 'smtp-secret-value' });
  assert.equal(senderFallback.recipient, 'mailer@habitai.app');
  assert.equal(getSupportEmailConfig({ SMTP_USER: 'mailer@habitai.app' }).configured, false);
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/** Same database, private schema. Neon's pooler drops startup options, so use the direct host. */
function urlForSchema(raw, schema) {
  const url = new URL(raw);
  url.hostname = url.hostname.replace('-pooler.', '.');
  if (schema) url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

function poolFor(url) {
  const parsed = new URL(url);
  const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('channel_binding');
  return new pg.Pool({ connectionString: parsed.toString(), ssl: isLocal ? false : { rejectUnauthorized: true }, max: 2 });
}

test('API integration against PostgreSQL', { skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test' }, async (t) => {
  const schema = `habitai_test_${crypto.randomBytes(4).toString('hex')}`;
  const admin = poolFor(urlForSchema(testDatabaseUrl));
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = poolFor(urlForSchema(testDatabaseUrl, schema));

  const port = 18900 + Math.floor(Math.random() * 500);
  const mlPort = port + 1000;
  const deadSmtpPort = port + 2000;
  let mlServiceReady = false;
  const mockMlService = createServer((request, response) => {
    if (request.url === '/api/predict/habit' && request.method === 'POST') {
      response.writeHead(mlServiceReady ? 200 : 503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(mlServiceReady ? { habit_name: 'Workout', completion_probability: 0.72, dropout_risk: 0.2, recommended_action: 'Keep the same time each day.', suggested_reminder_time: '07:00 AM', prediction_source: 'model', is_fallback: false } : { error: 'Model unavailable.' }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => mockMlService.listen(mlPort, '127.0.0.1', resolve));

  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: urlForSchema(testDatabaseUrl, schema),
      PORT: String(port),
      GROQ_API_KEY: '',
      // Short, so the test can see a check-in lock without waiting 30 seconds.
      CHECK_IN_UNDO_WINDOW_MS: '4000',
      ML_SERVICE_API_KEY: 'dev-only-local-key',
      ML_SERVICE_URL: `http://127.0.0.1:${mlPort}`,
      WEB_PUSH_VAPID_PUBLIC_KEY: 'test-vapid-public-key',
      WEB_PUSH_VAPID_PRIVATE_KEY: 'test-vapid-private-key',
      WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.com',
      // "Configured" SMTP that refuses connections: exercises verification and failure paths without sending mail.
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(deadSmtpPort),
      SMTP_SECURE: 'false',
      SMTP_USER: 'mailer@habitai.test',
      SMTP_PASSWORD: 'not-a-real-password',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let serverErrors = '';
  server.stderr.on('data', (chunk) => { serverErrors += chunk; });
  const serverExit = new Promise((resolve) => server.once('exit', resolve));

  t.after(async () => {
    server.kill();
    await serverExit;
    await new Promise((resolve) => mockMlService.close(resolve));
    await db.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) break;
    } catch {
      // still starting
    }
    if (Date.now() > deadline) throw new Error(`Server did not start:\n${serverErrors}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  /** Tokens from the rotating daily challenges (not "Finish N habits") in an answer's history. */
  const extraDailyTokens = (body) => body.tokenHistory.filter((item) => item.label.startsWith('Daily challenge: ')).reduce((sum, item) => sum + item.amount, 0);
  async function request(pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON from ${pathname}, received HTTP ${response.status}: ${text.slice(0, 120)}`);
    }
    return { response, body };
  }
  const setCode = async (table, key, code) => {
    const hash = bcrypt.hashSync(code, 4);
    if (table === 'email') {
      await db.query(`INSERT INTO email_verification_codes(user_id, code_hash, expires_at, attempts, created_at) VALUES ($1, $2, $3, 0, 0)
        ON CONFLICT (user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`, [key, hash, Date.now() + 600000]);
    } else {
      await db.query(`INSERT INTO password_reset_requests(email, otp_hash, expires_at, attempts, verified_at, created_at) VALUES ($1, $2, $3, 0, NULL, 0)
        ON CONFLICT (email) DO UPDATE SET otp_hash = excluded.otp_hash, expires_at = excluded.expires_at, attempts = 0, verified_at = NULL`, [key, hash, Date.now() + 600000]);
    }
  };

  const password = 'Violet!Orbit7!Cedar2!Mint';
  const registration = { firstName: 'Test', lastName: 'User', username: 'test_user', email: 'test@example.com', password, dateOfBirth: 'May 14, 1998', gender: 'Prefer not to say' };
  let token;
  let userId;
  let authHeaders;

  await t.test('every API answer carries the security headers and is not cached', async () => {
    for (const pathname of ['/api/health', '/api/no-such-route']) {
      const { response } = await request(pathname);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff', pathname);
      assert.equal(response.headers.get('x-frame-options'), 'DENY', pathname);
      assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'", pathname);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer', pathname);
      assert.equal(response.headers.get('cache-control'), 'no-store', pathname);
      assert.equal(response.headers.get('x-powered-by'), null, pathname);
    }
  });

  await t.test('registration requires privacy consent and email verification', async () => {
    const noConsent = await request('/api/auth/register', { method: 'POST', body: JSON.stringify(registration) });
    assert.equal(noConsent.response.status, 400);
    assert.match(noConsent.body.message, /Privacy Notice/);

    const created = await request('/api/auth/register', { method: 'POST', headers: { Origin: 'http://localhost:8081' }, body: JSON.stringify({ ...registration, privacyConsent: true }) });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.response.headers.get('access-control-allow-origin'), 'http://localhost:8081');
    assert.equal(created.body.user.emailVerified, false);
    assert.deepEqual([created.body.user.firstName, created.body.user.lastName, created.body.user.fullName], ['Test', 'User', 'Test User']);
    const noLastName = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, lastName: '', email: 'nolast@example.com', username: 'no_last', privacyConsent: true }) });
    assert.equal(noLastName.response.status, 400, 'first and last name are both required');
    const legacy = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ fullName: 'Juan Dela Cruz', username: 'legacy_user', email: 'legacy@example.com', password, dateOfBirth: 'May 14, 1998', gender: 'Male', privacyConsent: true }) });
    assert.equal(legacy.response.status, 201, 'older app versions still send one full name');
    assert.deepEqual([legacy.body.user.firstName, legacy.body.user.lastName], ['Juan', 'Dela Cruz']);
    assert.ok(created.body.user.privacyConsentAt);
    token = created.body.token;
    userId = created.body.user.id;
    authHeaders = { Authorization: `Bearer ${token}` };

    const duplicate = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, email: 'another@example.com', username: 'TEST_USER', privacyConsent: true }) });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.message, 'This username is already in use.');

    const blocked = await request('/api/app-state', { headers: authHeaders });
    assert.equal(blocked.response.status, 403);
    assert.equal(blocked.body.code, 'EMAIL_NOT_VERIFIED');
    assert.equal((await request('/api/auth/me', { headers: authHeaders })).response.status, 200);

    await setCode('email', userId, '424242');
    const wrong = await request('/api/auth/email/verify', { method: 'POST', headers: authHeaders, body: JSON.stringify({ otp: '111111' }) });
    assert.equal(wrong.response.status, 401);
    assert.equal(wrong.body.attemptsLeft, 4);
    const right = await request('/api/auth/email/verify', { method: 'POST', headers: authHeaders, body: JSON.stringify({ otp: '424242' }) });
    assert.equal(right.response.status, 200, JSON.stringify(right.body));
    assert.equal(right.body.user.emailVerified, true);
  });

  await t.test('sessions, tokens in URLs/bodies and expired sessions are rejected', async () => {
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'test@example.com', password, device: 'Test Phone (Android 15)' }) });
    assert.equal(login.response.status, 200);
    token = login.body.token;
    authHeaders = { Authorization: `Bearer ${token}` };
    assert.equal((await request(`/api/auth/me?token=${encodeURIComponent(token)}`)).response.status, 401);
    assert.equal((await request('/api/leaderboard/sync', { method: 'POST', body: JSON.stringify({ token }) })).response.status, 401);
    assert.equal((await request('/api/leaderboard')).response.status, 401);
    const expiredToken = crypto.randomBytes(32).toString('hex');
    await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, 0)', [crypto.createHash('sha256').update(expiredToken).digest('hex'), userId]);
    assert.equal((await request('/api/auth/me', { headers: { Authorization: `Bearer ${expiredToken}` } })).response.status, 401);
    assert.equal((await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ unexpected: true }) })).response.status, 400);
  });

  await t.test('web push subscriptions and one-time snooze tokens', async () => {
    const pushSubscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint', expirationTime: null, keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' } };
    assert.equal((await request('/api/web-push/public-key')).body.publicKey, 'test-vapid-public-key');
    assert.equal((await request('/api/web-push/subscriptions', { method: 'POST', body: JSON.stringify({ subscription: pushSubscription, timeZone: 'UTC' }) })).response.status, 401);
    assert.equal((await request('/api/web-push/subscriptions', { method: 'POST', headers: authHeaders, body: JSON.stringify({ subscription: pushSubscription, timeZone: 'America/Los_Angeles' }) })).response.status, 200);
    const snoozeState = { avatarImage: null, profile: { fullName: 'Test User' }, preferences: { notificationsEnabled: true }, habits: [{ id: 'habit-snooze', label: 'Stretch', reminderEnabled: true }], points: 0, tokens: 0, tokenHistory: [], darkModeOverride: null, ringInterval: 15, snoozeFrequency: '2 times', goals: [] };
    assert.equal((await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify(snoozeState) })).response.status, 200);
    const snoozeToken = crypto.randomBytes(32).toString('base64url');
    const subscriptionId = (await db.query('SELECT id FROM web_push_subscriptions WHERE endpoint=$1', [pushSubscription.endpoint])).rows[0].id;
    await db.query('INSERT INTO web_push_snooze_tokens(token_hash,subscription_id,habit_id,snooze_count,expires_at,created_at) VALUES($1,$2,$3,0,$4,$5)', [crypto.createHash('sha256').update(snoozeToken).digest('hex'), subscriptionId, 'habit-snooze', Date.now() + 60000, Date.now()]);
    assert.equal((await request('/api/web-push/snooze', { method: 'POST', body: JSON.stringify({ token: snoozeToken }) })).response.status, 200);
    assert.equal((await request('/api/web-push/snooze', { method: 'POST', body: JSON.stringify({ token: snoozeToken }) })).response.status, 410);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM web_push_snooze_queue')).rows[0].count, 1);
    assert.equal((await request('/api/web-push/subscriptions', { method: 'POST', headers: authHeaders, body: JSON.stringify({ subscription: { ...pushSubscription, endpoint: 'https://attacker.example/push' }, timeZone: 'UTC' }) })).response.status, 400);
    assert.equal((await request('/api/web-push/subscriptions', { method: 'DELETE', headers: authHeaders, body: JSON.stringify({ endpoint: pushSubscription.endpoint }) })).response.status, 200);
    // The test notification needs a signed-in account with this device subscribed.
    assert.equal((await request('/api/web-push/test', { method: 'POST', body: JSON.stringify({}) })).response.status, 401);
    const noDevice = await request('/api/web-push/test', { method: 'POST', headers: authHeaders, body: JSON.stringify({ endpoint: pushSubscription.endpoint }) });
    assert.equal(noDevice.response.status, 404);
    assert.match(noDevice.body.message, /Turn on reminders/);
  });

  await t.test('ML proxy, AI without keys, and password reset protections', async () => {
    assert.equal((await request('/api/habit/predict', { method: 'POST', headers: authHeaders, body: JSON.stringify({ habit_name: 'Workout' }) })).response.status, 503);
    mlServiceReady = true;
    const prediction = await request('/api/habit/predict', { method: 'POST', headers: authHeaders, body: JSON.stringify({ habit_name: 'Workout' }) });
    assert.equal(prediction.response.status, 200);
    assert.equal(prediction.body.prediction_source, 'model');
    assert.equal((await request('/api/insights/assistant', { method: 'POST', headers: authHeaders, body: JSON.stringify({ question: 'What should I focus on?', mode: 'support' }) })).response.status, 503);

    const unknown = await request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'nobody@example.com' }) });
    assert.equal(unknown.response.status, 200);
    assert.match(unknown.body.message, /If an account exists/);
    const cooldown = await request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'nobody@example.com' }) });
    assert.equal(cooldown.response.status, 429);
    assert.ok(cooldown.body.retryAfterSeconds > 0);
    const smtpDown = await request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'test@example.com' }) });
    assert.equal(smtpDown.response.status, 503);
    assert.doesNotMatch(smtpDown.body.message, /SMTP|Gmail|password/i, 'no configuration details reach the client');

    await setCode('reset', 'test@example.com', '123456');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const wrong = await request('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email: 'test@example.com', otp: '654321' }) });
      assert.equal(wrong.response.status, attempt === 5 ? 429 : 401);
    }
    assert.equal((await request('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email: 'test@example.com', otp: '123456' }) })).response.status, 404, 'locked codes are discarded');
  });

  const today = new Date().toISOString().slice(0, 10);
  const appState = {
    avatarImage: null,
    profile: { fullName: 'Test User' },
    preferences: { language: 'English' },
    habits: [{ id: 'habit-1', label: 'Read', frequency: 'Daily', startDate: '2026-01-01', completionDates: [] }],
    points: 42,
    tokens: 999,
    tokenHistory: [{ id: 'fake', amount: 999, label: 'Free tokens', date: today }],
    darkModeOverride: null,
    ringInterval: 30,
    snoozeFrequency: 'Once',
    goals: [{ id: 'goal-1', title: 'Read more', progress: 25 }],
  };
  let stateUpdatedAt;

  await t.test('points and tokens are owned by the server', async () => {
    const saved = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify(appState) });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.state.points, 0, 'client points are ignored');
    assert.equal(saved.body.state.tokens, 0, 'client tokens are ignored');
    assert.equal(saved.body.state.tokenHistory.length, 0);
    stateUpdatedAt = saved.body.updatedAt;

    const coach = await request('/api/insights/assistant', { method: 'POST', headers: authHeaders, body: JSON.stringify({ question: 'Help', mode: 'coach' }) });
    assert.equal(coach.response.status, 503, 'AI unavailable without a key; no tokens are spent');

    const redeem = await request('/api/rewards/redeem', { method: 'POST', headers: authHeaders, body: JSON.stringify({ rewardId: 'premium-theme', rewardName: 'Premium Themes', tokenCost: 200 }) });
    assert.equal(redeem.response.status, 409, 'not enough tokens');
  });

  await t.test('check-ins award tokens, compute streaks and survive stale devices', async () => {
    const done = await request('/api/habit-completions', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ habitId: 'habit-1', date: today, completed: true, timeZone: 'UTC' }) });
    assert.equal(done.response.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.points, 20);
    assert.equal(done.body.tokens, 5 + extraDailyTokens(done.body), '"Finish 2 habits" is not done yet: 1 of the 2 habits due today');
    assert.ok(!done.body.tokenHistory.some((item) => item.label === 'Daily challenge'));
    assert.equal(done.body.tokenHistory.find((item) => !item.label.startsWith('Daily challenge')).label, 'Completed Read');
    assert.equal(done.body.habit.streak, 1);

    const repeat = await request('/api/habit-completions', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ habitId: 'habit-1', date: today, completed: true, timeZone: 'UTC' }) });
    assert.equal(repeat.body.tokens, 5 + extraDailyTokens(repeat.body), 'the same check-in is only rewarded once');

    const stale = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...appState, preferences: { language: 'Filipino' } }) });
    assert.equal(stale.response.status, 200);
    const habitOne = (state) => state.habits.find((habit) => habit.id === 'habit-1');
    assert.deepEqual(habitOne(stale.body.state).completionDates, [today], 'a device without the check-in cannot erase it');

    const undo = await request('/api/habit-completions', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ habitId: 'habit-1', date: today, completed: false, timeZone: 'UTC' }) });
    assert.equal(undo.body.tokens, 0);
    assert.equal(undo.body.points, 0);
    assert.equal(undo.body.habit.streak, 0);

    const offline = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...appState, habits: [{ ...appState.habits[0], completionDates: [today] }] }) });
    assert.deepEqual(habitOne(offline.body.state).completionDates, [today], 'offline check-ins from a synced state are kept');
    assert.equal(offline.body.state.tokens, 5);
    stateUpdatedAt = offline.body.updatedAt;

    const unchanged = await request(`/api/app-state?since=${stateUpdatedAt}`, { headers: authHeaders });
    assert.equal(unchanged.body.unchanged, true);
    assert.equal(normalizeAppState({ habits: [{ id: 'a' }, { id: 'a' }] }).habits.length, 1);
  });

  await t.test('check-ins lock after the undo window, past days stay closed, habits are analysed', async () => {
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const late = await request('/api/habit-completions', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ habitId: 'habit-1', date: yesterday, completed: true, timeZone: 'UTC' }) });
    assert.equal(late.response.status, 409);
    assert.equal(late.body.code, 'DAY_CLOSED');

    // habit-1 was checked in by the offline sync above; once the window has passed it is locked.
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const locked = await request('/api/habit-completions', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ habitId: 'habit-1', date: today, completed: false, timeZone: 'UTC' }) });
    assert.equal(locked.response.status, 409);
    assert.equal(locked.body.code, 'CHECK_IN_LOCKED');
    const still = await request('/api/habit-completions', { headers: authHeaders });
    assert.ok(still.body.completions.some((row) => row.habitId === 'habit-1' && row.date === today), 'the locked check-in is kept');

    const analysis = await request('/api/insights/habit-analysis', { method: 'POST', headers: authHeaders, body: JSON.stringify({ habitId: 'habit-1', timeZone: 'UTC' }) });
    assert.equal(analysis.response.status, 200, JSON.stringify(analysis.body));
    assert.equal(analysis.body.stats.completedDays, 1);
    assert.deepEqual(analysis.body.stats.last7Days, [0, 0, 0, 0, 0, 0, 1]);
    assert.equal(analysis.body.ml.completionProbability, 0.72);
    assert.equal(analysis.body.ai, null, 'no AI advice without an API key');
    const unknown = await request('/api/insights/habit-analysis', { method: 'POST', headers: authHeaders, body: JSON.stringify({ habitId: 'missing' }) });
    assert.equal(unknown.response.status, 404);
  });

  await t.test('habits and check-ins survive empty, stale and reordering devices', async () => {
    const habit = (id, label) => ({ ...appState.habits[0], id, label, completionDates: [] });
    const latest = async () => (await request('/api/app-state', { headers: authHeaders })).body;
    let current = await latest();
    const saved = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...current.state, habits: [habit('h-a', 'Alpha'), habit('h-b', 'Beta'), habit('h-c', 'Gamma')], baseUpdatedAt: current.updatedAt, baseState: current.state }) });
    assert.deepEqual(saved.body.state.habits.map((item) => item.id), ['h-a', 'h-b', 'h-c']);
    const checkIn = await request('/api/habit-completions', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ habitId: 'h-b', date: today, completed: true, timeZone: 'UTC' }) });
    assert.ok(checkIn.body.state && checkIn.body.updatedAt, 'the check-in returns the new snapshot to use as the sync base');

    // A device that never loaded the server state (fresh install during a cold start) sends an empty list.
    const empty = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...appState, habits: [] }) });
    assert.equal(empty.response.status, 200);
    current = await latest();
    assert.deepEqual(current.state.habits.map((item) => item.id).filter((id) => id.startsWith('h-')), ['h-a', 'h-b', 'h-c'], 'a save without a base cannot delete habits');
    assert.ok(current.completions.some((row) => row.habitId === 'h-b' && row.date === today), 'or their check-ins');

    // Reordering right after a check-in, using the check-in response as the base: no merge, order kept.
    const base = { updatedAt: current.updatedAt, state: current.state };
    const reordered = [...current.state.habits].reverse();
    const reorder = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...current.state, habits: reordered, baseUpdatedAt: base.updatedAt, baseState: base.state }) });
    assert.deepEqual(reorder.body.state.habits.map((item) => item.id), reordered.map((item) => item.id));

    // A second device with an older base reorders too, while the server changed meanwhile: its order still wins.
    await request('/api/habit-completions', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ habitId: 'h-a', date: today, completed: true, timeZone: 'UTC' }) });
    const staleOrder = [...reorder.body.state.habits].sort((left, right) => left.id.localeCompare(right.id));
    const merged = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...reorder.body.state, habits: staleOrder, baseUpdatedAt: reorder.body.updatedAt, baseState: reorder.body.state }) });
    assert.equal(merged.body.merged, true);
    assert.deepEqual(merged.body.state.habits.map((item) => item.id), staleOrder.map((item) => item.id), 'a reorder survives a merge');
    assert.ok(merged.body.state.habits.find((item) => item.id === 'h-a').completionDates.includes(today), "and so does the other device's check-in");

    // Offline check-in on a device whose copy of the habit conflicts with the server's: still kept.
    const before = merged.body;
    await request('/api/habit-completions', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ habitId: 'h-c', date: today, completed: true, timeZone: 'UTC' }) });
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const offlineHabits = before.state.habits.map((item) => (item.id === 'h-c' ? { ...item, completionDates: [...item.completionDates, yesterday] } : item));
    const offline = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...before.state, habits: offlineHabits, baseUpdatedAt: before.updatedAt, baseState: before.state }) });
    assert.deepEqual(offline.body.state.habits.find((item) => item.id === 'h-c').completionDates, [today], 'a missed day cannot be filled in later, even by an offline device');

    // A check-in undone on another device is not brought back by a device that still shows it.
    await request('/api/habit-completions', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ habitId: 'h-a', date: today, completed: false, timeZone: 'UTC' }) });
    const resurrect = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...offline.body.state, ringInterval: 25, baseUpdatedAt: offline.body.updatedAt, baseState: offline.body.state }) });
    assert.ok(!resurrect.body.state.habits.find((item) => item.id === 'h-a').completionDates.includes(today), 'an undone check-in stays undone');

    const columns = (await db.query("SELECT frequency, start_date AS \"startDate\", reminder_days AS \"reminderDays\" FROM habits WHERE id = $1", [`${userId}:habit:h-a`])).rows[0];
    assert.equal(columns.frequency, appState.habits[0].frequency || '');
    assert.ok(Array.isArray(columns.reminderDays), 'the schedule is stored for live streaks');
  });

  await t.test('the blank startup state never replaces a loaded account', async () => {
    const loaded = (await request('/api/app-state', { headers: authHeaders })).body;
    const named = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...loaded.state, profile: { ...loaded.state.profile, email: 'reader@example.test' }, baseUpdatedAt: loaded.updatedAt, baseState: loaded.state }) });
    assert.equal(named.response.status, 200);
    const habitIds = named.body.state.habits.map((item) => item.id);
    const checkIns = (await request('/api/habit-completions', { headers: authHeaders })).body.completions.length;
    assert.ok(habitIds.length > 0 && checkIns > 0);

    // Same base as the server, so it would replace the state: the server refuses instead.
    const blank = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...named.body.state, profile: { fullName: '', email: '' }, habits: [], baseUpdatedAt: named.body.updatedAt, baseState: named.body.state }) });
    assert.equal(blank.response.status, 409);
    assert.equal(blank.body.code, 'STATE_NOT_LOADED');
    const after = (await request('/api/app-state', { headers: authHeaders })).body;
    assert.deepEqual(after.state.habits.map((item) => item.id), habitIds, 'habits are kept');
    assert.equal(after.completions.length, checkIns, 'and so are their check-ins');
  });

  await t.test('achievement notifications keep their read state', async () => {
    const notes = await request('/api/notifications', { headers: authHeaders });
    const firstHabit = notes.body.notifications.find((note) => note.title === 'First Habit');
    assert.ok(firstHabit, JSON.stringify(notes.body));
    await request(`/api/notifications/${encodeURIComponent(firstHabit.id)}`, { method: 'PATCH', headers: authHeaders, body: JSON.stringify({ read: true }) });
    const latest = await request('/api/app-state', { headers: authHeaders });
    await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...appState, ringInterval: 45, baseUpdatedAt: latest.body.updatedAt, baseState: latest.body.state }) });
    const after = await request('/api/notifications', { headers: authHeaders });
    assert.ok(after.body.notifications.find((note) => note.id === firstHabit.id).readAt);
  });

  await t.test('leaderboards hide full names and respect opt-out', async () => {
    const second = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, firstName: 'Second', lastName: 'Student', username: 'second_user', email: 'second@example.com', password: 'Silver!Meadow8!Cloud3!Pine', privacyConsent: true }) });
    await db.query('UPDATE users SET email_verified_at = 1 WHERE email = $1', ['second@example.com']);
    const secondHeaders = { Authorization: `Bearer ${second.body.token}` };
    await request('/api/app-state', { method: 'PUT', headers: secondHeaders, body: JSON.stringify({ ...appState, habits: [{ ...appState.habits[0], label: 'Second user habit' }] }) });
    const crossUser = await request('/api/habit-completions', { method: 'PUT', headers: secondHeaders, body: JSON.stringify({ habitId: 'habit-1', date: today, completed: true }) });
    assert.equal(crossUser.body.points, 20, 'habit ids are scoped per user');

    const board = await request('/api/leaderboard?period=All%20Time', { headers: authHeaders });
    const names = board.body.leaders.map((leader) => leader.name);
    assert.ok(names.includes('Test U. (You)'), names.join(', '));
    assert.ok(names.includes('Second S.'), names.join(', '));
    assert.ok(!names.some((name) => name.includes('Student') && name.includes('Second Student')));

    await request('/api/app-state', { method: 'PUT', headers: secondHeaders, body: JSON.stringify({ ...appState, preferences: { showOnLeaderboard: false }, habits: [{ ...appState.habits[0], label: 'Second user habit' }] }) });
    const hidden = await request('/api/leaderboard?period=All%20Time', { headers: authHeaders });
    assert.ok(!hidden.body.leaders.some((leader) => leader.name.startsWith('Second')), 'opted-out students are hidden from others');
    const self = await request('/api/leaderboard?period=All%20Time', { headers: secondHeaders });
    assert.ok(self.body.leaders.some((leader) => leader.isYou), 'but still see themselves');
  });

  await t.test('faculty use the app in Faculty mode and stay off student leaderboards', async () => {
    const password = 'Amber!Harbor7!Quiet2!Fern';
    await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, firstName: 'Prof', lastName: 'Santos', username: 'prof_santos', email: 'prof@example.com', password, privacyConsent: true }) });
    await db.query("UPDATE users SET email_verified_at = 1, role = 'faculty' WHERE email = $1", ['prof@example.com']);
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'prof@example.com', password }) });
    assert.equal(login.response.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.user.role, 'faculty', 'the app switches to Faculty mode');
    const facultyHeaders = { Authorization: `Bearer ${login.body.token}` };
    const me = await request('/api/auth/me', { headers: facultyHeaders });
    assert.equal(me.body.user.role, 'faculty');
    await request('/api/app-state', { method: 'PUT', headers: facultyHeaders, body: JSON.stringify({ ...appState, habits: [{ ...appState.habits[0], id: 'prep', label: 'Prepare tomorrow\'s lesson' }] }) });
    const checkIn = await request('/api/habit-completions', { method: 'PUT', headers: facultyHeaders, body: JSON.stringify({ habitId: 'prep', date: today, completed: true, timeZone: 'UTC' }) });
    assert.equal(checkIn.response.status, 200, 'faculty can track their own habits');
    const questBonus = weeklyQuests([{ id: 'prep', frequency: 'Daily', startDate: '2026-01-01', reminderDays: [], meta: '' }], new Map([[today, new Set(['prep'])]]), today)
      .filter((quest) => quest.complete).reduce((sum, quest) => sum + quest.reward, 0);
    assert.equal(checkIn.body.tokens, 15 + questBonus + extraDailyTokens(checkIn.body), '+5 for the check-in, +10 for "Finish 1 habit", and any other challenge or weekly quest it completes');
    assert.deepEqual(checkIn.body.tokenHistory.filter((item) => !item.label.startsWith('Weekly quest') && !item.label.startsWith('Daily challenge: ')).slice(0, 2).map((item) => item.label), ['Daily challenge', "Completed Prepare tomorrow's lesson"]);
    const undone = await request('/api/habit-completions', { method: 'PUT', headers: facultyHeaders, body: JSON.stringify({ habitId: 'prep', date: today, completed: false, timeZone: 'UTC' }) });
    assert.equal(undone.body.tokens, 0, 'an undo also takes the challenge bonus back');
    const again = await request('/api/habit-completions', { method: 'PUT', headers: facultyHeaders, body: JSON.stringify({ habitId: 'prep', date: today, completed: true, timeZone: 'UTC' }) });
    assert.equal(again.body.tokens, 15 + questBonus + extraDailyTokens(again.body), 'and pays it again, once, when the challenge is done again');
    const board = await request('/api/leaderboard?period=All%20Time', { headers: facultyHeaders });
    assert.ok(!JSON.stringify(board.body).includes('Santos'), 'faculty are not on the student leaderboard');
  });

  await t.test('weekly quests, the mystery box, the habit buddy and the Done button on reminders', async () => {
    const password = 'Cobalt!River8!Maple3!Stone';
    await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, firstName: 'Quest', lastName: 'Runner', username: 'quest_runner', email: 'quest@example.com', password, privacyConsent: true }) });
    await db.query('UPDATE users SET email_verified_at = 1 WHERE email = $1', ['quest@example.com']);
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'quest@example.com', password }) });
    const headers = { Authorization: `Bearer ${login.body.token}` };
    const userId = (await db.query('SELECT id FROM users WHERE email=$1', ['quest@example.com'])).rows[0].id;
    await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: [
      { ...appState.habits[0], id: 'walk', label: 'Morning walk' },
      { ...appState.habits[0], id: 'read', label: 'Read' },
    ] }) });

    // A fresh buddy, and a box that only opens after the day's first check-in.
    const fresh = await request('/api/buddy', { headers });
    assert.equal(fresh.response.status, 200, JSON.stringify(fresh.body));
    assert.deepEqual({ name: fresh.body.buddy.name, owned: fresh.body.buddy.owned, checkIns: fresh.body.buddy.checkIns }, { name: 'Habi', owned: [], checkIns: 0 });
    const locked = await request('/api/mystery-box/open', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.equal(locked.response.status, 409);
    assert.equal(locked.body.code, 'BOX_LOCKED');

    // Checking both habits in completes "check in on every habit" in the weeks it is the third quest.
    for (const habitId of ['walk', 'read']) {
      await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId, date: today, completed: true, timeZone: 'UTC' }) });
    }
    const quests = weeklyQuests(['walk', 'read'].map((id) => ({ id, frequency: 'Daily', startDate: '2026-01-01', reminderDays: [], meta: '' })), new Map([[today, new Set(['walk', 'read'])]]), today);
    const ledger = async () => (await db.query('SELECT id, amount FROM token_transactions WHERE user_id=$1', [userId])).rows;
    const paidQuests = (await ledger()).filter((row) => row.id.includes(':quest:')).map((row) => row.id.split(':').at(-1)).sort();
    assert.deepEqual(paidQuests, quests.filter((quest) => quest.complete).map((quest) => quest.id).sort(), 'the server pays exactly the completed quests');

    // The box opens once a day for 3 to 20 tokens.
    const before = (await request('/api/buddy', { headers })).body;
    const box = await request('/api/mystery-box/open', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.equal(box.response.status, 200, JSON.stringify(box.body));
    assert.ok([3, 5, 8, 12, 20].includes(box.body.amount));
    assert.equal(box.body.alreadyOpened, false);
    const reopened = await request('/api/mystery-box/open', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.deepEqual({ amount: reopened.body.amount, alreadyOpened: reopened.body.alreadyOpened, tokens: reopened.body.tokens }, { amount: box.body.amount, alreadyOpened: true, tokens: box.body.tokens });
    assert.equal(before.buddy.checkIns, 2);

    // The shop: stage-locked items, the price, owning and wearing.
    const crown = await request('/api/buddy/items', { method: 'POST', headers, body: JSON.stringify({ itemId: 'crown' }) });
    assert.equal(crown.response.status, 403, 'the crown waits for the Champ stage');
    await db.query('DELETE FROM token_transactions WHERE user_id=$1', [userId]);
    const poor = await request('/api/buddy/items', { method: 'POST', headers, body: JSON.stringify({ itemId: 'cap' }) });
    assert.equal(poor.response.status, 402);
    await db.query("INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,100,'Test grant',$3,$4)", [`${userId}:token:test-grant`, userId, new Date().toISOString(), Date.now()]);
    const cap = await request('/api/buddy/items', { method: 'POST', headers, body: JSON.stringify({ itemId: 'cap' }) });
    assert.equal(cap.response.status, 200, JSON.stringify(cap.body));
    assert.deepEqual({ head: cap.body.buddy.head, owned: cap.body.buddy.owned, tokens: cap.body.tokens }, { head: 'cap', owned: ['cap'], tokens: 60 });
    assert.equal((await request('/api/buddy/items', { method: 'POST', headers, body: JSON.stringify({ itemId: 'cap' }) })).response.status, 409);
    const renamed = await request('/api/buddy', { method: 'PUT', headers, body: JSON.stringify({ name: 'Bolt', head: '' }) });
    assert.deepEqual({ name: renamed.body.buddy.name, head: renamed.body.buddy.head }, { name: 'Bolt', head: '' });
    assert.equal((await request('/api/buddy', { method: 'PUT', headers, body: JSON.stringify({ hand: 'books' }) })).response.status, 400, 'only bought items can be worn');
    // Rooms: bought like items, moved into right away, and checked the same way.
    assert.equal((await request('/api/buddy/items', { method: 'POST', headers, body: JSON.stringify({ itemId: 'space' }) })).response.status, 403, 'space needs the Teen stage');
    assert.equal((await request('/api/buddy', { method: 'PUT', headers, body: JSON.stringify({ room: 'garden' }) })).response.status, 400, 'a room must be bought first');
    await db.query("INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,60,'Test tokens',$3,$4)", [`${userId}:token:test-room`, userId, new Date().toISOString(), Date.now()]);
    const garden = await request('/api/buddy/items', { method: 'POST', headers, body: JSON.stringify({ itemId: 'garden' }) });
    assert.equal(garden.response.status, 200, JSON.stringify(garden.body));
    assert.deepEqual({ room: garden.body.buddy.room, head: garden.body.buddy.head }, { room: 'garden', head: '' });
    const moved = await request('/api/buddy', { method: 'PUT', headers, body: JSON.stringify({ room: '' }) });
    assert.equal(moved.body.buddy.room, '');
    assert.equal((await request('/api/buddy', { method: 'PUT', headers, body: JSON.stringify({ room: 'cap' }) })).response.status, 400, 'a hat is not a room');

    // Done on a reminder notification checks the habit in, with no session; a forged token cannot.
    await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'read', date: today, completed: false, timeZone: 'UTC' }) });
    const secret = doneActionSecret({ WEB_PUSH_VAPID_PUBLIC_KEY: 'test-vapid-public-key', WEB_PUSH_VAPID_PRIVATE_KEY: 'test-vapid-private-key', WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.com' });
    const doneToken = makeDoneToken({ userId, habitId: 'read', date: today, timeZone: 'UTC' }, secret);
    assert.equal((await request('/api/web-push/done', { method: 'POST', body: JSON.stringify({ token: `${doneToken.split('.')[0]}.forged-signature-forged-signature` }) })).response.status, 410);
    const done = await request('/api/web-push/done', { method: 'POST', body: JSON.stringify({ token: doneToken }) });
    assert.equal(done.response.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.label, 'Read');
    const completions = (await request('/api/habit-completions', { headers })).body.completions;
    assert.ok(completions.some((row) => row.habitId === 'read' && row.date === today), 'the habit is checked in');

    // Streak Freeze: the walk ran for three days, then yesterday was missed.
    const dayBefore = (days) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    for (const days of [2, 3, 4]) {
      await db.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4)', [userId, 'walk', dayBefore(days), Date.now()]);
    }
    const walkStreak = async () => (await request('/api/app-state', { headers })).body.state.habits.find((habit) => habit.id === 'walk').streak;
    assert.equal(await walkStreak(), 1, 'yesterday broke it');
    await db.query('DELETE FROM token_transactions WHERE user_id=$1', [userId]);
    const broke = await request('/api/streak-freezes/buy', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.equal(broke.response.status, 402);
    await db.query("INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,200,'Test grant',$3,$4)", [`${userId}:token:freeze-grant`, userId, new Date().toISOString(), Date.now()]);
    const bought = await request('/api/streak-freezes/buy', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.equal(bought.response.status, 200, JSON.stringify(bought.body));
    assert.deepEqual({ used: bought.body.used, available: bought.body.available, tokens: bought.body.tokens }, { used: [dayBefore(1)], available: 0, tokens: 170 }, 'bought after the miss, it saves yesterday right away');
    assert.equal(await walkStreak(), 4, 'today and the three days before the frozen one');
    for (const expected of [1, 2]) {
      const another = await request('/api/streak-freezes/buy', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
      assert.deepEqual({ used: another.body.used, available: another.body.available }, { used: [], available: expected });
    }
    const tooMany = await request('/api/streak-freezes/buy', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.equal(tooMany.response.status, 409, 'two is the most you can hold');
    const synced = await request('/api/streak-freezes/sync', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.deepEqual({ used: synced.body.used, available: synced.body.available, frozenDays: synced.body.frozenDays }, { used: [], available: 2, frozenDays: [dayBefore(1)] });
  });

  await t.test('token rewards: real ones on sale, retired ones refunded, and the custom title', async () => {
    const password = 'Velvet!Canyon4!Birch9!Moon';
    await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, firstName: 'Rhea', lastName: 'Ward', username: 'rhea_ward', email: 'rhea@example.com', password, privacyConsent: true }) });
    await db.query('UPDATE users SET email_verified_at = 1 WHERE email = $1', ['rhea@example.com']);
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'rhea@example.com', password }) });
    const headers = { Authorization: `Bearer ${login.body.token}` };
    const userId = (await db.query('SELECT id FROM users WHERE email=$1', ['rhea@example.com'])).rows[0].id;

    const catalog = await request('/api/rewards', { headers });
    assert.equal(catalog.response.status, 200, JSON.stringify(catalog.body));
    assert.deepEqual(catalog.body.rewards.map((reward) => [reward.id, reward.cost, reward.permanent]), [['profile-frames', 180, true], ['premium-theme', 200, true], ['custom-title', 250, true]], 'only rewards that do something are on sale');
    assert.deepEqual({ owned: catalog.body.owned, title: catalog.body.title }, { owned: [], title: '' });
    assert.equal((await request('/api/rewards/redeem', { method: 'POST', headers, body: JSON.stringify({ rewardId: 'grace-day', rewardName: 'Grace Day', tokenCost: 620 }) })).response.status, 400, 'retired rewards cannot be bought');

    // Someone who bought a retired reward before gets the tokens back, once.
    await db.query("INSERT INTO reward_redemptions(id,user_id,reward_id,token_cost,redeemed_at) VALUES('old-grace-day',$1,'grace-day',620,$2)", [userId, Date.now()]);
    await retireRewards(db);
    await retireRewards(db);
    const refunds = (await db.query("SELECT amount, label FROM token_transactions WHERE user_id=$1 AND id LIKE '%:refund:%'", [userId])).rows;
    assert.deepEqual(refunds, [{ amount: 620, label: 'Refund: Grace Day was retired' }]);

    // The custom title: only after buying it, and only safe text.
    assert.equal((await request('/api/rewards/title', { method: 'PUT', headers, body: JSON.stringify({ title: 'Early Riser' }) })).response.status, 403);
    const bought = await request('/api/rewards/redeem', { method: 'POST', headers, body: JSON.stringify({ rewardId: 'custom-title', rewardName: 'Custom Title', tokenCost: 250 }) });
    assert.equal(bought.response.status, 200, JSON.stringify(bought.body));
    assert.equal(bought.body.tokens, 370, 'the refund paid for it');
    assert.equal((await request('/api/rewards/redeem', { method: 'POST', headers, body: JSON.stringify({ rewardId: 'custom-title', rewardName: 'Custom Title', tokenCost: 250 }) })).response.status, 409, 'bought once');
    for (const bad of ['A', '<b>Boss</b>', 'x'.repeat(25)]) {
      assert.equal((await request('/api/rewards/title', { method: 'PUT', headers, body: JSON.stringify({ title: bad }) })).response.status, 400, bad);
    }
    const titled = await request('/api/rewards/title', { method: 'PUT', headers, body: JSON.stringify({ title: '  Early   Riser ' }) });
    assert.deepEqual(titled.body, { ok: true, title: 'Early Riser' });
    assert.deepEqual((await request('/api/rewards', { headers })).body.owned, ['custom-title']);
    const board = await request('/api/leaderboard?period=All%20Time', { headers });
    assert.equal(board.body.leaders.find((leader) => leader.isYou).title, 'Early Riser', 'shown on the leaderboard');
  });

  await t.test('daily claim, daily challenges and profile frames', async () => {
    const password = 'Juniper!Coast6!Lantern2!Moss';
    await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, firstName: 'Dani', lastName: 'Cruz', username: 'dani_cruz', email: 'dani@example.com', password, privacyConsent: true }) });
    await db.query('UPDATE users SET email_verified_at = 1 WHERE email = $1', ['dani@example.com']);
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'dani@example.com', password }) });
    const headers = { Authorization: `Bearer ${login.body.token}` };
    const userId = (await db.query('SELECT id FROM users WHERE email=$1', ['dani@example.com'])).rows[0].id;
    const shift = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

    // Daily claim: day 1 is 2 tokens, once a day.
    const calendar = await request(`/api/daily-claim?date=${today}&timeZone=UTC`, { headers });
    assert.deepEqual({ day: calendar.body.day, claimed: calendar.body.claimedToday, amount: calendar.body.amount, rewards: calendar.body.rewards }, { day: 1, claimed: false, amount: 2, rewards: [2, 3, 4, 5, 6, 8, 15] });
    const claim = await request('/api/daily-claim', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.deepEqual({ status: claim.response.status, tokens: claim.body.tokens, claimed: claim.body.claimedToday, again: claim.body.alreadyClaimed, label: claim.body.tokenHistory[0].label }, { status: 200, tokens: 2, claimed: true, again: false, label: 'Daily claim: day 1' });
    const twice = await request('/api/daily-claim', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.deepEqual({ again: twice.body.alreadyClaimed, tokens: twice.body.tokens }, { again: true, tokens: 2 }, 'claimed once a day');
    assert.equal((await request('/api/daily-claim', { method: 'POST', headers, body: JSON.stringify({ date: shift(-1), timeZone: 'UTC' }) })).response.status, 409, 'only today can be claimed');

    // Days in a row climb the calendar; day 7 is 15 tokens; after day 7, or a gap, it starts again.
    const dayAfter = async (lastDay, daysAgo) => {
      await db.query('DELETE FROM daily_claims WHERE user_id=$1', [userId]);
      await db.query('INSERT INTO daily_claims(user_id,claim_date,cycle_day,amount,claimed_at) VALUES($1,$2,$3,1,1)', [userId, shift(-daysAgo), lastDay]);
      return (await request(`/api/daily-claim?date=${today}&timeZone=UTC`, { headers })).body;
    };
    assert.deepEqual(await dayAfter(6, 1).then((body) => [body.day, body.amount, body.claimedToday]), [7, 15, false]);
    assert.equal((await dayAfter(7, 1)).day, 1, 'a new calendar after day 7');
    assert.equal((await dayAfter(3, 2)).day, 1, 'a missed day starts again at day 1');

    // Daily challenges: "Finish N habits" plus two that fit; each check-in pays the ones it completes.
    await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: [{ ...appState.habits[0], id: 'one', label: 'One' }, { ...appState.habits[0], id: 'two', label: 'Two' }] }) });
    const challenges = await request(`/api/daily-challenges?date=${today}&timeZone=UTC`, { headers });
    assert.equal(challenges.response.status, 200, JSON.stringify(challenges.body));
    assert.deepEqual(challenges.body.challenges[0], { id: 'finish', title: 'Finish 2 habits today', icon: 'trophy', target: 2, progress: 0, reward: 10, date: today, complete: false });
    assert.equal(challenges.body.challenges.length, 3);
    await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'one', date: today, completed: true, timeZone: 'UTC' }) });
    const both = await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'two', date: today, completed: true, timeZone: 'UTC' }) });
    assert.equal(both.body.dailyChallenges[0].complete, true);
    for (const challenge of both.body.dailyChallenges) {
      const label = challenge.id === 'finish' ? 'Daily challenge' : `Daily challenge: ${challenge.title}`;
      const paid = both.body.tokenHistory.filter((item) => item.label === label);
      assert.deepEqual(paid.map((item) => item.amount), challenge.complete ? [challenge.reward] : [], label);
    }
    const undo = await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'two', date: today, completed: false, timeZone: 'UTC' }) });
    assert.equal(undo.body.dailyChallenges[0].complete, false);
    assert.ok(!undo.body.tokenHistory.some((item) => item.label === 'Daily challenge'), 'an undo takes the bonus back');

    // Profile Frames: bought once, then a frame is chosen and shown on the leaderboard.
    assert.equal((await request('/api/rewards/frame', { method: 'PUT', headers, body: JSON.stringify({ frame: 'gold' }) })).response.status, 403);
    await db.query("INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,200,'Test tokens',$3,$4)", [`${userId}:token:test-frames`, userId, new Date().toISOString(), Date.now()]);
    const catalog = await request('/api/rewards', { headers });
    assert.ok(catalog.body.rewards.some((reward) => reward.id === 'profile-frames' && reward.cost === 180 && reward.permanent));
    const bought = await request('/api/rewards/redeem', { method: 'POST', headers, body: JSON.stringify({ rewardId: 'profile-frames', rewardName: 'Profile Frames', tokenCost: 180 }) });
    assert.equal(bought.response.status, 200, JSON.stringify(bought.body));
    assert.equal((await request('/api/rewards/frame', { method: 'PUT', headers, body: JSON.stringify({ frame: 'rainbow' }) })).response.status, 400);
    assert.deepEqual((await request('/api/rewards/frame', { method: 'PUT', headers, body: JSON.stringify({ frame: 'neon' }) })).body, { ok: true, frame: 'neon' });
    assert.equal((await request('/api/rewards', { headers })).body.frame, 'neon');
    const board = await request('/api/leaderboard?period=All%20Time', { headers });
    assert.equal(board.body.leaders.find((leader) => leader.isYou).frame, 'neon');
  });

  await t.test('issue reports store attachments in the database and validate content', async () => {
    const report = await request('/api/support/reports', { method: 'POST', headers: authHeaders, body: JSON.stringify({ topic: 'Other', timing: 'Today', description: 'The report flow works.' }) });
    assert.equal(report.response.status, 201, JSON.stringify(report.body));
    const invalid = new FormData();
    invalid.append('topic', 'Other');
    invalid.append('timing', 'Today');
    invalid.append('description', 'Invalid attachment should be rejected.');
    invalid.append('attachment', new Blob(['not a PNG']), 'evidence.png');
    assert.equal((await fetch(`${baseUrl}/api/support/reports`, { method: 'POST', headers: authHeaders, body: invalid })).status, 400);
    const valid = new FormData();
    valid.append('topic', 'Other');
    valid.append('timing', 'Today');
    valid.append('description', 'Valid attachment should be stored.');
    valid.append('attachment', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'evidence.png');
    assert.equal((await fetch(`${baseUrl}/api/support/reports`, { method: 'POST', headers: authHeaders, body: valid })).status, 201);
    const stored = (await db.query('SELECT attachment_data AS data FROM issue_reports WHERE description = $1', ['Valid attachment should be stored.'])).rows[0];
    assert.deepEqual(stored.data, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const { pruneIssueAttachments } = await import('../services/retention.js');
    assert.equal(await pruneIssueAttachments(db), 0, 'an open report keeps its attachment');
    const longAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await db.query("UPDATE issue_reports SET status = 'resolved', updated_at = $1 WHERE description = $2", [longAgo, 'Valid attachment should be stored.']);
    assert.equal(await pruneIssueAttachments(db), 1, 'a report resolved over 30 days ago loses its attachment');
    const pruned = (await db.query('SELECT attachment_name AS name, attachment_data AS data FROM issue_reports WHERE description = $1', ['Valid attachment should be stored.'])).rows[0];
    assert.equal(pruned.data, null);
    assert.ok(pruned.name, 'the file name is kept');
  });

  await t.test('profile, login activity, multi-device merge and account deletion', async () => {
    const profile = await request('/api/auth/profile', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ fullName: 'Updated User', username: 'updated_user', email: 'updated@example.com', dateOfBirth: 'June 1, 1997', gender: 'Female', about: 'Updated profile.' }) });
    assert.equal(profile.response.status, 200, JSON.stringify(profile.body));
    assert.equal(profile.body.user.emailVerified, false, 'a new email must be confirmed again');
    await db.query('UPDATE users SET email_verified_at = 1 WHERE id = $1', [userId]);

    const activity = await request('/api/auth/login-activity', { headers: authHeaders });
    const entry = activity.body.activities.find((item) => item.device === 'Test Phone (Android 15)');
    assert.ok(entry?.loginDateTime);
    const columns = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'login_activity'`, [schema])).rows.map((row) => row.column_name);
    assert.ok(!columns.includes('ip_address'));

    const base = await request('/api/app-state', { headers: authHeaders });
    const deviceOne = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...base.body.state, preferences: { language: 'Tagalog' }, baseUpdatedAt: base.body.updatedAt, baseState: base.body.state }) });
    assert.equal(deviceOne.response.status, 200);
    const deviceTwo = await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...base.body.state, ringInterval: 20, baseUpdatedAt: base.body.updatedAt, baseState: base.body.state }) });
    assert.equal(deviceTwo.body.merged, true);
    assert.equal(deviceTwo.body.state.preferences.language, 'Tagalog');
    assert.equal(deviceTwo.body.state.ringInterval, 20);
    const snapshots = (await db.query('SELECT COUNT(*)::int AS count FROM user_app_state WHERE user_id = $1', [userId])).rows[0].count;
    assert.ok(snapshots <= 20, `snapshots are pruned (${snapshots})`);

    assert.equal((await request('/api/auth/account', { method: 'DELETE', headers: authHeaders, body: JSON.stringify({ currentPassword: password }) })).response.status, 200);
    assert.equal((await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'updated@example.com', password }) })).response.status, 401);
  });
});
