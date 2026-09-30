import { query } from '../db/client.js';
import { dateKeyInZone } from './ai-context.js';

// Engagement analytics count "active days"; the calendar follows the school's time zone.
const ACTIVITY_TIME_ZONE = process.env.APP_TIME_ZONE?.trim() || 'Asia/Manila';
const recorded = new Map();

/** Marks that the student used the app today. At most one write per user per day per server process. */
export async function recordActivity(userId) {
  const today = dateKeyInZone(new Date(), ACTIVITY_TIME_ZONE);
  if (recorded.get(userId) === today) return;
  recorded.set(userId, today);
  if (recorded.size > 10_000) recorded.clear();
  try {
    await query('INSERT INTO user_activity_days(user_id, activity_date) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, today]);
  } catch (error) {
    recorded.delete(userId);
    console.warn(`[activity] could not record activity: ${error?.message}`);
  }
}

/** Keeps the day-level history of older app-state snapshots before they are pruned. */
export async function backfillActivityFromSnapshots(timeZone = ACTIVITY_TIME_ZONE) {
  await query(
    `INSERT INTO user_activity_days(user_id, activity_date)
     SELECT DISTINCT user_id, (to_timestamp(updated_at / 1000.0) AT TIME ZONE $1)::date FROM user_app_state
     UNION
     SELECT DISTINCT user_id, (login_date_time AT TIME ZONE $1)::date FROM login_activity
     ON CONFLICT DO NOTHING`,
    [timeZone],
  );
}
