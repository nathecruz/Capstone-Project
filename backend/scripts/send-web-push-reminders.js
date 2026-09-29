import crypto from 'node:crypto';
import webpush from 'web-push';
import { closeDatabase, query } from '../db/client.js';
import { getDueHabitReminders, getSnoozeLimit, getWebPushSnoozeSettings, getWebPushSnoozeUrl, hashWebPushSnoozeToken } from '../services/web-push-reminders.js';

const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();

if (!publicKey || !privateKey || !subject) {
  throw new Error('WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_VAPID_SUBJECT must be configured.');
}

webpush.setVapidDetails(subject, publicKey, privateKey);
const snoozeUrl = getWebPushSnoozeUrl();

function makeNotificationId(userId, habitId, date, time) {
  const value = `${userId}\0${habitId}\0${date}\0${time}`;
  return `web-push:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

async function makeSnoozeAction(subscriptionId, habitId, snoozeCount, state) {
  if (!snoozeUrl) return null;
  const settings = getWebPushSnoozeSettings(state, habitId, snoozeCount);
  if (!settings || settings.nextSnoozeCount > getSnoozeLimit(state.snoozeFrequency || 'Once')) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  await query(`
    INSERT INTO web_push_snooze_tokens(token_hash,subscription_id,habit_id,snooze_count,expires_at,created_at)
    VALUES($1,$2,$3,$4,$5,$6)
  `, [hashWebPushSnoozeToken(token), subscriptionId, habitId, snoozeCount, createdAt + 24 * 60 * 60 * 1000, createdAt]);
  return { action: 'SNOOZE', title: `Snooze ${settings.intervalMinutes} min`, token, url: snoozeUrl };
}

async function dispatchDueSnoozes() {
  const now = Date.now();
  await query('DELETE FROM web_push_snooze_tokens WHERE expires_at<$1', [now]);
  await query('DELETE FROM web_push_snooze_queue WHERE sent_at>0 AND sent_at<$1', [now - 30 * 24 * 60 * 60 * 1000]);
  const claimed = await query(`
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
  let sent = 0;
  let expired = 0;
  let failed = 0;

  for (const row of claimed.rows) {
    const subscription = (await query('SELECT subscription_json AS "subscriptionJson" FROM web_push_subscriptions WHERE id=$1', [row.subscriptionId])).rows[0];
    const appState = (await query('SELECT state_json AS "stateJson" FROM user_app_state WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1', [row.userId])).rows[0]?.stateJson;
    if (!subscription || !appState) {
      await query('UPDATE web_push_snooze_queue SET sent_at=$2,attempted_at=0 WHERE id=$1', [row.id, now]);
      continue;
    }
    const state = typeof appState === 'string' ? JSON.parse(appState) : appState;
    const settings = getWebPushSnoozeSettings(state, row.habitId, Number(row.snoozeCount) - 1);
    const habit = Array.isArray(state.habits) ? state.habits.find((item) => item.id === row.habitId) : null;
    if (!settings || !habit) {
      await query('UPDATE web_push_snooze_queue SET sent_at=$2,attempted_at=0 WHERE id=$1', [row.id, now]);
      continue;
    }
    try {
      const action = await makeSnoozeAction(row.subscriptionId, row.habitId, Number(row.snoozeCount), state);
      await webpush.sendNotification(subscription.subscriptionJson, JSON.stringify({
        title: `${String(habit.label || 'Habit').slice(0, 120)} reminder`,
        body: 'A small step today keeps your streak moving.',
        tag: `snooze-${row.id}`,
        soundEnabled: habit.reminderSoundEnabled !== false,
        actions: action ? [{ action: action.action, title: action.title }] : [],
        data: action ? { habitId: row.habitId, type: 'habit-reminder', snoozeCount: Number(row.snoozeCount), snoozeToken: action.token, snoozeUrl: action.url } : { habitId: row.habitId, type: 'habit-reminder' },
      }), { TTL: 86400 });
      await query('UPDATE web_push_snooze_queue SET sent_at=$2,attempted_at=0 WHERE id=$1', [row.id, Date.now()]);
      sent += 1;
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await query('DELETE FROM web_push_subscriptions WHERE id=$1', [row.subscriptionId]);
        expired += 1;
      } else {
        failed += 1;
      }
    }
  }
  return { sent, expired, failed };
}

async function dispatchDueReminders() {
  const subscriptions = await query(`
    SELECT subscription.id AS "subscriptionId",
           subscription.user_id AS "userId",
           subscription.subscription_json AS "subscriptionJson",
           subscription.time_zone AS "timeZone",
           current_state.state_json AS "stateJson"
    FROM web_push_subscriptions AS subscription
    JOIN LATERAL (
      SELECT state_json
      FROM user_app_state
      WHERE user_id = subscription.user_id
      ORDER BY updated_at DESC
      LIMIT 1
    ) AS current_state ON TRUE
  `);

  let sent = 0;
  let expired = 0;
  let failed = 0;
  const now = new Date();

  for (const row of subscriptions.rows) {
    const state = row.stateJson || {};
    if (state.preferences?.notificationsEnabled === false) continue;

    for (const habit of Array.isArray(state.habits) ? state.habits : []) {
      if (typeof habit.id !== 'string' || !habit.id || habit.id.length > 120) continue;
      const dueReminders = getDueHabitReminders(habit, row.timeZone, now);
      for (const due of dueReminders) {
        const claim = await query(`
          INSERT INTO web_push_deliveries(subscription_id,habit_id,reminder_date,reminder_time,attempted_at,sent_at)
          VALUES($1,$2,$3,$4,$5,0)
          ON CONFLICT(subscription_id,habit_id,reminder_date,reminder_time) DO UPDATE
          SET attempted_at=EXCLUDED.attempted_at
          WHERE web_push_deliveries.sent_at=0
            AND web_push_deliveries.attempted_at < EXCLUDED.attempted_at - 300000
          RETURNING subscription_id
        `, [row.subscriptionId, String(habit.id), due.date, due.time, Date.now()]);
        if (!claim.rowCount) continue;

        const title = `${String(habit.label || 'Habit').slice(0, 120)} reminder`;
        const body = 'A small step today keeps your streak moving.';
        const notificationId = makeNotificationId(row.userId, String(habit.id), due.date, due.time);
        try {
          const action = await makeSnoozeAction(row.subscriptionId, String(habit.id), 0, state);
          await webpush.sendNotification(row.subscriptionJson, JSON.stringify({
            title,
            body,
            tag: `${habit.id}-${due.date}-${due.time}`,
            soundEnabled: habit.reminderSoundEnabled !== false,
            actions: action ? [{ action: action.action, title: action.title }] : [],
            data: action
              ? { habitId: habit.id, type: 'habit-reminder', snoozeCount: 0, snoozeToken: action.token, snoozeUrl: action.url }
              : { habitId: habit.id, type: 'habit-reminder' },
          }), { TTL: 86400 });
          const sentAt = Date.now();
          await query(`UPDATE web_push_deliveries
            SET sent_at=$5, attempted_at=0
            WHERE subscription_id=$1 AND habit_id=$2 AND reminder_date=$3 AND reminder_time=$4`,
          [row.subscriptionId, String(habit.id), due.date, due.time, sentAt]);
          await query(`INSERT INTO notifications(id,user_id,type,title,body,created_at)
            VALUES($1,$2,'habit-reminder',$3,$4,$5)
            ON CONFLICT(id) DO NOTHING`,
          [notificationId, row.userId, title, body, sentAt]);
          sent += 1;
        } catch (error) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            await query('DELETE FROM web_push_subscriptions WHERE id=$1', [row.subscriptionId]);
            expired += 1;
          } else {
            failed += 1;
          }
        }
      }
    }
  }

  const snoozes = await dispatchDueSnoozes();
  console.log(`Web Push dispatch complete: ${sent + snoozes.sent} sent, ${expired + snoozes.expired} expired subscriptions, ${failed + snoozes.failed} retryable failures.`);
}

try {
  await dispatchDueReminders();
} catch (error) {
  console.error('Web Push dispatch failed.', error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}