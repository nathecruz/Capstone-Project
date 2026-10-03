import crypto from 'node:crypto';
import { query, withTransaction } from '../db/client.js';
import { leaderboardName } from '../lib/display.js';
import { namesFromRow } from '../lib/names.js';
import { getPeriodStart, parse } from '../lib/http.js';
import { leaderboardSchema, rewardRedemptionSchema, rewardTitleSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { refreshSnapshot, serverCompletionPoints } from '../services/app-state-store.js';
import { cleanTitle, getRewards, PERMANENT_REWARDS } from '../services/rewards.js';
import { getWallet, POINTS_PER_CHECK_IN, spendTokens } from '../services/wallet.js';

/** First name and last initial; accounts from before the name split fall back to splitting full_name. */
function displayName(row) {
  const { firstName, lastName } = namesFromRow(row);
  return leaderboardName(firstName, lastName);
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

  app.post('/api/rewards/redeem', async (request, response) => {
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
      const spent = await spendTokens(db, session.userId, Number(reward.tokenCost), `Redeemed ${reward.name}`, now);
      if (!spent.ok) return { status: 409, body: { ok: false, message: 'You do not have enough tokens.' } };
      await db.query('INSERT INTO reward_redemptions(id,user_id,reward_id,token_cost,redeemed_at) VALUES($1,$2,$3,$4,$5)', [crypto.randomUUID(), session.userId, reward.id, reward.tokenCost, now]);
      const refreshed = await refreshSnapshot(session.userId, db);
      const wallet = await getWallet(db, session.userId);
      return { status: 200, body: { ok: true, tokens: wallet.tokens, tokenHistory: wallet.tokenHistory, points: wallet.points, updatedAt: refreshed?.updatedAt ?? null } };
    });
    response.status(result.status).json(result.body);
  });

  // Points come from recorded check-ins (20 each); students only, staff accounts are excluded.
  // Students who turned off "Show me on leaderboards" are hidden from everyone but themselves.
  app.get('/api/leaderboard', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const period = String(request.query.period || 'This Week');
    if (!['This Week', 'This Month', 'All Time'].includes(period)) return response.status(400).json({ ok: false, message: 'Unsupported leaderboard period.' });
    const start = period === 'All Time' ? null : getPeriodStart(period);
    const result = await query(
      `SELECT u.id, u.full_name AS "fullName", u.first_name AS "firstName", u.last_name AS "lastName", u.custom_title AS "title", (COUNT(c.completed_date)::integer * $3) AS points, COALESCE(l.avatar, LEFT(u.full_name, 1)) AS avatar
         FROM users u
         LEFT JOIN habit_completions c ON c.user_id=u.id AND ($1::date IS NULL OR c.completed_date >= $1::date)
         LEFT JOIN leaderboard_users l ON l.user_id=u.id
         LEFT JOIN user_preferences p ON p.user_id=u.id
        WHERE u.role = 'user' AND u.status = 'active'
          AND (u.id = $2 OR (p.preferences_json->'showOnLeaderboard') IS DISTINCT FROM 'false'::jsonb)
        GROUP BY u.id,u.full_name,u.first_name,u.last_name,u.custom_title,l.avatar
        ORDER BY points DESC,u.full_name ASC`,
      [start, session.userId, POINTS_PER_CHECK_IN],
    );
    response.json({
      period,
      date: period === 'All Time' ? 'Since joining' : period,
      leaders: result.rows.map((row, index) => ({
        rank: index + 1,
        name: `${displayName(row)}${row.id === session.userId ? ' (You)' : ''}`,
        points: row.points,
        avatar: row.avatar,
        title: row.title || '',
        isYou: row.id === session.userId,
      })),
    });
  });

  app.post('/api/leaderboard/sync', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(leaderboardSchema, request, response);
    if (!input) return;
    const safeName = session.fullName;
    const safePoints = await serverCompletionPoints(session.userId);
    const previous = await query('SELECT points FROM leaderboard_users WHERE user_id=$1', [session.userId]);
    const oldPoints = previous.rows[0]?.points || 0;
    const avatar = input.avatar || safeName.charAt(0) || '?';
    await withTransaction(async (db) => {
      await db.query('INSERT INTO leaderboard_users(user_id,name,points,avatar) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,points=excluded.points,avatar=excluded.avatar', [session.userId, safeName, safePoints, avatar]);
      await db.query('INSERT INTO leaderboard_snapshots(id,user_id,name,points,avatar,recorded_at) VALUES($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), session.userId, safeName, safePoints, avatar, Date.now()]);
      await db.query('INSERT INTO leaderboard_daily_points(user_id,recorded_date,points) VALUES($1,$2,$3) ON CONFLICT(user_id,recorded_date) DO UPDATE SET points=leaderboard_daily_points.points + excluded.points', [session.userId, new Date().toISOString().slice(0, 10), safePoints - oldPoints]);
    });
    response.json({ ok: true, points: safePoints });
  });
}
