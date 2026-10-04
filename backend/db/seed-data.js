export const achievementSeeds = [
  ['first-habit', 'First Habit', 'Created your first habit.'],
  ['habit-builder', 'Habit Builder', 'Created at least three habits.'],
  ['early-bird', 'Early Bird', 'Set a morning reminder.'],
  ['focus-master', 'Focus Master', 'Completed a Mind habit.'],
  ['streak-week', 'Seven-Day Streak', 'Reached a seven-day streak.'],
];

export const rewardSeeds = [
  ['plant-buddy', 'Plant Buddy', 200, 'Profile decoration'],
  ['kindness-boost', 'Kindness Boost', 250, 'Send encouragement to a friend'],
  ['premium-theme', 'Premium Themes', 200, 'Four app colour themes: Ocean, Sunset, Forest and Midnight'],
  ['habit-swap', 'Habit Swap Token', 380, 'Swap one habit, keep your streak history'],
  ['mystery-box', 'Mystery Box', 420, 'Open for a random reward'],
  ['xp-booster', 'XP Booster', 500, '+20% points for 3 days'],
  ['grace-day', 'Grace Day', 620, 'Skip logging for a day, streak stays safe'],
  ['custom-title', 'Custom Title', 250, 'Your own title under your name on your profile and the leaderboard'],
  ['profile-frames', 'Profile Frames', 180, 'Four frames for your photo: Gold, Neon, Leaf and Fire'],
];

export async function seedCatalog(connection) {
  for (const achievement of achievementSeeds) {
    await connection.query(
      'INSERT INTO achievements(id,name,description) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      achievement,
    );
  }
  for (const reward of rewardSeeds) {
    await connection.query(
      'INSERT INTO rewards(id,name,token_cost,description) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      reward,
    );
  }
}
