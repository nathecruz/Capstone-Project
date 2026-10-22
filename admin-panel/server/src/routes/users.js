import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query, queryIfTable, withTransaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { activeUntilOf, currentHabitSql, hasHabitEnded } from '../lib/habit-week.js';
import { HttpError, validate } from '../lib/http.js';
import { addDays, dateRange, habitFirstDay, habitFrequency, mondayOf, todayInZone } from '../lib/metrics.js';
import { generatePassword, hashPassword, passwordProblem } from '../lib/passwords.js';
import { ROLES, ROLE_LABELS, STAFF_ROLES } from '../lib/permissions.js';
import { loadLiveStreaks } from '../lib/streaks.js';
import { joinName, namesFromRow } from '../lib/names.js';
import { byKindOrder, FLAG_LIMITS, FLAG_WINDOW_DAYS, KINDS_OUTSIDE_BIG_DAY, tokenFlags, tokenKind, tokenKindSql } from '../lib/token-kinds.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();
const canView = requirePermission('users:view');
const canManage = requirePermission('users:manage');

const username = z.string().trim().min(2).max(30).regex(/^[a-zA-Z0-9_.-]+$/, 'Username may only contain letters, numbers, dots, dashes and underscores.');
const profileFields = {
  firstName: z.string().trim().min(1, 'Enter the first name.').max(60),
  lastName: z.string().trim().min(1, 'Enter the last name.').max(60),
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
    ...namesFromRow(row),
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
  const today = todayInZone(config.timeZone);

  const [list, summary] = await Promise.all([
    query(
      `SELECT u.id, u.full_name AS "fullName", u.first_name AS "firstName", u.last_name AS "lastName", u.username, u.email, u.role, u.status,
              u.status_reason AS "statusReason", u.created_at AS "createdAt", u.gender, u.region,
              u.date_of_birth AS "dateOfBirth",
              GREATEST(
                (SELECT (extract(epoch FROM max(la.login_date_time)) * 1000)::bigint FROM login_activity la WHERE la.user_id = u.id),
                (SELECT max(s.updated_at) FROM user_app_state s WHERE s.user_id = u.id)
              ) AS last_active,
              (SELECT count(*)::int FROM habits h WHERE h.user_id = u.id AND ${currentHabitSql('h', '$6')}) AS "habitCount",
              (SELECT count(*)::int FROM habit_completions c WHERE c.user_id = u.id) AS "completionCount",
              count(*) OVER ()::int AS total
         FROM users u
        WHERE ($1 = '' OR u.full_name ILIKE $1 OR u.email ILIKE $1 OR u.username ILIKE $1)
          AND ($2 = 'all' OR u.role = $2)
          AND ($3 = 'all' OR u.status = $3)
        ORDER BY ${SORT_SQL[input.sort]}, u.id
        LIMIT $4 OFFSET $5`,
      [search, input.role, input.status, input.pageSize, offset, today],
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

// Tokens -------------------------------------------------------------------------------------
// Read-only views of the ledger the app backend writes: no price editing or token adjustments here.

const HISTORY_PAGE = 30;
// SQL: the epoch milliseconds at which a day starts in a time zone.
const dayStartMs = (dayParam, tzParam) => `extract(epoch FROM (${dayParam}::date::timestamp AT TIME ZONE ${tzParam})) * 1000`;

/**
 * Students whose last 14 Manila days look like farming (lib/token-kinds.js tokenFlags): a day over
 * 150 tokens without streak, refund and weekly-bonus payouts, a day over the paid check-ins, a week
 * with more than 12 habits starting, or 15 or more gifts sent. Names are shown, so administrators only.
 */
router.get('/token-flags', canView, async (_request, response) => {
  const tz = config.timeZone;
  const today = todayInZone(tz);
  const from = addDays(today, -(FLAG_WINDOW_DAYS - 1));

  const [tokenDays, checkInDays, habits, gifts] = await Promise.all([
    query(
      `SELECT t.user_id AS "userId", (to_timestamp(t.created_at / 1000.0) AT TIME ZONE $2)::date AS day, sum(t.amount)::int AS count
         FROM token_transactions t JOIN users u ON u.id = t.user_id AND u.role = 'user'
        WHERE t.created_at >= ${dayStartMs('$1', '$2')} AND t.amount > 0 AND ${tokenKindSql('t')} <> ALL($3::text[])
        GROUP BY 1, 2 HAVING sum(t.amount) > $4`,
      [from, tz, KINDS_OUTSIDE_BIG_DAY, FLAG_LIMITS.dayTokens],
    ),
    query(
      `SELECT hc.user_id AS "userId", hc.completed_date AS day, count(*)::int AS count
         FROM habit_completions hc JOIN users u ON u.id = hc.user_id AND u.role = 'user'
        WHERE hc.completed_date >= $1::date
        GROUP BY 1, 2 HAVING count(*) > $2`,
      [from, FLAG_LIMITS.dayCheckIns],
    ),
    query(`SELECT h.id, h.user_id AS "userId", h.start_date FROM habits h JOIN users u ON u.id = h.user_id AND u.role = 'user'`),
    queryIfTable(
      'buddy_gifts',
      `SELECT g.sender_id AS "userId", count(*)::int AS count
         FROM buddy_gifts g JOIN users u ON u.id = g.sender_id AND u.role = 'user'
        WHERE g.created_at >= ${dayStartMs('$1', '$2')}
        GROUP BY 1 HAVING count(*) >= $3`,
      [from, tz, FLAG_LIMITS.giftsSent],
      [],
    ),
  ]);

  const facts = new Map();
  const factsOf = (userId) => {
    if (!facts.has(userId)) facts.set(userId, { tokenDays: [], checkInDays: [], habitWeeks: [], giftsSent: 0 });
    return facts.get(userId);
  };
  for (const row of tokenDays.rows) factsOf(row.userId).tokenDays.push({ day: row.day, count: row.count });
  for (const row of checkInDays.rows) factsOf(row.userId).checkInDays.push({ day: row.day, count: row.count });
  for (const row of gifts.rows) factsOf(row.userId).giftsSent = row.count;
  // A habit starts on its first day (the later of its start date and the day it was made).
  const weeksByUser = new Map();
  for (const habit of habits.rows) {
    const firstDay = habitFirstDay(habit, tz);
    if (!firstDay || firstDay < from || firstDay > today) continue;
    if (!weeksByUser.has(habit.userId)) weeksByUser.set(habit.userId, new Map());
    const weeks = weeksByUser.get(habit.userId);
    const week = mondayOf(firstDay);
    weeks.set(week, (weeks.get(week) ?? 0) + 1);
  }
  for (const [userId, weeks] of weeksByUser) {
    for (const [weekStart, count] of weeks) if (count > FLAG_LIMITS.weekHabits) factsOf(userId).habitWeeks.push({ weekStart, count });
  }

  const flagged = new Map([...facts].map(([userId, fact]) => [userId, tokenFlags(fact)]).filter(([, flags]) => flags.length));
  const names = flagged.size
    ? await query('SELECT id, full_name AS "fullName", first_name AS "firstName", last_name AS "lastName", email FROM users WHERE id = ANY($1::text[])', [[...flagged.keys()]])
    : { rows: [] };
  const items = names.rows
    .map((user) => ({ userId: user.id, name: namesFromRow(user).fullName || user.email, flags: flagged.get(user.id) }))
    .sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name));
  response.json({ ok: true, from, to: today, limits: FLAG_LIMITS, items });
});

async function loadUser(id, runner = { query }) {
  const { rows } = await runner.query(
    `SELECT id, full_name AS "fullName", first_name AS "firstName", last_name AS "lastName", username, email, role, status, status_reason AS "statusReason",
            status_changed_at AS "statusChangedAt", created_at AS "createdAt", date_of_birth AS "dateOfBirth",
            gender, region, about
       FROM users WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'User not found.');
  return rows[0];
}

/**
 * A student's habits for the detail page. The habits they track now come first and are the ones
 * counted (`habitCount`, `bestStreak`); habits whose week ended stay listed as history, most recent
 * first, with the streak they had on their last day.
 */
export function userHabits(rows, liveStreaks, userId, today) {
  const current = rows.filter((habit) => !hasHabitEnded(habit, today));
  const ended = rows.filter((habit) => hasHabitEnded(habit, today)).sort((a, b) => b.active_until.localeCompare(a.active_until));
  return {
    habitCount: current.length,
    totalHabitCount: rows.length,
    bestStreak: Math.max(0, ...current.map((habit) => liveStreaks.get(habit.id) ?? 0)),
    habits: [...current, ...ended].map((habit) => {
      const { active_until: _activeUntil, ...fields } = habit;
      return {
        ...fields,
        id: habit.id.replace(`${userId}:habit:`, ''),
        streak: liveStreaks.get(habit.id) ?? 0,
        frequency: habitFrequency(habit.meta),
        activeUntil: activeUntilOf(habit),
        ended: hasHabitEnded(habit, today),
      };
    }),
  };
}

router.get('/:id', canView, async (request, response) => {
  const user = await loadUser(request.params.id);
  const today = todayInZone(config.timeZone);
  const start = addDays(today, -29);

  const [habits, stats, logins, daily, achievements] = await Promise.all([
    query(
      `SELECT h.id, h.label, h.category, h.meta, h.streak, h.active_until, h.reminder_enabled AS "reminderEnabled", h.reminder_time AS "reminderTime",
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
  const { habits: habitList, ...habitStats } = userHabits(habits.rows, liveStreaks, user.id, today);
  response.json({
    ok: true,
    user: { ...serializeUser(user), about: user.about ?? '' },
    stats: { ...stats.rows[0], ...habitStats },
    habits: habitList,
    loginHistory: logins.rows,
    dailyCompletions: dateRange(start, today).map((day) => ({ day, completions: byDay.get(day) ?? 0 })),
    achievements: achievements.rows,
  });
});

/** The opaque cursor of a ledger page that ends at `row`: the next page starts after it. */
export function historyCursor(row) {
  return Buffer.from(JSON.stringify([Number(row.createdAt), String(row.id)])).toString('base64url');
}

/** The row ({ createdAt, id }) a cursor points at, or null when historyCursor did not make it. */
export function readHistoryCursor(cursor) {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    return Number.isSafeInteger(createdAt) && typeof id === 'string' && id ? { createdAt, id } : null;
  } catch {
    return null;
  }
}

/**
 * A Habi item's name: from the label of the spend that bought it ("Buddy: Cozy room", "Buddy:
 * Umbrella (weekly drop)"), else from its id ('sun-hat' is "Sun hat", the drop 'drop-mango' "Mango").
 */
export function buddyItemName(id, label) {
  const bought = /^Buddy:\s*(.+?)(?:\s+\(weekly drop\))?$/.exec(String(label ?? ''));
  if (bought) return bought[1];
  const words = String(id).replace(/^drop-/, '').split('-').filter(Boolean).join(' ');
  return words ? words[0].toUpperCase() + words.slice(1) : String(id);
}

// A cursor carries a whole ledger id, and check-in ids hold the habit id the app chose.
const tokensSchema = z.object({ before: z.string().trim().max(2000).optional() });

/**
 * A student's tokens for the detail page: earned, spent, the balance and sums by kind; what they
 * own (rewards on sale, Habi items and Weekly Drops, streak freezes held and used); their treat
 * gifts; and one page of the ledger, newest first (`before` is the nextCursor of the page before).
 */
router.get('/:id/tokens', canView, async (request, response) => {
  const { before } = validate(tokensSchema, request.query);
  const after = before ? readHistoryCursor(before) : null;
  if (before && !after) throw new HttpError(400, 'This page of the token history is not available.');
  const user = await loadUser(request.params.id);
  const values = [user.id];
  // Newest first, by time and then id (byte order), so rows of the same millisecond keep their place across pages.
  const older = after ? ' AND created_at <= $2 AND (created_at < $2 OR id COLLATE "C" < $3)' : '';
  if (after) values.push(after.createdAt, after.id);
  values.push(HISTORY_PAGE + 1);

  const [kinds, rewards, items, freezes, gifts, page] = await Promise.all([
    query(
      `SELECT ${tokenKindSql('t')} AS kind,
              COALESCE(sum(t.amount) FILTER (WHERE t.amount > 0), 0)::int AS earned,
              COALESCE(-sum(t.amount) FILTER (WHERE t.amount < 0), 0)::int AS spent
         FROM token_transactions t WHERE t.user_id = $1 GROUP BY 1`,
      [user.id],
    ),
    // Retired rewards were refunded, so only the rewards on sale are owned.
    query(
      `SELECT r.name FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id
        WHERE rr.user_id = $1 AND r.active GROUP BY r.id, r.name ORDER BY min(rr.redeemed_at)`,
      [user.id],
    ),
    // An item and the spend that bought it share their time.
    query(
      `SELECT b.item_id AS id, b.bought_at AS "boughtAt",
              (SELECT t.label FROM token_transactions t
                WHERE t.user_id = b.user_id AND t.created_at = b.bought_at AND t.amount < 0 AND t.label LIKE 'Buddy:%' LIMIT 1) AS label
         FROM buddy_items b WHERE b.user_id = $1 ORDER BY b.bought_at, b.item_id`,
      [user.id],
    ),
    query(
      `SELECT COALESCE((SELECT available FROM user_streak_freezes WHERE user_id = $1), 0)::int AS held,
              (SELECT count(*)::int FROM streak_freeze_days WHERE user_id = $1) AS used`,
      [user.id],
    ),
    queryIfTable(
      'buddy_gifts',
      `SELECT count(*) FILTER (WHERE sender_id = $1)::int AS sent, count(*) FILTER (WHERE recipient_id = $1)::int AS received
         FROM buddy_gifts WHERE sender_id = $1 OR recipient_id = $1`,
      [user.id],
      [{ sent: 0, received: 0 }],
    ),
    query(
      `SELECT id, amount, label, created_at AS "createdAt" FROM token_transactions
        WHERE user_id = $1${older}
        ORDER BY created_at DESC, id COLLATE "C" DESC LIMIT $${values.length}`,
      values,
    ),
  ]);

  const byKind = byKindOrder(kinds.rows);
  const earned = byKind.reduce((sum, row) => sum + row.earned, 0);
  const spent = byKind.reduce((sum, row) => sum + row.spent, 0);
  const owned = items.rows.map((item) => ({ id: item.id, name: buddyItemName(item.id, item.label), boughtAt: item.boughtAt }));
  const rows = page.rows.slice(0, HISTORY_PAGE);
  response.json({
    ok: true,
    balance: earned - spent,
    earned,
    spent,
    byKind,
    rewards: rewards.rows.map((row) => row.name),
    buddyItems: owned.filter((item) => !item.id.startsWith('drop-')),
    dropsOwned: owned.filter((item) => item.id.startsWith('drop-')),
    freezesHeld: freezes.rows[0].held,
    freezesUsed: freezes.rows[0].used,
    giftsSent: gifts.rows[0].sent,
    giftsReceived: gifts.rows[0].received,
    history: {
      items: rows.map((row) => ({
        id: String(row.id).replace(`${user.id}:token:`, ''),
        amount: Number(row.amount),
        kind: tokenKind(row.id, row.label),
        label: row.label,
        createdAt: Number(row.createdAt),
      })),
      nextCursor: page.rows.length > HISTORY_PAGE ? historyCursor(rows.at(-1)) : null,
    },
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
  const fullName = joinName(input.firstName, input.lastName);
  const problem = passwordProblem(password, { ...input, fullName });
  if (problem) throw new HttpError(400, problem);

  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO users (id, full_name, username, email, date_of_birth, gender, region, about, password_hash, created_at, role, status, is_admin, status_changed_at, email_verified_at, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '', $8, $9, $10, 'active', $11, $9, $9, $12, $13)`,
      [id, fullName, input.username, input.email, input.dateOfBirth, input.gender, input.region, hash, Date.now(), input.role, input.role === 'admin', input.firstName, input.lastName],
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
      'UPDATE users SET full_name = $1, username = $2, email = $3, date_of_birth = $4, gender = $5, region = $6, first_name = $8, last_name = $9 WHERE id = $7',
      [joinName(input.firstName, input.lastName), input.username, input.email, input.dateOfBirth, input.gender, input.region, before.id, input.firstName, input.lastName],
    );
    const beforeNames = namesFromRow(before);
    const changed = Object.keys(input).filter((key) => ((key in beforeNames ? beforeNames[key] : before[key]) ?? '') !== input[key]);
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
