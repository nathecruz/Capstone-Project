import crypto from 'node:crypto';
import { query, withTransaction } from '../db/client.js';
import { getPeriodStart, parse } from '../lib/http.js';
import { leaderboardSchema, rewardRedemptionSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { serverCompletionPoints } from '../services/app-state-store.js';

// Rewards that can only be redeemed once per account.
const PERMANENT_REWARDS = new Set(['plant-buddy', 'premium-theme', 'custom-title']);

export default function registerGamificationRoutes(app) {
  app.post('/api/rewards/redeem', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(rewardRedemptionSchema, request, response);
    if (!input) return;
    const reward = (await query('SELECT id,name,token_cost AS "tokenCost" FROM rewards WHERE id=$1', [input.rewardId])).rows[0];
    if (!reward || reward.name !== input.rewardName || Number(reward.tokenCost) !== input.tokenCost) return response.status(400).json({ ok: false, message: 'This reward is not available.' });

    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const balance = Number((await db.query('SELECT COALESCE(SUM(amount),0) AS balance FROM token_transactions WHERE user_id=$1', [session.userId])).rows[0].balance);
      if (PERMANENT_REWARDS.has(reward.id) && (await db.query('SELECT 1 FROM reward_redemptions WHERE user_id=$1 AND reward_id=$2 LIMIT 1', [session.userId, reward.id])).rowCount) {
        return { status: 409, body: { ok: false, message: 'This reward has already been redeemed.' } };
      }
      if (balance < input.tokenCost) return { status: 409, body: { ok: false, message: 'You do not have enough tokens.' } };
      const now = Date.now();
      await db.query('INSERT INTO reward_redemptions(id,user_id,reward_id,token_cost,redeemed_at) VALUES($1,$2,$3,$4,$5)', [crypto.randomUUID(), session.userId, reward.id, input.tokenCost, now]);
      await db.query('INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), session.userId, -input.tokenCost, `Redeemed ${reward.name}`, new Date(now).toISOString(), now]);
      return { status: 200, body: { ok: true, tokens: balance - input.tokenCost } };
    });
    response.status(result.status).json(result.body);
  });

  // Points come from recorded check-ins (20 each); students only, staff accounts are excluded.
  app.get('/api/leaderboard', async (request, response) => {
    if (!(await requireAuth(request, response))) return;
    const period = String(request.query.period || 'This Week');
    if (!['This Week', 'This Month', 'All Time'].includes(period)) return response.status(400).json({ ok: false, message: 'Unsupported leaderboard period.' });
    const start = period === 'All Time' ? null : getPeriodStart(period);
    const result = await query(
      `SELECT u.full_name AS name, (COUNT(c.completed_date)::integer * 20) AS points, COALESCE(l.avatar, LEFT(u.full_name, 1)) AS avatar
         FROM users u
         LEFT JOIN habit_completions c ON c.user_id=u.id AND ($1::date IS NULL OR c.completed_date >= $1::date)
         LEFT JOIN leaderboard_users l ON l.user_id=u.id
        WHERE u.role = 'user' AND u.status = 'active'
        GROUP BY u.id,u.full_name,l.avatar
        ORDER BY points DESC,u.full_name ASC`,
      [start],
    );
    response.json({ period, date: period === 'All Time' ? 'Since joining' : period, leaders: result.rows.map((user, index) => ({ ...user, rank: index + 1 })) });
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
