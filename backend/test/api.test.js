import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { goalPlanSchema } from '../schemas.js';
import { normalizeAppState } from '../services/app-state-sync.js';

const port = 18900 + Math.floor(Math.random() * 500);
const mlPort = port + 1000;
const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'habitai-api-test-'));
const server = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: '',
    PORT: String(port),
    DATABASE_PATH: path.join(databaseDirectory, 'test.sqlite'),
    GEMINI_API_KEY: 'replace-with-test-key',
    ML_SERVICE_API_KEY: 'dev-only-local-key',
    ML_SERVICE_URL: `http://127.0.0.1:${mlPort}`,
    WEB_PUSH_VAPID_PUBLIC_KEY: 'test-vapid-public-key',
    WEB_PUSH_VAPID_PRIVATE_KEY: 'test-vapid-private-key',
    WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.com',
  },
  stdio: 'ignore',
});
const serverExit = new Promise((resolve) => server.once('exit', resolve));

const baseUrl = `http://127.0.0.1:${port}`;
let mlServiceReady = false;
const mockMlService = createServer((request, response) => {
  if (request.url === '/api/predict/habit' && request.method === 'POST') {
    if (!mlServiceReady) {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Model unavailable.' }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      habit_name: 'Workout', completion_probability: 0.8, dropout_risk: 0.2, confidence: 0.9,
      recommended_action: 'Keep the routine stable.', suggested_reminder_time: '08:00', summary: 'Model forecast.',
      models_used: ['Test model'], prediction_source: 'model', is_fallback: false,
    }));
    return;
  }
  response.writeHead(404);
  response.end();
});
const mockMlServiceReady = new Promise((resolve) => mockMlService.listen(mlPort, '127.0.0.1', resolve));

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start in time.');
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const responseText = await response.text();
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error(`Expected JSON from ${pathname}, received HTTP ${response.status}: ${responseText.slice(0, 120)}`);
  }
  return { response, body };
}

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

test('auth, login activity, leaderboard sync, periods, and account deletion work together', async (t) => {
  await waitForServer();
  await mockMlServiceReady;
  const liveness = await request('/healthz');
  assert.equal(liveness.response.status, 200);
  assert.equal(liveness.body.ok, true);
  t.after(async () => {
    server.kill();
    await serverExit;
    await new Promise((resolve) => mockMlService.close(resolve));
    try {
      rmSync(databaseDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      if (error?.code !== 'EPERM') throw error;
    }
  });

  const registration = await request('/api/auth/register', {
    method: 'POST',
    headers: { Origin: 'http://localhost:8081' },
    body: JSON.stringify({ fullName: 'Test User', username: 'test_user', email: 'test@example.com', password: 'Violet!Orbit7!Cedar2!Mint', dateOfBirth: 'May 14, 1998', gender: 'Prefer not to say' }),
  });
  assert.equal(registration.response.status, 201, JSON.stringify(registration.body));
  assert.equal(registration.response.headers.get('access-control-allow-origin'), 'http://localhost:8081');
  assert.equal(registration.body.ok, true);
  assert.equal(registration.body.user.dateOfBirth, 'May 14, 1998');
  assert.equal(registration.body.user.gender, 'Prefer not to say');
  assert.equal(registration.body.user.about, '');

  const duplicateUsernameRegistration = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ fullName: 'Another User', username: 'TEST_USER', email: 'another@example.com', password: 'Amber!River8!Stone3!Leaf', dateOfBirth: 'January 1, 1990', gender: 'Prefer not to say' }),
  });
  assert.equal(duplicateUsernameRegistration.response.status, 409);
  assert.equal(duplicateUsernameRegistration.body.message, 'This username is already in use.');

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com', password: 'Violet!Orbit7!Cedar2!Mint', device: 'Test Phone (Android 15)' }),
  });
  assert.equal(login.response.status, 200);
  const token = login.body.token;
  assert.ok(token);
  const authHeaders = { Authorization: `Bearer ${token}` };

  const pushPublicKey = await request('/api/web-push/public-key');
  assert.equal(pushPublicKey.response.status, 200);
  assert.equal(pushPublicKey.body.publicKey, 'test-vapid-public-key');

  const pushSubscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
    expirationTime: null,
    keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' },
  };
  const anonymousPushSubscription = await request('/api/web-push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ subscription: pushSubscription, timeZone: 'UTC' }),
  });
  assert.equal(anonymousPushSubscription.response.status, 401);

  const savedPushSubscription = await request('/api/web-push/subscriptions', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ subscription: pushSubscription, timeZone: 'America/Los_Angeles' }),
  });
  assert.equal(savedPushSubscription.response.status, 200, JSON.stringify(savedPushSubscription.body));

  const invalidPushSubscription = await request('/api/web-push/subscriptions', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ subscription: { ...pushSubscription, endpoint: 'https://attacker.example/push' }, timeZone: 'UTC' }),
  });
  assert.equal(invalidPushSubscription.response.status, 400);

  const removePushSubscription = await request('/api/web-push/subscriptions', {
    method: 'DELETE',
    headers: authHeaders,
    body: JSON.stringify({ endpoint: pushSubscription.endpoint }),
  });
  assert.equal(removePushSubscription.response.status, 200);

  const currentUser = await request('/api/auth/me', { headers: authHeaders });
  assert.equal(currentUser.response.status, 200);
  assert.equal(currentUser.body.user.dateOfBirth, 'May 14, 1998');
  assert.equal(currentUser.body.user.gender, 'Prefer not to say');
  assert.equal(currentUser.body.user.about, '');

  const queryTokenUser = await request(`/api/auth/me?token=${encodeURIComponent(token)}`);
  assert.equal(queryTokenUser.response.status, 401);
  const bodyTokenUser = await request('/api/leaderboard/sync', {
    method: 'POST',
    body: JSON.stringify({ token, name: 'Test User', points: 0 }),
  });
  assert.equal(bodyTokenUser.response.status, 401);
  const anonymousLeaderboard = await request('/api/leaderboard');
  assert.equal(anonymousLeaderboard.response.status, 401);

  const expiredToken = crypto.randomBytes(32).toString('hex');
  const testDatabase = new Database(path.join(databaseDirectory, 'test.sqlite'));
  testDatabase.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(crypto.createHash('sha256').update(expiredToken).digest('hex'), login.body.user.id, 0);
  testDatabase.close();
  const expiredSession = await request('/api/auth/me', { headers: { Authorization: `Bearer ${expiredToken}` } });
  assert.equal(expiredSession.response.status, 401, JSON.stringify(expiredSession.body));

  const malformedState = await request('/api/app-state', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ unexpected: true }),
  });
  assert.equal(malformedState.response.status, 400);

  const predictionFailure = await request('/api/habit/predict', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ habit_name: 'Workout' }),
  });
  assert.equal(predictionFailure.response.status, 503);

  mlServiceReady = true;
  const predictionSuccess = await request('/api/habit/predict', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ habit_name: 'Workout' }),
  });
  assert.equal(predictionSuccess.response.status, 200);
  assert.equal(predictionSuccess.body.prediction_source, 'model');
  assert.equal(predictionSuccess.body.is_fallback, false);

  const assistantUnavailable = await request('/api/insights/assistant', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ question: 'What should I focus on?' }),
  });
  assert.equal(assistantUnavailable.response.status, 503);

  const forgotPasswordWithoutEmailConfig = await request('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com' }),
  });
  assert.equal(forgotPasswordWithoutEmailConfig.response.status, 503, JSON.stringify(forgotPasswordWithoutEmailConfig.body));
  assert.equal(forgotPasswordWithoutEmailConfig.body.ok, false);
  assert.equal(Object.hasOwn(forgotPasswordWithoutEmailConfig.body, 'otp'), false);
  assert.match(forgotPasswordWithoutEmailConfig.body.message, /SMTP|email.*config|Gmail/i);

  const resetDatabase = new Database(path.join(databaseDirectory, 'test.sqlite'));
  resetDatabase.prepare(`
    INSERT INTO password_reset_requests (email, otp_hash, expires_at, attempts, verified_at, created_at)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run('test@example.com', bcrypt.hashSync('123456', 4), Date.now() + 300000, Date.now(), Date.now());
  resetDatabase.close();

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const resetAttempt = await request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', otp: '654321', newPassword: 'Amber!River8!Stone3!Leaf' }),
    });
    assert.equal(resetAttempt.response.status, attempt === 5 ? 429 : 401);
  }
  const lockedReset = await request('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com', otp: '123456', newPassword: 'Amber!River8!Stone3!Leaf' }),
  });
  assert.equal(lockedReset.response.status, 429);

  const profileUpdate = await request('/api/auth/profile', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ fullName: 'Updated User', username: 'updated_user', email: 'updated@example.com', dateOfBirth: 'June 1, 1997', gender: 'Female', about: 'Updated profile.' }),
  });
  assert.equal(profileUpdate.response.status, 200, JSON.stringify(profileUpdate.body));
  assert.equal(profileUpdate.body.user.email, 'updated@example.com');
  assert.equal(profileUpdate.body.user.username, 'updated_user');

  const updatedUser = await request('/api/auth/me', { headers: authHeaders });
  assert.equal(updatedUser.body.user.fullName, 'Updated User');
  assert.equal(updatedUser.body.user.email, 'updated@example.com');

  const activity = await request('/api/auth/login-activity', { headers: authHeaders });
  assert.equal(activity.response.status, 200);
  const latestActivity = activity.body.activities.find((entry) => entry.device === 'Test Phone (Android 15)');
  assert.ok(latestActivity, JSON.stringify(activity.body.activities));
  assert.equal(typeof latestActivity.createdAt, 'number');
  assert.ok(latestActivity.loginDateTime);
  assert.equal(Object.hasOwn(latestActivity, 'ipAddress'), false);
  const loginActivityColumns = new Database(path.join(databaseDirectory, 'test.sqlite'))
    .prepare('PRAGMA table_info(login_activity)').all();
  assert.equal(loginActivityColumns.some((column) => column.name === 'ip_address'), false);
  assert.equal(loginActivityColumns.some((column) => column.name === 'login_date_time'), true);

  const sync = await request('/api/leaderboard/sync', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ avatar: 'T' }),
  });
  assert.equal(sync.response.status, 200);

  const secondSync = await request('/api/leaderboard/sync', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ avatar: 'T' }),
  });
  assert.equal(secondSync.response.status, 200);

  const completionDate = new Date().toISOString().slice(0, 10);
  const appState = {
    avatarImage: null,
    profile: { fullName: 'Test User', email: 'test@example.com' },
    preferences: { language: 'English' },
    habits: [{ id: 'habit-1', completionDates: [] }],
    points: 42,
    tokens: 5,
    tokenHistory: [],
    darkModeOverride: null,
    ringInterval: 30,
    snoozeFrequency: 'Once',
    goals: [{ id: 'goal-1', title: 'Read more', progress: 25 }],
  };
  const stateSave = await request('/api/app-state', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify(appState),
  });
  assert.equal(stateSave.response.status, 200, JSON.stringify(stateSave.body));

  const duplicateHabitState = normalizeAppState({
    ...appState,
    habits: [
      { ...appState.habits[0], id: 'habit-1', completionDates: [completionDate] },
      { ...appState.habits[0], id: 'habit-1', completionDates: [completionDate] },
    ],
  });
  assert.equal(duplicateHabitState.habits.length, 1);

  const completion = await request('/api/habit-completions', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ habitId: 'habit-1', date: completionDate, completed: true }),
  });
  assert.equal(completion.response.status, 200, JSON.stringify(completion.body));
  assert.equal(completion.body.points, 20);
  assert.deepEqual(completion.body.completions, [{ habitId: 'habit-1', date: completionDate }]);

  const persistedState = await request('/api/app-state', { headers: authHeaders });
  assert.equal(persistedState.response.status, 200);
  assert.equal(Array.isArray(persistedState.body.state.habits), true);
  assert.deepEqual(persistedState.body.state.habits[0].completionDates, [completionDate]);

  const verifiedLeaderboardSync = await request('/api/leaderboard/sync', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ avatar: 'T' }),
  });
  assert.equal(verifiedLeaderboardSync.response.status, 200);

  const expectedPersistedState = {
    ...appState,
    habits: [{
      ...appState.habits[0],
      completionDates: [completionDate],
      done: true,
      progress: 100,
      total: '1/1',
    }],
  };
  const stateLoad = await request('/api/app-state', { headers: authHeaders });
  assert.equal(stateLoad.response.status, 200);
  assert.deepEqual(stateLoad.body.state, expectedPersistedState);

  const secondRegistration = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ fullName: 'Second User', username: 'second_user', email: 'second@example.com', password: 'Silver!Meadow8!Cloud3!Pine', dateOfBirth: 'May 14, 1998', gender: 'Prefer not to say' }),
  });
  assert.equal(secondRegistration.response.status, 201, JSON.stringify(secondRegistration.body));
  const secondAuthHeaders = { Authorization: `Bearer ${secondRegistration.body.token}` };
  const secondUserAppState = {
    ...appState,
    profile: { fullName: 'Second User', email: 'second@example.com' },
    habits: [{ ...appState.habits[0], label: 'Second user habit' }],
    goals: [{ ...appState.goals[0], title: 'Second user goal' }],
  };
  const secondUserStateSave = await request('/api/app-state', {
    method: 'PUT',
    headers: secondAuthHeaders,
    body: JSON.stringify(secondUserAppState),
  });
  assert.equal(secondUserStateSave.response.status, 200, JSON.stringify(secondUserStateSave.body));

  const crossUserCompletion = await request('/api/habit-completions', {
    method: 'PUT',
    headers: secondAuthHeaders,
    body: JSON.stringify({ habitId: 'habit-1', date: completionDate, completed: true }),
  });
  assert.equal(crossUserCompletion.response.status, 200, JSON.stringify(crossUserCompletion.body));
  assert.equal(crossUserCompletion.body.points, 20);
  const firstUserStateAfterCrossAccess = await request('/api/app-state', { headers: authHeaders });
  assert.deepEqual(firstUserStateAfterCrossAccess.body.state, expectedPersistedState);
  const scopedHabitRows = new Database(path.join(databaseDirectory, 'test.sqlite'))
    .prepare('SELECT user_id AS userId, label FROM habits WHERE id LIKE ? ORDER BY user_id')
    .all('%:habit:habit-1');
  assert.equal(scopedHabitRows.length, 2);
  assert.deepEqual(new Set(scopedHabitRows.map((row) => row.label)), new Set(['habit-1', 'Second user habit']));

  const report = await request('/api/support/reports', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ topic: 'Other', timing: 'Today', description: 'The report flow works.' }),
  });
  assert.equal(report.response.status, 201, JSON.stringify(report.body));
  assert.equal(report.body.ok, true);

  const invalidAttachment = new FormData();
  invalidAttachment.append('topic', 'Other');
  invalidAttachment.append('timing', 'Today');
  invalidAttachment.append('description', 'Invalid attachment should be rejected.');
  invalidAttachment.append('attachment', new Blob(['not a PNG']), 'evidence.png');
  const invalidAttachmentResponse = await fetch(`${baseUrl}/api/support/reports`, {
    method: 'POST',
    headers: authHeaders,
    body: invalidAttachment,
  });
  assert.equal(invalidAttachmentResponse.status, 400);

  const validAttachment = new FormData();
  validAttachment.append('topic', 'Other');
  validAttachment.append('timing', 'Today');
  validAttachment.append('description', 'Valid attachment should be stored.');
  validAttachment.append('attachment', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'evidence.png');
  const validAttachmentResponse = await fetch(`${baseUrl}/api/support/reports`, {
    method: 'POST',
    headers: authHeaders,
    body: validAttachment,
  });
  assert.equal(validAttachmentResponse.status, 201, await validAttachmentResponse.text());
  const uploadedDatabase = new Database(path.join(databaseDirectory, 'test.sqlite'));
  const uploadedReport = uploadedDatabase.prepare('SELECT attachment_uri AS attachmentUri FROM issue_reports WHERE description = ?')
    .get('Valid attachment should be stored.');
  uploadedDatabase.close();
  assert.match(uploadedReport.attachmentUri, /^uploads\/[0-9a-f-]+\.png$/);
  const uploadedFilePath = path.resolve(import.meta.dirname, '..', 'data', uploadedReport.attachmentUri);
  assert.equal(existsSync(uploadedFilePath), true);
  rmSync(uploadedFilePath, { force: true });

  const deviceOneState = { ...appState, preferences: { language: 'Tagalog' } };
  const deviceOneSave = await request('/api/app-state', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ ...deviceOneState, baseUpdatedAt: stateSave.body.updatedAt, baseState: appState }),
  });
  assert.equal(deviceOneSave.response.status, 200);

  const deviceTwoState = { ...appState, points: 62 };
  const deviceTwoSave = await request('/api/app-state', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ ...deviceTwoState, baseUpdatedAt: stateSave.body.updatedAt, baseState: appState }),
  });
  assert.equal(deviceTwoSave.response.status, 200);
  assert.equal(deviceTwoSave.body.merged, true);
  assert.equal(deviceTwoSave.body.state.preferences.language, 'Tagalog');
  assert.equal(deviceTwoSave.body.state.points, 62);
  const stateDatabase = new Database(path.join(databaseDirectory, 'test.sqlite'));
  const appStateRows = stateDatabase
    .prepare('SELECT COUNT(*) AS count FROM user_app_state WHERE user_id = (SELECT id FROM users WHERE email = ?)')
    .get('updated@example.com');
  const normalizedCounts = stateDatabase
    .prepare(`SELECT
      (SELECT COUNT(*) FROM habits WHERE user_id = (SELECT id FROM users WHERE email = ?)) AS habits,
      (SELECT COUNT(*) FROM goals WHERE user_id = (SELECT id FROM users WHERE email = ?)) AS goals`)
    .get('updated@example.com', 'updated@example.com');
  stateDatabase.close();
  assert.equal(appStateRows.count, 4);
  assert.equal(normalizedCounts.habits, 1);
  assert.equal(normalizedCounts.goals, 1);

  for (const period of ['This Week', 'This Month', 'All Time']) {
    const leaderboard = await request(`/api/leaderboard?period=${encodeURIComponent(period)}`, { headers: authHeaders });
    assert.equal(leaderboard.response.status, 200);
    const updatedUserEntry = leaderboard.body.leaders.find((entry) => entry.name === 'Updated User');
    assert.equal(updatedUserEntry?.points, 20);
  }

  const deletion = await request('/api/auth/account', {
    method: 'DELETE',
    headers: authHeaders,
    body: JSON.stringify({ currentPassword: 'Violet!Orbit7!Cedar2!Mint' }),
  });
  assert.equal(deletion.response.status, 200);

  const deletedLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'updated@example.com', password: 'Violet!Orbit7!Cedar2!Mint' }),
  });
  assert.equal(deletedLogin.response.status, 401);
});
