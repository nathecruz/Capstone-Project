// Token rewards that do something: Premium Themes (four app colour themes) and a Custom Title shown
// on the profile and the leaderboard. Rewards that only took tokens (or doubled other features)
// were retired and what students paid for them was refunded.

export const RETIRED_REWARDS = ['plant-buddy', 'kindness-boost', 'habit-swap', 'mystery-box', 'xp-booster', 'grace-day'];

export const REAL_REWARDS = {
  'premium-theme': { name: 'Premium Themes', cost: 200, description: 'Four app colour themes: Ocean, Sunset, Forest and Midnight' },
  'custom-title': { name: 'Custom Title', cost: 250, description: 'Your own title under your name on your profile and the leaderboard' },
  'profile-frames': { name: 'Profile Frames', cost: 180, description: 'Four frames for your photo: Gold, Neon, Leaf and Fire' },
};

/** The frames the Profile Frames reward unlocks ('' is no frame). */
export const PROFILE_FRAMES = ['gold', 'neon', 'leaf', 'fire'];

/** Rewards bought once and kept. */
export const PERMANENT_REWARDS = new Set(Object.keys(REAL_REWARDS));

/** Retires the rewards that did nothing and refunds their redemptions (once per redemption). */
export async function retireRewards(db, now = Date.now()) {
  await db.query('UPDATE rewards SET active=false WHERE id = ANY($1::text[])', [RETIRED_REWARDS]);
  for (const [id, reward] of Object.entries(REAL_REWARDS)) {
    await db.query('UPDATE rewards SET name=$2, token_cost=$3, description=$4, active=true WHERE id=$1', [id, reward.name, reward.cost, reward.description]);
  }
  const redemptions = await db.query(
    `SELECT redemption.id, redemption.user_id AS "userId", redemption.token_cost AS "cost", reward.name
       FROM reward_redemptions AS redemption JOIN rewards AS reward ON reward.id = redemption.reward_id
      WHERE redemption.reward_id = ANY($1::text[])`,
    [RETIRED_REWARDS],
  );
  for (const row of redemptions.rows) {
    await db.query(
      'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
      [`${row.userId}:token:refund:${row.id}`, row.userId, Number(row.cost), `Refund: ${row.name} was retired`, new Date(now).toISOString(), now],
    );
  }
  return redemptions.rowCount;
}

/** The rewards on sale, the permanent ones this student owns, their title and their frame. */
export async function getRewards(db, userId) {
  const [rewards, owned, user] = await Promise.all([
    db.query('SELECT id, name, token_cost AS "cost", description FROM rewards WHERE active ORDER BY token_cost, id'),
    db.query('SELECT DISTINCT reward_id AS "rewardId" FROM reward_redemptions WHERE user_id=$1', [userId]),
    db.query('SELECT custom_title AS "title", profile_frame AS "frame" FROM users WHERE id=$1', [userId]),
  ]);
  return {
    rewards: rewards.rows.map((row) => ({ ...row, cost: Number(row.cost), permanent: PERMANENT_REWARDS.has(row.id) })),
    owned: owned.rows.map((row) => row.rewardId).filter((id) => PERMANENT_REWARDS.has(id)),
    title: user.rows[0]?.title ?? '',
    frame: user.rows[0]?.frame ?? '',
  };
}

/** A title that is safe to show to others: 2 to 24 letters, digits, spaces and simple punctuation ('' clears it). */
export function cleanTitle(value) {
  const title = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return '';
  return title.length >= 2 && title.length <= 24 && /^[\p{L}\p{N} .,'!&-]+$/u.test(title) ? title : null;
}
