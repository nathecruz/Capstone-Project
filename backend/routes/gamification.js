import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { query, withTransaction } from '../db/client.js';
import { walletLimiter } from '../http/rate-limits.js';
import { leaderboardName } from '../lib/display.js';
import { namesFromRow } from '../lib/names.js';
import { getPeriodRange, parse, periodLabel, periodResetsAt } from '../lib/http.js';
import { leaderboardSchema, rewardFrameSchema, rewardRedemptionSchema, rewardTitleSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { refreshSnapshot, serverCompletionPoints } from '../services/app-state-store.js';
import { cleanTitle, getRewards, PERMANENT_REWARDS, PROFILE_FRAMES } from '../services/rewards.js';
import { countedDaySql, getWallet, POINTS_PER_CHECK_IN, spendTokens } from '../services/wallet.js';

/** First name and last initial; accounts from before the name split fall back to splitting full_name. */
function displayName(row) {
  const { firstName, lastName } = namesFromRow(row);
  return leaderboardName(firstName, lastName);
}

/**
 * The board for `range` ({ start, end } or null for all time): students only, staff accounts are
 * excluded, and students who turned off "Show me on leaderboards" are hidden from everyone but
 * themselves. Points are 20 for each counted check-in (at most 6 a day, services/wallet.js) dated
 * inside the range; one dated after its end never counts. Ties go by name, then by public id, so
 * two students with the same name and points keep their ranks between loads.
 */
export async function leaderboardRows(db, userId, range) {
  const result = await db.query(
    `WITH days AS (
       SELECT user_id, completed_date AS d, COUNT(*)::int AS n FROM habit_completions
        WHERE ($1::date IS NULL OR completed_date >= $1::date) AND ($2::date IS NULL OR completed_date <= $2::date)
        GROUP BY user_id, completed_date
     ), counted AS (
       SELECT user_id, SUM(${countedDaySql('d', 'n')})::int AS checkins FROM days GROUP BY user_id
     )
     SELECT u.id, u.public_id AS "publicId", u.full_name AS "fullName", u.first_name AS "firstName", u.last_name AS "lastName", u.custom_title AS "title", u.profile_frame AS "frame",
            (COALESCE(k.checkins, 0) * $4)::int AS points, COALESCE(l.avatar, LEFT(u.full_name, 1)) AS avatar
       FROM users u
       LEFT JOIN counted k ON k.user_id=u.id
       LEFT JOIN leaderboard_users l ON l.user_id=u.id
       LEFT JOIN user_preferences p ON p.user_id=u.id
      WHERE u.role = 'user' AND u.status = 'active'
        AND (u.id = $3 OR (p.preferences_json->'showOnLeaderboard') IS DISTINCT FROM 'false'::jsonb)
      ORDER BY points DESC, u.full_name ASC, u.public_id`,
    [range?.start ?? null, range?.end ?? null, userId, POINTS_PER_CHECK_IN],
  );
  return result.rows;
}

/**
 * One row of the board as the app gets it. `id` is the student's public id, never the internal
 * one. canGift and buddy are filled in by the treat gifts and the Buddy Showcase.
 */
function leaderRow(row, index, userId) {
  const isYou = row.id === userId;
  return {
    id: row.publicId,
    rank: index + 1,
    name: `${displayName(row)}${isYou ? ' (You)' : ''}`,
    points: row.points,
    avatar: row.avatar,
    title: row.title || '',
    frame: row.frame || '',
    isYou,
    canGift: false,
    buddy: null,
  };
}

export default function registerGamificationRoutes(app) {
  // What is on sale, what this student owns (Premium Themes, Custom Title) and their title.
  app.get('/api/rewards', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    response.json({ ok: true, ...await getRewards({ query }, session.userId) });
  });

  // Sets (or clears, with '') the title shown under the student's name; needs the Custom Title reward.
  app.put('/api/rewards/title', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(rewardTitleSchema, request, response);
    if (!input) return;
    const owned = (await query("SELECT 1 FROM reward_redemptions WHERE user_id=$1 AND reward_id='custom-title' LIMIT 1", [session.userId])).rowCount;
    if (!owned) return response.status(403).json({ ok: false, message: 'Redeem the Custom Title reward first.' });
    const title = cleanTitle(input.title);
    if (title === null) return response.status(400).json({ ok: false, message: 'Use 2 to 24 letters, numbers, spaces or simple punctuation.' });
    await query('UPDATE users SET custom_title=$2 WHERE id=$1', [session.userId, title]);
    response.json({ ok: true, title });
  });

  // Chooses (or takes off, with '') the frame around the student's photo; needs Profile Frames.
  app.put('/api/rewards/frame', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(rewardFrameSchema, request, response);
    if (!input) return;
    if (input.frame && !PROFILE_FRAMES.includes(input.frame)) return response.status(400).json({ ok: false, message: 'That frame does not exist.' });
    const owned = (await query("SELECT 1 FROM reward_redemptions WHERE user_id=$1 AND reward_id='profile-frames' LIMIT 1", [session.userId])).rowCount;
    if (!owned) return response.status(403).json({ ok: false, message: 'Redeem the Profile Frames reward first.' });
    await query('UPDATE users SET profile_frame=$2 WHERE id=$1', [session.userId, input.frame]);
    response.json({ ok: true, frame: input.frame });
  });

  app.post('/api/rewards/redeem', walletLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(rewardRedemptionSchema, request, response);
    if (!input) return;
    const reward = (await query('SELECT id,name,token_cost AS "tokenCost" FROM rewards WHERE id=$1 AND active', [input.rewardId])).rows[0];
    if (!reward || reward.name !== input.rewardName || Number(reward.tokenCost) !== input.tokenCost) return response.status(400).json({ ok: false, message: 'This reward is not available.' });

    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      if (PERMANENT_REWARDS.has(reward.id) && (await db.query('SELECT 1 FROM reward_redemptions WHERE user_id=$1 AND reward_id=$2 LIMIT 1', [session.userId, reward.id])).rowCount) {
        return { status: 409, body: { ok: false, message: 'This reward has already been redeemed.' } };
      }
      const now = Date.now();
      const spent = await spendTokens(db, session.userId, Number(reward.tokenCost), `Redeemed ${reward.name}`, { kind: 'reward', now });
      if (!spent.ok) return { status: 409, body: { ok: false, message: 'You do not have enough tokens.' } };
      await db.query('INSERT INTO reward_redemptions(id,user_id,reward_id,token_cost,redeemed_at) VALUES($1,$2,$3,$4,$5)', [crypto.randomUUID(), session.userId, reward.id, reward.tokenCost, now]);
      const refreshed = await refreshSnapshot(session.userId, db);
      const wallet = await getWallet(db, session.userId);
      return { status: 200, body: { ok: true, tokens: wallet.tokens, tokenHistory: wallet.tokenHistory, points: wallet.points, updatedAt: refreshed?.updatedAt ?? null } };
    });
    response.status(result.status).json(result.body);
  });

  // The week and month follow the campus calendar (config.appTimeZone), with when they reset. The
  // app never sends dates: only the period's name.
  app.get('/api/leaderboard', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const period = String(request.query.period || 'This Week');
    if (!['This Week', 'This Month', 'All Time'].includes(period)) return response.status(400).json({ ok: false, message: 'Unsupported leaderboard period.' });
    const range = getPeriodRange(period);
    const rows = await leaderboardRows({ query }, session.userId, range);
    response.json({
      period,
      date: range ? periodLabel(range) : 'Since joining',
      range: range ? { ...range, timeZone: config.appTimeZone, resetsAt: periodResetsAt(range) } : null,
      leaders: rows.map((row, index) => leaderRow(row, index, session.userId)),
    });
  });

  // Keeps the student's leaderboard_users row (name, counted points, avatar) current, and writes
  // nothing when it already is. (It also used to add snapshot and daily-points rows that nothing read.)
  app.post('/api/leaderboard/sync', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(leaderboardSchema, request, response);
    if (!input) return;
    const safeName = session.fullName;
    const safePoints = await serverCompletionPoints(session.userId);
    const avatar = input.avatar || safeName.charAt(0) || '?';
    await query(
      `INSERT INTO leaderboard_users(user_id,name,points,avatar) VALUES($1,$2,$3,$4)
       ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, points=excluded.points, avatar=excluded.avatar
       WHERE (leaderboard_users.name, leaderboard_users.points, leaderboard_users.avatar) IS DISTINCT FROM (excluded.name, excluded.points, excluded.avatar)`,
      [session.userId, safeName, safePoints, avatar],
    );
    response.json({ ok: true, points: safePoints });
  });
}
