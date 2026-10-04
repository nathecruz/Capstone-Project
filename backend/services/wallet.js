// Server-side token ledger and points. Every token change is a row in
// token_transactions written by the server; the app only displays the result.
import crypto from 'node:crypto';
import { runAll } from '../db/run-all.js';

export const POINTS_PER_CHECK_IN = 20;
export const TOKENS_PER_CHECK_IN = 5;
export const COACH_TOKEN_COST = 10;
export const DAILY_CHALLENGE_BONUS = 10;
const HISTORY_LIMIT = 100;

const checkInId = (userId, habitId, date) => `${userId}:token:check-in:${habitId}:${date}`;

/** +5 tokens for a check-in; idempotent per habit and day. */
export async function awardCheckIn(db, userId, habitId, date, habitLabel, now = Date.now()) {
  await db.query(
    'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
    [checkInId(userId, habitId, date), userId, TOKENS_PER_CHECK_IN, `Completed ${habitLabel || 'habit'}`, new Date(now).toISOString(), now],
  );
}

/** Takes back the tokens of an undone check-in. */
export async function revokeCheckIn(db, userId, habitId, date, habitLabel, now = Date.now()) {
  const removed = await db.query('DELETE FROM token_transactions WHERE id=$1', [checkInId(userId, habitId, date)]);
  if (removed.rowCount) return;
  // Check-ins from before the server ledger have no matching row: record the reversal instead.
  await db.query(
    'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [`${userId}:token:undo:${habitId}:${date}:${now}`, userId, -TOKENS_PER_CHECK_IN, `Undid ${habitLabel || 'habit'}`, new Date(now).toISOString(), now],
  );
}

export async function tokenBalance(db, userId) {
  const result = await db.query('SELECT COALESCE(SUM(amount),0)::int AS balance FROM token_transactions WHERE user_id=$1', [userId]);
  return result.rows[0].balance;
}

/** Spends tokens if the balance allows. Call inside a transaction that locked the user row. */
export async function spendTokens(db, userId, amount, label, now = Date.now()) {
  const balance = await tokenBalance(db, userId);
  if (balance < amount) return { ok: false, balance };
  await db.query(
    'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [crypto.randomUUID(), userId, -amount, label, new Date(now).toISOString(), now],
  );
  return { ok: true, balance: balance - amount };
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
    () => db.query('SELECT COUNT(*)::int AS checkins FROM habit_completions WHERE user_id=$1', [userId]),
  ]);
  return {
    tokens: Math.max(0, balance),
    points: points.rows[0].checkins * POINTS_PER_CHECK_IN,
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
