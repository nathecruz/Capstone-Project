// The daily mystery box: after the first check-in of the day it can be opened once for a random
// number of tokens, chosen here on the server.
import crypto from 'node:crypto';

/** [tokens, weight]: small amounts are common, 20 is rare. */
export const MYSTERY_REWARDS = [[3, 40], [5, 30], [8, 18], [12, 9], [20, 3]];

/** A reward drawn by weight; `roll` is in [0, total weight). */
export function pickMysteryReward(roll) {
  let left = roll;
  for (const [amount, weight] of MYSTERY_REWARDS) {
    if (left < weight) return amount;
    left -= weight;
  }
  return MYSTERY_REWARDS[0][0];
}

const boxId = (userId, date) => `${userId}:token:mystery:${date}`;
const totalWeight = MYSTERY_REWARDS.reduce((sum, [, weight]) => sum + weight, 0);

/**
 * Opens the box for `date` (the user's today). Returns { amount, alreadyOpened } or { locked: true }
 * when nothing was checked in that day. Call inside a transaction that locked the user row.
 */
export async function openMysteryBox(db, userId, date, now = Date.now(), roll = () => crypto.randomInt(totalWeight)) {
  const opened = await db.query('SELECT amount FROM token_transactions WHERE id=$1', [boxId(userId, date)]);
  if (opened.rowCount) return { amount: Number(opened.rows[0].amount), alreadyOpened: true };
  const checkedIn = await db.query('SELECT 1 FROM habit_completions WHERE user_id=$1 AND completed_date=$2 LIMIT 1', [userId, date]);
  if (!checkedIn.rowCount) return { locked: true };
  const amount = pickMysteryReward(roll());
  await db.query(
    'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [boxId(userId, date), userId, amount, 'Mystery box', new Date(now).toISOString(), now],
  );
  return { amount, alreadyOpened: false };
}
