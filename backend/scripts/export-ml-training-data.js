// Exports anonymized habit outcomes from Neon for ml-service training and holdout evaluation.
//   npm --prefix backend run ml:export -- [--out ../ml-service/data/private] [--holdout 0.2] [--min-users 10]
// Rows carry only the model features and the observed outcome (see services/ml-training-rows.js).
// Users are split between the two files so the holdout is independent from training data.
// The output folder is git-ignored; review the files before setting ML_TRAINING_DATASET_APPROVED.
import crypto from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import '../config/index.js';
import { backendRoot } from '../config/env.js';
import { closeDatabase, query } from '../db/client.js';
import { getDateKeyInTimeZone } from '../services/completion-date.js';
import { buildTrainingRows, toCsv } from '../services/ml-training-rows.js';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const outputDirectory = path.resolve(backendRoot, option('out', '../ml-service/data/private'));
const holdoutShare = Math.min(0.5, Math.max(0.05, Number(option('holdout', '0.2'))));
const minUsers = Math.max(1, Number(option('min-users', '10')));
const today = getDateKeyInTimeZone(new Date(), 'Asia/Manila');

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = crypto.randomInt(index + 1);
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}

try {
  // Only student accounts; faculty/admin test data would skew the outcomes.
  const users = await query("SELECT id FROM users WHERE role = 'user' AND status = 'active'");
  const snapshots = await query(`
    SELECT DISTINCT ON (user_id) user_id AS "userId", state_json AS state
    FROM user_app_state ORDER BY user_id, updated_at DESC
  `);
  const completions = await query('SELECT user_id AS "userId", habit_id AS "habitId", completed_date::text AS date FROM habit_completions');

  const habitsByUser = new Map(snapshots.rows.map((row) => [row.userId, Array.isArray(row.state?.habits) ? row.state.habits : []]));
  const datesByHabit = new Map();
  for (const row of completions.rows) {
    const key = `${row.userId}\u0000${row.habitId}`;
    if (!datesByHabit.has(key)) datesByHabit.set(key, []);
    datesByHabit.get(key).push(row.date);
  }

  const rowsByUser = [];
  for (const { id: userId } of users.rows) {
    const rows = (habitsByUser.get(userId) || []).flatMap((habit) => buildTrainingRows(habit, datesByHabit.get(`${userId}\u0000${habit.id}`), { today }));
    if (rows.length) rowsByUser.push(rows);
  }

  if (rowsByUser.length < minUsers) {
    console.error(`Only ${rowsByUser.length} users have enough history (need ${minUsers}). Collect more real check-ins before training, or lower --min-users for a local dry run.`);
    process.exitCode = 1;
  } else {
    shuffle(rowsByUser);
    const holdoutUsers = Math.max(1, Math.round(rowsByUser.length * holdoutShare));
    const holdout = shuffle(rowsByUser.slice(0, holdoutUsers).flat());
    const training = shuffle(rowsByUser.slice(holdoutUsers).flat());
    mkdirSync(outputDirectory, { recursive: true });
    const stamp = today.replace(/-/g, '');
    const trainingPath = path.join(outputDirectory, `training-${stamp}.csv`);
    const holdoutPath = path.join(outputDirectory, `holdout-${stamp}.csv`);
    writeFileSync(trainingPath, toCsv(training));
    writeFileSync(holdoutPath, toCsv(holdout));
    console.log(`Training rows: ${training.length} from ${rowsByUser.length - holdoutUsers} users -> ${trainingPath}`);
    console.log(`Holdout rows:  ${holdout.length} from ${holdoutUsers} users -> ${holdoutPath}`);
    if (holdout.length < 100) console.log('Note: production approval needs at least 100 holdout rows (ml-service/README.md).');
  }
} finally {
  await closeDatabase();
}
