import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, validate } from '../lib/http.js';
import { addDays, dateRange, habitFrequency, todayInZone } from '../lib/metrics.js';
import { generatePassword, hashPassword, passwordProblem } from '../lib/passwords.js';
import { ROLES, ROLE_LABELS, STAFF_ROLES } from '../lib/permissions.js';
import { loadLiveStreaks } from '../lib/streaks.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();
const canView = requirePermission('users:view');
const canManage = requirePermission('users:manage');

const username = z.string().trim().min(2).max(30).regex(/^[a-zA-Z0-9_.-]+$/, 'Username may only contain letters, numbers, dots, dashes and underscores.');
const profileFields = {
  fullName: z.string().trim().min(2).max(100),
  username,
  email: z.string().trim().toLowerCase().email().max(254),
  dateOfBirth: z.string().trim().max(40).default(''),
  gender: z.string().trim().max(40).default(''),
  region: z.string().trim().max(80).default(''),
};

const listSchema = z.object({
  search: z.string().trim().max(100).default(''),
  role: z.enum(['all', ...ROLES]).default('all'),
  status: z.enum(['all', 'active', 'deactivated']).default('all'),
  sort: z.enum(['newest', 'oldest', 'name', 'last_active']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

const SORT_SQL = {
  newest: 'u.created_at DESC',
  oldest: 'u.created_at ASC',
  name: 'LOWER(u.full_name) ASC',
  last_active: 'last_active DESC NULLS LAST',
};

function likePattern(value) {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function serializeUser(row) {
  return {
    id: row.id,
    fullName: row.fullName,
    username: row.username,
    email: row.email,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] ?? row.role,
    status: row.status,
    statusReason: row.statusReason ?? '',
    statusChangedAt: row.statusChangedAt ?? null,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActive ?? null,
    habitCount: row.habitCount ?? 0,
    completionCount: row.completionCount ?? 0,
    gender: row.gender ?? '',
    region: row.region ?? '',
    dateOfBirth: row.dateOfBirth ?? '',
  };
}

router.get('/', canView, async (request, response) => {
  const input = validate(listSchema, request.query);
  const offset = (input.page - 1) * input.pageSize;
  const search = input.search ? likePattern(input.search) : '';

  const [list, summary] = await Promise.all([
    query(
      `SELECT u.id, u.full_name AS "fullName", u.username, u.email, u.role, u.status,
              u.status_reason AS "statusReason", u.created_at AS "createdAt", u.gender, u.region,
              u.date_of_birth AS "dateOfBirth",
              GREATEST(
                (SELECT (extract(epoch FROM max(la.login_date_time)) * 1000)::bigint FROM login_activity la WHERE la.user_id = u.id),
                (SELECT max(s.updated_at) FROM user_app_state s WHERE s.user_id = u.id)
              ) AS last_active,
              (SELECT count(*)::int FROM habits h WHERE h.user_id = u.id) AS "habitCount",
              (SELECT count(*)::int FROM habit_completions c WHERE c.user_id = u.id) AS "completionCount",
              count(*) OVER ()::int AS total
         FROM users u
        WHERE ($1 = '' OR u.full_name ILIKE $1 OR u.email ILIKE $1 OR u.username ILIKE $1)
          AND ($2 = 'all' OR u.role = $2)
          AND ($3 = 'all' OR u.status = $3)
        ORDER BY ${SORT_SQL[input.sort]}, u.id
        LIMIT $4 OFFSET $5`,
      [search, input.role, input.status, input.pageSize, offset],
    ),
    query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status = 'deactivated')::int AS deactivated,
              count(*) FILTER (WHERE role = 'user')::int AS students,
              count(*) FILTER (WHERE role = 'faculty')::int AS faculty,
              count(*) FILTER (WHERE role = 'admin')::int AS admins
         FROM users`,
    ),
  ]);

  response.json({
    ok: true,
    items: list.rows.map((row) => serializeUser({ ...row, lastActive: row.last_active })),
    total: list.rows[0]?.total ?? 0,
    page: input.page,
    pageSize: input.pageSize,
    summary: summary.rows[0],
  });
});

async function loadUser(id, runner = { query }) {
  const { rows } = await runner.query(
    `SELECT id, full_name AS "fullName", username, email, role, status, status_reason AS "statusReason",
            status_changed_at AS "statusChangedAt", created_at AS "createdAt", date_of_birth AS "dateOfBirth",
            gender, region, about
       FROM users WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'User not found.');
  return rows[0];
}

router.get('/:id', canView, async (request, response) => {
  const user = await loadUser(request.params.id);
  const today = todayInZone(config.timeZone);
  const start = addDays(today, -29);

  const [habits, stats, logins, daily, achievements] = await Promise.all([
    query(
      `SELECT h.id, h.label, h.category, h.meta, h.streak, h.reminder_enabled AS "reminderEnabled", h.reminder_time AS "reminderTime",
              (SELECT count(*)::int FROM habit_completions c WHERE c.user_id = h.user_id AND h.id = h.user_id || ':habit:' || c.habit_id) AS completions,
              (SELECT max(c.completed_date) FROM habit_completions c WHERE c.user_id = h.user_id AND h.id = h.user_id || ':habit:' || c.habit_id) AS "lastCompleted"
         FROM habits h WHERE h.user_id = $1 ORDER BY h.sort_order, h.id`,
      [user.id],
    ),
    query(
      `SELECT
         (SELECT count(*)::int FROM habit_completions WHERE user_id = $1) AS "completionCount",
         (SELECT count(*)::int FROM habit_completions WHERE user_id = $1 AND completed_date >= $2::date) AS "completions30d",
         (SELECT COALESCE(max(streak), 0)::int FROM habits WHERE user_id = $1) AS "bestStreak",
         (SELECT count(*)::int FROM goals WHERE user_id = $1) AS "goalCount",
         (SELECT COALESCE(round(avg(progress)), 0)::int FROM goals WHERE user_id = $1) AS "goalAvgProgress",
         (SELECT COALESCE(sum(amount), 0)::int FROM token_transactions WHERE user_id = $1) AS "tokenBalance",
         (SELECT count(*)::int FROM sessions WHERE user_id = $1 AND expires_at > $3) AS "appSessions",
         (SELECT count(*)::int FROM web_push_subscriptions WHERE user_id = $1) AS "pushDevices",
         (SELECT count(*)::int FROM issue_reports WHERE user_id = $1) AS "issueReports",
         (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL) AS "unreadNotifications",
         GREATEST(
           (SELECT (extract(epoch FROM max(login_date_time)) * 1000)::bigint FROM login_activity WHERE user_id = $1),
           (SELECT max(updated_at) FROM user_app_state WHERE user_id = $1)
         ) AS "lastActiveAt"`,
      [user.id, start, Date.now()],
    ),
    query('SELECT device, login_date_time AS "loginAt" FROM login_activity WHERE user_id = $1 ORDER BY login_date_time DESC LIMIT 10', [user.id]),
    query(
      `SELECT completed_date AS day, count(*)::int AS completions
         FROM habit_completions WHERE user_id = $1 AND completed_date >= $2::date
        GROUP BY completed_date`,
      [user.id, start],
    ),
    query(
      `SELECT a.name, a.description, ua.earned_at AS "earnedAt"
         FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id
        WHERE ua.user_id = $1 ORDER BY ua.earned_at DESC`,
      [user.id],
    ),
  ]);

  const byDay = new Map(daily.rows.map((row) => [row.day, row.completions]));
  const liveStreaks = await loadLiveStreaks(config.timeZone, user.id);
  const bestStreak = Math.max(0, ...habits.rows.map((habit) => liveStreaks.get(habit.id) ?? 0));
  response.json({
    ok: true,
    user: { ...serializeUser(user), about: user.about ?? '' },
    stats: { ...stats.rows[0], bestStreak, habitCount: habits.rowCount },
    habits: habits.rows.map((habit) => ({
      ...habit,
      streak: liveStreaks.get(habit.id) ?? 0,
      id: habit.id.replace(`${user.id}:habit:`, ''),
      frequency: habitFrequency(habit.meta),
    })),
    loginHistory: logins.rows,
    dailyCompletions: dateRange(start, today).map((day) => ({ day, completions: byDay.get(day) ?? 0 })),
    achievements: achievements.rows,
  });
});

async function assertUnique(email, usernameValue, exceptId = null) {
  const { rows } = await query(
    `SELECT email, username FROM users
      WHERE (email = $1 OR (username <> '' AND lower(username) = lower($2))) AND ($3::text IS NULL OR id <> $3)`,
    [email, usernameValue, exceptId],
  );
  if (rows.some((row) => row.email === email)) throw new HttpError(409, 'An account with this email already exists.');
  if (rows.length) throw new HttpError(409, 'This username is already in use.');
}

const createSchema = z.object({
  ...profileFields,
  role: z.enum(ROLES).default('user'),
  password: z.string().max(128).optional().default(''),
}).strict();

router.post('/', canManage, async (request, response) => {
  const input = validate(createSchema, request.body);
  await assertUnique(input.email, input.username);

  const generated = !input.password;
  const password = input.password || generatePassword();
  const problem = passwordProblem(password, input);
  if (problem) throw new HttpError(400, problem);

  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO users (id, full_name, username, email, date_of_birth, gender, region, about, password_hash, created_at, role, status, is_admin, status_changed_at, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '', $8, $9, $10, 'active', $11, $9, $9)`,
      [id, input.fullName, input.username, input.email, input.dateOfBirth, input.gender, input.region, hash, Date.now(), input.role, input.role === 'admin'],
    );
    await audit(request, {
      action: 'user.created',
      targetType: 'user',
      targetId: id,
      summary: `Created ${ROLE_LABELS[input.role]} account ${input.email}`,
      details: { email: input.email, role: input.role },
    }, client);
  });

  const user = await loadUser(id);
  response.status(201).json({ ok: true, user: serializeUser(user), temporaryPassword: generated ? password : undefined });
});

const updateSchema = z.object(profileFields).strict();

router.patch('/:id', canManage, async (request, response) => {
  const input = validate(updateSchema, request.body);
  const before = await loadUser(request.params.id);
  await assertUnique(input.email, input.username, before.id);

  await withTransaction(async (client) => {
    await client.query(
      'UPDATE users SET full_name = $1, username = $2, email = $3, date_of_birth = $4, gender = $5, region = $6 WHERE id = $7',
      [input.fullName, input.username, input.email, input.dateOfBirth, input.gender, input.region, before.id],
    );
    const changed = Object.keys(input).filter((key) => (before[key] ?? '') !== input[key]);
    await audit(request, {
      action: 'user.updated',
      targetType: 'user',
      targetId: before.id,
      summary: `Updated profile of ${input.email}`,
      details: { changed },
    }, client);
  });
  response.json({ ok: true, user: serializeUser(await loadUser(before.id)) });
});

async function assertAnotherActiveAdmin(client, userId) {
  const { rows } = await client.query("SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1", [userId]);
  if (rows[0].count === 0) throw new HttpError(409, 'At least one active System Administrator must remain.');
}

const roleSchema = z.object({ role: z.enum(ROLES) }).strict();

router.patch('/:id/role', canManage, async (request, response) => {
  const { role } = validate(roleSchema, request.body);
  if (request.params.id === request.admin.id) throw new HttpError(409, 'You cannot change your own role.');

  await withTransaction(async (client) => {
    await client.query('SELECT id FROM users WHERE role = $1 FOR UPDATE', ['admin']);
    const user = await loadUser(request.params.id, client);
    if (user.role === role) return;
    if (user.role === 'admin' && user.status === 'active') await assertAnotherActiveAdmin(client, user.id);
    await client.query('UPDATE users SET role = $1, is_admin = $2 WHERE id = $3', [role, role === 'admin', user.id]);
    if (!STAFF_ROLES.includes(role)) await client.query('DELETE FROM admin_sessions WHERE user_id = $1', [user.id]);
    await audit(request, {
      action: 'user.role_changed',
      targetType: 'user',
      targetId: user.id,
      summary: `Changed ${user.email} from ${ROLE_LABELS[user.role]} to ${ROLE_LABELS[role]}`,
      details: { from: user.role, to: role },
    }, client);
  });
  response.json({ ok: true, user: serializeUser(await loadUser(request.params.id)) });
});

const statusSchema = z.object({
  status: z.enum(['active', 'deactivated']),
  reason: z.string().trim().max(300).default(''),
}).strict();

router.patch('/:id/status', canManage, async (request, response) => {
  const input = validate(statusSchema, request.body);
  if (request.params.id === request.admin.id) throw new HttpError(409, 'You cannot change the status of your own account.');

  await withTransaction(async (client) => {
    await client.query('SELECT id FROM users WHERE role = $1 FOR UPDATE', ['admin']);
    const user = await loadUser(request.params.id, client);
    if (user.status === input.status) return;
    if (input.status === 'deactivated' && user.role === 'admin') await assertAnotherActiveAdmin(client, user.id);

    await client.query(
      'UPDATE users SET status = $1, status_reason = $2, status_changed_at = $3 WHERE id = $4',
      [input.status, input.status === 'deactivated' ? input.reason : '', Date.now(), user.id],
    );
    if (input.status === 'deactivated') {
      // Sign the account out everywhere; the app backend also refuses new logins.
      await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      await client.query('DELETE FROM admin_sessions WHERE user_id = $1', [user.id]);
    }
    await audit(request, {
      action: input.status === 'deactivated' ? 'user.deactivated' : 'user.reactivated',
      targetType: 'user',
      targetId: user.id,
      summary: `${input.status === 'deactivated' ? 'Deactivated' : 'Reactivated'} ${user.email}`,
      details: { reason: input.reason },
    }, client);
  });
  response.json({ ok: true, user: serializeUser(await loadUser(request.params.id)) });
});

const resetSchema = z.object({ password: z.string().max(128).optional().default('') }).strict();

router.post('/:id/reset-password', canManage, async (request, response) => {
  const input = validate(resetSchema, request.body);
  const user = await loadUser(request.params.id);
  const generated = !input.password;
  const password = input.password || generatePassword();
  const problem = passwordProblem(password, user);
  if (problem) throw new HttpError(400, problem);
  const hash = await hashPassword(password);

  await withTransaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    await client.query('DELETE FROM password_reset_requests WHERE email = $1', [user.email]);
    if (user.id !== request.admin.id) await client.query('DELETE FROM admin_sessions WHERE user_id = $1', [user.id]);
    await audit(request, { action: 'user.password_reset', targetType: 'user', targetId: user.id, summary: `Reset password for ${user.email}` }, client);
  });
  response.json({ ok: true, temporaryPassword: generated ? password : undefined });
});

router.post('/:id/revoke-sessions', canManage, async (request, response) => {
  const user = await loadUser(request.params.id);
  const result = await withTransaction(async (client) => {
    const app = await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    const admin = await client.query('DELETE FROM admin_sessions WHERE user_id = $1 AND token_hash <> $2', [user.id, request.admin.sessionHash]);
    await audit(request, {
      action: 'user.sessions_revoked',
      targetType: 'user',
      targetId: user.id,
      summary: `Signed ${user.email} out of all devices`,
      details: { appSessions: app.rowCount, adminSessions: admin.rowCount },
    }, client);
    return app.rowCount + admin.rowCount;
  });
  response.json({ ok: true, revoked: result });
});

const deleteSchema = z.object({ confirmEmail: z.string().trim().toLowerCase() }).strict();

router.delete('/:id', canManage, async (request, response) => {
  const { confirmEmail } = validate(deleteSchema, request.body);
  if (request.params.id === request.admin.id) throw new HttpError(409, 'You cannot delete your own account.');

  await withTransaction(async (client) => {
    await client.query('SELECT id FROM users WHERE role = $1 FOR UPDATE', ['admin']);
    const user = await loadUser(request.params.id, client);
    if (confirmEmail !== user.email) throw new HttpError(400, 'The confirmation email does not match this account.');
    if (user.role === 'admin' && user.status === 'active') await assertAnotherActiveAdmin(client, user.id);
    await client.query('DELETE FROM users WHERE id = $1', [user.id]);
    await audit(request, {
      action: 'user.deleted',
      targetType: 'user',
      targetId: user.id,
      summary: `Permanently deleted ${user.email}`,
      details: { email: user.email, role: user.role },
    }, client);
  });
  response.json({ ok: true });
});

export default router;
