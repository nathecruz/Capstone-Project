// Token rewards, all sold in the app's Rewards Shop. Most of them help with school, work or health:
// the AI Study & Work Planner, the AI Practice Quiz, the AI Weekly Report and the Certificate of
// Achievement are made when they are redeemed (services/reward-tools.js; the tokens come back when
// one cannot be made), and the Wellness Pack unlocks guided breaks for good. The looks are Premium
// Themes (app colour themes), a Custom Title shown on the profile and the leaderboard, Profile
// Frames, and the Buddy Showcase (the student's Habi next to their name on the leaderboard;
// students only, as faculty are not on it). Rewards that only took tokens (or doubled other
// features) were retired and what students paid for them was refunded.

export const RETIRED_REWARDS = ['plant-buddy', 'kindness-boost', 'habit-swap', 'mystery-box', 'xp-booster', 'grace-day'];

// In the order the AI help assistant names them (services/token-guide.js economyGuide).
export const REAL_REWARDS = {
  'study-planner': { name: 'AI Study & Work Planner', cost: 30, description: 'Turn an exam, a project or any big task into a day-by-day plan you can follow' },
  'practice-quiz': { name: 'AI Practice Quiz', cost: 15, description: 'Five questions on a topic you are studying, with the answers explained' },
  'weekly-report': { name: 'AI Weekly Report', cost: 25, description: 'A review of your last 7 days: what went well, what slipped, and a plan for the week ahead' },
  'certificate': { name: 'Certificate of Achievement', cost: 100, description: 'A certificate of your check-ins and streak, with a link anyone can open to check it' },
  'wellness-pack': { name: 'Wellness Pack', cost: 120, description: 'Four guided breaks to use any time: box breathing, a desk stretch, an eye break and a mindful minute' },
  'premium-theme': { name: 'Premium Themes', cost: 200, description: 'Seven app colour themes: Ocean, Sunset, Forest, Midnight, Rose, Amber and Berry' },
  'profile-frames': { name: 'Profile Frames', cost: 180, description: 'Eight frames for your photo: Gold, Neon, Leaf, Fire, Aqua, Galaxy, Blossom and Royal' },
  'custom-title': { name: 'Custom Title', cost: 250, description: 'Your own title under your name on your profile and the leaderboard' },
  'buddy-showcase': { name: 'Buddy Showcase', cost: 300, description: 'Show your Habi, with what it wears, next to your name on the leaderboard' },
};

/** The frames the Profile Frames reward unlocks ('' is no frame). */
export const PROFILE_FRAMES = ['gold', 'neon', 'leaf', 'fire', 'aqua', 'galaxy', 'blossom', 'royal'];

/** Rewards made when they are redeemed (services/reward-tools.js), each time anew: POST /api/rewards/use. */
export const MADE_REWARDS = new Set(['study-planner', 'practice-quiz', 'weekly-report', 'certificate']);

/** Rewards bought once and kept: POST /api/rewards/redeem. */
export const PERMANENT_REWARDS = new Set(Object.keys(REAL_REWARDS).filter((id) => !MADE_REWARDS.has(id)));

/** Rewards only students can use: the Buddy Showcase shows on the student leaderboard, which has no faculty. */
export const STUDENT_REWARDS = new Set(['buddy-showcase']);

/** What a reward does for faculty, where it differs: they teach, and they are not on the leaderboard. */
const FACULTY_DESCRIPTIONS = {
  'custom-title': 'Your own title under your name on your profile',
  'study-planner': 'Turn grading, lesson preparation, research or any big task into a day-by-day plan',
  'practice-quiz': 'Five questions on a lesson topic, with the answers explained, to use in class',
};

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

/**
 * The rewards on sale to this account (for `faculty`, without the students' own), the permanent ones
 * it owns, its title and its frame.
 */
export async function getRewards(db, userId, { faculty = false } = {}) {
  const [rewards, owned, user] = await Promise.all([
    db.query('SELECT id, name, token_cost AS "cost", description FROM rewards WHERE active ORDER BY token_cost, id'),
    db.query('SELECT DISTINCT reward_id AS "rewardId" FROM reward_redemptions WHERE user_id=$1', [userId]),
    db.query('SELECT custom_title AS "title", profile_frame AS "frame" FROM users WHERE id=$1', [userId]),
  ]);
  return {
    rewards: rewards.rows.filter((row) => !(faculty && STUDENT_REWARDS.has(row.id))).map((row) => ({
      ...row,
      ...(faculty && FACULTY_DESCRIPTIONS[row.id] ? { description: FACULTY_DESCRIPTIONS[row.id] } : {}),
      cost: Number(row.cost),
      permanent: PERMANENT_REWARDS.has(row.id),
      // Made each time it is redeemed (an AI plan, a quiz, a report or a certificate).
      ...(MADE_REWARDS.has(row.id) ? { made: true } : {}),
    })),
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
