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
import { normalizeAppState } from '../services/app-state-sync.js';
import { weekEndKey } from '../services/habit-week.js';
import { BUDDY_DROPS, dropForWeek, weeksUntilDrop } from '../services/buddy.js';
import { weekStartOf, weeklyQuests } from '../services/quests.js';
import { retireRewards } from '../services/rewards.js';
import { doneActionSecret, makeDoneToken } from '../services/web-push-actions.js';

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

  const serverEnv = {
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
  };
  const server = spawn(process.execPath, ['server.js'], { cwd: path.resolve(import.meta.dirname, '..'), env: serverEnv, stdio: ['ignore', 'ignore', 'pipe'] });
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
  const waitUntilUp = async (url, errors) => {
    const deadline = Date.now() + 90_000;
    for (;;) {
      try {
        if ((await fetch(`${url}/healthz`)).ok) return;
      } catch {
        // still starting
      }
      if (Date.now() > deadline) throw new Error(`Server did not start:\n${errors()}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };
  await waitUntilUp(baseUrl, () => serverErrors);

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
  // A time zone where it is around noon now, so reminder deadlines (12:00 AM here) have passed and
  // the day is far from over whatever time the tests run.
  const utcHour = new Date().getUTCHours();
  const middayZone = utcHour <= 12 ? `Etc/GMT-${12 - utcHour}` : `Etc/GMT+${utcHour - 12}`;
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
    // A sign-in lasts 30 days.
    const { expiresAt } = (await db.query('SELECT expires_at AS "expiresAt" FROM sessions WHERE token_hash = $1', [crypto.createHash('sha256').update(token).digest('hex')])).rows[0];
    assert.ok(Math.abs(Number(expiresAt) - (Date.now() + 30 * 24 * 60 * 60 * 1000)) < 60_000, `expires at ${new Date(Number(expiresAt)).toISOString()}`);
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
    assert.equal((await request('/api/web-push/subscriptions', { method: 'POST', headers: authHeaders, body: JSON.stringify({ subscription: pushSubscription, timeZone: middayZone }) })).response.status, 200);
    const missedHabit = { id: 'habit-missed', label: 'Pills', reminderEnabled: true, reminderTime: '12:00 AM', reminderTimes: ['12:00 AM'] };
    // Its last reminder is 5 minutes from now: a 15-minute snooze would come back after it.
    const soon = new Intl.DateTimeFormat('en-US', { timeZone: middayZone, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(Date.now() + 5 * 60_000));
    const soonHabit = { id: 'habit-soon', label: 'Water', reminderEnabled: true, reminderTime: soon, reminderTimes: [soon] };
    const snoozeState = { avatarImage: null, profile: { fullName: 'Test User' }, preferences: { notificationsEnabled: true }, habits: [{ id: 'habit-snooze', label: 'Stretch', reminderEnabled: true }, missedHabit, soonHabit], points: 0, tokens: 0, tokenHistory: [], darkModeOverride: null, ringInterval: 15, snoozeFrequency: '2 times', goals: [] };
    assert.equal((await request('/api/app-state', { method: 'PUT', headers: authHeaders, body: JSON.stringify(snoozeState) })).response.status, 200);
    const snoozeToken = crypto.randomBytes(32).toString('base64url');
    const subscriptionId = (await db.query('SELECT id FROM web_push_subscriptions WHERE endpoint=$1', [pushSubscription.endpoint])).rows[0].id;
    await db.query('INSERT INTO web_push_snooze_tokens(token_hash,subscription_id,habit_id,snooze_count,expires_at,created_at) VALUES($1,$2,$3,0,$4,$5)', [crypto.createHash('sha256').update(snoozeToken).digest('hex'), subscriptionId, 'habit-snooze', Date.now() + 60000, Date.now()]);
    assert.equal((await request('/api/web-push/snooze', { method: 'POST', body: JSON.stringify({ token: snoozeToken }) })).response.status, 200);
    assert.equal((await request('/api/web-push/snooze', { method: 'POST', body: JSON.stringify({ token: snoozeToken }) })).response.status, 410);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM web_push_snooze_queue')).rows[0].count, 1);
    // A snooze that could not come back while the habit can be checked in is refused, with the reason.
    const snoozeWith = async (habitId, createdAt = Date.now()) => {
      const oneTime = crypto.randomBytes(32).toString('base64url');
      await db.query('INSERT INTO web_push_snooze_tokens(token_hash,subscription_id,habit_id,snooze_count,expires_at,created_at) VALUES($1,$2,$3,0,$4,$5)', [crypto.createHash('sha256').update(oneTime).digest('hex'), subscriptionId, habitId, Date.now() + 60000, createdAt]);
      return request('/api/web-push/snooze', { method: 'POST', body: JSON.stringify({ token: oneTime }) });
    };
    const missedSnooze = await snoozeWith(missedHabit.id);
    assert.deepEqual([missedSnooze.response.status, missedSnooze.body.code], [409, 'HABIT_MISSED'], 'past its last reminder time (12:00 AM)');
    const lateSnooze = await snoozeWith(soonHabit.id);
    assert.deepEqual([lateSnooze.response.status, lateSnooze.body.code], [409, 'SNOOZE_TOO_LATE'], JSON.stringify(lateSnooze.body));
    assert.match(lateSnooze.body.message, /Check it in before then/);
    const oldSnooze = await snoozeWith('habit-snooze', Date.now() - 24 * 60 * 60 * 1000);
    assert.deepEqual([oldSnooze.response.status, oldSnooze.body.code], [409, 'DAY_OVER'], 'a reminder from an earlier day');
    // Without a reminder time the habit is open until midnight; a 1000-minute snooze from noon is not.
    await db.query(`UPDATE user_app_state SET state_json = jsonb_set(state_json, '{ringInterval}', '1000') WHERE user_id=$1`, [userId]);
    const pastMidnight = await snoozeWith('habit-snooze');
    assert.deepEqual([pastMidnight.response.status, pastMidnight.body.code], [409, 'SNOOZE_TOO_LATE'], JSON.stringify(pastMidnight.body));
    assert.match(pastMidnight.body.message, /after midnight/);
    await db.query(`UPDATE user_app_state SET state_json = jsonb_set(state_json, '{ringInterval}', '15') WHERE user_id=$1`, [userId]);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM web_push_snooze_queue')).rows[0].count, 1, 'nothing more is queued');
    assert.equal((await request('/api/web-push/subscriptions', { method: 'POST', headers: authHeaders, body: JSON.stringify({ subscription: { ...pushSubscription, endpoint: 'https://attacker.example/push' }, timeZone: 'UTC' }) })).response.status, 400);
    assert.equal((await request('/api/web-push/subscriptions', { method: 'DELETE', headers: authHeaders, body: JSON.stringify({ endpoint: pushSubscription.endpoint }) })).response.status, 200);
    // The test notification needs a signed-in account with this device subscribed.
    assert.equal((await request('/api/web-push/test', { method: 'POST', body: JSON.stringify({}) })).response.status, 401);
    const noDevice = await request('/api/web-push/test', { method: 'POST', headers: authHeaders, body: JSON.stringify({ endpoint: pushSubscription.endpoint }) });
    assert.equal(noDevice.response.status, 404);
    assert.match(noDevice.body.message, /Turn on reminders/);
  });

  await t.test('ML proxy, AI without keys, and password reset protections', async () => {
    // While the ML service is down (asleep on the free server), the same rules answer, labelled.
    const asleep = await request('/api/habit/predict', { method: 'POST', headers: authHeaders, body: JSON.stringify({ habit_name: 'Workout', completion_rate: 0.75, streak: 4, last_7_days: [1, 1, 0, 1, 1, 0, 1] }) });
    assert.equal(asleep.response.status, 200);
    assert.equal(asleep.body.prediction_source, 'fallback');
    assert.equal(asleep.body.is_fallback, true);
    assert.equal(asleep.body.completion_probability, 0.616);
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
    // And paid as one sent directly: 5 and each of today's challenges it completed.
    const challenges = (await request(`/api/daily-challenges?date=${today}&timeZone=UTC`, { headers: authHeaders })).body.challenges;
    const paidChallenges = offline.body.state.tokenHistory.filter((item) => item.label.startsWith('Daily challenge'));
    assert.deepEqual(paidChallenges.map((item) => item.amount).sort(), challenges.filter((challenge) => challenge.complete).map((challenge) => challenge.reward).sort(), JSON.stringify(challenges));
    assert.equal(offline.body.state.tokens, 5 + paidChallenges.reduce((sum, item) => sum + item.amount, 0));
    stateUpdatedAt = offline.body.updatedAt;

    const unchanged = await request(`/api/app-state?since=${stateUpdatedAt}`, { headers: authHeaders });
    assert.equal(unchanged.body.unchanged, true);
    assert.equal(normalizeAppState({ habits: [{ id: 'a' }, { id: 'a' }] }).habits.length, 1);
  });

  await t.test('check-ins lock after the undo window, past days stay closed, habits are analysed', async () => {
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const late = await request('/api/habit-completions', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ habitId: 'habit-1', date: yesterday, completed: true, timeZone: 'UTC' }) });
    assert.equal(late.response.status, 409);
    assert.deepEqual([late.body.code, late.body.today, late.body.timeZone], ['DAY_CLOSED', today, 'UTC'], 'with the account\'s day, for the app to show');

    // habit-1 was checked in by the offline sync above; once the window has passed it is locked.
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const locked = await request('/api/habit-completions', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ habitId: 'habit-1', date: today, completed: false, timeZone: 'UTC' }) });
    assert.equal(locked.response.status, 409);
    assert.equal(locked.body.code, 'CHECK_IN_LOCKED');
    const still = await request('/api/habit-completions', { headers: authHeaders });
    assert.ok(still.body.completions.some((row) => row.habitId === 'habit-1' && row.date === today), 'the locked check-in is kept');

    // A sleeping ML service still gives a forecast: the same rules, computed by the backend.
    mlServiceReady = false;
    const asleepAnalysis = await request('/api/insights/habit-analysis', { method: 'POST', headers: authHeaders, body: JSON.stringify({ habitId: 'habit-1', timeZone: 'UTC' }) });
    assert.equal(asleepAnalysis.response.status, 200, JSON.stringify(asleepAnalysis.body));
    assert.equal(asleepAnalysis.body.mlStatus, 'estimate');
    assert.equal(asleepAnalysis.body.ml.source, 'rules');
    assert.equal(typeof asleepAnalysis.body.ml.completionProbability, 'number');
    mlServiceReady = true;
    const analysis = await request('/api/insights/habit-analysis', { method: 'POST', headers: authHeaders, body: JSON.stringify({ habitId: 'habit-1', timeZone: 'UTC' }) });
    assert.equal(analysis.response.status, 200, JSON.stringify(analysis.body));
    assert.equal(analysis.body.stats.completedDays, 1);
    assert.deepEqual(analysis.body.stats.last7Days, [0, 0, 0, 0, 0, 0, 1]);
    assert.equal(analysis.body.ml.completionProbability, 0.72);
    assert.equal(analysis.body.mlStatus, 'ready');
    assert.equal(analysis.body.ai, null, 'no AI advice without an API key');
    assert.equal(analysis.body.aiStatus, 'off');
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
    const crossUser = await request('/api/habit-completions', { method: 'PUT', headers: secondHeaders, body: JSON.stringify({ habitId: 'habit-1', date: today, completed: true, timeZone: 'UTC' }) });
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

  await t.test('system admins cannot sign in to the app (they use the Admin Panel)', async () => {
    const password = 'Violet!Canyon6!Brisk4!Oak';
    const registered = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, firstName: 'Ada', lastName: 'Reyes', username: 'ada_reyes', email: 'ada@example.com', password, privacyConsent: true }) });
    await db.query('UPDATE users SET email_verified_at = 1 WHERE email = $1', ['ada@example.com']);
    // Signed in to the app as a student...
    const before = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'ada@example.com', password }) });
    assert.equal(before.response.status, 200, JSON.stringify(before.body));
    // ...then made a system admin in the Admin Panel: every app session stops working at once.
    await db.query("UPDATE users SET role = 'admin' WHERE email = $1", ['ada@example.com']);
    for (const token of [before.body.token, registered.body.token]) {
      const me = await request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(me.response.status, 401, 'an app session of a system admin is not valid');
    }
    const sessions = await db.query('SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1', ['ada@example.com']);
    assert.equal(sessions.rows[0].n, 0, 'and it is removed');

    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'ada@example.com', password }) });
    assert.equal(login.response.status, 403);
    assert.equal(login.body.code, 'ADMIN_ACCOUNT');
    assert.match(login.body.message, /Admin Panel/);
    assert.equal(login.body.token, undefined, 'no app session is created');
    // A wrong password gets the usual answer, so the account's role is not revealed.
    const wrong = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'ada@example.com', password: 'Wrong!Harbor2!Pine9!Lake' }) });
    assert.equal(wrong.response.status, 401);
    assert.equal(wrong.body.code, undefined);
  });

  await t.test('sign-in is paused after too many wrong passwords, from any network', async () => {
    const password = 'Copper!Meadow5!Swift8!Elm';
    await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, firstName: 'Lock', lastName: 'Tester', username: 'lock_tester', email: 'lock@example.com', password, privacyConsent: true }) });
    await db.query('UPDATE users SET email_verified_at = 1 WHERE email = $1', ['lock@example.com']);
    const attempt = (secret) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'lock@example.com', password: secret }) });
    for (let index = 1; index < 8; index += 1) {
      const wrong = await attempt(`Wrong!Guess${index}!Pine9!Lake`);
      assert.equal(wrong.response.status, 401, `wrong password ${index} is just refused`);
    }
    const eighth = await attempt('Wrong!Guess8!Pine9!Lake');
    assert.equal(eighth.response.status, 429, 'the 8th wrong password pauses sign-in');
    assert.equal(eighth.body.code, 'ACCOUNT_LOCKED');
    assert.match(eighth.body.message, /paused for 15 minutes/);
    const right = await attempt(password);
    assert.equal(right.response.status, 429, 'while paused even the right password is refused, so guessing cannot continue');
    assert.equal(right.body.token, undefined);

    // After the pause the right password works and the count starts again.
    await db.query('UPDATE users SET login_locked_until = $2 WHERE email = $1', ['lock@example.com', Date.now() - 1000]);
    const later = await attempt(password);
    assert.equal(later.response.status, 200, JSON.stringify(later.body));
    const counters = await db.query('SELECT failed_logins AS "failedLogins", login_locked_until AS "lockedUntil" FROM users WHERE email = $1', ['lock@example.com']);
    assert.deepEqual(counters.rows[0], { failedLogins: 0, lockedUntil: null });
  });

  await t.test('a done goal step cannot be unchecked by a later save', async () => {
    const password = 'Maple!Harbor3!Quick6!Fig';
    await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, firstName: 'Gia', lastName: 'Santos', username: 'gia_santos', email: 'gia@example.com', password, privacyConsent: true }) });
    await db.query('UPDATE users SET email_verified_at = 1 WHERE email = $1', ['gia@example.com']);
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'gia@example.com', password }) });
    const headers = { Authorization: `Bearer ${login.body.token}` };
    const goal = { id: 'goal-1', title: 'Get fit', category: 'Health', summary: 'Plan.', intensity: 'Balanced', focusAreas: ['A', 'B', 'C'], actionPlan: ['One', 'Two', 'Three', 'Four'], actionDueDates: ['Oct 7', 'Oct 14', 'Oct 25', 'Nov 18'], nextMilestone: 'M', risk: 'R', riskAction: 'A', timeline: '30-60 days', focusTarget: '4 habits', nextCheckIn: 'Oct 11, 2026', completedSteps: [true, false, false, false], progress: 25, status: 'In progress' };
    const first = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, goals: [goal] }) });
    assert.equal(first.response.status, 200, JSON.stringify(first.body));

    // The same device, up to date, sends step 1 unchecked and step 2 ticked.
    const unchecked = { ...goal, completedSteps: [false, true, false, false], progress: 25 };
    const second = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, goals: [unchecked], baseUpdatedAt: first.body.updatedAt, baseState: first.body.state }) });
    assert.equal(second.response.status, 200, JSON.stringify(second.body));
    const saved = second.body.state.goals[0];
    assert.deepEqual(saved.completedSteps, [true, true, false, false], 'step 1 stays done, step 2 is added');
    assert.equal(saved.progress, 50);
    const stored = await db.query("SELECT completed FROM goal_steps WHERE id LIKE '%goal-1:step:0'");
    assert.equal(stored.rows[0].completed, true);
  });

  await t.test('a confirmed email changes only with the current password; other devices can be signed out', async () => {
    const password = 'Silver!Brook4!Calm7!Ash';
    const registered = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, firstName: 'Mia', lastName: 'Lopez', username: 'mia_lopez', email: 'mia@example.com', password, privacyConsent: true }) });
    await db.query('UPDATE users SET email_verified_at = 1 WHERE email = $1', ['mia@example.com']);
    const phone = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'mia@example.com', password, device: 'Phone' }) });
    const laptop = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'mia@example.com', password, device: 'Laptop' }) });
    const phoneHeaders = { Authorization: `Bearer ${phone.body.token}` };
    const profile = { firstName: 'Mia', lastName: 'Lopez', username: 'mia_lopez', email: 'mia.new@example.com', dateOfBirth: registration.dateOfBirth, gender: registration.gender, about: '' };

    const without = await request('/api/auth/profile', { method: 'PUT', headers: phoneHeaders, body: JSON.stringify(profile) });
    assert.equal(without.response.status, 403);
    assert.equal(without.body.code, 'PASSWORD_REQUIRED');
    const wrong = await request('/api/auth/profile', { method: 'PUT', headers: phoneHeaders, body: JSON.stringify({ ...profile, currentPassword: 'Not!The!Password1' }) });
    assert.equal(wrong.response.status, 401);
    assert.equal((await db.query('SELECT email FROM users WHERE username = $1', ['mia_lopez'])).rows[0].email, 'mia@example.com', 'the email did not change');
    const sameEmail = await request('/api/auth/profile', { method: 'PUT', headers: phoneHeaders, body: JSON.stringify({ ...profile, email: 'mia@example.com', about: 'Hi' }) });
    assert.equal(sameEmail.response.status, 200, 'other details change without the password');
    const changed = await request('/api/auth/profile', { method: 'PUT', headers: phoneHeaders, body: JSON.stringify({ ...profile, currentPassword: password }) });
    assert.equal(changed.response.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.user.email, 'mia.new@example.com');
    await db.query('UPDATE users SET email_verified_at = 1 WHERE email = $1', ['mia.new@example.com']);

    // The phone sees the other signed-in devices and signs them out; it stays signed in itself.
    const activity = await request('/api/auth/login-activity', { headers: phoneHeaders });
    assert.equal(activity.body.otherSessions, 2, 'the laptop and the sign-up session');
    const out = await request('/api/auth/sessions/others/logout', { method: 'POST', headers: phoneHeaders });
    assert.equal(out.response.status, 200);
    assert.equal(out.body.signedOut, 2);
    for (const token of [laptop.body.token, registered.body.token]) {
      assert.equal((await request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })).response.status, 401, 'other devices are signed out');
    }
    assert.equal((await request('/api/auth/me', { headers: phoneHeaders })).response.status, 200, 'this device stays signed in');
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
    // Treats: fed with tokens, counted toward the collection, and the buddy says a line.
    assert.equal((await request('/api/buddy/treats', { method: 'POST', headers, body: JSON.stringify({ treatId: 'nope' }) })).response.status, 404, 'unknown treats are refused');
    const apple = await request('/api/buddy/treats', { method: 'POST', headers, body: JSON.stringify({ treatId: 'apple' }) });
    assert.equal(apple.response.status, 200, JSON.stringify(apple.body));
    assert.equal(apple.body.tokens, 45, 'a 15-token treat is charged');
    assert.ok(typeof apple.body.line === 'string' && apple.body.line.length > 0, 'the buddy says something');
    assert.deepEqual(apple.body.buddy.fedTreats, [{ treatId: 'apple', count: 1 }]);
    const apple2 = await request('/api/buddy/treats', { method: 'POST', headers, body: JSON.stringify({ treatId: 'apple' }) });
    assert.equal(apple2.body.buddy.treatsFed, 2, 'feeding again bumps the count');

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
    // Done on a habit already past its last reminder time is refused with the reason (it used to fail with a 500).
    const pills = { ...appState.habits[0], id: 'pills', label: 'Pills', reminderEnabled: true, reminderTime: '12:00 AM', reminderTimes: ['12:00 AM'] };
    const current = await request('/api/app-state', { headers });
    await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...current.body.state, habits: [...current.body.state.habits, pills], baseUpdatedAt: current.body.updatedAt, baseState: current.body.state }) });
    const middayDate = new Intl.DateTimeFormat('en-CA', { timeZone: middayZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const lateDone = await request('/api/web-push/done', { method: 'POST', body: JSON.stringify({ token: makeDoneToken({ userId, habitId: 'pills', date: middayDate, timeZone: middayZone }, secret) }) });
    assert.equal(lateDone.response.status, 409, JSON.stringify(lateDone.body));
    assert.equal(lateDone.body.code, 'PAST_DEADLINE');
    // Checked in before its deadline: Done tapped again afterwards still finds it done, not missed.
    await db.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4)', [userId, 'pills', middayDate, Date.now()]);
    const doneAgain = await request('/api/web-push/done', { method: 'POST', body: JSON.stringify({ token: makeDoneToken({ userId, habitId: 'pills', date: middayDate, timeZone: middayZone }, secret) }) });
    assert.equal(doneAgain.response.status, 200, JSON.stringify(doneAgain.body));

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

  await t.test('habits last one week: stamped when saved, closed after their week, account streak bonuses', async () => {
    const password = 'Amber!Harbor3!Fjord7!Lark';
    await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, firstName: 'Week', lastName: 'Runner', username: 'week_runner', email: 'week@example.com', password, privacyConsent: true }) });
    await db.query('UPDATE users SET email_verified_at = 1 WHERE email = $1', ['week@example.com']);
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'week@example.com', password }) });
    const headers = { Authorization: `Bearer ${login.body.token}` };
    const userId = (await db.query('SELECT id FROM users WHERE email=$1', ['week@example.com'])).rows[0].id;
    const habitById = (state, id) => state.habits.find((habit) => habit.id === id);
    const dayBefore = (days) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    // A habit with no time zone yet is stamped with the end of its week in Manila.
    const manilaToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    // Habits saved without a last active day (made by an older app) get the end of this week; one
    // whose week ended long ago keeps its day and stays in the state as history.
    const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: [
      { ...appState.habits[0], id: 'walk', label: 'Morning walk' },
      { ...appState.habits[0], id: 'read', label: 'Read' },
      { ...appState.habits[0], id: 'old', label: 'Old habit', startDate: '2026-01-05', activeUntil: '2026-01-11' },
    ] }) });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.state.habits.map((habit) => habit.activeUntil), [weekEndKey(manilaToday), weekEndKey(manilaToday), '2026-01-11']);
    const column = (await db.query('SELECT active_until AS "activeUntil" FROM habits WHERE id=$1', [`${userId}:habit:walk`])).rows[0];
    assert.equal(column.activeUntil, weekEndKey(manilaToday), 'the habits table has it too');

    // An app version that drops the field cannot move the ended habit into this week.
    const dropped = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...saved.body.state, habits: saved.body.state.habits.map(({ activeUntil, ...habit }) => habit), ringInterval: 25, baseUpdatedAt: saved.body.updatedAt, baseState: saved.body.state }) });
    assert.equal(dropped.response.status, 200, JSON.stringify(dropped.body));
    assert.deepEqual(dropped.body.state.habits.map((habit) => habit.activeUntil), [weekEndKey(manilaToday), weekEndKey(manilaToday), '2026-01-11']);

    // The ended habit cannot be checked in, from the app or from a reminder's Done button.
    const ended = await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'old', date: today, completed: true, timeZone: 'UTC' }) });
    assert.equal(ended.response.status, 409, JSON.stringify(ended.body));
    assert.deepEqual([ended.body.code, ended.body.message], ['HABIT_ENDED', "This habit's week has ended. It stays in your history; add a new habit for this week."]);
    const secret = doneActionSecret({ WEB_PUSH_VAPID_PUBLIC_KEY: 'test-vapid-public-key', WEB_PUSH_VAPID_PRIVATE_KEY: 'test-vapid-private-key', WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.com' });
    const endedDone = await request('/api/web-push/done', { method: 'POST', body: JSON.stringify({ token: makeDoneToken({ userId, habitId: 'old', date: today, timeZone: 'UTC' }, secret) }) });
    assert.equal(endedDone.response.status, 409, JSON.stringify(endedDone.body));
    assert.equal(endedDone.body.code, 'HABIT_ENDED');
    const synced = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...dropped.body.state, habits: dropped.body.state.habits.map((habit) => (habit.id === 'old' ? { ...habit, completionDates: [manilaToday] } : habit)), baseUpdatedAt: dropped.body.updatedAt, baseState: dropped.body.state }) });
    assert.equal(synced.response.status, 200, JSON.stringify(synced.body));
    assert.deepEqual(habitById(synced.body.state, 'old').completionDates, [], 'nor by a synced (offline) check-in');
    assert.ok(!(await request('/api/habit-completions', { headers })).body.completions.some((row) => row.habitId === 'old'), 'nothing was checked in');

    // Account streak: six days in a row (on any habit), then today's first check-in makes seven and
    // pays the 7-day bonus once for this run, whatever else is checked in or undone today.
    for (const days of [1, 2, 3, 4, 5, 6]) {
      await db.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4)', [userId, days % 2 ? 'walk' : 'read', dayBefore(days), Date.now()]);
    }
    const streakBonuses = async () => (await db.query('SELECT id, amount, label FROM token_transactions WHERE user_id=$1 AND id LIKE $2', [userId, `${userId}:token:streak:%`])).rows;
    const walked = await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'walk', date: today, completed: true, timeZone: 'UTC' }) });
    assert.equal(walked.response.status, 200, JSON.stringify(walked.body));
    assert.deepEqual(await streakBonuses(), [{ id: `${userId}:token:streak:account:${dayBefore(6)}:7`, amount: 15, label: '7-day streak' }]);
    assert.equal(walked.body.tokenHistory.find((item) => item.label === '7-day streak')?.amount, 15, 'the app sees the bonus');
    await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'read', date: today, completed: true, timeZone: 'UTC' }) });
    await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'walk', date: today, completed: false, timeZone: 'UTC' }) });
    await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'walk', date: today, completed: true, timeZone: 'UTC' }) });
    assert.equal((await streakBonuses()).length, 1, 'paid once');

    // The one-time migration: a snapshot saved before weekly habits gets the end of the week on
    // its habits (a stamped one keeps its day), as a newer snapshot with every check-in kept.
    // (The server's own modules need DATABASE_URL to load; only the test's connection is used.)
    process.env.DATABASE_URL ||= urlForSchema(testDatabaseUrl, schema);
    const { stampLatestSnapshot } = await import('../services/app-state-store.js');
    const latest = (await request('/api/app-state', { headers })).body;
    const legacyState = { ...latest.state, habits: latest.state.habits.map(({ activeUntil, ...habit }) => (habit.id === 'old' ? { ...habit, activeUntil } : habit)) };
    await db.query('INSERT INTO user_app_state(id,user_id,state_json,updated_at) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), userId, legacyState, latest.updatedAt + 1]);
    await db.query("UPDATE habits SET active_until='' WHERE user_id=$1", [userId]);
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      assert.equal(await stampLatestSnapshot(userId, connection), true);
      assert.equal(await stampLatestSnapshot(userId, connection), false, 'stamped once');
      await connection.query('COMMIT');
    } finally {
      connection.release();
    }
    const migrated = (await request('/api/app-state', { headers })).body;
    assert.ok(migrated.updatedAt > latest.updatedAt + 1, 'a newer snapshot the apps rebase on');
    // Walk and read were checked in with the UTC time zone, so their week ends in UTC.
    assert.deepEqual(migrated.state.habits.map((habit) => habit.activeUntil), [weekEndKey(today), weekEndKey(today), '2026-01-11']);
    assert.deepEqual((await db.query('SELECT active_until AS "activeUntil" FROM habits WHERE user_id=$1 ORDER BY sort_order', [userId])).rows.map((row) => row.activeUntil), [weekEndKey(today), weekEndKey(today), '2026-01-11']);
    assert.equal(migrated.completions.length, latest.completions.length, 'every check-in is kept');

    // The seven-day streak achievement follows the account streak, across habits and weeks, like
    // the app's badge: seven days in a row with any check-in earn it, and it stays earned.
    const { earnedAchievements } = await import('../services/app-state-store.js');
    const weekDays = Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(2026, 9, 12 + index)).toISOString().slice(0, 10));
    const split = [
      { id: 'a', frequency: 'Daily', startDate: '2026-10-12', activeUntil: '2026-10-18', streak: 0, completionDates: weekDays.slice(0, 4) },
      { id: 'b', frequency: 'Daily', startDate: '2026-10-15', activeUntil: '2026-10-18', streak: 3, completionDates: weekDays.slice(4) },
    ];
    assert.ok(earnedAchievements(split, { today: '2026-10-21' }).includes('streak-week'));
    assert.ok(!earnedAchievements(split.slice(0, 1), { today: '2026-10-21' }).includes('streak-week'), 'four days are not seven');
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
    assert.deepEqual(catalog.body.rewards.map((reward) => [reward.id, reward.cost, reward.permanent]), [['profile-frames', 180, true], ['premium-theme', 200, true], ['custom-title', 250, true], ['buddy-showcase', 300, true]], 'only rewards that do something are on sale');
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

  await t.test('live versions change only for the data that changed', async () => {
    const password = 'Harbor!Willow5!Comet8!Pine';
    await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...registration, firstName: 'Lia', lastName: 'Ramos', username: 'lia_ramos', email: 'lia@example.com', password, privacyConsent: true }) });
    await db.query('UPDATE users SET email_verified_at = 1 WHERE email = $1', ['lia@example.com']);
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'lia@example.com', password }) });
    const headers = { Authorization: `Bearer ${login.body.token}` };
    const userId = (await db.query('SELECT id FROM users WHERE email=$1', ['lia@example.com'])).rows[0].id;
    const live = async () => (await request('/api/live', { headers })).body;
    assert.equal((await request('/api/live')).response.status, 401, 'signed in only');

    const start = await live();
    assert.deepEqual(Object.keys(start.versions).sort(), ['buddy', 'claims', 'freezes', 'notifications', 'rewards', 'state', 'wallet']);
    assert.equal(start.unread, 0);

    // A daily claim (on any device) changes the wallet and the claims, nothing else.
    await request('/api/daily-claim', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    const claimed = await live();
    const changed = (before, after) => Object.keys(after.versions).filter((key) => after.versions[key] !== before.versions[key]).sort();
    assert.deepEqual(changed(start, claimed), ['claims', 'wallet']);

    // A new notification (e.g. a badge) and reading it.
    await db.query("INSERT INTO notifications(id,user_id,type,title,body,created_at) VALUES('live-note',$1,'achievement','Badge','You earned a badge',$2)", [userId, Date.now()]);
    const noted = await live();
    assert.deepEqual([changed(claimed, noted), noted.unread], [['notifications'], 1]);
    await db.query("UPDATE notifications SET read_at=$2 WHERE id='live-note' AND user_id=$1", [userId, Date.now()]);
    const read = await live();
    assert.deepEqual([changed(noted, read), read.unread], [['notifications'], 0]);

    // Saving habits changes the state (and the first habit earns a badge notification); renaming the buddy changes the buddy.
    await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify(appState) });
    await request('/api/buddy', { method: 'PUT', headers, body: JSON.stringify({ name: 'Mochi' }) });
    const afterHabits = await live();
    assert.deepEqual(changed(read, afterHabits), ['buddy', 'notifications', 'state']);

    // Feeding a treat records it in buddy_treats; the buddy version must change so the collection
    // syncs to the student's other devices, and the wallet changes because the treat costs tokens.
    await db.query("INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,50,'Test grant',$3,$4)", [`${userId}:token:treat-grant`, userId, new Date().toISOString(), Date.now()]);
    const beforeTreat = await live();
    await request('/api/buddy/treats', { method: 'POST', headers, body: JSON.stringify({ treatId: 'apple' }) });
    assert.deepEqual(changed(beforeTreat, await live()), ['buddy', 'wallet'], 'a treat feed syncs the buddy collection and the wallet');
  });

  /** A verified student made directly in the database, with a session (sign-ups are rate-limited per network). */
  const student = async (firstName, lastName) => {
    const id = crypto.randomUUID();
    const handle = `${firstName}_${lastName}`.toLowerCase();
    await db.query(
      `INSERT INTO users(id, full_name, first_name, last_name, username, email, password_hash, created_at, email_verified_at, privacy_consent_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'not-a-password', $7, 1, 1)`,
      [id, `${firstName} ${lastName}`, firstName, lastName, handle, `${handle}@example.com`, Date.now()],
    );
    const session = async () => {
      const secret = crypto.randomBytes(32).toString('hex');
      await db.query('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [crypto.createHash('sha256').update(secret).digest('hex'), id, Date.now() + 60 * 60 * 1000]);
      return { Authorization: `Bearer ${secret}` };
    };
    return { userId: id, headers: await session(), session };
  };
  const dateIn = (zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const grant = (userId, amount, id) => db.query("INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,'Test grant',$4,$5)", [`${userId}:token:${id}`, userId, amount, new Date().toISOString(), Date.now()]);
  let capped;

  await t.test('tokens are paid for 6 check-ins a day; undoing, deleting and re-creating never pay more', async () => {
    capped = await student('Cap', 'Tester');
    const { headers, userId } = capped;
    const ids = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'];
    const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: ids.map((id) => ({ ...appState.habits[0], id, label: `Habit ${id}` })) }) });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    const checkIn = (habitId, completed = true) => request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId, date: today, completed, timeZone: 'UTC' }) });
    // Today's check-in tokens (and any undo row, which must never be written again).
    const checkInRows = async () => (await db.query("SELECT amount FROM token_transactions WHERE user_id=$1 AND (id LIKE '%:token:check-in:%:' || $2::text OR id LIKE '%:token:undo:%')", [userId, today])).rows.map((row) => row.amount);
    const paid = async () => (await checkInRows()).reduce((sum, amount) => sum + amount, 0);

    for (const [index, habitId] of ids.slice(0, 6).entries()) {
      const done = await checkIn(habitId);
      assert.equal(done.response.status, 200, JSON.stringify(done.body));
      assert.deepEqual([done.body.tokenCapped, done.body.paidCheckInsToday, done.body.paidCheckInsLimit], [false, index + 1, 6], habitId);
    }
    const seventh = await checkIn('h7');
    assert.deepEqual([seventh.body.tokenCapped, seventh.body.paidCheckInsToday, seventh.body.paidCheckInsLimit], [true, 6, 6], 'the 7th check-in pays 0');
    assert.deepEqual(seventh.body.habit.completionDates, [today], 'but it is kept, for the streak, challenges and quests');
    assert.equal(await paid(), 30);

    // Undoing the unpaid check-in takes nothing (it used to write -5); undoing a paid one frees its slot.
    const undoCapped = await checkIn('h7', false);
    assert.deepEqual([undoCapped.response.status, undoCapped.body.tokenCapped], [200, false]);
    assert.deepEqual(await checkInRows(), [5, 5, 5, 5, 5, 5], 'undoing a capped check-in writes no negative row');
    const undo = await checkIn('h6', false);
    assert.equal(undo.body.paidCheckInsToday, 5, 'an undo frees a slot');
    const eighth = await checkIn('h8');
    assert.deepEqual([eighth.body.tokenCapped, eighth.body.paidCheckInsToday], [false, 6]);
    assert.equal(await paid(), 30);

    // Deleting a habit checked in today takes its +5 back, so delete + re-create + check-in pays 0.
    // Earlier days keep theirs, so cleaning up history never makes a balance negative.
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    await db.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4)', [userId, 'h1', yesterday, Date.now()]);
    await db.query("INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,5,'Completed Habit h1',$3,$4)", [`${userId}:token:check-in:h1:${yesterday}`, userId, new Date().toISOString(), Date.now()]);
    const deleted = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...eighth.body.state, habits: eighth.body.state.habits.filter((habit) => habit.id !== 'h1'), baseUpdatedAt: eighth.body.updatedAt, baseState: eighth.body.state }) });
    assert.deepEqual([deleted.response.status, deleted.body.merged], [200, false], JSON.stringify(deleted.body));
    assert.equal(await paid(), 25, 'deleting a habit checked in today removes its +5');
    assert.equal((await db.query('SELECT 1 FROM token_transactions WHERE id=$1', [`${userId}:token:check-in:h1:${yesterday}`])).rowCount, 1, "yesterday's +5 stays");
    const recreated = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...deleted.body.state, habits: [...deleted.body.state.habits, { ...appState.habits[0], id: 'h1', label: 'Habit h1' }], baseUpdatedAt: deleted.body.updatedAt, baseState: deleted.body.state }) });
    assert.equal(recreated.response.status, 200, JSON.stringify(recreated.body));
    const again = await checkIn('h1');
    assert.equal(again.response.status, 200, JSON.stringify(again.body));
    assert.equal(await paid(), 30, 'after 6 paid check-ins, delete + re-create + check-in pays 0');
    const renamed = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...again.body.state, habits: [...again.body.state.habits.filter((habit) => habit.id !== 'h2'), { ...appState.habits[0], id: 'h2-new', label: 'Habit h2' }], baseUpdatedAt: again.body.updatedAt, baseState: again.body.state }) });
    assert.equal(renamed.response.status, 200, JSON.stringify(renamed.body));
    assert.equal((await checkIn('h2-new')).body.tokenCapped, false);
    assert.equal(await paid(), 30, 'the same under a new habit id');
    assert.equal((await db.query('SELECT 1 FROM token_transactions WHERE user_id=$1 AND amount < 0', [userId])).rowCount, 0, 'nothing was ever charged back');
  });

  await t.test('the 121st check-in request in 15 minutes gets 429', async () => {
    const headers = await capped.session();
    const send = (sessionHeaders = headers) => request('/api/habit-completions', { method: 'PUT', headers: sessionHeaders, body: JSON.stringify({ habitId: 'missing', date: today, completed: true, timeZone: 'UTC' }) });
    for (let sent = 0; sent < 120; sent += 20) {
      const answers = await Promise.all(Array.from({ length: 20 }, () => send()));
      assert.ok(answers.every((answer) => answer.response.status === 404), 'within the limit');
    }
    const over = await send();
    assert.equal(over.response.status, 429);
    assert.deepEqual(over.body, { ok: false, message: 'Too many check-ins. Please wait a few minutes and try again.' });
    assert.equal((await request('/api/habit-completions', { headers })).response.status, 200, 'reading check-ins is not limited');
    assert.equal((await send(capped.headers)).response.status, 404, 'the limit is per session');

    // Token actions share one budget of 60 per session.
    const walletHeaders = await capped.session();
    const closedDay = JSON.stringify({ date: '2000-01-01', timeZone: 'UTC' });
    const spend = (url, body = closedDay) => request(url, { method: 'POST', headers: walletHeaders, body });
    for (let sent = 0; sent < 60; sent += 20) {
      const answers = await Promise.all(Array.from({ length: 20 }, (_, index) => spend(['/api/daily-claim', '/api/mystery-box/open', '/api/streak-freezes/buy', '/api/buddy/treats', '/api/rewards/redeem'][index % 5], index % 5 >= 3 ? '{}' : closedDay)));
      assert.ok(answers.every((answer) => [400, 409].includes(answer.response.status)), answers.map((answer) => answer.response.status).join(', '));
      // Every closed day says which day the account is on.
      assert.ok(answers.filter((answer) => answer.response.status === 409).every((answer) => answer.body.code === 'DAY_CLOSED' && answer.body.today === today && answer.body.timeZone === 'UTC'));
    }
    const overWallet = await spend('/api/buddy/items', JSON.stringify({ itemId: 'cap' }));
    assert.deepEqual([overWallet.response.status, overWallet.body], [429, { ok: false, message: 'Too many token actions. Please wait a few minutes and try again.' }]);
  });

  await t.test('from the cap date a day counts 6 check-ins toward points, the leaderboard and Habi', async () => {
    const { headers, userId } = await student('Ivy', 'Ocampo');
    // 2026-10-27 is on or after CHECK_IN_CAP_FROM (2026-10-26); the check-ins are made in the database.
    for (let index = 0; index < 8; index += 1) await db.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4)', [userId, `h${index}`, '2026-10-27', Date.now()]);
    const points = async () => (await request('/api/leaderboard?period=All%20Time', { headers })).body.leaders.find((leader) => leader.isYou).points;
    assert.equal(await points(), 120, 'a day with 8 check-ins after the cap date shows 120 points');
    assert.equal((await request('/api/buddy', { headers })).body.buddy.checkIns, 6, 'Habi grows on the same 6');
    // A day before the cap date keeps all 8, so no points already shown are lost.
    for (let index = 0; index < 8; index += 1) await db.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4)', [userId, `h${index}`, '2026-10-25', Date.now()]);
    assert.equal(await points(), 280);
    const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: Array.from({ length: 8 }, (_, index) => ({ ...appState.habits[0], id: `h${index}`, label: `Habit ${index}` })) }) });
    assert.equal(saved.body.state.points, 280, 'the profile shows the same points');
    assert.equal((await request('/api/leaderboard/sync', { method: 'POST', headers, body: JSON.stringify({}) })).body.points, 280);
  });

  await t.test('the account day: a western time zone or a habit\'s own zone cannot reopen a day', async () => {
    const { headers, userId } = await student('Zoe', 'Travel');
    const east = dateIn('Pacific/Kiritimati');
    // Always one or two days before Kiritimati's.
    const west = dateIn('Pacific/Pago_Pago');
    const zone = async () => (await db.query('SELECT time_zone AS "timeZone", day_floor::text AS floor FROM users WHERE id=$1', [userId])).rows[0];
    // The app opens in Kiritimati: the first zone is stored with no floor.
    assert.equal((await request(`/api/daily-claim?date=${east}&timeZone=Pacific/Kiritimati`, { headers })).response.status, 200);
    assert.deepEqual(await zone(), { timeZone: 'Pacific/Kiritimati', floor: null });
    const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: [{ ...appState.habits[0], id: 'trip', label: 'Trip journal' }, { ...appState.habits[0], id: 'forever', label: 'Forever', activeUntil: '2030-01-01' }] }) });
    assert.deepEqual(saved.body.state.habits.map((habit) => habit.activeUntil), [weekEndKey(east), weekEndKey(east)], 'a habit cannot be stamped past its week');
    const first = await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'trip', date: east, completed: true, timeZone: 'Pacific/Kiritimati' }) });
    assert.equal(first.response.status, 200, JSON.stringify(first.body));

    // Switching the phone to Pago Pago cannot reopen a day before Kiritimati's, for check-ins or claims.
    const reopened = await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'trip', date: west, completed: true, timeZone: 'Pacific/Pago_Pago' }) });
    assert.equal(reopened.response.status, 409, JSON.stringify(reopened.body));
    assert.deepEqual([reopened.body.code, reopened.body.today, reopened.body.timeZone], ['DAY_CLOSED', east, 'Pacific/Kiritimati']);
    const claim = await request('/api/daily-claim', { method: 'POST', headers, body: JSON.stringify({ date: west, timeZone: 'Pacific/Pago_Pago' }) });
    assert.deepEqual([claim.response.status, claim.body.code, claim.body.today], [409, 'DAY_CLOSED', east]);
    for (const path of ['/api/daily-claim', '/api/daily-challenges']) {
      const closed = await request(`${path}?date=${west}&timeZone=Pacific/Pago_Pago`, { headers });
      assert.deepEqual([closed.response.status, closed.body.code, closed.body.today, closed.body.timeZone], [409, 'DAY_CLOSED', east, 'Pacific/Kiritimati'], path);
      assert.equal((await request(`${path}?timeZone=Pacific/Pago_Pago`, { headers })).response.status, 400, `${path} without a date`);
    }
    assert.deepEqual(await zone(), { timeZone: 'Pacific/Kiritimati', floor: null }, 'a refused request changes nothing');

    // An offline save whose habits claim another time zone cannot add that zone's day either.
    const latest = (await request('/api/app-state', { headers })).body;
    const forged = latest.state.habits.map((habit) => ({ ...habit, completionTimeZone: 'Pacific/Pago_Pago', completionDates: [...habit.completionDates, west] }));
    const offline = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...latest.state, habits: forged, baseUpdatedAt: latest.updatedAt, baseState: latest.state }) });
    assert.equal(offline.response.status, 200, JSON.stringify(offline.body));
    const days = (await db.query('SELECT habit_id AS "habitId", completed_date::text AS date FROM habit_completions WHERE user_id=$1 ORDER BY habit_id', [userId])).rows;
    assert.deepEqual(days, [{ habitId: 'trip', date: east }], 'offline sync with a forged completionTimeZone cannot add yesterday');
    // A forged last day sent later is cut back to the habit's week too.
    const extended = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...offline.body.state, habits: offline.body.state.habits.map((habit) => ({ ...habit, activeUntil: '2030-01-01' })), baseUpdatedAt: offline.body.updatedAt, baseState: offline.body.state }) });
    assert.deepEqual(extended.body.state.habits.map((habit) => habit.activeUntil), [weekEndKey(east), weekEndKey(east)]);
  });

  await t.test('the leaderboard follows the Manila calendar, with public row ids and no write-only rows', async () => {
    const { headers, userId } = await student('Lea', 'Board');
    process.env.DATABASE_URL ||= urlForSchema(testDatabaseUrl, schema);
    const { getPeriodRange, periodLabel, periodResetsAt } = await import('../lib/http.js');
    const { leaderboardRows } = await import('../routes/gamification.js');
    for (const [habitId, date] of [['sunday', '2026-10-25'], ['monday', '2026-10-26'], ['later', '2026-11-02']]) {
      await db.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4)', [userId, habitId, date, Date.now()]);
    }
    // Monday Oct 26, 02:00 in Manila (Sunday 18:00 UTC): the UTC week still ran from Oct 19.
    const mondayRange = getPeriodRange('This Week', new Date('2026-10-25T18:00:00Z'));
    assert.deepEqual(mondayRange, { start: '2026-10-26', end: '2026-11-01' });
    const pointsIn = async (range) => (await leaderboardRows(db, userId, range)).find((row) => row.id === userId).points;
    assert.equal(await pointsIn(mondayRange), 20, "only Monday counts: Sunday was last week's, and a check-in dated after the range never counts");
    assert.equal(await pointsIn(getPeriodRange('This Week', new Date('2026-10-25T15:59:00Z'))), 20, 'Sunday 23:59 is still the week of Oct 19');
    assert.equal(await pointsIn(null), 60);

    const board = await request('/api/leaderboard?period=This%20Week', { headers });
    assert.equal(board.response.status, 200, JSON.stringify(board.body));
    const week = getPeriodRange('This Week');
    assert.deepEqual(board.body.range, { ...week, timeZone: 'Asia/Manila', resetsAt: periodResetsAt(week) });
    assert.equal(board.body.date, periodLabel(week));
    const all = await request('/api/leaderboard?period=All%20Time', { headers });
    assert.deepEqual([all.body.date, all.body.range], ['Since joining', null]);
    const ids = all.body.leaders.map((leader) => leader.id);
    assert.ok(ids.length >= 2 && ids.every((id) => /^[0-9a-f]{12}$/.test(id)), ids.join(', '));
    assert.equal(new Set(ids).size, ids.length, 'every row has its own id');
    const internal = (await db.query('SELECT id FROM users')).rows.map((row) => row.id);
    assert.ok(internal.every((id) => !JSON.stringify(all.body).includes(id)), 'no internal user ids');
    assert.ok(all.body.leaders.every((leader) => leader.canGift === !leader.isYou && leader.buddy === null), 'treats for classmates; no Buddy Showcase yet');

    // Sync keeps only the student's own row, and writes nothing when it is already current.
    const synced = await request('/api/leaderboard/sync', { method: 'POST', headers, body: JSON.stringify({ avatar: 'L' }) });
    assert.deepEqual([synced.response.status, synced.body.points], [200, 60]);
    const row = async () => (await db.query('SELECT points, avatar, xmin::text AS version FROM leaderboard_users WHERE user_id=$1', [userId])).rows[0];
    const before = await row();
    assert.deepEqual([before.points, before.avatar], [60, 'L']);
    await request('/api/leaderboard/sync', { method: 'POST', headers, body: JSON.stringify({ avatar: 'L' }) });
    assert.equal((await row()).version, before.version, 'nothing changed: no write');
    const counts = (await db.query('SELECT (SELECT COUNT(*) FROM leaderboard_snapshots)::int AS snapshots, (SELECT COUNT(*) FROM leaderboard_daily_points)::int AS daily')).rows[0];
    assert.deepEqual(counts, { snapshots: 0, daily: 0 }, '/sync writes no snapshot or daily-points rows');
  });

  await t.test('the AI Coach is charged once under the lock and gives the tokens back when the AI fails', async () => {
    // A second API with an AI key, whose Groq calls go to a local stub.
    let groqStatus = 200;
    let groqAnswer = 'Do Trip journal at 9 PM tonight, before Sunday.';
    const asked = [];
    const groq = createServer(async (incoming, outgoing) => {
      let body = '';
      for await (const chunk of incoming) body += chunk;
      outgoing.setHeader('Content-Type', 'application/json');
      if (incoming.url.endsWith('/models')) return outgoing.end(JSON.stringify({ object: 'list', data: [{ id: 'llama-3.3-70b-versatile', object: 'model', active: true }] }));
      asked.push(JSON.parse(body));
      // Slow enough for a second question to arrive while the first is answered.
      await new Promise((resolve) => setTimeout(resolve, 300));
      outgoing.statusCode = groqStatus;
      outgoing.end(JSON.stringify(groqStatus === 200 ? { choices: [{ message: { role: 'assistant', content: groqAnswer } }] } : { error: { message: 'The stub refused.' } }));
    });
    const groqPort = port + 4000;
    await new Promise((resolve) => groq.listen(groqPort, '127.0.0.1', resolve));
    const redirect = `globalThis.fetch = ((send) => (url, init) => send(String(url).replace('https://api.groq.com/openai/v1', 'http://127.0.0.1:${groqPort}'), init))(globalThis.fetch);`;
    const aiPort = port + 3000;
    const aiServer = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(redirect)}`, 'server.js'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...serverEnv, PORT: String(aiPort), GROQ_API_KEY: `gsk_${'stub'.repeat(13)}` },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let aiErrors = '';
    aiServer.stderr.on('data', (chunk) => { aiErrors += chunk; });
    const aiExit = new Promise((resolve) => aiServer.once('exit', resolve));
    try {
      const aiBase = `http://127.0.0.1:${aiPort}`;
      await waitUntilUp(aiBase, () => aiErrors);
      const { headers, userId } = await student('Cole', 'Coach');
      await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: [{ ...appState.habits[0], id: 'trip', label: 'Trip journal' }] }) });
      const ask = async (mode = 'coach') => {
        const response = await fetch(`${aiBase}/api/insights/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ question: 'What should I do next?', mode, timeZone: 'UTC' }) });
        return { status: response.status, body: await response.json() };
      };
      const coachRows = async () => (await db.query("SELECT id, amount FROM token_transactions WHERE user_id=$1 AND id LIKE '%:coach:%' ORDER BY created_at, id", [userId])).rows;
      const balance = async () => (await db.query('SELECT COALESCE(SUM(amount),0)::int AS sum FROM token_transactions WHERE user_id=$1', [userId])).rows[0].sum;

      // Two questions at once with tokens for one: one answer and one 402.
      await grant(userId, 10, 'coach-grant-1');
      const both = await Promise.all([ask(), ask()]);
      assert.deepEqual(both.map((answer) => answer.status).sort(), [200, 402], JSON.stringify(both.map((answer) => answer.body)));
      const answered = both.find((answer) => answer.status === 200).body;
      assert.deepEqual([answered.answer, answered.tokens], ['Do Trip journal at 9 PM tonight, before Sunday.', 0]);
      assert.equal(both.find((answer) => answer.status === 402).body.error, 'You need 10 tokens to ask the AI Coach. Complete habits to earn more.');
      assert.equal(asked.length, 1, 'the AI was asked once');
      assert.deepEqual((await coachRows()).map((row) => [row.id.replace(/[0-9a-f-]{36}$/, '<uuid>'), row.amount]), [[`${userId}:token:spend:coach:<uuid>`, -10]]);
      // The coach reads the planner history; its instructions say how to use it.
      const [system, user] = asked[0].messages;
      assert.match(system.content, /plannerHistory/);
      assert.ok(JSON.parse(user.content.split('\n')[1]).plannerHistory.habits.some((habit) => habit.name === 'Trip journal'));

      // The AI fails after the charge: the 10 tokens come back, once.
      await grant(userId, 10, 'coach-grant-2');
      groqStatus = 400;
      const failed = await ask();
      assert.equal(failed.status, 502);
      assert.deepEqual(failed.body, { ok: false, error: 'The AI service is temporarily unavailable.', refunded: true, tokens: 10 });
      assert.equal(await balance(), 10, 'a failing AI call leaves the balance unchanged');
      const rows = await coachRows();
      const spends = rows.filter((row) => row.id.includes(':token:spend:coach:'));
      assert.equal(spends.length, 2);
      assert.deepEqual(rows.filter((row) => row.id.includes(':token:refund:coach:')), [{ id: `${userId}:token:refund:coach:${spends[1].id.split(':').at(-1)}`, amount: 10 }], 'the refund names the charge it gives back');

      // An empty answer is refunded the same way.
      groqStatus = 200;
      groqAnswer = '   ';
      const empty = await ask();
      assert.deepEqual([empty.status, empty.body], [502, { ok: false, error: 'The AI service is temporarily unavailable.', refunded: true, tokens: 10 }]);
      assert.equal((await coachRows()).filter((row) => row.id.includes(':token:refund:coach:')).length, 2);
      assert.equal(await balance(), 10);
      groqAnswer = 'Do Trip journal at 9 PM tonight, before Sunday.';

      // The free assistant costs nothing and gets no planner history.
      groqStatus = 200;
      const free = await ask('assistant');
      assert.equal(free.status, 200, JSON.stringify(free.body));
      assert.equal(JSON.parse(asked.at(-1).messages[1].content.split('\n')[1]).plannerHistory, undefined);
      assert.equal(await balance(), 10);
    } finally {
      aiServer.kill();
      await aiExit;
      await new Promise((resolve) => groq.close(resolve));
    }
  });

  const shiftDay = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const checkInOn = (userId, habitId, date) => db.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4)', [userId, habitId, date, Date.now()]);

  await t.test('a check-in a synced state adds pays its challenge, and a habit past its reminder time takes none', async () => {
    const { headers, userId } = await student('Sync', 'Saved');
    await db.query('UPDATE users SET time_zone=$2 WHERE id=$1', [userId, middayZone]);
    const day = dateIn(middayZone);
    const ledgerIds = async () => (await db.query('SELECT id FROM token_transactions WHERE user_id=$1', [userId])).rows.map((row) => row.id.replace(`${userId}:token:`, ''));
    const save = async (previous, habits) => {
      const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify(previous ? { ...previous.state, habits, baseUpdatedAt: previous.updatedAt, baseState: previous.state } : { ...appState, habits }) });
      assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
      return saved.body;
    };
    const walk = { ...appState.habits[0], id: 'walk', label: 'Walk' };
    // The app could not reach the server when walk was checked in, so its next save carries it.
    const first = await save(null, [walk]);
    const second = await save(first, [{ ...walk, completionDates: [day] }]);
    assert.ok((await ledgerIds()).includes(`check-in:walk:${day}`));
    assert.ok((await ledgerIds()).includes(`challenge:${day}`), `"Finish 1 habit today" is paid as for a direct check-in: ${JSON.stringify(await ledgerIds())}`);

    // Pills passed its reminder time today: a synced state cannot check it in late.
    const pills = { ...appState.habits[0], id: 'pills', label: 'Pills', reminderEnabled: true, reminderTime: '12:00 AM', reminderTimes: ['12:00 AM'], completionDates: [day] };
    await save(second, [...second.state.habits, pills]);
    const done = (await db.query('SELECT habit_id AS "habitId" FROM habit_completions WHERE user_id=$1', [userId])).rows.map((row) => row.habitId);
    assert.deepEqual(done, ['walk']);
    assert.ok(!(await ledgerIds()).includes(`check-in:pills:${day}`));
  });

  await t.test('a streak milestone is not paid again when deleting a habit moves the first day of the run', async () => {
    const { headers, userId } = await student('Run', 'Start');
    await db.query("UPDATE users SET time_zone='UTC' WHERE id=$1", [userId]);
    const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: ['walk', 'extra'].map((id) => ({ ...appState.habits[0], id, label: id })) }) });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    // Extra alone was checked in 7 days ago and walk on each of the 6 days after: the 7-day bonus
    // of that run was paid yesterday.
    await checkInOn(userId, 'extra', shiftDay(today, -7));
    for (let days = 6; days >= 1; days -= 1) await checkInOn(userId, 'walk', shiftDay(today, -days));
    const paidId = `${userId}:token:streak:account:${shiftDay(today, -7)}:7`;
    const yesterdayNoon = Date.parse(`${shiftDay(today, -1)}T12:00:00Z`);
    await db.query("INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,15,'7-day streak',$3,$4)", [paidId, userId, new Date(yesterdayNoon).toISOString(), yesterdayNoon]);

    // Deleting extra makes the same run start 6 days ago, so today's check-in reaches 7 days again.
    const deleted = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...saved.body.state, habits: saved.body.state.habits.filter((entry) => entry.id !== 'extra'), baseUpdatedAt: saved.body.updatedAt, baseState: saved.body.state }) });
    assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body));
    const walked = await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'walk', date: today, completed: true, timeZone: 'UTC' }) });
    assert.equal(walked.response.status, 200, JSON.stringify(walked.body));
    const bonuses = (await db.query("SELECT id FROM token_transactions WHERE user_id=$1 AND id LIKE '%:token:streak:%'", [userId])).rows.map((row) => row.id);
    assert.deepEqual(bonuses, [paidId], 'the 7-day bonus is not paid a second time');
  });

  await t.test('the weekly bonus is worked out on the server, paid once, and deleting a missed habit cannot raise it', async () => {
    const { headers, userId } = await student('Wes', 'Bonus');
    // The account day is in UTC, so it is the test's today.
    await db.query("UPDATE users SET time_zone='UTC' WHERE id=$1", [userId]);
    const lastMonday = shiftDay(weekStartOf(today), -7);
    const lastWeek = Array.from({ length: 7 }, (_, index) => shiftDay(lastMonday, index));
    const habit = (id) => ({ ...appState.habits[0], id, label: id, startDate: lastMonday, activeUntil: lastWeek[6] });
    const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: ['walk', 'read', 'gym'].map(habit) }) });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    // Walk and read every day of last week, the gym never: 14 of 21 (66%).
    for (const date of lastWeek) for (const habitId of ['walk', 'read']) await checkInOn(userId, habitId, date);

    const day = `date=${today}&timeZone=UTC`;
    assert.equal((await request('/api/weekly-bonus', { headers })).response.status, 400);
    const closed = await request(`/api/weekly-bonus?date=${lastMonday}&timeZone=UTC`, { headers });
    assert.deepEqual([closed.response.status, closed.body.code, closed.body.today, closed.body.timeZone], [409, 'DAY_CLOSED', today, 'UTC']);
    const steady = { percent: 60, amount: 10, label: 'Steady week' };
    const bonus = await request(`/api/weekly-bonus?${day}`, { headers });
    assert.equal(bonus.response.status, 200, JSON.stringify(bonus.body));
    const { weekStart, scheduled, done, percent, activeDays, eligible, tier, claimed, claimable } = bonus.body.lastWeek;
    assert.deepEqual({ weekStart, scheduled, done, percent, activeDays, eligible, tier, claimed, claimable }, { weekStart: lastMonday, scheduled: 21, done: 14, percent: 66, activeDays: 7, eligible: true, tier: steady, claimed: false, claimable: true });
    assert.equal(bonus.body.thisWeek.weekStart, weekStartOf(today));
    assert.equal(bonus.body.tiers.length, 3);

    // The gym habit is deleted after its days passed: the 7 check-ins it missed still count.
    const deleted = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...saved.body.state, habits: saved.body.state.habits.filter((entry) => entry.id !== 'gym'), baseUpdatedAt: saved.body.updatedAt, baseState: saved.body.state }) });
    assert.deepEqual([deleted.response.status, deleted.body.state.habits.length], [200, 2], JSON.stringify(deleted.body));
    assert.deepEqual((await db.query('SELECT due FROM weekly_due_marks WHERE user_id=$1 AND week_start=$2', [userId, lastMonday])).rows, [{ due: 21 }]);
    const after = (await request(`/api/weekly-bonus?${day}`, { headers })).body.lastWeek;
    assert.deepEqual([after.scheduled, after.done, after.percent, after.tier], [21, 14, 66, steady], 'not 100% (+30)');

    // Two devices claim at once: paid once, and both get the same amount.
    const claim = () => request('/api/weekly-bonus/claim', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    const claims = await Promise.all([claim(), claim()]);
    assert.ok(claims.every((answer) => answer.response.status === 200), JSON.stringify(claims.map((answer) => answer.body)));
    assert.deepEqual(claims.map((answer) => answer.body.alreadyClaimed).sort(), [false, true]);
    for (const answer of claims) assert.deepEqual([answer.body.amount, answer.body.percent, answer.body.tier, answer.body.tokens], [10, 66, steady, 10]);
    const first = claims.find((answer) => !answer.body.alreadyClaimed).body;
    assert.ok(first.updatedAt > saved.body.updatedAt && first.points === 280, JSON.stringify(first));
    const row = first.tokenHistory.find((item) => item.id === `week:${lastMonday}`);
    assert.deepEqual([row?.amount, row?.label], [10, 'Weekly bonus: 66% (Steady week)']);
    const again = await claim();
    assert.deepEqual([again.response.status, again.body.amount, again.body.alreadyClaimed, again.body.tokens], [200, 10, true, 10], 'a second claim returns the same amount');
    assert.deepEqual((await db.query("SELECT amount FROM token_transactions WHERE user_id=$1 AND id LIKE '%:token:week:%'", [userId])).rows, [{ amount: 10 }]);
    const paid = (await request(`/api/weekly-bonus?${day}`, { headers })).body.lastWeek;
    assert.deepEqual([paid.claimed, paid.claimedAmount, paid.claimable], [true, 10, false]);
  });

  await t.test('a missed habit deleted mid-week still counts the days it missed', async () => {
    const { headers, userId } = await student('Mid', 'Week');
    await db.query("UPDATE users SET time_zone='UTC' WHERE id=$1", [userId]);
    const lastMonday = shiftDay(weekStartOf(today), -7);
    const lastWeek = Array.from({ length: 7 }, (_, index) => shiftDay(lastMonday, index));
    const habit = (id) => ({ ...appState.habits[0], id, label: id, startDate: lastMonday, activeUntil: lastWeek[6] });
    // Walk and read every day of last week. A gym habit missed Monday and Tuesday was deleted on
    // Wednesday: that save recorded its 6 due check-ins of Monday and Tuesday before deleting it.
    const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: ['walk', 'read'].map(habit) }) });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    for (const date of lastWeek) for (const habitId of ['walk', 'read']) await checkInOn(userId, habitId, date);
    await db.query('INSERT INTO weekly_due_marks(user_id, week_start, due, last_day, updated_at) VALUES($1,$2,6,$3,$4)', [userId, lastMonday, lastWeek[1], Date.now()]);
    const marked = (await request(`/api/weekly-bonus?date=${today}&timeZone=UTC`, { headers })).body.lastWeek;
    assert.deepEqual([marked.scheduled, marked.done, marked.percent, marked.tier?.amount], [16, 14, 87, 20], 'Monday and Tuesday of the gym, then walk and read: not 14/14 (+30)');

    // The next save joins the stored mark with the days after it, and keeps it.
    const renamed = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...saved.body.state, habits: saved.body.state.habits.map((entry) => ({ ...entry, label: `${entry.label}!` })), baseUpdatedAt: saved.body.updatedAt, baseState: saved.body.state }) });
    assert.equal(renamed.response.status, 200, JSON.stringify(renamed.body));
    const rows = await db.query('SELECT due, last_day::text AS "lastDay" FROM weekly_due_marks WHERE user_id=$1 AND week_start=$2', [userId, lastMonday]);
    assert.deepEqual(rows.rows, [{ due: 16, lastDay: lastWeek[6] }]);
    const claim = await request('/api/weekly-bonus/claim', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.deepEqual([claim.response.status, claim.body.amount, claim.body.percent, claim.body.tier?.label], [200, 20, 87, 'Strong week'], JSON.stringify(claim.body));
  });

  await t.test('the weekly bonus: only last week can be claimed, and only from 60%', async () => {
    const { headers, userId } = await student('Nia', 'Lowe');
    await db.query("UPDATE users SET time_zone='UTC' WHERE id=$1", [userId]);
    const claim = (date = today) => request('/api/weekly-bonus/claim', { method: 'POST', headers, body: JSON.stringify({ date, timeZone: 'UTC' }) });
    const empty = await claim();
    assert.deepEqual([empty.response.status, empty.body], [409, { ok: false, code: 'BONUS_NOT_EARNED', message: 'Last week had fewer than 7 scheduled check-ins.' }]);

    // The week before last was perfect; last week reached 10 of 21 (47%).
    const lastMonday = shiftDay(weekStartOf(today), -7);
    const mondayBefore = shiftDay(lastMonday, -7);
    const habit = (id, monday) => ({ ...appState.habits[0], id, label: id, startDate: monday, activeUntil: shiftDay(monday, 6) });
    const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: [...['a', 'b', 'c'].map((id) => habit(id, mondayBefore)), ...['x', 'y', 'z'].map((id) => habit(id, lastMonday))] }) });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    for (let index = 0; index < 7; index += 1) {
      for (const habitId of ['a', 'b', 'c']) await checkInOn(userId, habitId, shiftDay(mondayBefore, index));
      await checkInOn(userId, 'x', shiftDay(lastMonday, index));
      if (index < 3) await checkInOn(userId, 'y', shiftDay(lastMonday, index));
    }
    const low = await claim();
    assert.deepEqual([low.response.status, low.body], [409, { ok: false, code: 'BONUS_NOT_EARNED', message: 'Last week reached 47%. Reach 60% this week for +10 tokens.' }]);
    const status = (await request(`/api/weekly-bonus?date=${today}&timeZone=UTC`, { headers })).body.lastWeek;
    assert.deepEqual([status.weekStart, status.percent, status.eligible, status.reason, status.tier, status.claimable], [lastMonday, 47, false, 'low-rate', null, false]);
    // The week before last cannot be claimed: not from today, and not with one of its own days.
    const old = await claim(shiftDay(mondayBefore, 6));
    assert.deepEqual([old.response.status, old.body.code, old.body.today], [409, 'DAY_CLOSED', today]);
    assert.equal((await db.query("SELECT 1 FROM token_transactions WHERE user_id=$1 AND id LIKE '%:token:week:%'", [userId])).rowCount, 0, 'no bonus was paid');
  });

  await t.test('the weekly drop is sold in its week, after 2 of 3 quests, from the Kid stage, once', async () => {
    // A time zone where today is not a Monday, so yesterday is in the same week.
    const zone = ['Etc/GMT+12', 'Etc/GMT-14'].find((candidate) => new Date(`${dateIn(candidate)}T00:00:00Z`).getUTCDay() !== 1);
    const day = dateIn(zone);
    const yesterday = shiftDay(day, -1);
    const drop = dropForWeek(weekStartOf(day));
    const other = BUDDY_DROPS.find((entry) => entry.id !== drop.id);
    const buy = (headers, itemId, dayInput = { date: day, timeZone: zone }) => request('/api/buddy/items', { method: 'POST', headers, body: JSON.stringify({ itemId, ...dayInput }) });
    const { headers, userId } = await student('Dina', 'Drop');
    await db.query('UPDATE users SET time_zone=$2 WHERE id=$1', [userId, zone]);
    await grant(userId, 400, 'drop-grant');

    // A drop needs the account's today, and only this week's is on sale.
    assert.deepEqual([(await buy(headers, drop.id, {})).response.status, (await buy(headers, drop.id, {})).body.message], [400, 'Send your today and time zone.']);
    const closed = await buy(headers, drop.id, { date: yesterday, timeZone: zone });
    assert.deepEqual([closed.response.status, closed.body.code, closed.body.today], [409, 'DAY_CLOSED', day]);
    const gone = await buy(headers, other.id);
    const weeks = weeksUntilDrop(other, weekStartOf(day));
    assert.deepEqual([gone.response.status, gone.body], [410, { ok: false, code: 'DROP_GONE', message: `This drop is gone for now. It comes back in ${weeks} week${weeks === 1 ? '' : 's'}.` }]);
    const baby = await buy(headers, drop.id);
    assert.deepEqual([baby.response.status, baby.body.code, baby.body.message], [403, undefined, 'Habi needs to reach the Kid stage (10 check-ins) first.']);

    // Seven habits, six of them checked in yesterday and today: 12 check-ins (one quest), no perfect day.
    const ids = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'];
    const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: ids.map((id) => ({ ...appState.habits[0], id, label: id })) }) });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    for (const date of [yesterday, day]) for (const habitId of ids.slice(0, 6)) await checkInOn(userId, habitId, date);
    const questHabits = ids.map((id) => ({ id, frequency: 'Daily', startDate: '2026-01-01', reminderDays: [], meta: '' }));
    const doneBy = (habitIds) => new Map([[yesterday, new Set(habitIds)], [day, new Set(habitIds)]]);
    assert.equal(weeklyQuests(questHabits, doneBy(ids.slice(0, 6)), day).filter((quest) => quest.complete).length, 1);
    const locked = await buy(headers, drop.id);
    assert.deepEqual([locked.response.status, locked.body], [403, { ok: false, code: 'DROP_LOCKED', message: `Finish 2 of this week's 3 quests to unlock the ${drop.name}.` }]);
    const lockedCard = (await request(`/api/buddy?date=${day}&timeZone=${encodeURIComponent(zone)}`, { headers })).body.buddy;
    assert.deepEqual(lockedCard.drop, { item: drop, weekStart: weekStartOf(day), weekEnd: shiftDay(weekStartOf(day), 6), questsDone: 1, questsNeeded: 2, unlocked: false, owned: false });
    assert.deepEqual([lockedCard.drops.length, lockedCard.dropsOwned, lockedCard.items.some((item) => item.id === 'aurora')], [12, 0, true]);

    // The seventh habit too: two perfect days complete a second quest.
    for (const date of [yesterday, day]) await checkInOn(userId, 'h7', date);
    assert.ok(weeklyQuests(questHabits, doneBy(ids), day).filter((quest) => quest.complete).length >= 2);
    const bought = await buy(headers, drop.id);
    assert.equal(bought.response.status, 200, JSON.stringify(bought.body));
    assert.deepEqual([bought.body.buddy[drop.slot], bought.body.buddy.owned, bought.body.tokens], [drop.id, [drop.id], 250], 'worn right away, for 150 tokens');
    assert.deepEqual([bought.body.buddy.drop.owned, bought.body.buddy.drop.unlocked, bought.body.buddy.dropsOwned], [true, true, 1]);
    assert.deepEqual(bought.body.tokenHistory.find((item) => item.amount === -150).label, `Buddy: ${drop.name} (weekly drop)`);
    const twice = await buy(headers, drop.id);
    assert.deepEqual([twice.response.status, twice.body.message], [409, 'You already have this item.']);

    // Worn like any item, in its own slot only; another drop must be bought first.
    assert.equal((await request('/api/buddy', { method: 'PUT', headers, body: JSON.stringify({ [drop.slot]: '' }) })).body.buddy[drop.slot], '');
    const worn = await request('/api/buddy', { method: 'PUT', headers, body: JSON.stringify({ [drop.slot]: drop.id }) });
    assert.deepEqual([worn.response.status, worn.body.buddy[drop.slot], worn.body.buddy.drop.item.id], [200, drop.id, drop.id]);
    const wrongSlot = ['head', 'hand', 'accessory'].find((slot) => slot !== drop.slot);
    assert.equal((await request('/api/buddy', { method: 'PUT', headers, body: JSON.stringify({ [wrongSlot]: drop.id }) })).response.status, 400);
    assert.equal((await request('/api/buddy', { method: 'PUT', headers, body: JSON.stringify({ [other.slot]: other.id }) })).response.status, 400);
    const listed = (await request('/api/buddy', { headers })).body.buddy;
    assert.deepEqual([listed.drop, listed.dropsOwned, listed.owned], [null, 1, [drop.id]], 'without a date there is no drop card, but the collection counts');
  });

  await t.test('buying a shop item with a date never stores a new time zone', async () => {
    const { headers, userId } = await student('Shop', 'Zone');
    await db.query("UPDATE users SET time_zone='Asia/Manila' WHERE id=$1", [userId]);
    await grant(userId, 100, 'shop-grant');
    const east = 'Pacific/Kiritimati';
    const bought = await request('/api/buddy/items', { method: 'POST', headers, body: JSON.stringify({ itemId: 'cap', date: dateIn(east), timeZone: east }) });
    assert.deepEqual([bought.response.status, bought.body.buddy?.head, bought.body.tokens], [200, 'cap', 60], JSON.stringify(bought.body));
    assert.equal((await db.query('SELECT time_zone FROM users WHERE id=$1', [userId])).rows[0].time_zone, 'Asia/Manila', 'only a drop is sold by the day');
  });

  const publicIdOf = async (userId) => (await db.query('SELECT public_id AS "publicId" FROM users WHERE id=$1', [userId])).rows[0].publicId;
  const leadersFor = async (headers) => (await request('/api/leaderboard?period=All%20Time', { headers })).body.leaders;
  /** Saves the preferences as the app does, on top of the latest state (a save without a base keeps changed keys). */
  const savePreferences = async (headers, preferences) => {
    const latest = (await request('/api/app-state', { headers })).body;
    const state = latest.updatedAt ? { ...latest.state, baseUpdatedAt: latest.updatedAt, baseState: latest.state } : appState;
    return request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...state, preferences }) });
  };

  await t.test('the Buddy Showcase shows Habi, as it is dressed, next to the name on the leaderboard', async () => {
    const owner = await student('Sho', 'Case');
    const classmate = await student('Nora', 'Plain');
    const ownerId = await publicIdOf(owner.userId);
    const classmateId = await publicIdOf(classmate.userId);
    await grant(owner.userId, 700, 'showcase-grant');

    // On sale for 300, bought once and kept.
    const catalog = await request('/api/rewards', { headers: owner.headers });
    assert.deepEqual(catalog.body.rewards.find((reward) => reward.id === 'buddy-showcase'), { id: 'buddy-showcase', name: 'Buddy Showcase', cost: 300, description: 'Show your Habi, with what it wears, next to your name on the leaderboard', permanent: true });
    const redeem = () => request('/api/rewards/redeem', { method: 'POST', headers: owner.headers, body: JSON.stringify({ rewardId: 'buddy-showcase', rewardName: 'Buddy Showcase', tokenCost: 300 }) });
    const bought = await redeem();
    assert.deepEqual([bought.response.status, bought.body.tokens], [200, 400], JSON.stringify(bought.body));
    assert.deepEqual([(await redeem()).response.status, (await request('/api/rewards', { headers: owner.headers })).body.owned], [409, ['buddy-showcase']], 'bought once');

    // 12 check-ins (the Kid stage), a cap and a cookie; a forged row wears the cookie as a room, glasses
    // never bought and an item that is not in the shop.
    assert.equal((await savePreferences(owner.headers, {})).response.status, 200);
    for (let day = 1; day <= 12; day += 1) await checkInOn(owner.userId, 'habit-1', `2026-01-${String(day).padStart(2, '0')}`);
    for (const itemId of ['cap', 'cookie']) assert.equal((await request('/api/buddy/items', { method: 'POST', headers: owner.headers, body: JSON.stringify({ itemId }) })).response.status, 200, itemId);
    await db.query("UPDATE user_buddy SET hand_item='laser-sword', room_item='cookie', accessory_item='glasses' WHERE user_id=$1", [owner.userId]);
    const look = { stage: 'kid', checkIns: 10, head: 'cap', hand: '', accessory: '', room: '' };
    const seen = await leadersFor(classmate.headers);
    assert.deepEqual(seen.find((leader) => leader.id === ownerId).buddy, look, "the stage's least check-ins and only what was bought, in its slot");
    assert.equal(seen.find((leader) => leader.id === classmateId).buddy, null, 'no showcase without the reward');
    assert.deepEqual(Object.keys(look).sort(), Object.keys(seen.find((leader) => leader.id === ownerId).buddy).sort(), 'nothing about habits, times or streaks');
    const own = (await leadersFor(owner.headers)).find((leader) => leader.isYou);
    assert.deepEqual([own.id, own.buddy], [ownerId, look], 'shown on the own row too');

    // "Show my Habi" off: no buddy. Hidden from the leaderboard: still hidden, Habi or not.
    await savePreferences(owner.headers, { showBuddy: false });
    assert.equal((await leadersFor(classmate.headers)).find((leader) => leader.id === ownerId).buddy, null);
    await savePreferences(owner.headers, { showOnLeaderboard: false });
    assert.ok(!(await leadersFor(classmate.headers)).some((leader) => leader.id === ownerId), 'a hidden student stays hidden');
    assert.deepEqual((await leadersFor(owner.headers)).find((leader) => leader.isYou).buddy, look, 'but sees their own Habi');
  });

  await t.test('treats go to a classmate: only the sender pays, with the limits, a notification and a live update', async () => {
    const zone = 'Asia/Manila';
    const sender = await student('Gia', 'Giver');
    const recipient = await student('Rio', 'Receiver');
    const [third, fourth, fifth] = [await student('Tess', 'Third'), await student('Fern', 'Fourth'), await student('Fil', 'Fifth')];
    const hidden = await student('Hal', 'Hidden');
    const closed = await student('Olive', 'Off');
    const faculty = await student('Prof', 'Gifts');
    await db.query("UPDATE users SET role='faculty' WHERE id=$1", [faculty.userId]);
    await savePreferences(hidden.headers, { showOnLeaderboard: false });
    await savePreferences(closed.headers, { allowGifts: false });
    await request('/api/buddy', { method: 'PUT', headers: recipient.headers, body: JSON.stringify({ name: 'Mochi' }) });
    const ids = Object.fromEntries(await Promise.all(Object.entries({ sender, recipient, third, fourth, fifth, hidden, closed, faculty }).map(async ([key, account]) => [key, await publicIdOf(account.userId)])));
    const send = (headers, to, treatId = 'apple', messageId = 0, dayInput = { date: dateIn(zone), timeZone: zone }) => request('/api/buddy/gifts', { method: 'POST', headers, body: JSON.stringify({ to, treatId, messageId, ...dayInput }) });
    const refusal = (answer) => [answer.response.status, answer.body.code, answer.body.message];
    const ledger = async (userId) => (await db.query('SELECT id, amount FROM token_transactions WHERE user_id=$1 ORDER BY created_at', [userId])).rows;
    const live = async (headers) => (await request('/api/live', { headers })).body.versions;
    const changed = (before, after) => Object.keys(after).filter((key) => after[key] !== before[key]).sort();

    // canGift on the board: classmates who accept treats, not yourself, and never for faculty.
    const board = await leadersFor(sender.headers);
    const canGift = (id) => board.find((leader) => leader.id === id)?.canGift;
    assert.deepEqual([canGift(ids.recipient), canGift(ids.closed), canGift(ids.sender), canGift(ids.hidden)], [true, false, false, undefined]);
    assert.ok((await leadersFor(faculty.headers)).every((leader) => !leader.canGift));

    assert.deepEqual(refusal(await send(sender.headers, ids.recipient)), [402, undefined, 'You need 15 more tokens for the Apple.'], 'not enough tokens');
    await grant(sender.userId, 200, 'gift-grant');
    assert.deepEqual(refusal(await send(sender.headers, ids.sender)), [400, 'SELF_GIFT', 'You cannot send a treat to yourself.']);
    for (const to of [ids.hidden, ids.faculty, 'ffffffffffff']) assert.deepEqual(refusal(await send(sender.headers, to)), [404, 'RECIPIENT_NOT_FOUND', 'That classmate is not on the leaderboard.'], to);
    assert.deepEqual(refusal(await send(sender.headers, ids.closed)), [403, 'GIFTS_OFF', 'This classmate is not accepting treats.']);
    assert.deepEqual(refusal(await send(faculty.headers, ids.recipient)), [403, undefined, 'Only students can send treats to classmates.']);
    assert.equal((await send(sender.headers, ids.recipient, 'apple', 0, { date: shiftDay(dateIn(zone), -1), timeZone: zone })).body.code, 'DAY_CLOSED');
    assert.equal((await send(sender.headers, ids.recipient, 'apple', 5)).response.status, 400, 'one of the 5 cheers');
    assert.equal((await send(sender.headers, ids.recipient, 'pizza')).response.status, 404, 'a treat from the shop');

    // A cupcake for Rio's Habi: the sender pays 25, Rio pays and gets nothing, and is told.
    const [senderLive, recipientLive] = [await live(sender.headers), await live(recipient.headers)];
    const recipientLedger = await ledger(recipient.userId);
    const cupcake = await send(sender.headers, ids.recipient, 'cupcake', 3);
    assert.equal(cupcake.response.status, 200, JSON.stringify(cupcake.body));
    assert.deepEqual({ ...cupcake.body.gift, id: typeof cupcake.body.gift.id }, { id: 'string', treatId: 'cupcake', to: ids.recipient, message: "Kaya mo 'yan!" });
    assert.deepEqual([cupcake.body.sentToday, cupcake.body.leftToday, cupcake.body.tokens], [1, 2, 175]);
    assert.deepEqual([cupcake.body.tokenHistory[0].label, cupcake.body.tokenHistory[0].amount], ['Gift: Cupcake to Rio R.', -25]);
    assert.match((await ledger(sender.userId)).at(-1).id, new RegExp(`^${sender.userId}:token:spend:gift:[0-9a-f-]{36}$`));
    assert.deepEqual(await ledger(recipient.userId), recipientLedger, 'tokens never move between accounts');
    const notes = (await request('/api/notifications', { headers: recipient.headers })).body.notifications.filter((note) => note.type === 'gift');
    assert.deepEqual(notes.map(({ id, title, message }) => ({ id, title, message })), [{ id: `${recipient.userId}:notification:gift:${cupcake.body.gift.id}`, title: '🧁 A treat for Mochi', message: "Gia G. sent Mochi a Cupcake: Kaya mo 'yan!" }], 'First L. and the fixed cheer, never the full name');
    assert.deepEqual(changed(recipientLive, await live(recipient.headers)), ['buddy', 'notifications'], "the classmate's Habi updates live");
    assert.deepEqual(changed(senderLive, await live(sender.headers)), ['buddy', 'wallet']);
    const gifted = (await request(`/api/buddy?date=${dateIn(zone)}&timeZone=${encodeURIComponent(zone)}`, { headers: recipient.headers })).body.buddy;
    assert.deepEqual([gifted.giftsToday, gifted.giftsReceived, gifted.giftsSent, gifted.giftMessages.length], [[{ treatId: 'cupcake', emoji: '🧁', from: 'Gia G.', message: "Kaya mo 'yan!" }], 1, 0, 5]);
    assert.deepEqual((await request('/api/buddy', { headers: recipient.headers })).body.buddy.giftsToday.length, 1, 'also without a date, on the stored day');
    assert.deepEqual([(await request('/api/buddy', { headers: sender.headers })).body.buddy.giftsSent, gifted.treatsFed], [1, 0], 'feeding your own Habi is separate');
    // Both students' data exports list the treat, naming the classmate only as First L.
    const exportedGifts = async (who) => {
      const { sent, received } = (await request('/api/auth/export', { headers: who.headers })).body.treatGifts;
      return { sent: sent.map(({ at, ...gift }) => gift), received: received.map(({ at, ...gift }) => gift) };
    };
    assert.deepEqual(await exportedGifts(sender), { sent: [{ to: 'Rio R.', treat: 'cupcake', message: "Kaya mo 'yan!" }], received: [] });
    assert.deepEqual(await exportedGifts(recipient), { sent: [], received: [{ from: 'Gia G.', treat: 'cupcake', message: "Kaya mo 'yan!" }] });

    // One treat per classmate a week, three a day, ten received in 24 hours.
    assert.equal((await leadersFor(sender.headers)).find((leader) => leader.id === ids.recipient)?.canGift, false, 'no Send a treat for a classmate treated this week');
    assert.deepEqual(refusal(await send(sender.headers, ids.recipient)), [429, 'GIFT_PAIR_LIMIT', 'You already sent Rio R. a treat in the last 7 days.']);
    assert.deepEqual([(await send(sender.headers, ids.third)).body.leftToday, (await send(sender.headers, ids.fourth)).body.leftToday], [1, 0]);
    assert.deepEqual(refusal(await send(sender.headers, ids.fifth)), [429, 'GIFT_DAILY_LIMIT', 'You can send 3 treats a day. Try again tomorrow.']);
    assert.equal((await ledger(sender.userId)).reduce((sum, row) => sum + row.amount, 0), 145, 'refusals cost nothing');
    for (let index = 0; index < 10; index += 1) {
      await db.query("INSERT INTO buddy_gifts(id,sender_id,recipient_id,treat_id,message_id,local_date,created_at) VALUES($1,$2,$3,'apple',0,$4,$5)", [crypto.randomUUID(), recipient.userId, fifth.userId, dateIn(zone), Date.now() - 60_000]);
    }
    assert.deepEqual(refusal(await send(third.headers, ids.fifth)), [429, 'RECIPIENT_FULL', 'Fil F. has received lots of treats today. Try again tomorrow.']);
  });

  await t.test('treat gifts hold under requests at the same moment: the limits, two-way gifts and a classmate who just opted out', async () => {
    const zone = 'Asia/Manila';
    const send = (from, to, timeZone = zone) => request('/api/buddy/gifts', { method: 'POST', headers: from.headers, body: JSON.stringify({ to, treatId: 'apple', messageId: 1, date: dateIn(timeZone), timeZone }) });
    const refusal = (answer) => [answer.response.status, answer.body.code, answer.body.message];
    const statuses = (answers) => answers.map((answer) => answer.response.status).sort();
    const balance = async (userId) => (await db.query('SELECT COALESCE(SUM(amount), 0)::int AS sum FROM token_transactions WHERE user_id=$1', [userId])).rows[0].sum;
    const funded = async (firstName, lastName) => {
      const account = await student(firstName, lastName);
      await grant(account.userId, 200, 'race-grant');
      return { ...account, publicId: await publicIdOf(account.userId) };
    };

    // Five at once from one student: three go through, the other two are over the day's limit and cost nothing.
    const racer = await funded('Rae', 'Racer');
    const targets = await Promise.all(['One', 'Two', 'Three', 'Four', 'Five'].map((lastName) => funded('Kai', lastName)));
    const burst = await Promise.all(targets.map((target) => send(racer, target.publicId)));
    assert.deepEqual(statuses(burst), [200, 200, 200, 429, 429], JSON.stringify(burst.map((answer) => answer.body)));
    assert.ok(burst.filter((answer) => answer.response.status === 429).every((answer) => answer.body.code === 'GIFT_DAILY_LIMIT'));
    assert.equal(await balance(racer.userId), 200 - 3 * 15, 'only three are paid');
    // A new time zone does not start a new day of treats: one on the same date keeps the count, and
    // one still on yesterday (UTC-12, unless it is past 20:00 in Manila) is a closed day.
    const sixth = await funded('Kai', 'Six');
    assert.equal((await send(racer, sixth.publicId, 'Asia/Singapore')).body.code, 'GIFT_DAILY_LIMIT');
    const west = 'Etc/GMT+12';
    assert.equal((await send(racer, sixth.publicId, west)).body.code, dateIn(west) < dateIn(zone) ? 'DAY_CLOSED' : 'GIFT_DAILY_LIMIT');

    // Two classmates sending each other a treat at the same moment both get through, with no deadlock.
    const [ana, ben] = [await funded('Ana', 'Mutual'), await funded('Ben', 'Mutual')];
    const mutual = await Promise.all([send(ana, ben.publicId), send(ben, ana.publicId)]);
    assert.deepEqual(statuses(mutual), [200, 200], JSON.stringify(mutual.map((answer) => answer.body)));
    // A treat from 30 hours ago was before today in every time zone: counted, but not on today's floor.
    await db.query("INSERT INTO buddy_gifts(id,sender_id,recipient_id,treat_id,message_id,local_date,created_at) VALUES($1,$2,$3,'cake',4,$4,$5)", [crypto.randomUUID(), racer.userId, ana.userId, shiftDay(dateIn(zone), -1), Date.now() - 30 * 60 * 60 * 1000]);
    const anaBuddy = (await request('/api/buddy', { headers: ana.headers })).body.buddy;
    assert.deepEqual([anaBuddy.giftsToday, anaBuddy.giftsReceived, anaBuddy.giftsSent], [[{ treatId: 'apple', emoji: '🍎', from: 'Ben M.', message: 'Proud of you!' }], 2, 1]);

    // Eleven classmates at once to one student: ten land, the eleventh finds them full.
    const popular = await funded('Pia', 'Popular');
    const fans = await Promise.all(Array.from({ length: 11 }, (_, index) => funded('Fan', `Number${index}`)));
    const rush = await Promise.all(fans.map((fan) => send(fan, popular.publicId)));
    assert.deepEqual(statuses(rush), [...Array(10).fill(200), 429], JSON.stringify(rush.map((answer) => answer.body)));
    assert.equal(rush.find((answer) => answer.response.status === 429).body.code, 'RECIPIENT_FULL');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM buddy_gifts WHERE recipient_id=$1', [popular.userId])).rows[0].count, 10);

    // A deactivated classmate gets nothing.
    const gone = await funded('Dee', 'Gone');
    await db.query("UPDATE users SET status='deactivated' WHERE id=$1", [gone.userId]);
    assert.deepEqual(refusal(await send(racer, gone.publicId)).slice(0, 2), [404, 'RECIPIENT_NOT_FOUND']);

    // A classmate turns treats off (an app-state save holds their account) while a gift waits for
    // it: the gift reads the setting that was saved, not the one from before it waited.
    const giver = await funded('Gus', 'Waiting');
    const shy = await funded('Ola', 'Optout');
    assert.equal((await savePreferences(shy.headers, {})).response.status, 200);
    const holder = await db.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [shy.userId]);
      await holder.query(`UPDATE user_preferences SET preferences_json = preferences_json || '{"allowGifts": false}'::jsonb WHERE user_id=$1`, [shy.userId]);
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = send(giver, shy.publicId);
      const deadline = Date.now() + 10_000;
      while (!(await db.query('SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))', [holderPid])).rowCount) {
        assert.ok(Date.now() < deadline, 'the gift waits for the classmate\'s account');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await holder.query('COMMIT');
      assert.deepEqual(refusal(await pending), [403, 'GIFTS_OFF', 'This classmate is not accepting treats.']);
    } catch (error) {
      await holder.query('ROLLBACK');
      throw error;
    } finally {
      holder.release();
    }
    assert.equal(await balance(giver.userId), 200, 'the refused gift cost nothing');
  });

  const ledgerOf = async (userId) => (await db.query('SELECT id, amount FROM token_transactions WHERE user_id=$1', [userId])).rows.map((row) => ({ id: row.id, amount: Number(row.amount) }));
  const sumOf = (rows) => rows.reduce((sum, row) => sum + row.amount, 0);

  await t.test('the Tokens screen is for students, on their today, from the ledger, and it never writes', async () => {
    const { headers, userId } = await student('Tia', 'Tokens');
    await db.query("UPDATE users SET time_zone='UTC' WHERE id=$1", [userId]);
    const summaryFor = (query, asHeaders = headers) => request(`/api/wallet/summary?${query}`, { headers: asHeaders });
    const day = `date=${today}&timeZone=UTC`;

    // Faculty have no Tokens screen (system admins cannot use the app at all).
    const faculty = await student('Fay', 'Culty');
    await db.query("UPDATE users SET role='faculty' WHERE id=$1", [faculty.userId]);
    for (const answer of [await summaryFor(day, faculty.headers), await request('/api/wallet/history', { headers: faculty.headers })]) {
      assert.deepEqual([answer.response.status, answer.body], [403, { ok: false, message: 'Tokens are for students.' }]);
    }
    assert.equal((await request(`/api/wallet/summary?${day}`)).response.status, 401);
    for (const query of ['', 'timeZone=UTC', `date=${today}&timeZone=Not%2FA_Zone`, `date=${today}&date=${today}&timeZone=UTC`]) {
      const refused = await summaryFor(query);
      assert.deepEqual([refused.response.status, refused.body.message], [400, 'Send your today and time zone.'], query);
    }
    const closed = await summaryFor(`date=${shiftDay(today, -1)}&timeZone=UTC`);
    assert.deepEqual([closed.response.status, closed.body.ok, closed.body.code, closed.body.today, closed.body.timeZone], [409, false, 'DAY_CLOSED', today, 'UTC']);

    // Two habits, one checked in; 100 granted tokens; a Streak Freeze bought.
    const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: ['h1', 'h2'].map((id) => ({ ...appState.habits[0], id, label: id })) }) });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    const done = await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'h1', date: today, completed: true, timeZone: 'UTC' }) });
    assert.equal(done.response.status, 200, JSON.stringify(done.body));
    await grant(userId, 100, 'wallet-grant');
    const freeze = await request('/api/streak-freezes/buy', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.equal(freeze.response.status, 200, JSON.stringify(freeze.body));

    const before = await ledgerOf(userId);
    const answer = await summaryFor(day);
    assert.equal(answer.response.status, 200, JSON.stringify(answer.body));
    const summary = answer.body;
    const balance = sumOf(before);
    const challengeTokens = sumOf(before.filter((row) => /:token:(challenge|daily):/.test(row.id)));
    const earned = sumOf(before.filter((row) => row.amount > 0));
    assert.deepEqual([summary.ok, summary.balance, summary.tokens], [true, balance, balance]);
    assert.deepEqual(summary.today.checkIns, { paid: 1, limit: 6, perCheckIn: 5, earned: 5 });
    assert.deepEqual(summary.today.dailyClaim, { claimed: false, day: 1, amount: 2, tomorrowAmount: 3 });
    assert.deepEqual(summary.today.mysteryBox, { status: 'ready', amount: null, min: 3, max: 20 });
    assert.equal(summary.today.challenges.earned, challengeTokens, 'the challenges paid so far');
    // 2 (the daily reward) + 5 (h2, the one habit left) + the open challenges + 20 (the box).
    assert.equal(summary.today.canStillEarn, 2 + 5 + summary.today.challenges.available + 20);

    // This week: every row is from today, so earned minus spent is the balance.
    const weekStart = weekStartOf(today);
    const weekEnd = weekEndKey(today);
    assert.deepEqual([summary.week.start, summary.week.end, summary.week.resetsAt], [weekStart, weekEnd, Date.parse(`${shiftDay(weekEnd, 1)}T00:00:00Z`)]);
    assert.deepEqual([summary.week.earned, summary.week.spent, summary.week.bySink], [earned, 30, { freeze: 30 }]);
    assert.deepEqual({ ...summary.week.bySource, challenge: summary.week.bySource.challenge ?? 0 }, { 'check-in': 5, other: 100, challenge: challengeTokens });
    assert.deepEqual(summary.week.quests, { done: 0, total: 3, earned: 0, available: 50 });
    assert.equal(summary.week.bonus.lastWeek.weekStart, shiftDay(weekStart, -7));
    assert.deepEqual(summary.streak, { days: 1, next: { days: 7, bonus: 15, daysLeft: 6 } });
    assert.deepEqual(summary.earn.map((row) => row.id), ['check-in', 'daily-claim', 'challenge', 'mystery', 'quest', 'weekly-bonus', 'streak']);

    // What to spend on, against the balance.
    const drop = dropForWeek(weekStart);
    const spend = Object.fromEntries(summary.spend.map((row) => [row.id, row]));
    assert.deepEqual(summary.spend.map((row) => row.target), ['freeze', 'buddy', 'buddy', 'reward:profile-frames', 'reward:premium-theme', 'reward:custom-title', 'reward:buddy-showcase', 'gift', 'coach']);
    assert.deepEqual([spend['streak-freeze'].status, spend['streak-freeze'].held, spend['streak-freeze'].max, spend['streak-freeze'].cost], ['ready', 1, 2, 30]);
    assert.deepEqual([spend['buddy-shop'].status, spend['buddy-shop'].cost, spend['buddy-shop'].from], ['ready', 40, true]);
    assert.deepEqual([spend['weekly-drop'].status, spend['weekly-drop'].cost, spend['weekly-drop'].detail], ['locked', 150, `${drop.emoji} ${drop.name} · finish 2 of 3 quests (0/2)`]);
    assert.deepEqual([spend['profile-frames'].status, spend['profile-frames'].short, spend['buddy-showcase'].cost], ['short', 180 - balance, 300]);
    assert.deepEqual([spend['treat-gift'].status, spend['treat-gift'].detail], ['ready', '3 of 3 left today']);
    assert.deepEqual([spend.coach.status, spend.coach.detail], ['ready', `Enough for ${Math.floor(balance / 10)} answers`]);
    assert.equal(summary.affordable, 4, 'the freeze, a Habi item, a treat and the AI Coach');
    const perDay = Math.round(earned / 7);
    assert.deepEqual([summary.pace, summary.nextGoal], [{ perDay }, { id: 'profile-frames', title: 'Profile Frames', cost: 180, short: 180 - balance, days: Math.ceil((180 - balance) / perDay) }]);

    // The daily reward and the box are counted once they are taken.
    assert.equal((await request('/api/daily-claim', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) })).response.status, 200);
    const box = await request('/api/mystery-box/open', { method: 'POST', headers, body: JSON.stringify({ date: today, timeZone: 'UTC' }) });
    assert.equal(box.response.status, 200, JSON.stringify(box.body));
    const later = (await summaryFor(day)).body;
    assert.deepEqual(later.today.dailyClaim, { claimed: true, day: 1, amount: 2, tomorrowAmount: 3 });
    assert.deepEqual(later.today.mysteryBox, { status: 'opened', amount: box.body.amount, min: 3, max: 20 });
    assert.equal(later.today.canStillEarn, 5 + later.today.challenges.available);
    assert.deepEqual([later.balance, later.week.bySource['daily-claim'], later.week.bySource.mystery], [balance + 2 + box.body.amount, 2, box.body.amount]);

    // It only reads: a new time zone is not stored and nothing is written.
    const east = 'Pacific/Kiritimati';
    const rows = (await ledgerOf(userId)).length;
    const eastern = await summaryFor(`date=${dateIn(east)}&timeZone=${encodeURIComponent(east)}`);
    assert.deepEqual([eastern.response.status, eastern.body.today?.date], [200, dateIn(east)], JSON.stringify(eastern.body));
    assert.deepEqual((await db.query('SELECT time_zone AS "timeZone", day_floor AS "floor" FROM users WHERE id=$1', [userId])).rows[0], { timeZone: 'UTC', floor: null });
    assert.equal((await ledgerOf(userId)).length, rows);

    // The freeze is a spend:freeze:<uuid> row in the history.
    const history = (await request('/api/wallet/history', { headers })).body;
    const bought = history.items.find((item) => item.kind === 'freeze');
    assert.match(bought?.id ?? '', /^spend:freeze:[0-9a-f-]{36}$/);
    assert.deepEqual([bought.amount, bought.label], [-30, 'Streak freeze']);
  });

  await t.test('the token history: the whole ledger a page at a time, with totals over all of it', async () => {
    const { headers, userId } = await student('Hal', 'History');
    // A new student: nothing earned yet, so no pace and no days to the first goal.
    const fresh = (await request(`/api/wallet/summary?date=${today}&timeZone=UTC`, { headers })).body;
    assert.deepEqual([fresh.balance, fresh.affordable, fresh.today.canStillEarn, fresh.streak.days, fresh.pace.perDay], [0, 0, 2 + 20, 0, 0], JSON.stringify(fresh));
    assert.deepEqual(fresh.nextGoal, { id: 'profile-frames', title: 'Profile Frames', cost: 180, short: 180, days: null });
    assert.deepEqual((await request('/api/wallet/history', { headers })).body, { ok: true, items: [], nextCursor: null, totals: { earned: 0, spent: 0, balance: 0 } });

    // 130 rows, two to a millisecond (so a page can end between two rows of the same time), every
    // tenth an AI Coach answer, and a spend from before ids named their kind (a plain UUID).
    const at = Date.now() - 60_000;
    const rows = Array.from({ length: 130 }, (_, index) => (index % 10 === 0
      ? { id: `${userId}:token:spend:coach:${crypto.randomUUID()}`, amount: -10, label: 'AI Coach answer', createdAt: at + Math.floor(index / 2) }
      : { id: `${userId}:token:quest:2026-10-19:q${index}`, amount: 4, label: `Quest ${index}`, createdAt: at + Math.floor(index / 2) }));
    rows.push({ id: crypto.randomUUID(), amount: -30, label: 'Streak freeze', createdAt: at - 1 });
    await db.query(
      `INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at)
       SELECT r.id, $1, r.amount, r.label, $2, r.created_at FROM unnest($3::text[], $4::int[], $5::text[], $6::bigint[]) AS r(id, amount, label, created_at)`,
      [userId, new Date(at).toISOString(), rows.map((row) => row.id), rows.map((row) => row.amount), rows.map((row) => row.label), rows.map((row) => row.createdAt)],
    );
    const publicId = (id) => id.replace(`${userId}:token:`, '');
    // Newest first, then by id (byte order) within a millisecond.
    const newestFirst = [...rows].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).map((row) => publicId(row.id));
    const totals = { earned: 117 * 4, spent: 13 * 10 + 30, balance: 117 * 4 - 13 * 10 - 30 };
    const history = (query) => request(`/api/wallet/history?${query}`, { headers });

    /** Every page of `filter`, `limit` rows at a time, following nextCursor. */
    const allPages = async (filter, limit) => {
      const pages = [];
      let before = null;
      do {
        const page = await history(`filter=${filter}&limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`);
        assert.equal(page.response.status, 200, JSON.stringify(page.body));
        assert.deepEqual(page.body.totals, totals, 'the totals are over the whole ledger');
        pages.push(page.body);
        before = page.body.nextCursor;
      } while (before && pages.length < 10);
      return pages;
    };
    const pages = await allPages('all', 45);
    assert.deepEqual(pages.map((page) => page.items.length), [45, 45, 41], 'the pages end between two rows of the same millisecond');
    assert.equal(pages.at(-1).nextCursor, null);
    const items = pages.flatMap((page) => page.items);
    assert.deepEqual(items.map((item) => item.id), newestFirst, 'every row once, in order');
    assert.ok(items.every((item) => !item.id.includes(userId)), 'ids are shown without the account prefix');
    const legacy = items.at(-1);
    assert.deepEqual([legacy.kind, legacy.amount, legacy.label, legacy.createdAt], ['freeze', -30, 'Streak freeze', at - 1]);
    assert.deepEqual([...new Set(items.map((item) => item.kind))].sort(), ['coach', 'freeze', 'quest']);
    assert.ok(rows.length > 100 && sumOf(rows) === totals.balance, 'more rows than the 100 the app state carries');

    const spent = (await allPages('spent', 50)).flatMap((page) => page.items);
    assert.deepEqual([spent.length, spent.every((item) => item.amount < 0)], [14, true]);
    const earnedRows = (await allPages('earned', 50)).flatMap((page) => page.items);
    assert.deepEqual([earnedRows.length, earnedRows.every((item) => item.amount > 0)], [117, true]);
    const first = (await history('')).body;
    assert.deepEqual([first.items.length, Boolean(first.nextCursor)], [30, true], '30 rows by default');

    const forged = Buffer.from(JSON.stringify(['soon', 'x'])).toString('base64url');
    for (const query of ['limit=51', 'limit=0', 'limit=ten', 'filter=refunds', 'before=not-a-cursor', `before=${forged}`, 'userId=someone-else']) {
      assert.equal((await history(query)).response.status, 400, query);
    }
  });

  await t.test('what can still be earned today leaves out a habit past its reminder time, which a check-in no longer pays', async () => {
    const { headers, userId } = await student('Dee', 'Dline');
    await db.query('UPDATE users SET time_zone=$2 WHERE id=$1', [userId, middayZone]);
    const pills = { ...appState.habits[0], id: 'pills', label: 'Pills', reminderEnabled: true, reminderTime: '12:00 AM', reminderTimes: ['12:00 AM'] };
    const saved = await request('/api/app-state', { method: 'PUT', headers, body: JSON.stringify({ ...appState, habits: [{ ...appState.habits[0], id: 'read', label: 'Read' }, pills] }) });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    const day = { date: dateIn(middayZone), timeZone: middayZone };
    const summary = (await request(`/api/wallet/summary?date=${day.date}&timeZone=${encodeURIComponent(middayZone)}`, { headers })).body;
    // 2 (the daily reward) + 5 (Read: Pills is missed for today) + the open challenges + 20 (the box).
    assert.equal(summary.today.canStillEarn, 2 + 5 + summary.today.challenges.available + 20, JSON.stringify(summary.today));
    const late = await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'pills', completed: true, ...day }) });
    assert.deepEqual([late.response.status, late.body.code], [409, 'PAST_DEADLINE']);
    const done = await request('/api/habit-completions', { method: 'PUT', headers, body: JSON.stringify({ habitId: 'read', completed: true, ...day }) });
    assert.equal(done.response.status, 200, JSON.stringify(done.body));
    const after = (await request(`/api/wallet/summary?date=${day.date}&timeZone=${encodeURIComponent(middayZone)}`, { headers })).body;
    assert.deepEqual([after.today.checkIns.paid, after.today.canStillEarn], [1, 2 + after.today.challenges.available + 20], 'no habit is left that pays');
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

    // Weekly due marks are kept for last week's bonus and this week, not for old weeks.
    const { pruneDueMarks } = await import('../services/retention.js');
    const weekAgo = (weeks) => new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db.query('INSERT INTO weekly_due_marks(user_id, week_start, due, last_day, updated_at) VALUES($1,$2,9,$2,$4), ($1,$3,7,$3,$4)', [userId, weekAgo(6), weekAgo(1), Date.now()]);
    assert.equal(await pruneDueMarks(db), 1);
    const kept = (await db.query('SELECT week_start::text AS "weekStart" FROM weekly_due_marks WHERE user_id=$1', [userId])).rows.map((row) => row.weekStart);
    assert.deepEqual([kept.includes(weekAgo(6)), kept.includes(weekAgo(1))], [false, true]);
  });

  await t.test('profile, login activity, multi-device merge and account deletion', async () => {
    const profile = await request('/api/auth/profile', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ fullName: 'Updated User', username: 'updated_user', email: 'updated@example.com', dateOfBirth: 'June 1, 1997', gender: 'Female', about: 'Updated profile.', currentPassword: password }) });
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
