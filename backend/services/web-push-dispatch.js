// Sends due habit reminders and snoozes over Web Push. Used by the every-minute dispatcher
// (scripts/send-web-push-reminders.js) and by the GitHub Actions scheduler
// (scripts/web-push-scheduler.js). `db` is anything with pg's `query(text, values)`.
import crypto from 'node:crypto';
import { getSmartReminderText } from './smart-reminders.js';
import { getDueHabitReminders, getReminderText, getSnoozeLimit, getWebPushSnoozeSettings, hashWebPushSnoozeToken } from './web-push-reminders.js';

/** The Admin Panel manages the reminder wording; without its table or when disabled, the built-in text is used. */
export async function loadReminderTemplate(db) {
  try {
    const result = await db.query("SELECT title, body FROM notification_templates WHERE id='habit-reminder' AND is_active");
    return result.rows[0] ?? null;
  } catch (error) {
    if (error?.code === '42P01') return null;
    throw error;
  }
}

/** Push subscriptions of active accounts with each account's latest app state. */
export async function loadSubscriptionStates(db) {
  const result = await db.query(`
    SELECT subscription.id AS "subscriptionId",
           subscription.user_id AS "userId",
           subscription.subscription_json AS "subscriptionJson",
           subscription.time_zone AS "timeZone",
           current_state.state_json AS "stateJson"
    FROM web_push_subscriptions AS subscription
    JOIN users AS account ON account.id = subscription.user_id AND account.status <> 'deactivated'
    JOIN LATERAL (
      SELECT state_json
      FROM user_app_state
      WHERE user_id = subscription.user_id
      ORDER BY updated_at DESC
      LIMIT 1
    ) AS current_state ON TRUE
  `);
  return result.rows.map((row) => ({ ...row, state: typeof row.stateJson === 'string' ? JSON.parse(row.stateJson) : (row.stateJson || {}) }));
}

/** Times (epoch ms) of snoozes that are queued but not sent yet, up to `until`. */
export async function pendingSnoozeTimes(db, until) {
  const result = await db.query('SELECT scheduled_at AS "scheduledAt" FROM web_push_snooze_queue WHERE sent_at=0 AND scheduled_at<=$1', [until]);
  return result.rows.map((row) => Number(row.scheduledAt));
}

function makeNotificationId(userId, habitId, date, time) {
  const value = `${userId}\0${habitId}\0${date}\0${time}`;
  return `web-push:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

/** Creates a one-time Snooze token; `followUpAt` is when the snooze would be due if tapped right away. */
async function makeSnoozeAction(db, snoozeUrl, subscriptionId, habitId, snoozeCount, state) {
  if (!snoozeUrl) return null;
  const settings = getWebPushSnoozeSettings(state, habitId, snoozeCount);
  if (!settings || settings.nextSnoozeCount > getSnoozeLimit(state.snoozeFrequency || 'Once')) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  await db.query(`
    INSERT INTO web_push_snooze_tokens(token_hash,subscription_id,habit_id,snooze_count,expires_at,created_at)
    VALUES($1,$2,$3,$4,$5,$6)
  `, [hashWebPushSnoozeToken(token), subscriptionId, habitId, snoozeCount, createdAt + 24 * 60 * 60 * 1000, createdAt]);
  return { action: 'SNOOZE', title: `Snooze ${settings.intervalMinutes} min`, token, url: snoozeUrl, followUpAt: createdAt + settings.intervalMinutes * 60_000 };
}

export async function dispatchDueSnoozes(db, { webpush, template = null, snoozeUrl = null } = {}) {
  const now = Date.now();
  await db.query('DELETE FROM web_push_snooze_tokens WHERE expires_at<$1', [now]);
  await db.query('DELETE FROM web_push_snooze_queue WHERE sent_at>0 AND sent_at<$1', [now - 30 * 24 * 60 * 60 * 1000]);
  const claimed = await db.query(`
    WITH due AS (
      SELECT id FROM web_push_snooze_queue
      WHERE scheduled_at<=$1 AND sent_at=0 AND (attempted_at=0 OR attempted_at<$1-300000)
      ORDER BY scheduled_at LIMIT 100 FOR UPDATE SKIP LOCKED
    )
    UPDATE web_push_snooze_queue AS queue SET attempted_at=$1
    FROM due WHERE queue.id=due.id
    RETURNING queue.id,queue.subscription_id AS "subscriptionId",queue.user_id AS "userId",
              queue.habit_id AS "habitId",queue.snooze_count AS "snoozeCount"
  `, [now]);
  const result = { sent: 0, expired: 0, failed: 0, followUps: [] };

  for (const row of claimed.rows) {
    const subscription = (await db.query(`SELECT s.subscription_json AS "subscriptionJson" FROM web_push_subscriptions s
      JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND u.status <> 'deactivated'`, [row.subscriptionId])).rows[0];
    const appState = (await db.query('SELECT state_json AS "stateJson" FROM user_app_state WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1', [row.userId])).rows[0]?.stateJson;
    if (!subscription || !appState) {
      await db.query('UPDATE web_push_snooze_queue SET sent_at=$2,attempted_at=0 WHERE id=$1', [row.id, now]);
      continue;
    }
    const state = typeof appState === 'string' ? JSON.parse(appState) : appState;
    const settings = getWebPushSnoozeSettings(state, row.habitId, Number(row.snoozeCount) - 1);
    const habit = Array.isArray(state.habits) ? state.habits.find((item) => item.id === row.habitId) : null;
    if (!settings || !habit) {
      await db.query('UPDATE web_push_snooze_queue SET sent_at=$2,attempted_at=0 WHERE id=$1', [row.id, now]);
      continue;
    }
    try {
      const action = await makeSnoozeAction(db, snoozeUrl, row.subscriptionId, row.habitId, Number(row.snoozeCount), state);
      await webpush.sendNotification(subscription.subscriptionJson, JSON.stringify({
        ...getReminderText(habit, template),
        tag: `snooze-${row.id}`,
        soundEnabled: habit.reminderSoundEnabled !== false,
        actions: action ? [{ action: action.action, title: action.title }] : [],
        data: action ? { habitId: row.habitId, type: 'habit-reminder', url: '/', snoozeCount: Number(row.snoozeCount), snoozeToken: action.token, snoozeUrl: action.url } : { habitId: row.habitId, type: 'habit-reminder', url: '/' },
      }), { TTL: 86400 });
      await db.query('UPDATE web_push_snooze_queue SET sent_at=$2,attempted_at=0 WHERE id=$1', [row.id, Date.now()]);
      result.sent += 1;
      if (action) result.followUps.push(action.followUpAt);
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await db.query('DELETE FROM web_push_subscriptions WHERE id=$1', [row.subscriptionId]);
        result.expired += 1;
      } else {
        result.failed += 1;
      }
    }
  }
  return result;
}

/**
 * Sends every reminder due in the last `lookbackMinutes`. Deliveries are claimed in
 * web_push_deliveries, so overlapping or repeated runs never send a reminder twice.
 */
export async function dispatchDueReminders(db, { webpush, template = null, snoozeUrl = null, lookbackMinutes = 5, rows = null } = {}) {
  const subscriptions = rows ?? await loadSubscriptionStates(db);
  const result = { sent: 0, expired: 0, failed: 0, followUps: [] };
  const now = new Date();

  for (const row of subscriptions) {
    const state = row.state || {};
    if (state.preferences?.notificationsEnabled === false) continue;

    for (const habit of Array.isArray(state.habits) ? state.habits : []) {
      if (typeof habit.id !== 'string' || !habit.id || habit.id.length > 120) continue;
      for (const due of getDueHabitReminders(habit, row.timeZone, now, lookbackMinutes)) {
        const claim = await db.query(`
          INSERT INTO web_push_deliveries(subscription_id,habit_id,reminder_date,reminder_time,attempted_at,sent_at)
          VALUES($1,$2,$3,$4,$5,0)
          ON CONFLICT(subscription_id,habit_id,reminder_date,reminder_time) DO UPDATE
          SET attempted_at=EXCLUDED.attempted_at
          WHERE web_push_deliveries.sent_at=0
            AND web_push_deliveries.attempted_at < EXCLUDED.attempted_at - 300000
          RETURNING subscription_id
        `, [row.subscriptionId, String(habit.id), due.date, due.time, Date.now()]);
        if (!claim.rowCount) continue;

        const { title, body } = due.smart ? getSmartReminderText(habit, due.smart.riskLevel) : getReminderText(habit, template);
        const type = due.smart ? 'smart-reminder' : 'habit-reminder';
        const notificationId = makeNotificationId(row.userId, String(habit.id), due.date, due.time);
        try {
          const action = await makeSnoozeAction(db, snoozeUrl, row.subscriptionId, String(habit.id), 0, state);
          await webpush.sendNotification(row.subscriptionJson, JSON.stringify({
            title,
            body,
            tag: `${habit.id}-${due.date}-${due.time}`,
            soundEnabled: habit.reminderSoundEnabled !== false,
            actions: action ? [{ action: action.action, title: action.title }] : [],
            data: action
              ? { habitId: habit.id, type, url: '/', snoozeCount: 0, snoozeToken: action.token, snoozeUrl: action.url }
              : { habitId: habit.id, type, url: '/' },
          }), { TTL: 86400 });
          const sentAt = Date.now();
          await db.query(`UPDATE web_push_deliveries
            SET sent_at=$5, attempted_at=0
            WHERE subscription_id=$1 AND habit_id=$2 AND reminder_date=$3 AND reminder_time=$4`,
          [row.subscriptionId, String(habit.id), due.date, due.time, sentAt]);
          await db.query(`INSERT INTO notifications(id,user_id,type,title,body,created_at)
            VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(id) DO NOTHING`,
          [notificationId, row.userId, type, title, body, sentAt]);
          result.sent += 1;
          if (action) result.followUps.push(action.followUpAt);
        } catch (error) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            await db.query('DELETE FROM web_push_subscriptions WHERE id=$1', [row.subscriptionId]);
            result.expired += 1;
          } else {
            result.failed += 1;
          }
        }
      }
    }
  }
  return result;
}
