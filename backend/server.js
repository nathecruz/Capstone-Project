import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env') });
}
import { mkdirSync } from 'node:fs';
import cors from 'cors';
import express from 'express';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { rateLimit } from 'express-rate-limit';
import nodemailer from 'nodemailer';
import { mergeAppState, normalizeAppState } from './services/app-state-sync.js';
import { hasValidFileSignature, removeUploadedFile, uploadIssueAttachment } from './services/file-upload.js';
import {
  accountDeletionSchema,
  appStateSchema,
  assistantSchema,
  changePasswordSchema,
  emailSchema,
  forgotPasswordSchema,
  goalGenerationSchema,
  habitCompletionSchema,
  goalPlanSchema,
  habitPredictionSchema,
  issueReportSchema,
  leaderboardSyncSchema,
  loginSchema,
  passwordSchema,
  profileUpdateSchema,
  registerSchema,
  rewardRedemptionSchema,
  resetPasswordSchema,
  suggestionSchema,
  notificationReadSchema,
  webPushSubscriptionRequestSchema,
  webPushUnsubscribeSchema,
  verifyOtpSchema,
} from './schemas.js';
import { achievementSeeds, rewardSeeds } from './db/seed-data.js';
import { getConfiguredVapidPublicKey, isAllowedWebPushEndpoint } from './services/web-push-reminders.js';

const { generateGeminiText, gemini } = await import('./services/gemini.js');

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL?.trim()) {
  throw new Error('DATABASE_URL must be configured in production.');
}
if (process.env.DATABASE_URL?.trim()) {
  await import('./server-neon.js');
}

const app = express();
const port = Number(process.env.PORT || 8787);
const isProduction = process.env.NODE_ENV === 'production';
const configuredMlServiceUrl = process.env.ML_SERVICE_URL?.trim();
if (isProduction && !configuredMlServiceUrl) {
  throw new Error('ML_SERVICE_URL must be configured in production.');
}
const ML_SERVICE_URL = configuredMlServiceUrl || 'http://localhost:8000';
const isLocalUrl = (value) => {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
};
if (isProduction && isLocalUrl(ML_SERVICE_URL)) {
  throw new Error('ML_SERVICE_URL must not use localhost in production.');
}
const ML_SERVICE_API_KEY = process.env.ML_SERVICE_API_KEY?.trim();
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
if (!isConfiguredSecret(ML_SERVICE_API_KEY, !isProduction)) {
  throw new Error('ML_SERVICE_API_KEY must be configured.');
}
const externalRequestTimeoutMs = Math.max(1000, Number(process.env.EXTERNAL_REQUEST_TIMEOUT_MS) || 15000);
async function isMlServiceReady() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(externalRequestTimeoutMs, 3000));
  try {
    const response = await fetch(`${ML_SERVICE_URL.replace(/\/$/, '')}/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const health = await response.json();
    return health.ok === true && (!isProduction || health.modelReady === true);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
const databasePath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'habitai.sqlite');
mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    date_of_birth TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    about TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_activity (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    login_date_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS password_reset_requests (
    email TEXT PRIMARY KEY,
    otp_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    verified_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leaderboard_users (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    avatar TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    points INTEGER NOT NULL,
    avatar TEXT NOT NULL,
    recorded_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leaderboard_daily_points (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recorded_date TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, recorded_date)
  );
  CREATE TABLE IF NOT EXISTS user_app_state (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    goal INTEGER NOT NULL DEFAULT 1,
    progress INTEGER NOT NULL DEFAULT 0,
    total TEXT NOT NULL DEFAULT '',
    streak INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    reminder_time TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS habits_user_sort_idx ON habits(user_id, sort_order);
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Fresh plan',
    details_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS goals_user_updated_idx ON goals(user_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS goal_steps (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    description TEXT NOT NULL,
    due_date TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    UNIQUE (goal_id, step_index)
  );
  CREATE TABLE IF NOT EXISTS user_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, preferences_json TEXT NOT NULL, ring_interval INTEGER NOT NULL DEFAULT 30, snooze_frequency TEXT NOT NULL DEFAULT 'Once', updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS token_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, amount INTEGER NOT NULL, label TEXT NOT NULL, transaction_date TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS token_transactions_user_date_idx ON token_transactions(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS achievements (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS user_achievements (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE, earned_at INTEGER NOT NULL, PRIMARY KEY (user_id, achievement_id));
  CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, read_at INTEGER, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS web_push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE, subscription_json TEXT NOT NULL, time_zone TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx ON web_push_subscriptions(user_id);
  CREATE TABLE IF NOT EXISTS web_push_deliveries (subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE, habit_id TEXT NOT NULL, reminder_date TEXT NOT NULL, reminder_time TEXT NOT NULL, attempted_at INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (subscription_id, habit_id, reminder_date, reminder_time));
  CREATE TABLE IF NOT EXISTS rewards (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, token_cost INTEGER NOT NULL CHECK (token_cost >= 0), description TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS reward_redemptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, reward_id TEXT NOT NULL REFERENCES rewards(id), token_cost INTEGER NOT NULL, redeemed_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS habit_completions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    habit_id TEXT NOT NULL,
    completed_date TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, habit_id, completed_date)
  );
  CREATE INDEX IF NOT EXISTS habit_completions_user_date_idx ON habit_completions(user_id, completed_date);
  CREATE TABLE IF NOT EXISTS issue_reports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    timing TEXT NOT NULL,
    description TEXT NOT NULL,
    attachment_name TEXT,
    attachment_uri TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS feature_suggestions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    suggestion TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);
for (const reward of [['plant-buddy', 'Plant Buddy', 200, 'Profile decoration'], ['kindness-boost', 'Kindness Boost', 250, 'Send encouragement to a friend'], ['premium-theme', 'Premium Theme', 320, 'Unlock the premium app theme'], ['habit-swap', 'Habit Swap Token', 380, 'Swap one habit, keep your streak history'], ['mystery-box', 'Mystery Box', 420, 'Open for a random reward'], ['xp-booster', 'XP Booster', 500, '+20% points for 3 days'], ['grace-day', 'Grace Day', 620, 'Skip logging for a day, streak stays safe'], ['custom-title', 'Custom Title', 750, 'Set your own title under your name']]) {
  database.prepare('INSERT OR IGNORE INTO rewards (id, name, token_cost, description) VALUES (?, ?, ?, ?)').run(...reward);
}

const appStateColumns = database.prepare('PRAGMA table_info(user_app_state)').all();
if (appStateColumns.some((column) => column.name === 'user_id' && column.pk === 1)) {
  database.transaction(() => {
    database.exec('ALTER TABLE user_app_state RENAME TO user_app_state_legacy');
    database.exec(`
      CREATE TABLE user_app_state (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    const legacyStates = database.prepare('SELECT user_id, state_json, updated_at FROM user_app_state_legacy').all();
    const insertState = database.prepare('INSERT INTO user_app_state (id, user_id, state_json, updated_at) VALUES (?, ?, ?, ?)');
    for (const state of legacyStates) insertState.run(crypto.randomUUID(), state.user_id, state.state_json, state.updated_at);
    database.exec('DROP TABLE user_app_state_legacy');
  })();
}
database.exec('CREATE INDEX IF NOT EXISTS user_app_state_user_updated_idx ON user_app_state(user_id, updated_at DESC)');

function syncNormalizedState(userId, state, updatedAt) {
  const sync = database.transaction(() => {
    const rawHabits = Array.isArray(state.habits) ? state.habits : [];
    const seenHabitIds = new Set();
    const habits = rawHabits.filter((habit) => {
      const habitId = String(habit?.id || '').trim();
      if (!habitId || seenHabitIds.has(habitId)) return false;
      seenHabitIds.add(habitId);
      return true;
    });

    database.prepare('DELETE FROM habits WHERE user_id = ?').run(userId);
    const deleteHabitCompletions = database.prepare('DELETE FROM habit_completions WHERE user_id = ? AND habit_id = ?');
    const insertHabitCompletion = database.prepare('INSERT OR IGNORE INTO habit_completions (user_id, habit_id, completed_date, completed_at) VALUES (?, ?, ?, ?)');
    const insertHabit = database.prepare(`INSERT INTO habits
      (id, user_id, label, meta, category, icon, color, goal, progress, total, streak, done, reminder_enabled, reminder_time, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [sortOrder, habit] of habits.entries()) {
      const habitId = String(habit.id || '').trim();
      if (!habitId) continue;
      const scopedHabitId = `${userId}:habit:${habitId}`;
      const goal = Math.max(1, Number(habit.goal) || 1);
      insertHabit.run(scopedHabitId, userId, habit.label || habit.name || habitId, habit.meta || '', habit.category || '', habit.icon || 'ellipse-outline', habit.color || '', goal, Number(habit.progress) || 0, habit.total || `0/${goal}`, Number(habit.streak) || 0, habit.done ? 1 : 0, habit.reminderEnabled ? 1 : 0, habit.reminderTime || '', sortOrder, updatedAt);
      deleteHabitCompletions.run(userId, habitId);
      for (const completionDate of Array.isArray(habit.completionDates) ? habit.completionDates : []) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(completionDate))) insertHabitCompletion.run(userId, habitId, completionDate, updatedAt);
      }
    }
    database.prepare('DELETE FROM goals WHERE user_id = ?').run(userId);
    const insertGoal = database.prepare('INSERT INTO goals (id, user_id, title, category, progress, status, details_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertStep = database.prepare('INSERT INTO goal_steps (id, goal_id, step_index, description, due_date, completed) VALUES (?, ?, ?, ?, ?, ?)');
    for (const goal of state.goals || []) {
      const scopedGoalId = `${userId}:goal:${goal.id}`;
      insertGoal.run(scopedGoalId, userId, goal.title || goal.id, goal.category || 'Personal Growth', Number(goal.progress) || 0, goal.status || 'Fresh plan', JSON.stringify(goal), updatedAt);
      for (const [stepIndex, description] of (goal.actionPlan || []).entries()) {
        insertStep.run(`${scopedGoalId}:step:${stepIndex}`, scopedGoalId, stepIndex, description, goal.actionDueDates?.[stepIndex] || '', goal.completedSteps?.[stepIndex] ? 1 : 0);
      }
    }
    const preferences = state.preferences || {};
    database.prepare(`INSERT INTO user_preferences (user_id, preferences_json, ring_interval, snooze_frequency, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json, ring_interval=excluded.ring_interval, snooze_frequency=excluded.snooze_frequency, updated_at=excluded.updated_at`)
      .run(userId, JSON.stringify(preferences), Number(state.ringInterval) || 30, state.snoozeFrequency || 'Once', updatedAt);
    database.prepare('DELETE FROM token_transactions WHERE user_id = ?').run(userId);
    const insertToken = database.prepare('INSERT INTO token_transactions (id, user_id, amount, label, transaction_date, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const transaction of state.tokenHistory || []) insertToken.run(`${userId}:token:${transaction.id || crypto.randomUUID()}`, userId, Number(transaction.amount) || 0, transaction.label || '', transaction.date || '', updatedAt);

    const insertAchievement = database.prepare('INSERT OR IGNORE INTO achievements (id, name, description) VALUES (?, ?, ?)');
    for (const definition of achievementSeeds) insertAchievement.run(...definition);
    database.prepare('DELETE FROM user_achievements WHERE user_id = ?').run(userId);
    const habitList = habits;
    const earned = new Set();
    if (habitList.length > 0) earned.add('first-habit');
    if (habitList.length >= 3) earned.add('habit-builder');
    if (habitList.some((habit) => habit.reminderEnabled && /AM/i.test(habit.reminderTime || ''))) earned.add('early-bird');
    if (habitList.some((habit) => habit.category === 'Mind' && habit.done)) earned.add('focus-master');
    if (habitList.some((habit) => Number(habit.streak) >= 7)) earned.add('streak-week');
    const insertEarned = database.prepare('INSERT INTO user_achievements (user_id, achievement_id, earned_at) VALUES (?, ?, ?)');
    for (const achievementId of earned) insertEarned.run(userId, achievementId, updatedAt);

    database.prepare("DELETE FROM notifications WHERE user_id = ? AND type = ? AND body LIKE 'Reminder set for %'").run(userId, 'habit-reminder');
    database.prepare('DELETE FROM notifications WHERE user_id = ? AND type = ?').run(userId, 'achievement');
    const insertAchievementNotification = database.prepare('INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const achievementId of earned) {
      const achievement = database.prepare('SELECT name, description FROM achievements WHERE id = ?').get(achievementId);
      if (achievement) insertAchievementNotification.run(`${userId}:notification:achievement:${achievementId}`, userId, 'achievement', achievement.name, achievement.description, updatedAt);
    }

    const insertReward = database.prepare('INSERT OR IGNORE INTO rewards (id, name, token_cost, description) VALUES (?, ?, ?, ?)');
    for (const reward of rewardSeeds) insertReward.run(...reward);
  });
  sync();
}
const userColumns = database.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some((column) => column.name === 'username')) {
  database.exec("ALTER TABLE users ADD COLUMN username TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.some((column) => column.name === 'date_of_birth')) {
  database.exec("ALTER TABLE users ADD COLUMN date_of_birth TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.some((column) => column.name === 'gender')) {
  database.exec("ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.some((column) => column.name === 'region')) {
  database.exec("ALTER TABLE users ADD COLUMN region TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.some((column) => column.name === 'about')) {
  database.exec("ALTER TABLE users ADD COLUMN about TEXT NOT NULL DEFAULT ''");
}
const loginActivityColumns = database.prepare('PRAGMA table_info(login_activity)').all();
if (loginActivityColumns.some((column) => column.name === 'ip_address')) {
  database.exec('ALTER TABLE login_activity DROP COLUMN ip_address');
}
if (!loginActivityColumns.some((column) => column.name === 'login_date_time')) {
  database.exec("ALTER TABLE login_activity ADD COLUMN login_date_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
}
database.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (lower(username)) WHERE username <> ''");

// Preserve existing leaderboard members when snapshot history is introduced.
// Older point changes cannot be reconstructed, so this records a one-time baseline.
database.prepare(`
  INSERT INTO leaderboard_snapshots (id, user_id, name, points, avatar, recorded_at)
  SELECT lower(hex(randomblob(16))), user_id, name, points, avatar, ?
  FROM leaderboard_users
  WHERE NOT EXISTS (
    SELECT 1 FROM leaderboard_snapshots snapshot WHERE snapshot.user_id = leaderboard_users.user_id
  )
`).run(Date.now());
database.prepare(`
  INSERT INTO leaderboard_daily_points (user_id, recorded_date, points)
  SELECT user_id, ?, points
  FROM leaderboard_users
  WHERE NOT EXISTS (
    SELECT 1 FROM leaderboard_daily_points daily WHERE daily.user_id = leaderboard_users.user_id
  )
`).run(new Date().toISOString().slice(0, 10));

const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const resetLifetimeMs = 5 * 60 * 1000;
const resetRequestCooldownMs = 60 * 1000;
const maxOtpAttempts = 5;
const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, message: 'Too many requests. Please try again later.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, message: 'Too many authentication attempts. Please try again later.' },
});
const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, message: 'Too many password reset requests. Please try again later.' },
});
const passwordResetVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, message: 'Too many OTP attempts. Please try again later.' },
});
const expensiveApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, message: 'Too many requests for this service. Please try again shortly.' },
});
function parseRequest(schema, request, response) {
  const result = schema.safeParse(request.body ?? {});
  if (!result.success) {
    response.status(400).json({ ok: false, message: 'Request contains invalid or unsupported fields.', issues: result.error.issues });
    return null;
  }

  return result.data;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), user.id, Date.now() + sessionLifetimeMs);
  return token;
}

function findUserByEmail(email) {
  return database.prepare('SELECT id, full_name AS fullName, username, email, date_of_birth AS dateOfBirth, gender, region, about, password_hash AS passwordHash FROM users WHERE email = ?')
    .get(email);
}

function findAuthenticatedSession(request) {
  const token = getAuthToken(request);
  if (!token) {
    return null;
  }

  const session = database.prepare(`
    SELECT s.user_id AS userId, u.full_name AS fullName, u.username, u.email, u.date_of_birth AS dateOfBirth, u.gender, u.region, u.about
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(hashToken(token), Date.now());

  if (!session) {
    database.prepare('DELETE FROM sessions WHERE token_hash = ? OR expires_at <= ?').run(hashToken(token), Date.now());
  }

  return session || null;
}

function requireAuthentication(request, response) {
  const session = findAuthenticatedSession(request);
  if (!session) {
    response.status(401).json({ ok: false, message: 'Authentication required.' });
    return null;
  }

  return session;
}

function getLeaderboardPeriodStart(period) {
  const now = new Date();
  if (period === 'This Month') {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }

  const mondayOffset = (now.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset));
  return start.toISOString().slice(0, 10);
}

function calculateServerPoints(userId) {
  return database.prepare('SELECT COUNT(*) AS count FROM habit_completions WHERE user_id = ?').get(userId).count * 20;
}

function getServerCompletions(userId) {
  return database.prepare('SELECT habit_id AS habitId, completed_date AS date FROM habit_completions WHERE user_id = ? ORDER BY completed_date DESC').all(userId);
}

function applyHabitCompletionToState(userId, habitId, completionDate, completed) {
  const currentState = database.prepare('SELECT state_json AS stateJson, updated_at AS updatedAt FROM user_app_state WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').get(userId);
  if (!currentState) {
    return false;
  }

  const state = JSON.parse(currentState.stateJson);
  if (!Array.isArray(state.habits)) {
    return false;
  }

  const habit = state.habits.find((entry) => entry.id === habitId);
  if (!habit) {
    return false;
  }

  const dates = new Set(Array.isArray(habit.completionDates) ? habit.completionDates.filter((value) => typeof value === 'string') : []);
  if (completed) dates.add(completionDate);
  else dates.delete(completionDate);

  habit.completionDates = Array.from(dates).sort();
  habit.done = habit.completionDates.includes(new Date().toISOString().slice(0, 10));

  const goal = Math.max(1, Number(habit.goal) || 1);
  habit.progress = habit.done ? 100 : 0;
  habit.total = `${habit.completionDates.length}/${goal}`;

  const updatedAt = Date.now();
  database.prepare('INSERT INTO user_app_state (id, user_id, state_json, updated_at) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), userId, JSON.stringify(state), updatedAt);
  syncNormalizedState(userId, state, updatedAt);
  return true;
}

function isValidCompletionDate(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date <= new Date().toISOString().slice(0, 10);
}

function createEmailTransport() {
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER?.trim() || process.env.GMAIL_USER?.trim();
  const smtpPassword = process.env.SMTP_PASSWORD?.trim() || process.env.GMAIL_APP_PASSWORD?.trim();

  if (!smtpUser || !smtpPassword || looksLikePlaceholderValue(smtpUser) || looksLikePlaceholderValue(smtpPassword)) {
    return null;
  }

  if (smtpHost) {
    return nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true' || smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPassword },
    });
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  });
}

function isEmailConfigured() {
  const user = process.env.SMTP_USER?.trim() || process.env.GMAIL_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim() || process.env.GMAIL_APP_PASSWORD?.trim();
  return Boolean(user && password && !looksLikePlaceholderValue(user) && !looksLikePlaceholderValue(password));
}

async function sendResetOtpEmail(email, otp, fullName) {
  const transport = createEmailTransport();
  if (!transport) {
    throw new Error('Email delivery is not configured. Set real SMTP/Gmail credentials in the backend environment (for example SMTP_HOST + SMTP_USER + SMTP_PASSWORD or GMAIL_USER + GMAIL_APP_PASSWORD).');
  }

  const senderEmail = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || process.env.GMAIL_USER?.trim() || 'habitai@localhost';
  const displayName = 'HabitAI';

  await transport.sendMail({
    from: `${displayName} <${senderEmail}>`,
    to: email,
    subject: 'Your HabitAI password reset code',
    text: `Hello ${fullName || 'there'},\n\nYour HabitAI password reset code is: ${otp}\n\nThis code expires in 5 minutes. If you did not request this, you can ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #1d2435; line-height: 1.6;">
        <h3 style="margin-bottom: 12px;">Password Reset Request</h3>
        <p>Hello ${fullName || 'there'},</p>
        <p>Your HabitAI password reset code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 16px 0;">${otp}</p>
        <p>This code expires in 5 minutes.</p>
        <p>If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

function normalizePasswordSeed(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function validatePasswordStrength(password, context = {}) {
  const pass = String(password ?? '').trim();

  if (!pass) {
    return { ok: false, message: 'Password is required.' };
  }

  if (pass.length < 8) {
    return { ok: false, message: 'Password must be at least 8 characters long.' };
  }

  const lower = pass.toLowerCase();
  const hasLowercase = /[a-z]/.test(pass);
  const hasUppercase = /[A-Z]/.test(pass);
  const hasNumber = /\d/.test(pass);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(pass);
  const characterClasses = [hasLowercase, hasUppercase, hasNumber, hasSymbol].filter(Boolean).length;
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const maybeBirthday = /(?:0?[1-9]|1[0-2])(?:[/-]?)(?:0?[1-9]|[12]\d|3[01])(?:[/-]?)(?:19\d{2}|20\d{2}|\d{2})/.test(pass)
    || /(?:19\d{2}|20\d{2})/.test(pass);

  const allSeeds = [
    ...(context.fullName ? [context.fullName] : []),
    ...(context.username ? [context.username] : []),
    ...(context.email ? [context.email.split('@')[0], context.email] : []),
    ...(context.serviceWords ?? []),
    'habitai', 'habit', 'habits', 'tracker', 'goals', 'progress', 'app', 'account',
  ];

  const bannedSeeds = Array.from(new Set(
    allSeeds
      .map(normalizePasswordSeed)
      .filter((seed) => seed.length >= 3),
  ));

  const weakWordMatch = [
    'password', 'passw0rd', 'pass123', 'password123', 'admin', 'administrator', 'qwerty', 'welcome',
    'letmein', 'login', 'monkey', 'dragon', 'football', 'abc123', 'sunshine', 'iloveyou', 'happy',
    'lovely', 'secret', 'superman', 'batman', 'master', 'shadow', 'princess', 'password1', 'passphrase',
    '012345', '123456', '123456789', '12345678', '123123', '111111', ...bannedSeeds,
  ].some((seed) => {
    const normalizedSeed = normalizePasswordSeed(seed);
    if (!normalizedSeed || normalizedSeed.length < 3) {
      return false;
    }

    return lower.includes(normalizedSeed);
  });

  if (weakWordMatch) {
    return {
      ok: false,
      message: 'Choose a stronger password that avoids common words, personal details, dates, and app-specific terms.',
    };
  }

  if (maybeBirthday) {
    return {
      ok: false,
      message: 'Avoid birthdays, dates, or other personal details in your password.',
    };
  }

  if (characterClasses < 4) {
    return {
      ok: false,
      message: 'Use at least 8 characters with uppercase letters, lowercase letters, numbers, and symbols.',
    };
  }

  if (words.length >= 2 && words.length < 4) {
    return {
      ok: false,
      message: 'Passphrases must contain at least four unrelated words.',
    };
  }

  if ((context.existingPasswords ?? []).some((existingPassword) => existingPassword === password)) {
    return {
      ok: false,
      message: 'Choose a password that is not used by another account or tier.',
    };
  }

  if (/(.)\1{2,}/.test(pass) || /(?:123|456|789)/.test(pass.toLowerCase()) && pass.length <= 24) {
    return {
      ok: false,
      message: 'Avoid repeated or predictable patterns such as repeated characters or common numeric sequences.',
    };
  }

  return { ok: true };
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim());
}

function getAuthToken(request) {
  const authHeader = request.headers.authorization ?? '';
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

function sanitizeUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username || '',
    email: user.email,
    dateOfBirth: user.dateOfBirth || '',
    gender: user.gender || '',
    region: user.region || '',
    about: user.about || '',
  };
}

async function predictHabitWithMl(signal) {
  const response = await fetch(`${ML_SERVICE_URL}/api/predict/habit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ML-Service-Key': ML_SERVICE_API_KEY,
    },
    body: JSON.stringify(signal),
    signal: AbortSignal.timeout(externalRequestTimeoutMs),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || 'ML prediction service returned a non-OK response');
  }

  return response.json();
}

const configuredOrigins = process.env.ALLOWED_ORIGINS?.trim();
if (isProduction && !configuredOrigins) {
  throw new Error('ALLOWED_ORIGINS must be configured in production.');
}
const allowedOrigins = new Set(
  (configuredOrigins || 'http://localhost:19006,http://localhost:19080,http://localhost:8081')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
);
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
if (isProduction && [...allowedOrigins].some(isLocalUrl)) {
  throw new Error('ALLOWED_ORIGINS must not use localhost in production.');
}
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin) || isLocalDevelopmentOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin is not allowed by CORS.'));
  },
}));
app.use(express.json({ limit: '2mb' }));
app.use('/api', globalApiLimiter);

app.get('/healthz', (_request, response) => {
  response.json({ ok: true });
});

app.get('/health', async (_request, response) => {
  const geminiConfigured = Boolean(gemini);
  const mlConfigured = isConfiguredSecret(ML_SERVICE_API_KEY, !isProduction);
  const mlServiceReady = !isProduction || await isMlServiceReady();
  const ready = !isProduction || (geminiConfigured && mlConfigured && mlServiceReady);
  if (!ready) response.status(503);
  response.json({
    ok: ready,
    aiConfigured: geminiConfigured,
    mlConfigured,
    mlServiceReady,
    emailConfigured: isEmailConfigured(),
    mlServiceUrl: ML_SERVICE_URL,
  });
});

app.post('/api/auth/register', authLimiter, (request, response) => {
  const input = parseRequest(registerSchema, request, response);
  if (!input) return;
  const { fullName, username, password } = input;
  const email = normalizeEmail(input.email);

  const validation = validatePasswordStrength(password, {
    fullName,
    email,
  });

  if (!validation.ok) {
    response.status(400).json({ ok: false, message: validation.message || 'Password does not meet the security requirements.' });
    return;
  }

  if (findUserByEmail(email)) {
    response.status(409).json({ ok: false, message: 'An account with this email already exists.' });
    return;
  }

  const existingUsername = database.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username);
  if (existingUsername) {
    response.status(409).json({ ok: false, message: 'This username is already in use.' });
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    fullName,
    username,
    email,
    dateOfBirth: input.dateOfBirth || '',
    gender: input.gender || '',
    region: input.region || '',
    about: input.about || '',
    passwordHash: bcrypt.hashSync(password, 12),
  };

  database.prepare('INSERT INTO users (id, full_name, username, email, date_of_birth, gender, region, about, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(user.id, user.fullName, user.username, user.email, user.dateOfBirth, user.gender, user.region, user.about, user.passwordHash, Date.now());
  const token = createSession(user);
  database.prepare('INSERT INTO login_activity (id, user_id, device, created_at) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), user.id, input.device || request.get('user-agent')?.slice(0, 160) || 'Unknown device', Date.now());

  response.status(201).json({
    ok: true,
    message: 'Account created successfully.',
    token,
    user: sanitizeUser(user),
  });
});

app.post('/api/auth/login', authLimiter, (request, response) => {
  const input = parseRequest(loginSchema, request, response);
  if (!input) return;
  const email = normalizeEmail(input.email);
  const { password } = input;

  const user = findUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    response.status(401).json({ ok: false, message: 'Incorrect email or password.' });
    return;
  }

  const token = createSession(user);
  database.prepare('INSERT INTO login_activity (id, user_id, device, created_at) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), user.id, input.device || request.get('user-agent')?.slice(0, 160) || 'Unknown device', Date.now());

  response.json({
    ok: true,
    message: 'Login successful.',
    token,
    user: sanitizeUser(user),
  });
});

app.get('/api/auth/me', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) {
    return;
  }

  response.json({
    ok: true,
    user: {
      id: session.userId,
      fullName: session.fullName,
      username: session.username || '',
      email: session.email,
      region: session.region || '',
      dateOfBirth: session.dateOfBirth || '',
      gender: session.gender || '',
      about: session.about || '',
    },
  });
});

app.get('/api/auth/login-activity', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;

  const activities = database.prepare(`
    SELECT device, created_at AS createdAt
      , login_date_time AS loginDateTime
    FROM login_activity
    WHERE user_id = ?
    ORDER BY login_date_time DESC
    LIMIT 10
  `).all(session.userId);

  response.json({ ok: true, activities });
});

app.put('/api/auth/profile', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;

  const input = parseRequest(profileUpdateSchema, request, response);
  if (!input) return;
  const email = normalizeEmail(input.email);
  const existingEmail = database.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, session.userId);
  if (existingEmail) {
    response.status(409).json({ ok: false, message: 'An account with this email already exists.' });
    return;
  }

  const existingUsername = database.prepare('SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?').get(input.username, session.userId);
  if (existingUsername) {
    response.status(409).json({ ok: false, message: 'This username is already in use.' });
    return;
  }

  database.prepare(`
    UPDATE users
    SET full_name = ?, username = ?, email = ?, date_of_birth = ?, gender = ?, about = ?
    WHERE id = ?
  `).run(input.fullName, input.username, email, input.dateOfBirth, input.gender, input.about, session.userId);

  const user = database.prepare('SELECT id, full_name AS fullName, username, email, date_of_birth AS dateOfBirth, gender, region, about FROM users WHERE id = ?')
    .get(session.userId);
  response.json({ ok: true, message: 'Profile updated successfully.', user: sanitizeUser(user) });
});

app.get('/api/app-state', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;

  const savedState = database.prepare('SELECT state_json AS stateJson, updated_at AS updatedAt FROM user_app_state WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
    .get(session.userId);
  if (!savedState) {
    response.json({ ok: true, state: null, updatedAt: null });
    return;
  }

  response.json({ ok: true, state: JSON.parse(savedState.stateJson), updatedAt: savedState.updatedAt });
});

app.put('/api/app-state', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;

  const input = parseRequest(appStateSchema, request, response);
  if (!input) return;
  const updatedAt = Math.max(input.clientUpdatedAt || 0, Date.now());
  const { clientUpdatedAt: _clientUpdatedAt, baseUpdatedAt, baseState, ...incomingState } = input;
  const existing = database.prepare('SELECT state_json AS stateJson, updated_at AS updatedAt FROM user_app_state WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
    .get(session.userId);
  const currentState = existing ? JSON.parse(existing.stateJson) : null;
  const state = existing && baseState && baseUpdatedAt !== existing.updatedAt
    ? mergeAppState(baseState, currentState, incomingState)
    : normalizeAppState(incomingState);
  const savedUpdatedAt = Math.max(updatedAt, existing?.updatedAt || 0) + (existing?.updatedAt === updatedAt ? 1 : 0);

  database.prepare(`
    INSERT INTO user_app_state (id, user_id, state_json, updated_at) VALUES (?, ?, ?, ?)
  `).run(crypto.randomUUID(), session.userId, JSON.stringify(state), savedUpdatedAt);
  syncNormalizedState(session.userId, state, savedUpdatedAt);

  response.json({ ok: true, state, updatedAt: savedUpdatedAt, merged: Boolean(existing && baseState && baseUpdatedAt !== existing.updatedAt) });
});

app.get('/api/habit-completions', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;
  response.json({ ok: true, completions: getServerCompletions(session.userId) });
});

app.put('/api/habit-completions', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;
  const input = parseRequest(habitCompletionSchema, request, response);
  if (!input) return;
  if (!isValidCompletionDate(input.date)) return response.status(400).json({ ok: false, message: 'Completion date must be a valid date up to today.' });
  const savedState = database.prepare('SELECT state_json AS stateJson FROM user_app_state WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').get(session.userId);
  const habits = savedState ? JSON.parse(savedState.stateJson).habits : [];
  if (!habits.some((habit) => habit.id === input.habitId)) return response.status(404).json({ ok: false, message: 'Habit not found.' });

  if (input.completed) {
    database.prepare('INSERT OR IGNORE INTO habit_completions (user_id, habit_id, completed_date, completed_at) VALUES (?, ?, ?, ?)')
      .run(session.userId, input.habitId, input.date, Date.now());
  } else {
    database.prepare('DELETE FROM habit_completions WHERE user_id = ? AND habit_id = ? AND completed_date = ?')
      .run(session.userId, input.habitId, input.date);
  }

  applyHabitCompletionToState(session.userId, input.habitId, input.date, input.completed);

  response.json({ ok: true, completions: getServerCompletions(session.userId), points: calculateServerPoints(session.userId) });
});

app.post('/api/auth/logout', (request, response) => {
  const token = getAuthToken(request);
  if (token) {
    database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }
  response.json({ ok: true, message: 'Logged out successfully.' });
});

app.post('/api/auth/forgot-password', passwordResetRequestLimiter, async (request, response) => {
  const input = parseRequest(forgotPasswordSchema, request, response);
  if (!input) return;
  const email = normalizeEmail(input.email);

  const user = findUserByEmail(email);
  if (!user) {
    response.json({ ok: true, message: 'If an account exists, a verification code has been sent to the email address.' });
    return;
  }

  const existingRequest = database.prepare('SELECT created_at AS createdAt FROM password_reset_requests WHERE email = ?').get(email);
  if (existingRequest && Date.now() - existingRequest.createdAt < resetRequestCooldownMs) {
    response.status(429).json({ ok: false, message: 'Please wait before requesting another verification code.' });
    return;
  }

  const otp = generateOtp();
  const expiresAt = Date.now() + resetLifetimeMs;
  database.prepare(`
    INSERT INTO password_reset_requests (email, otp_hash, expires_at, attempts, verified_at, created_at)
    VALUES (?, ?, ?, 0, NULL, ?)
    ON CONFLICT(email) DO UPDATE SET otp_hash = excluded.otp_hash, expires_at = excluded.expires_at,
      attempts = 0, verified_at = NULL, created_at = excluded.created_at
  `).run(email, bcrypt.hashSync(otp, 10), expiresAt, Date.now());

  try {
    await sendResetOtpEmail(email, otp, user.fullName);
    response.json({
      ok: true,
      message: 'A 6-digit verification code has been sent to your email.',
      email,
    });
  } catch (error) {
    database.prepare('DELETE FROM password_reset_requests WHERE email = ?').run(email);
    const smtpMessage = !isEmailConfigured()
      ? 'Password reset email is not configured. Add a valid Gmail address and 16-character Gmail App Password to backend/.env, then restart the backend.'
      : error instanceof Error && /535|badcredentials|authentication/i.test(error.message)
      ? 'Gmail rejected the SMTP credentials. Use the correct Gmail address and a 16-character Gmail App Password, then restart the backend.'
      : error instanceof Error ? error.message : 'Unable to send the reset code to your email right now.';
    response.status(503).json({
      ok: false,
      message: smtpMessage,
    });
  }
});

app.post('/api/auth/verify-otp', passwordResetVerificationLimiter, async (request, response) => {
  const input = parseRequest(verifyOtpSchema, request, response);
  if (!input) return;
  const email = normalizeEmail(input.email);
  const otpCode = input.otp;

  const resetRequest = database.prepare('SELECT email, otp_hash, expires_at AS expiresAt, attempts, verified_at, created_at FROM password_reset_requests WHERE email = ?').get(email);
  if (!resetRequest) {
    response.status(404).json({ ok: false, message: 'No active reset request was found. Please request a new OTP.' });
    return;
  }

  if (Date.now() > resetRequest.expiresAt) {
    database.prepare('DELETE FROM password_reset_requests WHERE email = ?').run(email);
    response.status(410).json({ ok: false, message: 'This OTP has expired. Please request a new one.' });
    return;
  }

  if (resetRequest.attempts >= maxOtpAttempts) {
    database.prepare('DELETE FROM password_reset_requests WHERE email = ?').run(email);
    response.status(429).json({ ok: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
    return;
  }

  if (!bcrypt.compareSync(otpCode, resetRequest.otp_hash)) {
    database.prepare('UPDATE password_reset_requests SET attempts = attempts + 1 WHERE email = ?').run(email);
    response.status(401).json({ ok: false, message: 'The OTP is incorrect. Please check the code and try again.' });
    return;
  }

  database.prepare('UPDATE password_reset_requests SET verified_at = ? WHERE email = ?').run(Date.now(), email);
  response.json({ ok: true, message: 'OTP verified successfully.' });
});

app.post('/api/auth/reset-password', passwordResetVerificationLimiter, async (request, response) => {
  const input = parseRequest(resetPasswordSchema, request, response);
  if (!input) return;
  const email = normalizeEmail(input.email);
  const otpCode = input.otp;
  const { newPassword } = input;

  const resetRequest = database.prepare('SELECT email, otp_hash, expires_at AS expiresAt, attempts, verified_at, created_at FROM password_reset_requests WHERE email = ?').get(email);
  if (!resetRequest) {
    response.status(404).json({ ok: false, message: 'No active reset request was found. Please request a new OTP.' });
    return;
  }

  if (Date.now() > resetRequest.expiresAt) {
    database.prepare('DELETE FROM password_reset_requests WHERE email = ?').run(email);
    response.status(410).json({ ok: false, message: 'This OTP has expired. Please request a new one.' });
    return;
  }

  if (!resetRequest.verified_at || Date.now() - resetRequest.verified_at > 10 * 60 * 1000) {
    response.status(401).json({ ok: false, message: 'Please verify the OTP before setting a new password.' });
    return;
  }

  if (resetRequest.attempts >= maxOtpAttempts) {
    database.prepare('DELETE FROM password_reset_requests WHERE email = ?').run(email);
    response.status(429).json({ ok: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
    return;
  }

  if (!bcrypt.compareSync(otpCode, resetRequest.otp_hash)) {
    const nextAttempts = resetRequest.attempts + 1;
    if (nextAttempts >= maxOtpAttempts) {
      database.prepare('DELETE FROM password_reset_requests WHERE email = ?').run(email);
      response.status(429).json({ ok: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
      return;
    }

    database.prepare('UPDATE password_reset_requests SET attempts = attempts + 1 WHERE email = ?').run(email);
    response.status(401).json({ ok: false, message: 'The OTP is incorrect. Please check the code and try again.' });
    return;
  }

  const user = findUserByEmail(email);
  if (!user) {
    response.status(404).json({ ok: false, message: 'No account was found for this email address.' });
    return;
  }

  const validation = validatePasswordStrength(newPassword, {
    fullName: user.fullName,
    email,
    serviceWords: ['habitai', 'habit'],
  });

  if (!validation.ok) {
    response.status(400).json({ ok: false, message: validation.message || 'Password does not meet the security requirements.' });
    return;
  }

  database.prepare('UPDATE users SET password_hash = ? WHERE email = ?')
    .run(bcrypt.hashSync(newPassword, 12), email);
  database.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  database.prepare('DELETE FROM password_reset_requests WHERE email = ?').run(email);

  response.json({ ok: true, message: 'Your password has been reset successfully.' });
});

app.post('/api/auth/change-password', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) {
    return;
  }

  const input = parseRequest(changePasswordSchema, request, response);
  if (!input) return;
  const { currentPassword, newPassword } = input;
  const user = findUserByEmail(session.email);

  if (!user || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    response.status(401).json({ ok: false, message: 'The current password is incorrect.' });
    return;
  }

  const validation = validatePasswordStrength(newPassword, {
    fullName: user.fullName,
    email: user.email,
    serviceWords: ['habitai', 'habit'],
  });
  if (!validation.ok) {
    response.status(400).json({ ok: false, message: validation.message || 'Password does not meet the security requirements.' });
    return;
  }

  database.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 12), user.id);
  database.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

  response.json({ ok: true, message: 'Your password has been updated. Please sign in again.' });
});

app.post('/api/support/reports', uploadIssueAttachment, async (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) {
    removeUploadedFile(request.file);
    return;
  }
  if (!(await hasValidFileSignature(request.file))) {
    removeUploadedFile(request.file);
    response.status(400).json({ ok: false, message: 'The attachment content does not match its file type.' });
    return;
  }

  const input = parseRequest(issueReportSchema, request, response);
  if (!input) {
    removeUploadedFile(request.file);
    return;
  }

  try {
    database.prepare(`
      INSERT INTO issue_reports (id, user_id, topic, timing, description, attachment_name, attachment_uri, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), session.userId, input.topic, input.timing, input.description, request.file?.originalname || null, request.file ? `uploads/${request.file.filename}` : null, Date.now());
  } catch (error) {
    removeUploadedFile(request.file);
    response.status(500).json({ ok: false, message: 'Your report could not be saved.' });
    return;
  }

  response.status(201).json({ ok: true, message: 'Your report was submitted successfully.' });
});

app.post('/api/support/suggestions', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;
  const input = parseRequest(suggestionSchema, request, response);
  if (!input) return;
  database.prepare('INSERT INTO feature_suggestions (id, user_id, suggestion, created_at) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), session.userId, input.suggestion, Date.now());
  response.status(201).json({ ok: true, message: 'Your suggestion was submitted successfully.' });
});

app.get('/api/notifications', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;
  const rows = database.prepare('SELECT id, type, title, body AS message, read_at AS readAt, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(session.userId);
  response.json({ ok: true, notifications: rows });
});

app.patch('/api/notifications/:id', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;
  const input = parseRequest(notificationReadSchema, request, response);
  if (!input) return;
  const result = database.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(input.read ? Date.now() : null, request.params.id, session.userId);
  if (!result.changes) return response.status(404).json({ ok: false, message: 'Notification not found.' });
  response.json({ ok: true });
});

app.get('/api/web-push/public-key', (request, response) => {
  const publicKey = getConfiguredVapidPublicKey();
  if (!publicKey) return response.status(503).json({ ok: false, message: 'Web Push is not configured.' });
  response.json({ ok: true, publicKey });
});

app.post('/api/web-push/subscriptions', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;
  const input = parseRequest(webPushSubscriptionRequestSchema, request, response);
  if (!input) return;
  if (!isAllowedWebPushEndpoint(input.subscription.endpoint)) return response.status(400).json({ ok: false, message: 'Unsupported Web Push endpoint.' });
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone });
  } catch {
    return response.status(400).json({ ok: false, message: 'A valid device timezone is required.' });
  }
  const now = Date.now();
  database.prepare(`INSERT INTO web_push_subscriptions(id,user_id,endpoint,subscription_json,time_zone,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,time_zone=excluded.time_zone,updated_at=excluded.updated_at`)
    .run(crypto.randomUUID(), session.userId, input.subscription.endpoint, JSON.stringify(input.subscription), input.timeZone, now, now);
  response.json({ ok: true });
});

app.delete('/api/web-push/subscriptions', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;
  const input = parseRequest(webPushUnsubscribeSchema, request, response);
  if (!input) return;
  database.prepare('DELETE FROM web_push_subscriptions WHERE user_id=? AND endpoint=?').run(session.userId, input.endpoint);
  response.json({ ok: true });
});

app.post('/api/rewards/redeem', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;
  const input = parseRequest(rewardRedemptionSchema, request, response);
  if (!input) return;
  const reward = database.prepare('SELECT id, name, token_cost AS tokenCost FROM rewards WHERE id = ?').get(input.rewardId);
  if (!reward || reward.name !== input.rewardName || reward.tokenCost !== input.tokenCost) return response.status(400).json({ ok: false, message: 'This reward is not available.' });
  const balance = database.prepare('SELECT COALESCE(SUM(amount), 0) AS balance FROM token_transactions WHERE user_id = ?').get(session.userId).balance;
  const alreadyOwned = database.prepare('SELECT 1 FROM reward_redemptions WHERE user_id = ? AND reward_id = ?').get(session.userId, reward.id);
  if (alreadyOwned && reward.id !== 'kindness-boost' && reward.id !== 'habit-swap' && reward.id !== 'mystery-box' && reward.id !== 'xp-booster' && reward.id !== 'grace-day') return response.status(409).json({ ok: false, message: 'This reward has already been redeemed.' });
  if (balance < reward.tokenCost) return response.status(409).json({ ok: false, message: 'You do not have enough tokens.' });
  database.transaction(() => {
    const now = Date.now();
    database.prepare('INSERT INTO reward_redemptions (id, user_id, reward_id, token_cost, redeemed_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.userId, reward.id, reward.tokenCost, now);
    database.prepare('INSERT INTO token_transactions (id, user_id, amount, label, transaction_date, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.userId, -reward.tokenCost, `Redeemed ${reward.name}`, new Date(now).toISOString(), now);
  })();
  response.json({ ok: true, tokens: balance - reward.tokenCost });
});

app.delete('/api/auth/account', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) return;

  const input = parseRequest(accountDeletionSchema, request, response);
  if (!input) return;

  const user = findUserByEmail(session.email);
  if (!user || !bcrypt.compareSync(input.currentPassword, user.passwordHash)) {
    response.status(401).json({ ok: false, message: 'The current password is incorrect.' });
    return;
  }

  const deleteAccount = database.transaction(() => {
    database.prepare('DELETE FROM password_reset_requests WHERE email = ?').run(user.email);
    database.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  });
  deleteAccount();
  response.json({ ok: true, message: 'Your account and associated data have been permanently deleted.' });
});

app.post('/api/habit/predict', expensiveApiLimiter, async (request, response) => {
  if (!requireAuthentication(request, response)) {
    return;
  }

  const signal = parseRequest(habitPredictionSchema, request, response);
  if (!signal) return;
  const habitName = signal.habit_name || signal.name || '';
  const payload = {
    habit_name: habitName,
    streak: signal.streak ?? 0,
    completion_rate: signal.completion_rate ?? 0,
    missed_days: signal.missed_days ?? 0,
    last_7_days: signal.last_7_days ?? [1, 1, 0, 1, 1, 0, 1],
    average_session_minutes: signal.average_session_minutes,
    priority: signal.priority || 'balanced',
    goal_type: signal.goal_type || 'health',
  };

  if (!habitName) {
    response.status(400).json({ error: 'habit_name is required.' });
    return;
  }

  try {
    const prediction = await predictHabitWithMl(payload);
    response.json(prediction);
  } catch (error) {
    console.error('ML service call failed', error);
    response.status(503).json({ error: 'Live prediction service unavailable.' });
  }
});

app.get('/api/leaderboard', (request, response) => {
  if (!requireAuthentication(request, response)) {
    return;
  }

  const period = String(request.query.period || 'This Week');
  if (!['This Week', 'This Month', 'All Time'].includes(period)) {
    response.status(400).json({ ok: false, message: 'Unsupported leaderboard period.' });
    return;
  }

  const start = period === 'All Time' ? null : getLeaderboardPeriodStart(period);
  let leaders = database.prepare(`
    SELECT users.full_name AS name,
      COUNT(completions.completed_date) * 20 AS points,
      COALESCE(leaderboard.avatar, substr(users.full_name, 1, 1)) AS avatar
    FROM users
    LEFT JOIN habit_completions completions
      ON completions.user_id = users.id
      AND (? IS NULL OR completions.completed_date >= ?)
    LEFT JOIN leaderboard_users leaderboard ON leaderboard.user_id = users.id
    GROUP BY users.id, users.full_name, leaderboard.avatar
    ORDER BY points DESC, users.full_name ASC
  `).all(start, start);

  leaders = leaders.map((user, index) => ({ ...user, rank: index + 1 }));

  response.json({
    period,
    date: period === 'All Time' ? 'Since joining' : period,
    leaders,
  });
});

app.post('/api/leaderboard/sync', (request, response) => {
  const session = requireAuthentication(request, response);
  if (!session) {
    return;
  }

  const input = parseRequest(leaderboardSyncSchema, request, response);
  if (!input) return;
  const safeName = session.fullName;
  const safePoints = calculateServerPoints(session.userId);
  const previous = database.prepare('SELECT points FROM leaderboard_users WHERE user_id = ?').get(session.userId);
  const pointsDelta = previous ? safePoints - previous.points : safePoints;
  const recordedDate = new Date().toISOString().slice(0, 10);

  database.transaction(() => {
    database.prepare(`
      INSERT INTO leaderboard_users (user_id, name, points, avatar) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, points = excluded.points, avatar = excluded.avatar
    `).run(session.userId, safeName, safePoints, input.avatar || safeName.charAt(0) || '?');
    database.prepare('INSERT INTO leaderboard_snapshots (id, user_id, name, points, avatar, recorded_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), session.userId, safeName, safePoints, input.avatar || safeName.charAt(0) || '?', Date.now());
    database.prepare(`
      INSERT INTO leaderboard_daily_points (user_id, recorded_date, points) VALUES (?, ?, ?)
      ON CONFLICT(user_id, recorded_date) DO UPDATE SET points = points + excluded.points
    `).run(session.userId, recordedDate, pointsDelta);
  })();
  response.json({ ok: true });
});

app.post('/api/insights/assistant', expensiveApiLimiter, async (request, response) => {
  if (!requireAuthentication(request, response)) {
    return;
  }

  if (!gemini) {
    response.status(503).json({ error: 'AI service is not configured on the server.' });
    return;
  }

  const input = parseRequest(assistantSchema, request, response);
  if (!input) return;
  const { question, summary } = input;
  const safeSummary = JSON.stringify(summary ?? {}).slice(0, 6000);
  const prompt = `You are a concise habit coach. Use only this user summary: ${safeSummary}. Answer this question in 2-4 helpful sentences: ${String(question || 'What should I focus on next?').slice(0, 500)}`;

  try {
    const answer = z.string().trim().min(1).max(4000).safeParse(await generateGeminiText(prompt, { maxOutputTokens: 180 }));
    if (!answer.success) {
      response.status(502).json({ error: 'The AI service returned an invalid response.' });
      return;
    }
    response.json({ answer: answer.data });
  } catch (error) {
    console.error('Gemini request failed', error);
    response.status(502).json({ error: 'The AI service is temporarily unavailable.' });
  }
});

app.post('/api/goals/generate', expensiveApiLimiter, async (request, response) => {
  if (!requireAuthentication(request, response)) {
    return;
  }

  if (!gemini) {
    response.status(503).json({ error: 'AI service is not configured on the server.' });
    return;
  }

  const input = parseRequest(goalGenerationSchema, request, response);
  if (!input) return;
  const goal = input.goal;
  const focusTarget = input.focusTarget || '4 habits';
  const timeline = input.timeline || '30-60 days';

  const prompt = `Create a practical personal growth plan for this goal: ${goal}
The user prefers a focus of ${focusTarget} and a timeline of ${timeline}. Honor those preferences in the plan.
Return valid JSON only with these keys:
category (one of Career, Health, Finance, Education, Relationships, Personal Growth),
summary (2 concise sentences), intensity (one of High focus, Balanced, Quick win),
focusAreas (exactly 3 short strings),
actionPlan (exactly 4 short actionable strings, each under 70 characters), actionDueDates (exactly 4 dates: today, tomorrow, 3 days from now, and 7 days from now), nextMilestone (one sentence),
risk (one sentence), riskAction (one sentence explaining exactly what to do if that risk happens),
timeline (one of 7-14 days, 30-60 days, 90 days), nextCheckIn (a specific date 7 days from today),
status (Fresh plan). Do not include progress; the app calculates progress from completed steps. Keep every action realistic, specific to the exact goal, and avoid generic advice.`;

  try {
    const completionText = await generateGeminiText(prompt, { json: true, maxOutputTokens: 700 });
    let rawPlan;
    try {
      rawPlan = JSON.parse(completionText);
    } catch {
      response.status(502).json({ error: 'The AI goal planner returned invalid JSON.' });
      return;
    }

    const plan = goalPlanSchema.safeParse(rawPlan);
    if (!plan.success) {
      response.status(502).json({ error: 'The AI goal planner returned an invalid plan.' });
      return;
    }
    response.json({ plan: plan.data });
  } catch (error) {
    console.error('Gemini goal generation failed', error);
    response.status(502).json({ error: 'The AI goal planner is temporarily unavailable.' });
  }
});

if (!process.env.DATABASE_URL?.trim()) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Insights API listening on http://localhost:${port}`);
  });
}
