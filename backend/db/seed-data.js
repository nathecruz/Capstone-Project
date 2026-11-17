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
  ['premium-theme', 'Premium Themes', 200, 'Seven app colour themes: Ocean, Sunset, Forest, Midnight, Rose, Amber and Berry'],
  ['habit-swap', 'Habit Swap Token', 380, 'Swap one habit, keep your streak history'],
  ['mystery-box', 'Mystery Box', 420, 'Open for a random reward'],
  ['xp-booster', 'XP Booster', 500, '+20% points for 3 days'],
  ['grace-day', 'Grace Day', 620, 'Skip logging for a day, streak stays safe'],
  ['custom-title', 'Custom Title', 250, 'Your own title under your name on your profile and the leaderboard'],
  ['profile-frames', 'Profile Frames', 180, 'Eight frames for your photo: Gold, Neon, Leaf, Fire, Aqua, Galaxy, Blossom and Royal'],
  ['buddy-showcase', 'Buddy Showcase', 300, 'Show your Habi, with what it wears, next to your name on the leaderboard'],
  // Rewards that help with school, work and health (services/rewards.js keeps their names and prices).
  ['study-planner', 'AI Study & Work Planner', 30, 'Turn an exam, a project or any big task into a day-by-day plan you can follow'],
  ['practice-quiz', 'AI Practice Quiz', 15, 'Five questions on a topic you are studying, with the answers explained'],
  ['weekly-report', 'AI Weekly Report', 25, 'A review of your last 7 days: what went well, what slipped, and a plan for the week ahead'],
  ['certificate', 'Certificate of Achievement', 100, 'A certificate of your check-ins and streak, with a link anyone can open to check it'],
  ['wellness-pack', 'Wellness Pack', 120, 'Four guided breaks to use any time: box breathing, a desk stretch, an eye break and a mindful minute'],
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
