// Server-side token ledger and points. Every token change is a row in
// token_transactions written by the server; the app only displays the result.
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { runAll } from '../db/run-all.js';

export const POINTS_PER_CHECK_IN = 20;
export const TOKENS_PER_CHECK_IN = 5;
// Tokens are paid for this many check-ins a day; from CHECK_IN_CAP_FROM a day also counts at most
// this many toward points, the leaderboard and Habi's growth (config.checkIns).
export const PAID_CHECK_INS_PER_DAY = config.checkIns.paidPerDay;
export const CHECK_IN_CAP_FROM = config.checkIns.cappedFrom;
export const COACH_TOKEN_COST = 10;
export const DAILY_CHALLENGE_BONUS = 10;
const HISTORY_LIMIT = 100;

// Bonus tokens for reaching an account streak milestone (days in a row with a check-in, across all
// habits and weeks: services/account-streak.js). Awarded once per run of the streak and milestone,
// so an undo-and-recheck never pays twice. Keep this in sync with the app's copy
// (frontend/utils/engagement.ts STREAK_MILESTONE_BONUS) so the celebration shows the right amount.
export const STREAK_MILESTONE_BONUS = { 7: 15, 14: 25, 30: 50, 50: 80, 100: 150, 200: 300, 365: 500 };

const checkInId = (userId, habitId, date) => `${userId}:token:check-in:${habitId}:${date}`;
// A run is known by the day it started. (Bonuses paid per habit before weekly habits were
// `${userId}:token:streak:${habitId}:${milestone}`.)
const streakBonusId = (userId, runStart, milestone) => `${userId}:token:streak:account:${runStart}:${milestone}`;
// For LIKE patterns: an id's own % or _ must not act as a wildcard.
const escapeLike = (value) => String(value).replace(/[\\%_]/g, '\\$&');

/** The milestones a streak crossed going from `before` to `after` (before < m <= after). */
export function crossedStreakMilestones(before, after) {
  return Object.keys(STREAK_MILESTONE_BONUS).map(Number).filter((milestone) => before < milestone && milestone <= after);
}

/** The check-ins paid on `date` (their +5 rows in the ledger). */
export async function paidCheckIns(db, userId, date) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count FROM token_transactions WHERE user_id=$1 AND id LIKE $2 ESCAPE '\\'`,
    [userId, `${escapeLike(userId)}:token:check-in:%:${date}`],
  );
  return result.rows[0].count;
}

/**
 * +5 tokens for a check-in, for the first PAID_CHECK_INS_PER_DAY check-ins of the day; idempotent
 * per habit and day. Later check-ins are kept (they count for streaks, challenges and quests) but
 * pay nothing. Returns { paid, paidToday }. Call inside a transaction that locked the user row, so
 * the count cannot race.
 */
export async function awardCheckIn(db, userId, habitId, date, habitLabel, now = Date.now()) {
  const paidToday = await paidCheckIns(db, userId, date);
  if (paidToday >= PAID_CHECK_INS_PER_DAY) return { paid: false, paidToday };
  const inserted = await db.query(
    'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id',
    [checkInId(userId, habitId, date), userId, TOKENS_PER_CHECK_IN, `Completed ${habitLabel || 'habit'}`, new Date(now).toISOString(), now],
  );
  return { paid: inserted.rowCount > 0, paidToday: paidToday + inserted.rowCount };
}

/**
 * Takes back the tokens of an undone check-in: its +5 row, when it was paid. An undo is only
 * possible right after a check-in made under the server ledger, so there is nothing else to take
 * back (a check-in over the daily cap has no row).
 */
export async function revokeCheckIn(db, userId, habitId, date) {
  await db.query('DELETE FROM token_transactions WHERE id=$1', [checkInId(userId, habitId, date)]);
}

/** A day's check-ins as they count toward points: at most PAID_CHECK_INS_PER_DAY from CHECK_IN_CAP_FROM on. */
export function countedOnDay(date, checkIns) {
  return date >= CHECK_IN_CAP_FROM ? Math.min(checkIns, PAID_CHECK_INS_PER_DAY) : checkIns;
}

/**
 * The same rule in SQL, for `days` rows of a day column and its check-in count (the values come
 * from validated config, so they are safe in the query text).
 */
export const countedDaySql = (dayColumn, countColumn) => `CASE WHEN ${dayColumn} >= '${CHECK_IN_CAP_FROM}'::date THEN LEAST(${countColumn}, ${PAID_CHECK_INS_PER_DAY}) ELSE ${countColumn} END`;

/**
 * Check-ins that count toward points (countedOnDay), between `from` and `to` (YYYY-MM-DD, both
 * optional). Points, the leaderboard and Habi's growth all use it, so they agree.
 */
export async function countedCheckIns(db, userId, { from = null, to = null } = {}) {
  const result = await db.query(
    `SELECT COALESCE(SUM(${countedDaySql('d', 'n')}), 0)::int AS count FROM (
       SELECT completed_date AS d, COUNT(*)::int AS n FROM habit_completions
        WHERE user_id=$1 AND ($2::date IS NULL OR completed_date >= $2::date) AND ($3::date IS NULL OR completed_date <= $3::date)
        GROUP BY completed_date) days`,
    [userId, from, to],
  );
  return result.rows[0].count;
}

/**
 * Awards bonus tokens for account streak milestones newly crossed by a check-in. `before` and
 * `after` are the streak runs ({ streak, start }, services/account-streak.js) without and with it;
 * a milestone m is crossed when before.streak < m <= after.streak. Idempotent per run and
 * milestone. Returns the total tokens awarded.
 */
export async function awardAccountStreakMilestones(db, userId, before, after, now = Date.now()) {
  let awarded = 0;
  for (const milestone of crossedStreakMilestones(before.streak, after.streak)) {
    const bonus = STREAK_MILESTONE_BONUS[milestone];
    const inserted = await db.query(
      'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id',
      [streakBonusId(userId, after.start, milestone), userId, bonus, `${milestone}-day streak`, new Date(now).toISOString(), now],
    );
    if (inserted.rowCount) awarded += bonus;
  }
  return awarded;
}

export async function tokenBalance(db, userId) {
  const result = await db.query('SELECT COALESCE(SUM(amount),0)::int AS balance FROM token_transactions WHERE user_id=$1', [userId]);
  return result.rows[0].balance;
}

/**
 * Spends tokens if the balance allows, as a row `${userId}:token:spend:<kind>:<uuid>` (kind: reward,
 * buddy-item, buddy-treat, gift, freeze or coach). Returns { ok, balance, id }. Call inside a
 * transaction that locked the user row.
 */
export async function spendTokens(db, userId, amount, label, { kind, now = Date.now() } = {}) {
  const balance = await tokenBalance(db, userId);
  if (balance < amount) return { ok: false, balance };
  const id = `${userId}:token:spend:${kind}:${crypto.randomUUID()}`;
  await db.query(
    'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [id, userId, -amount, label, new Date(now).toISOString(), now],
  );
  return { ok: true, balance: balance - amount, id };
}

/** Gives back the tokens of an AI Coach answer that never came, once per charge (`spendId` from spendTokens). */
export async function refundCoachAnswer(db, userId, spendId, now = Date.now()) {
  await db.query(
    'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
    [`${userId}:token:refund:coach:${String(spendId).split(':').at(-1)}`, userId, COACH_TOKEN_COST, 'Refund: AI Coach was unavailable', new Date(now).toISOString(), now],
  );
}

/** Points, token balance and recent token history exactly as the server records them. */
export async function getWallet(db, userId) {
  const [balance, history, points] = await runAll(db, [
    () => tokenBalance(db, userId),
    () => db.query(
      `SELECT id, amount, label, transaction_date AS date, created_at AS "createdAt"
         FROM token_transactions WHERE user_id=$1
        ORDER BY transaction_date DESC, created_at DESC LIMIT $2`,
      [userId, HISTORY_LIMIT],
    ),
    () => countedCheckIns(db, userId),
  ]);
  return {
    tokens: Math.max(0, balance),
    points: points * POINTS_PER_CHECK_IN,
    tokenHistory: history.rows.map((row) => ({
      id: String(row.id).replace(`${userId}:token:`, ''),
      amount: Number(row.amount),
      label: row.label,
      date: row.date || new Date(Number(row.createdAt)).toISOString(),
    })),
  };
}

export function applyWallet(state, wallet) {
  return { ...state, points: wallet.points, tokens: wallet.tokens, tokenHistory: wallet.tokenHistory };
}
