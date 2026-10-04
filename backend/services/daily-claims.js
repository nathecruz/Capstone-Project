// Daily claim: a reward for opening HabitAI each day, once a day, on a 7-day calendar. The reward
// grows each day in a row (day 7 is the biggest) and the calendar starts again after day 7 or
// after a day without a claim. The server decides the day and pays the tokens.

/** Tokens for days 1 to 7 of the calendar. */
export const DAILY_CLAIM_REWARDS = [2, 3, 4, 5, 6, 8, 15];

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const claimTokenId = (userId, date) => `${userId}:token:daily-claim:${date}`;

/**
 * The calendar for `date` (the student's today): the day of the calendar to claim (or claimed)
 * today, whether today is claimed, and the reward for each day.
 */
export async function getDailyClaim(db, userId, date) {
  const last = (await db.query(
    'SELECT claim_date::text AS date, cycle_day AS "cycleDay" FROM daily_claims WHERE user_id=$1 AND claim_date <= $2::date ORDER BY claim_date DESC LIMIT 1',
    [userId, date],
  )).rows[0];
  const claimedToday = last?.date === date;
  let day = 1;
  if (claimedToday) day = Number(last.cycleDay);
  else if (last?.date === shiftDay(date, -1)) day = (Number(last.cycleDay) % DAILY_CLAIM_REWARDS.length) + 1;
  return {
    date,
    day,
    claimedToday,
    amount: DAILY_CLAIM_REWARDS[day - 1],
    rewards: DAILY_CLAIM_REWARDS,
  };
}

/**
 * Claims today's reward. Returns the calendar with { alreadyClaimed } when today was claimed
 * before. Call inside a transaction that locked the user row.
 */
export async function claimDaily(db, userId, date, now = Date.now()) {
  const calendar = await getDailyClaim(db, userId, date);
  if (calendar.claimedToday) return { ...calendar, alreadyClaimed: true };
  await db.query(
    'INSERT INTO daily_claims(user_id,claim_date,cycle_day,amount,claimed_at) VALUES($1,$2,$3,$4,$5)',
    [userId, date, calendar.day, calendar.amount, now],
  );
  await db.query(
    'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
    [claimTokenId(userId, date), userId, calendar.amount, `Daily claim: day ${calendar.day}`, new Date(now).toISOString(), now],
  );
  return { ...calendar, claimedToday: true, alreadyClaimed: false };
}
