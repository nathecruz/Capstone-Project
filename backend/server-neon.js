import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV !== 'test') {
  dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env'), override: true });
}
import { readFile } from 'node:fs/promises';
import cors from 'cors';
import express from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { closeDatabase, query, withTransaction } from './db/client.js';
import { seedCatalog } from './db/seed-data.js';
import { mergeAppState, normalizeAppState } from './services/app-state-sync.js';
import { hasValidFileSignature, removeUploadedFile, uploadIssueAttachment } from './services/file-upload.js';
import {
  assistantSchema,
  emailSchema as email,
  goalGenerationSchema,
  habitCompletionSchema,
  goalPlanSchema,
  habitPredictionSchema,
  issueSchema,
  leaderboardSchema,
  loginSchema,
  otpSchema,
  passwordSchema as password,
  profileSchema,
  registerSchema,
  rewardRedemptionSchema,
  stateSchema,
  suggestionSchema,
  notificationReadSchema,
} from './schemas.js';

const { generateGeminiText, gemini } = await import('./services/gemini.js');

const app = express();
const port = Number(process.env.PORT || 8787);
const isProduction = process.env.NODE_ENV === 'production';
const isLocalUrl = (value) => {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
};
const configuredAuthUrl = process.env.AUTH_URL?.trim();
const configuredJwksUrl = process.env.JWKS_URL?.trim();
if (isProduction && !configuredAuthUrl) throw new Error('AUTH_URL must be configured in production.');
if (isProduction && !configuredJwksUrl) throw new Error('JWKS_URL must be configured in production.');
if (isProduction && configuredAuthUrl && isLocalUrl(configuredAuthUrl)) throw new Error('AUTH_URL must not use localhost in production.');
if (isProduction && configuredJwksUrl && isLocalUrl(configuredJwksUrl)) throw new Error('JWKS_URL must not use localhost in production.');
const configuredMlServiceUrl = process.env.ML_SERVICE_URL?.trim();
if (isProduction && !configuredMlServiceUrl) throw new Error('ML_SERVICE_URL must be configured in production.');
const mlUrl = configuredMlServiceUrl || 'http://localhost:8000';
const mlKey = process.env.ML_SERVICE_API_KEY?.trim();
const looksLikePlaceholderValue = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    /^x+$/i.test(normalized)
    || normalized.includes('replace-with')
    || normalized.includes('yourrealgmail')
    || normalized.includes('your-email')
    || normalized.includes('your_gmail')
    || normalized.includes('example.com')
    || normalized.includes('@example.')
    || normalized.includes('localhost')
    || /^your(?:[-_]?gmail|[-_]?email|[-_]?username|[-_]?name|realgmail)/i.test(normalized)
  );
};
const isConfiguredSecret = (value, allowDevelopmentKey = false) => Boolean(
  value
  && !looksLikePlaceholderValue(value)
  && (allowDevelopmentKey || (value.trim().length >= 32 && !value.startsWith('dev-only-'))),
);
if (isProduction && !isConfiguredSecret(mlKey)) throw new Error('ML_SERVICE_API_KEY must be configured.');
if (isProduction && isLocalUrl(mlUrl)) throw new Error('ML_SERVICE_URL must not use localhost in production.');
if (isProduction && !process.env.ALLOWED_ORIGINS?.trim()) throw new Error('ALLOWED_ORIGINS must be configured in production.');
const timeoutMs = Math.max(1000, Number(process.env.EXTERNAL_REQUEST_TIMEOUT_MS) || 15000);
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const resetLifetimeMs = 5 * 60 * 1000;
const resetCooldownMs = 60 * 1000;
const maxOtpAttempts = 5;

async function ensureNeonSchema() {
  const schema = await readFile(new URL('./db/schema.sql', import.meta.url), 'utf8');
  await withTransaction((connection) => connection.query(schema));
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS about TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT");
  const appStateId = await query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_app_state' AND column_name = 'id'
  `);
  if (appStateId.rows.length === 0) {
    await withTransaction(async (connection) => {
      await connection.query('DROP INDEX IF EXISTS user_app_state_user_updated_idx');
      await connection.query('ALTER TABLE user_app_state RENAME TO user_app_state_legacy');
      await connection.query(`
        CREATE TABLE user_app_state (
          id UUID PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          state_json JSONB NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `);
      await connection.query('INSERT INTO user_app_state(id,user_id,state_json,updated_at) SELECT gen_random_uuid(),user_id,state_json,updated_at FROM user_app_state_legacy');
      await connection.query('DROP TABLE user_app_state_legacy');
      await connection.query('CREATE INDEX user_app_state_user_updated_idx ON user_app_state(user_id, updated_at DESC)');
    });
  }
  await query('ALTER TABLE login_activity ADD COLUMN IF NOT EXISTS login_date_time TIMESTAMPTZ');
  await query('UPDATE login_activity SET login_date_time = to_timestamp(created_at / 1000.0) WHERE login_date_time IS NULL');
  await query('ALTER TABLE login_activity ALTER COLUMN login_date_time SET DEFAULT CURRENT_TIMESTAMP');
  await query('ALTER TABLE login_activity ALTER COLUMN login_date_time SET NOT NULL');
  await withTransaction(seedCatalog);
}

function getEmailConfig() {
  const user = process.env.SMTP_USER?.trim() || process.env.GMAIL_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim() || process.env.GMAIL_APP_PASSWORD?.trim();
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const configured = Boolean(user && password && !looksLikePlaceholderValue(user) && !looksLikePlaceholderValue(password));
  return { user, password, host, port, configured };
}

async function serverCompletionPoints(userId) {
  const result = await query('SELECT COUNT(*)::integer * 20 AS points FROM habit_completions WHERE user_id=$1', [userId]);
  return result.rows[0]?.points || 0;
}
async function getServerCompletions(userId) {
  const result = await query('SELECT habit_id AS "habitId", completed_date::text AS date FROM habit_completions WHERE user_id=$1 ORDER BY completed_date DESC', [userId]);
  return result.rows;
}
function isValidCompletionDate(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date <= new Date().toISOString().slice(0, 10);
}

let userAppStateHasId;
async function saveUserAppState(userId, state, updatedAt) {
  if (userAppStateHasId === undefined) {
    const result = await query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_app_state' AND column_name = 'id'
    `);
    userAppStateHasId = result.rows.length > 0;
  }
  if (userAppStateHasId) {
    await query('INSERT INTO user_app_state(id,user_id,state_json,updated_at) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), userId, state, updatedAt]);
    return;
  }
  const updated = await query('UPDATE user_app_state SET state_json=$1,updated_at=$2 WHERE user_id=$3', [state, updatedAt, userId]);
  if (updated.rowCount === 0) await query('INSERT INTO user_app_state(user_id,state_json,updated_at) VALUES($1,$2,$3)', [userId, state, updatedAt]);
}

function parse(schema, request, response) {
  const result = schema.safeParse(request.body ?? {});
  if (!result.success) { response.status(400).json({ ok: false, message: 'Request contains invalid or unsupported fields.', issues: result.error.issues }); return null; }
  return result.data;
}
function normalizeEmail(value) { return String(value).trim().toLowerCase(); }
function hashToken(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function authToken(request) { const header = request.headers.authorization || ''; return header.startsWith('Bearer ') ? header.slice(7).trim() : ''; }
function userFromRow(row) { return { id: row.id ?? row.userId, fullName: row.fullName, username: row.username || '', email: row.email, dateOfBirth: row.dateOfBirth || '', gender: row.gender || '', region: row.region || '', about: row.about || '' }; }
function passwordStrength(value, context = {}) {
  const pass = String(value || '').trim();
  if (!pass) return 'Password is required.';
  if (pass.length < 8) return 'Password must be at least 8 characters long.';
  const lower = pass.toLowerCase();
  const characterClasses = [/[a-z]/.test(pass), /[A-Z]/.test(pass), /\d/.test(pass), /[^A-Za-z0-9\s]/.test(pass)].filter(Boolean).length;
  const seeds = [context.fullName, context.username, context.email?.split('@')[0], context.email, 'habitai', 'habit', 'habits', 'tracker', 'goals', 'progress', 'app', 'account', 'password', 'admin', 'qwerty', 'welcome', 'letmein', 'login', '123456'].filter(Boolean).map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, '')).filter((seed) => seed.length >= 3);
  if (seeds.some((seed) => lower.includes(seed))) return 'Choose a stronger password that avoids common words, personal details, dates, and app-specific terms.';
  if (/(?:19\d{2}|20\d{2})/.test(pass)) return 'Avoid birthdays, dates, or other personal details in your password.';
  if (characterClasses < 4) return 'Use at least 8 characters with uppercase letters, lowercase letters, numbers, and symbols.';
  if (/(.)\1{2,}/.test(pass) || (/(?:123|456|789)/.test(lower) && pass.length <= 24)) return 'Avoid repeated or predictable patterns such as repeated characters or common numeric sequences.';
  return null;
}
function getPeriodStart(period) {
  const now = new Date();
  if (period === 'This Month') return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const mondayOffset = (now.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset));
  return start.toISOString().slice(0, 10);
}
async function currentSession(request) {
  const token = authToken(request);
  if (!token) return null;
  const result = await query(`SELECT s.user_id AS "userId", u.full_name AS "fullName", u.username, u.email, u.date_of_birth AS "dateOfBirth", u.gender, u.region, u.about FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2`, [hashToken(token), Date.now()]);
  if (!result.rows[0]) await query('DELETE FROM sessions WHERE token_hash = $1 OR expires_at <= $2', [hashToken(token), Date.now()]);
  return result.rows[0] || null;
}
async function requireAuth(request, response) {
  const session = await currentSession(request);
  if (!session) { response.status(401).json({ ok: false, message: 'Authentication required.' }); return null; }
  return session;
}
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, Date.now() + sessionLifetimeMs]);
  return token;
}
async function findUser(emailAddress) {
  const result = await query('SELECT id, full_name AS "fullName", username, email, date_of_birth AS "dateOfBirth", gender, region, about, password_hash AS "passwordHash" FROM users WHERE email = $1', [normalizeEmail(emailAddress)]);
  return result.rows[0] || null;
}
function safeOriginList() { return new Set((process.env.ALLOWED_ORIGINS || 'http://localhost:19006,http://localhost:19080,http://localhost:8081').split(',').map((item) => item.trim()).filter(Boolean)); }
const origins = safeOriginList();
function isLocalDevelopmentOrigin(origin) {
  if (isProduction) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const isPrivateAddress = /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    return url.protocol === 'http:'
      && ['8081', '8082', '19006', '19080'].includes(url.port)
      && (isPrivateAddress || isLocalHost);
  } catch {
    return false;
  }
}
if (isProduction && [...origins].some(isLocalUrl)) throw new Error('ALLOWED_ORIGINS must not use localhost in production.');
app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.has(origin) || isLocalDevelopmentOrigin(origin)) }));
app.use(express.json({ limit: '2mb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { ok: false, message: 'Too many password reset requests. Please try again later.' } });
const resetRequestLimiter = resetLimiter;
const resetVerificationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { ok: false, message: 'Too many OTP verification attempts. Please try again later.' } });

async function isMlServiceReady() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, 3000));
  try {
    const response = await fetch(`${mlUrl.replace(/\/$/, '')}/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const health = await response.json();
    return health.ok === true && (!isProduction || health.modelReady === true);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

app.get('/healthz', (_request, response) => {
  response.json({ ok: true });
});

app.get('/health', async (_request, response) => {
  try {
    await query('SELECT 1');
    const aiConfigured = Boolean(gemini);
    const mlConfigured = isConfiguredSecret(mlKey, !isProduction);
    const mlServiceReady = !isProduction || await isMlServiceReady();
    const ready = !isProduction || (aiConfigured && mlConfigured && mlServiceReady);
    response.status(ready ? 200 : 503).json({ ok: ready, database: 'neon', aiConfigured, emailConfigured: getEmailConfig().configured, mlConfigured, mlServiceReady, mlServiceUrl: mlUrl });
  } catch {
    response.status(503).json({ ok: false, database: 'neon' });
  }
});

app.post('/api/auth/register', authLimiter, async (request, response) => {
  const input = parse(registerSchema, request, response); if (!input) return;
  const emailAddress = normalizeEmail(input.email); const passwordError = passwordStrength(input.password, { fullName: input.fullName, username: input.username, email: emailAddress });
  if (passwordError) return response.status(400).json({ ok: false, message: passwordError });
  const existing = await query('SELECT id FROM users WHERE email = $1 OR lower(username) = lower($2)', [emailAddress, input.username]);
  if (existing.rows.some((row) => row.id)) return response.status(409).json({ ok: false, message: existing.rows.length && (await query('SELECT id FROM users WHERE email = $1', [emailAddress])).rows[0] ? 'An account with this email already exists.' : 'This username is already in use.' });
  const user = { id: crypto.randomUUID(), fullName: input.fullName, username: input.username, email: emailAddress, dateOfBirth: input.dateOfBirth, gender: input.gender, region: input.region, about: '', passwordHash: bcrypt.hashSync(input.password, 12) };
  await withTransaction(async (db) => { await db.query('INSERT INTO users (id, full_name, username, email, date_of_birth, gender, region, about, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [user.id, user.fullName, user.username, user.email, user.dateOfBirth, user.gender, user.region, user.about, user.passwordHash, Date.now()]); await db.query('INSERT INTO login_activity (id,user_id,device,created_at) VALUES ($1,$2,$3,$4)', [crypto.randomUUID(), user.id, input.device || request.get('user-agent')?.slice(0, 160) || 'Unknown device', Date.now()]); });
  response.status(201).json({ ok: true, message: 'Account created successfully.', token: await createSession(user.id), user: userFromRow(user) });
});

app.post('/api/auth/login', authLimiter, async (request, response) => { const input = parse(loginSchema, request, response); if (!input) return; const user = await findUser(input.email); if (!user || !bcrypt.compareSync(input.password, user.passwordHash)) return response.status(401).json({ ok: false, message: 'Incorrect email or password.' }); await query('INSERT INTO login_activity (id,user_id,device,created_at) VALUES ($1,$2,$3,$4)', [crypto.randomUUID(), user.id, input.device || request.get('user-agent')?.slice(0, 160) || 'Unknown device', Date.now()]); response.json({ ok: true, message: 'Login successful.', token: await createSession(user.id), user: userFromRow(user) }); });
app.get('/api/auth/me', async (request, response) => { const session = await requireAuth(request, response); if (session) response.json({ ok: true, user: userFromRow(session) }); });
app.get('/api/auth/login-activity', async (request, response) => { const session = await requireAuth(request, response); if (!session) return; const result = await query('SELECT device, created_at AS "createdAt", login_date_time AS "loginDateTime" FROM login_activity WHERE user_id = $1 ORDER BY login_date_time DESC LIMIT 10', [session.userId]); response.json({ ok: true, activities: result.rows }); });
app.put('/api/auth/profile', async (request, response) => { const session = await requireAuth(request, response); if (!session) return; const input = parse(profileSchema, request, response); if (!input) return; const emailAddress = normalizeEmail(input.email); const duplicate = await query('SELECT id FROM users WHERE (email = $1 OR lower(username) = lower($2)) AND id <> $3', [emailAddress, input.username, session.userId]); if (duplicate.rows[0]) return response.status(409).json({ ok: false, message: 'This email or username is already in use.' }); await query('UPDATE users SET full_name=$1,username=$2,email=$3,date_of_birth=$4,gender=$5,about=$6 WHERE id=$7', [input.fullName, input.username, emailAddress, input.dateOfBirth, input.gender, input.about, session.userId]); const user = await findUser(emailAddress); response.json({ ok: true, message: 'Profile updated successfully.', user: userFromRow(user) }); });

app.get('/api/app-state', async (request, response) => { const session = await requireAuth(request, response); if (!session) return; const result = await query('SELECT state_json AS "stateJson", updated_at AS "updatedAt" FROM user_app_state WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1', [session.userId]); const row = result.rows[0]; response.json({ ok: true, state: row?.stateJson || null, updatedAt: row ? Number(row.updatedAt) : null }); });
async function syncNormalizedState(userId, state, updatedAt) {
  await withTransaction(async (connection) => {
    const rawHabits = Array.isArray(state.habits) ? state.habits : [];
    const seenHabitIds = new Set();
    const habits = rawHabits.filter((habit) => {
      const habitId = String(habit?.id || '').trim();
      if (!habitId || seenHabitIds.has(habitId)) return false;
      seenHabitIds.add(habitId);
      return true;
    });

    await connection.query('DELETE FROM habits WHERE user_id=$1', [userId]);
    const habitIds = habits.map((habit) => String(habit.id).trim()).filter(Boolean);
    if (habitIds.length === 0) await connection.query('DELETE FROM habit_completions WHERE user_id=$1', [userId]);
    else await connection.query('DELETE FROM habit_completions WHERE user_id=$1 AND NOT (habit_id = ANY($2::text[]))', [userId, habitIds]);
    for (const [sortOrder, habit] of habits.entries()) {
      const goal = Math.max(1, Number(habit.goal) || 1);
      const habitId = String(habit.id || '').trim();
      if (!habitId) continue;
      const scopedHabitId = `${userId}:habit:${habitId}`;
      await connection.query(
        `INSERT INTO habits(id,user_id,label,meta,category,icon,color,goal,progress,total,streak,done,reminder_enabled,reminder_time,sort_order,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET
           label = EXCLUDED.label,
           meta = EXCLUDED.meta,
           category = EXCLUDED.category,
           icon = EXCLUDED.icon,
           color = EXCLUDED.color,
           goal = EXCLUDED.goal,
           progress = EXCLUDED.progress,
           total = EXCLUDED.total,
           streak = EXCLUDED.streak,
           done = EXCLUDED.done,
           reminder_enabled = EXCLUDED.reminder_enabled,
           reminder_time = EXCLUDED.reminder_time,
           sort_order = EXCLUDED.sort_order,
           updated_at = EXCLUDED.updated_at`,
        [scopedHabitId, userId, habit.label || habit.name || habitId, habit.meta || '', habit.category || '', habit.icon || 'ellipse-outline', habit.color || '', goal, Number(habit.progress) || 0, habit.total || `0/${goal}`, Number(habit.streak) || 0, Boolean(habit.done), Boolean(habit.reminderEnabled), habit.reminderTime || '', sortOrder, updatedAt]
      );
      await connection.query('DELETE FROM habit_completions WHERE user_id=$1 AND habit_id=$2', [userId, habitId]);
      for (const completionDate of Array.isArray(habit.completionDates) ? habit.completionDates : []) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(completionDate))) await connection.query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [userId, habitId, completionDate, updatedAt]);
      }
    }
    await connection.query('DELETE FROM goals WHERE user_id=$1', [userId]);
    for (const goal of state.goals || []) {
      const scopedGoalId = `${userId}:goal:${goal.id}`;
      await connection.query('INSERT INTO goals(id,user_id,title,category,progress,status,details_json,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [scopedGoalId, userId, goal.title || goal.id, goal.category || 'Personal Growth', Number(goal.progress) || 0, goal.status || 'Fresh plan', goal, updatedAt]);
      for (const [stepIndex, description] of (goal.actionPlan || []).entries()) {
        await connection.query('INSERT INTO goal_steps(id,goal_id,step_index,description,due_date,completed) VALUES($1,$2,$3,$4,$5,$6)', [`${scopedGoalId}:step:${stepIndex}`, scopedGoalId, stepIndex, description, goal.actionDueDates?.[stepIndex] || '', goal.completedSteps?.[stepIndex] || false]);
      }
    }
    const preferences = state.preferences || {};
    await connection.query('INSERT INTO user_preferences(user_id,preferences_json,ring_interval,snooze_frequency,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json,ring_interval=excluded.ring_interval,snooze_frequency=excluded.snooze_frequency,updated_at=excluded.updated_at', [userId, preferences, Number(state.ringInterval) || 30, state.snoozeFrequency || 'Once', updatedAt]);
    await connection.query('DELETE FROM token_transactions WHERE user_id=$1', [userId]);
    for (const transaction of state.tokenHistory || []) await connection.query('INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6)', [`${userId}:token:${transaction.id || crypto.randomUUID()}`, userId, Number(transaction.amount) || 0, transaction.label || '', transaction.date || '', updatedAt]);
    const achievementDefinitions = [['first-habit', 'First Habit', 'Created your first habit.'], ['habit-builder', 'Habit Builder', 'Created at least three habits.'], ['early-bird', 'Early Bird', 'Set a morning reminder.'], ['focus-master', 'Focus Master', 'Completed a Mind habit.'], ['streak-week', 'Seven-Day Streak', 'Reached a seven-day streak.']];
    for (const definition of achievementDefinitions) await connection.query('INSERT INTO achievements(id,name,description) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING', definition);
    await connection.query('DELETE FROM user_achievements WHERE user_id=$1', [userId]);
    const habitList = state.habits || [];
    const earned = new Set();
    if (habitList.length > 0) earned.add('first-habit');
    if (habitList.length >= 3) earned.add('habit-builder');
    if (habitList.some((habit) => habit.reminderEnabled && /AM/i.test(habit.reminderTime || ''))) earned.add('early-bird');
    if (habitList.some((habit) => habit.category === 'Mind' && habit.done)) earned.add('focus-master');
    if (habitList.some((habit) => Number(habit.streak) >= 7)) earned.add('streak-week');
    for (const achievementId of earned) await connection.query('INSERT INTO user_achievements(user_id,achievement_id,earned_at) VALUES($1,$2,$3)', [userId, achievementId, updatedAt]);
    await connection.query('DELETE FROM notifications WHERE user_id=$1 AND type=$2', [userId, 'habit-reminder']);
    for (const habit of habitList.filter((item) => item.reminderEnabled)) await connection.query('INSERT INTO notifications(id,user_id,type,title,body,created_at) VALUES($1,$2,$3,$4,$5,$6)', [`${userId}:notification:habit:${habit.id}`, userId, 'habit-reminder', `${habit.label || habit.id} reminder`, `Reminder set for ${habit.reminderTime || 'your schedule'}.`, updatedAt]);
    await connection.query('DELETE FROM notifications WHERE user_id=$1 AND type=$2', [userId, 'achievement']);
    for (const achievementId of earned) {
      const achievement = (await connection.query('SELECT name,description FROM achievements WHERE id=$1', [achievementId])).rows[0];
      if (achievement) await connection.query('INSERT INTO notifications(id,user_id,type,title,body,created_at) VALUES($1,$2,$3,$4,$5,$6)', [`${userId}:notification:achievement:${achievementId}`, userId, 'achievement', achievement.name, achievement.description, updatedAt]);
    }
    for (const reward of [['plant-buddy', 'Plant Buddy', 200, 'Profile decoration'], ['kindness-boost', 'Kindness Boost', 250, 'Send encouragement to a friend'], ['premium-theme', 'Premium Theme', 320, 'Unlock the premium app theme'], ['habit-swap', 'Habit Swap Token', 380, 'Swap one habit, keep your streak history'], ['mystery-box', 'Mystery Box', 420, 'Open for a random reward'], ['xp-booster', 'XP Booster', 500, '+20% points for 3 days'], ['grace-day', 'Grace Day', 620, 'Skip logging for a day, streak stays safe'], ['custom-title', 'Custom Title', 750, 'Set your own title under your name']]) await connection.query('INSERT INTO rewards(id,name,token_cost,description) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING', reward);
  });
}
app.put('/api/app-state', async (request, response) => {
  const session = await requireAuth(request, response); if (!session) return;
  const input = parse(stateSchema, request, response); if (!input) return;
  const { clientUpdatedAt, baseUpdatedAt, baseState, ...incomingState } = input;
  const existingResult = await query('SELECT state_json AS "stateJson", updated_at AS "updatedAt" FROM user_app_state WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1', [session.userId]);
  const existing = existingResult.rows[0];
  const existingUpdatedAt = existing ? Number(existing.updatedAt) : null;
  const currentState = existing?.stateJson || null;
  const merged = Boolean(existing && baseState && Number(baseUpdatedAt) !== existingUpdatedAt);
  const state = merged ? mergeAppState(baseState, currentState, incomingState) : normalizeAppState(incomingState);
  const updatedAt = Math.max(clientUpdatedAt || 0, Date.now());
  const savedUpdatedAt = Math.max(updatedAt, existingUpdatedAt || 0) + (existingUpdatedAt === updatedAt ? 1 : 0);
  await saveUserAppState(session.userId, state, savedUpdatedAt);
  await syncNormalizedState(session.userId, state, savedUpdatedAt);
  response.json({ ok: true, state, updatedAt: savedUpdatedAt, merged });
});
app.get('/api/habit-completions', async (request, response) => { const session = await requireAuth(request, response); if (!session) return; response.json({ ok: true, completions: await getServerCompletions(session.userId) }); });
app.put('/api/habit-completions', async (request, response) => {
  const session = await requireAuth(request, response); if (!session) return;
  const input = parse(habitCompletionSchema, request, response); if (!input) return;
  if (!isValidCompletionDate(input.date)) return response.status(400).json({ ok: false, message: 'Completion date must be a valid date up to today.' });
  const savedStateResult = await query('SELECT state_json AS "stateJson" FROM user_app_state WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1', [session.userId]);
  const habits = savedStateResult.rows[0]?.stateJson?.habits || [];
  if (!habits.some((habit) => habit.id === input.habitId)) return response.status(404).json({ ok: false, message: 'Habit not found.' });
  if (input.completed) await query('INSERT INTO habit_completions(user_id,habit_id,completed_date,completed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [session.userId, input.habitId, input.date, Date.now()]);
  else await query('DELETE FROM habit_completions WHERE user_id=$1 AND habit_id=$2 AND completed_date=$3', [session.userId, input.habitId, input.date]);
  response.json({ ok: true, completions: await getServerCompletions(session.userId), points: await serverCompletionPoints(session.userId) });
});
app.post('/api/auth/logout', async (request, response) => { const token = authToken(request); if (token) await query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(token)]); response.json({ ok: true, message: 'Logged out successfully.' }); });

async function mailOtp(emailAddress, otp, name) {
  const config = getEmailConfig();
  if (!config.configured) {
    throw new Error('Email delivery is not configured. Set real SMTP/Gmail credentials in the backend environment (for example SMTP_HOST + SMTP_USER + SMTP_PASSWORD or GMAIL_USER + GMAIL_APP_PASSWORD).');
  }

  const transport = config.host ? nodemailer.createTransport({ host: config.host, port: config.port, secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true' || config.port === 465, auth: { user: config.user, pass: config.password } }) : nodemailer.createTransport({ service: 'gmail', auth: { user: config.user, pass: config.password } });
  const sender = process.env.SMTP_FROM?.trim() || config.user;
  await transport.sendMail({ from: `HabitAI <${sender}>`, to: emailAddress, subject: 'Your HabitAI password reset code', text: `Hello ${name || 'there'}, your HabitAI password reset code is ${otp}. It expires in 5 minutes.` });
}

app.post('/api/auth/forgot-password', resetRequestLimiter, async (request, response) => { const input = parse(z.object({ email }).strict(), request, response); if (!input) return; const emailAddress = normalizeEmail(input.email); const user = await findUser(emailAddress); if (!user) return response.json({ ok: true, message: 'If an account exists, a verification code has been sent to the email address.' }); const old = await query('SELECT created_at AS "createdAt" FROM password_reset_requests WHERE email=$1', [emailAddress]); if (old.rows[0] && Date.now() - old.rows[0].createdAt < resetCooldownMs) return response.status(429).json({ ok: false, message: 'Please wait before requesting another verification code.' }); const otp = crypto.randomInt(100000, 1000000).toString(); await query('INSERT INTO password_reset_requests(email,otp_hash,expires_at,attempts,verified_at,created_at) VALUES($1,$2,$3,0,NULL,$4) ON CONFLICT(email) DO UPDATE SET otp_hash=excluded.otp_hash,expires_at=excluded.expires_at,attempts=0,verified_at=NULL,created_at=excluded.created_at', [emailAddress, bcrypt.hashSync(otp, 10), Date.now() + 5 * 60 * 1000, Date.now()]); try { if (!getEmailConfig().configured) { throw new Error('Email delivery is not configured. Set real SMTP/Gmail credentials in the backend environment (for example SMTP_HOST + SMTP_USER + SMTP_PASSWORD or GMAIL_USER + GMAIL_APP_PASSWORD).'); } await mailOtp(emailAddress, otp, user.fullName); response.json({ ok: true, message: 'A 6-digit verification code has been sent to your email.', email: emailAddress }); } catch (error) { await query('DELETE FROM password_reset_requests WHERE email=$1', [emailAddress]); const message = error instanceof Error && /535|badcredentials|authentication/i.test(error.message) ? 'Gmail rejected the SMTP credentials. Use the correct Gmail address and a 16-character Gmail App Password, then restart the backend.' : error instanceof Error ? error.message : 'Unable to send the reset code to your email right now.'; response.status(503).json({ ok: false, message }); } });
async function getReset(emailAddress) { const result = await query('SELECT email,otp_hash AS "otpHash",expires_at AS "expiresAt",attempts,verified_at AS "verifiedAt" FROM password_reset_requests WHERE email=$1', [emailAddress]); return result.rows[0]; }
app.post('/api/auth/verify-otp', resetVerificationLimiter, async (request, response) => {
  const input = parse(otpSchema, request, response);
  if (!input) return;
  const emailAddress = normalizeEmail(input.email);

  const reset = await getReset(emailAddress);
  if (!reset) {
    response.status(404).json({ ok: false, message: 'No active reset request was found. Please request a new OTP.' });
    return;
  }

  if (Date.now() > reset.expiresAt) {
    await query('DELETE FROM password_reset_requests WHERE email=$1', [emailAddress]);
    response.status(410).json({ ok: false, message: 'This OTP has expired. Please request a new one.' });
    return;
  }

  if (reset.attempts >= maxOtpAttempts) {
    await query('DELETE FROM password_reset_requests WHERE email=$1', [emailAddress]);
    response.status(429).json({ ok: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
    return;
  }

  if (!bcrypt.compareSync(input.otp, reset.otpHash)) {
    const nextAttempts = reset.attempts + 1;
    if (nextAttempts >= maxOtpAttempts) {
      await query('DELETE FROM password_reset_requests WHERE email=$1', [emailAddress]);
      response.status(429).json({ ok: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
      return;
    }

    await query('UPDATE password_reset_requests SET attempts=attempts+1 WHERE email=$1', [emailAddress]);
    response.status(401).json({ ok: false, message: 'The OTP is incorrect. Please check the code and try again.' });
    return;
  }

  await query('UPDATE password_reset_requests SET verified_at=$1 WHERE email=$2', [Date.now(), emailAddress]);
  response.json({ ok: true, message: 'OTP verified successfully.' });
});

app.post('/api/auth/reset-password', resetVerificationLimiter, async (request, response) => {
  const input = parse(z.object({ email, otp: z.string().regex(/^\d{6}$/), newPassword: password }).strict(), request, response);
  if (!input) return;
  const emailAddress = normalizeEmail(input.email);

  const resetRequest = await getReset(emailAddress);
  if (!resetRequest) {
    response.status(404).json({ ok: false, message: 'No active reset request was found. Please request a new OTP.' });
    return;
  }

  if (Date.now() > resetRequest.expiresAt) {
    await query('DELETE FROM password_reset_requests WHERE email=$1', [emailAddress]);
    response.status(410).json({ ok: false, message: 'This OTP has expired. Please request a new one.' });
    return;
  }

  if (!resetRequest.verifiedAt || Date.now() - resetRequest.verifiedAt > 10 * 60 * 1000) {
    response.status(401).json({ ok: false, message: 'Please verify the OTP before setting a new password.' });
    return;
  }

  if (resetRequest.attempts >= maxOtpAttempts) {
    await query('DELETE FROM password_reset_requests WHERE email=$1', [emailAddress]);
    response.status(429).json({ ok: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
    return;
  }

  if (!bcrypt.compareSync(input.otp, resetRequest.otpHash)) {
    const nextAttempts = resetRequest.attempts + 1;
    if (nextAttempts >= maxOtpAttempts) {
      await query('DELETE FROM password_reset_requests WHERE email=$1', [emailAddress]);
      response.status(429).json({ ok: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
      return;
    }

    await query('UPDATE password_reset_requests SET attempts=attempts+1 WHERE email=$1', [emailAddress]);
    response.status(401).json({ ok: false, message: 'The OTP is incorrect. Please check the code and try again.' });
    return;
  }

  const user = await findUser(emailAddress);
  if (!user) {
    response.status(404).json({ ok: false, message: 'No account was found for this email address.' });
    return;
  }

  const error = passwordStrength(input.newPassword, user);
  if (error) {
    response.status(400).json({ ok: false, message: error });
    return;
  }

  await withTransaction(async (db) => {
    await db.query('UPDATE users SET password_hash=$1 WHERE email=$2', [bcrypt.hashSync(input.newPassword, 12), emailAddress]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    await db.query('DELETE FROM password_reset_requests WHERE email=$1', [emailAddress]);
  });

  response.json({ ok: true, message: 'Your password has been reset successfully.' });
});
app.post('/api/auth/change-password', async (request, response) => { const session = await requireAuth(request, response); if (!session) return; const input = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict(), request, response); if (!input) return; const user = await findUser(session.email); if (!user || !bcrypt.compareSync(input.currentPassword, user.passwordHash)) return response.status(401).json({ ok: false, message: 'The current password is incorrect.' }); const error = passwordStrength(input.newPassword, user); if (error) return response.status(400).json({ ok: false, message: error }); await query('UPDATE users SET password_hash=$1 WHERE id=$2', [bcrypt.hashSync(input.newPassword, 12), user.id]); await query('DELETE FROM sessions WHERE user_id=$1', [user.id]); response.json({ ok: true, message: 'Your password has been updated. Please sign in again.' }); });
app.post('/api/support/reports', uploadIssueAttachment, async (request, response) => { const session = await requireAuth(request, response); if (!session) { removeUploadedFile(request.file); return; } if (!(await hasValidFileSignature(request.file))) { removeUploadedFile(request.file); return response.status(400).json({ ok: false, message: 'The attachment content does not match its file type.' }); } const input = parse(issueSchema, request, response); if (!input) { removeUploadedFile(request.file); return; } try { await query('INSERT INTO issue_reports(id,user_id,topic,timing,description,attachment_name,attachment_uri,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [crypto.randomUUID(), session.userId, input.topic, input.timing, input.description, request.file?.originalname || null, request.file ? `uploads/${request.file.filename}` : null, Date.now()]); response.status(201).json({ ok: true, message: 'Your report was submitted successfully.' }); } catch { removeUploadedFile(request.file); response.status(500).json({ ok: false, message: 'Your report could not be saved.' }); } });
app.post('/api/support/suggestions', async (request, response) => { const session = await requireAuth(request, response); if (!session) return; const input = parse(suggestionSchema, request, response); if (!input) return; await query('INSERT INTO feature_suggestions(id,user_id,suggestion,created_at) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), session.userId, input.suggestion, Date.now()]); response.status(201).json({ ok: true, message: 'Your suggestion was submitted successfully.' }); });
app.get('/api/notifications', async (request, response) => { const session = await requireAuth(request, response); if (!session) return; const result = await query('SELECT id,type,title,body AS message,read_at AS "readAt",created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [session.userId]); response.json({ ok: true, notifications: result.rows }); });
app.patch('/api/notifications/:id', async (request, response) => { const session = await requireAuth(request, response); if (!session) return; const input = parse(notificationReadSchema, request, response); if (!input) return; const result = await query('UPDATE notifications SET read_at=$1 WHERE id=$2 AND user_id=$3', [input.read ? Date.now() : null, request.params.id, session.userId]); if (!result.rowCount) return response.status(404).json({ ok: false, message: 'Notification not found.' }); response.json({ ok: true }); });
app.post('/api/rewards/redeem', async (request, response) => { const session = await requireAuth(request, response); if (!session) return; const input = parse(rewardRedemptionSchema, request, response); if (!input) return; const reward = (await query('SELECT id,name,token_cost AS "tokenCost" FROM rewards WHERE id=$1', [input.rewardId])).rows[0]; if (!reward || reward.name !== input.rewardName || Number(reward.tokenCost) !== input.tokenCost) return response.status(400).json({ ok: false, message: 'This reward is not available.' }); const balance = Number((await query('SELECT COALESCE(SUM(amount),0) AS balance FROM token_transactions WHERE user_id=$1', [session.userId])).rows[0].balance); const permanent = ['plant-buddy', 'premium-theme', 'custom-title'].includes(reward.id); if (permanent && (await query('SELECT 1 FROM reward_redemptions WHERE user_id=$1 AND reward_id=$2 LIMIT 1', [session.userId, reward.id])).rowCount) return response.status(409).json({ ok: false, message: 'This reward has already been redeemed.' }); if (balance < input.tokenCost) return response.status(409).json({ ok: false, message: 'You do not have enough tokens.' }); await withTransaction(async (db) => { const now = Date.now(); await db.query('INSERT INTO reward_redemptions(id,user_id,reward_id,token_cost,redeemed_at) VALUES($1,$2,$3,$4,$5)', [crypto.randomUUID(), session.userId, reward.id, input.tokenCost, now]); await db.query('INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), session.userId, -input.tokenCost, `Redeemed ${reward.name}`, new Date(now).toISOString(), now]); }); response.json({ ok: true, tokens: balance - input.tokenCost }); });
app.delete('/api/auth/account', async (request, response) => { const session = await requireAuth(request, response); if (!session) return; const input = parse(z.object({ currentPassword: z.string().min(1).max(128) }).strict(), request, response); if (!input) return; const user = await findUser(session.email); if (!user || !bcrypt.compareSync(input.currentPassword, user.passwordHash)) return response.status(401).json({ ok: false, message: 'The current password is incorrect.' }); await query('DELETE FROM users WHERE id=$1', [user.id]); response.json({ ok: true, message: 'Your account and associated data have been permanently deleted.' }); });

app.post('/api/habit/predict', async (request, response) => {
  if (!(await requireAuth(request, response))) return;
  if (!mlKey) return response.status(503).json({ error: 'Live prediction service unavailable.' });
  const parsed = parse(habitPredictionSchema, request, response); if (!parsed) return;
  const habitName = parsed.habit_name || parsed.name || '';
  if (!habitName) return response.status(400).json({ error: 'habit_name is required.' });
  const payload = { habit_name: habitName, streak: parsed.streak ?? 0, completion_rate: parsed.completion_rate ?? 0, missed_days: parsed.missed_days ?? 0, last_7_days: parsed.last_7_days ?? [1, 1, 0, 1, 1, 0, 1], average_session_minutes: parsed.average_session_minutes, priority: parsed.priority || 'balanced', goal_type: parsed.goal_type || 'health' };
  try {
    const result = await fetch(`${mlUrl}/api/predict/habit`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ML-Service-Key': mlKey }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    if (!result.ok) throw new Error('ML service returned a non-OK response.');
    response.json(await result.json());
  } catch {
    response.status(503).json({ error: 'Live prediction service unavailable.' });
  }
});
app.get('/api/leaderboard', async (request, response) => { if (!(await requireAuth(request, response))) return; const period = String(request.query.period || 'This Week'); if (!['This Week', 'This Month', 'All Time'].includes(period)) return response.status(400).json({ ok: false, message: 'Unsupported leaderboard period.' }); const start = period === 'All Time' ? null : getPeriodStart(period); const result = await query('SELECT u.full_name AS name, (COUNT(c.completed_date)::integer * 20) AS points, COALESCE(l.avatar, LEFT(u.full_name, 1)) AS avatar FROM users u LEFT JOIN habit_completions c ON c.user_id=u.id AND ($1::date IS NULL OR c.completed_date >= $1::date) LEFT JOIN leaderboard_users l ON l.user_id=u.id GROUP BY u.id,u.full_name,l.avatar ORDER BY points DESC,u.full_name ASC', [start]); response.json({ period, date: period === 'All Time' ? 'Since joining' : period, leaders: result.rows.map((user, index) => ({ ...user, rank: index + 1 })) }); });
app.post('/api/leaderboard/sync', async (request, response) => { const session = await requireAuth(request, response); if (!session) return; const input = parse(leaderboardSchema, request, response); if (!input) return; const safeName = session.fullName; const safePoints = await serverCompletionPoints(session.userId); const previous = await query('SELECT points FROM leaderboard_users WHERE user_id=$1', [session.userId]); const oldPoints = previous.rows[0]?.points || 0; const avatar = input.avatar || safeName.charAt(0) || '?'; await withTransaction(async (db) => { await db.query('INSERT INTO leaderboard_users(user_id,name,points,avatar) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,points=excluded.points,avatar=excluded.avatar', [session.userId, safeName, safePoints, avatar]); await db.query('INSERT INTO leaderboard_snapshots(id,user_id,name,points,avatar,recorded_at) VALUES($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), session.userId, safeName, safePoints, avatar, Date.now()]); await db.query('INSERT INTO leaderboard_daily_points(user_id,recorded_date,points) VALUES($1,$2,$3) ON CONFLICT(user_id,recorded_date) DO UPDATE SET points=leaderboard_daily_points.points + excluded.points', [session.userId, new Date().toISOString().slice(0, 10), safePoints - oldPoints]); }); response.json({ ok: true, points: safePoints }); });

app.post('/api/insights/assistant', async (request, response) => {
  if (!(await requireAuth(request, response))) return;
  if (!gemini) return response.status(503).json({ error: 'Gemini AI service is not configured on the server.' });
  const input = parse(assistantSchema, request, response); if (!input) return;
  const safeSummary = JSON.stringify(input.summary || {}).slice(0, 6000);
  try {
    const answer = z.string().trim().min(1).max(4000).safeParse(await generateGeminiText(`You are a concise habit coach. Use only this user summary: ${safeSummary}. Answer this question in 2-4 helpful sentences: ${String(input.question || 'What should I focus on next?').slice(0, 500)}`, { maxOutputTokens: 180 }));
    if (!answer.success) return response.status(502).json({ error: 'The AI service returned an invalid response.' });
    response.json({ answer: answer.data });
  } catch { response.status(502).json({ error: 'The AI service is temporarily unavailable.' }); }
});
app.post('/api/goals/generate', async (request, response) => {
  if (!(await requireAuth(request, response))) return;
  if (!gemini) return response.status(503).json({ error: 'Gemini AI service is not configured on the server.' });
  const input = parse(goalGenerationSchema, request, response); if (!input) return;
  try {
    const completionText = await generateGeminiText(`Create a practical personal growth plan for this goal: ${input.goal}. The user prefers a focus of ${input.focusTarget || '4 habits'} and a timeline of ${input.timeline || '30-60 days'}. Return valid JSON with category, summary, intensity, focusAreas, actionPlan, actionDueDates, nextMilestone, risk, riskAction, timeline, nextCheckIn, status. Do not include numerical scores or confidence claims.`, { json: true, maxOutputTokens: 700 });
    let rawPlan;
    try { rawPlan = JSON.parse(completionText); } catch { return response.status(502).json({ error: 'The AI goal planner returned invalid JSON.' }); }
    const plan = goalPlanSchema.safeParse(rawPlan);
    if (!plan.success) return response.status(502).json({ error: 'The AI goal planner returned an invalid plan.' });
    response.json({ plan: plan.data });
  } catch { response.status(502).json({ error: 'The AI goal planner is temporarily unavailable.' }); }
});

await ensureNeonSchema();
const server = app.listen(port, '0.0.0.0', () => console.log(`Neon Insights API listening on http://0.0.0.0:${port}`));
process.once('SIGTERM', async () => { server.close(); await closeDatabase(); });
process.once('SIGINT', async () => { server.close(); await closeDatabase(); });
