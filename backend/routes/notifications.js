import crypto from 'node:crypto';
import { query, withTransaction } from '../db/client.js';
import { parse } from '../lib/http.js';
import { notificationReadSchema, webPushSnoozeRequestSchema, webPushSubscriptionRequestSchema, webPushUnsubscribeSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { getConfiguredVapidPublicKey, getWebPushSnoozeSettings, hashWebPushSnoozeToken, isAllowedWebPushEndpoint } from '../services/web-push-reminders.js';

export default function registerNotificationRoutes(app) {
  // In-app notifications: achievements, reminders, and Admin Panel broadcasts/announcements.
  app.get('/api/notifications', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const result = await query('SELECT id,type,title,body AS message,read_at AS "readAt",created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [session.userId]);
    response.json({ ok: true, notifications: result.rows });
  });

  app.patch('/api/notifications/:id', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(notificationReadSchema, request, response);
    if (!input) return;
    const result = await query('UPDATE notifications SET read_at=$1 WHERE id=$2 AND user_id=$3', [input.read ? Date.now() : null, request.params.id, session.userId]);
    if (!result.rowCount) return response.status(404).json({ ok: false, message: 'Notification not found.' });
    response.json({ ok: true });
  });

  app.get('/api/web-push/public-key', (_request, response) => {
    const publicKey = getConfiguredVapidPublicKey();
    if (!publicKey) return response.status(503).json({ ok: false, message: 'Web Push is not configured.' });
    response.json({ ok: true, publicKey });
  });

  app.post('/api/web-push/subscriptions', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(webPushSubscriptionRequestSchema, request, response);
    if (!input) return;
    if (!isAllowedWebPushEndpoint(input.subscription.endpoint)) return response.status(400).json({ ok: false, message: 'Unsupported Web Push endpoint.' });
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone });
    } catch {
      return response.status(400).json({ ok: false, message: 'A valid device timezone is required.' });
    }
    const now = Date.now();
    await query(
      `INSERT INTO web_push_subscriptions(id,user_id,endpoint,subscription_json,time_zone,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,time_zone=excluded.time_zone,updated_at=excluded.updated_at`,
      [crypto.randomUUID(), session.userId, input.subscription.endpoint, input.subscription, input.timeZone, now],
    );
    response.json({ ok: true });
  });

  app.delete('/api/web-push/subscriptions', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(webPushUnsubscribeSchema, request, response);
    if (!input) return;
    await query('DELETE FROM web_push_subscriptions WHERE user_id=$1 AND endpoint=$2', [session.userId, input.endpoint]);
    response.json({ ok: true });
  });

  // Called from the notification's Snooze action; authorised by a one-time token instead of a session.
  app.post('/api/web-push/snooze', async (request, response) => {
    const input = parse(webPushSnoozeRequestSchema, request, response);
    if (!input) return;
    const tokenHash = hashWebPushSnoozeToken(input.token);
    if (!tokenHash) return response.status(410).json({ ok: false, message: 'This snooze action has expired.' });
    const now = Date.now();
    const enqueued = await withTransaction(async (db) => {
      const token = (await db.query(`
        SELECT snooze_token.subscription_id AS "subscriptionId",
               snooze_token.habit_id AS "habitId",
               snooze_token.snooze_count AS "snoozeCount",
               subscription.user_id AS "userId",
               current_state.state_json AS "stateJson"
        FROM web_push_snooze_tokens AS snooze_token
        JOIN web_push_subscriptions AS subscription ON subscription.id=snooze_token.subscription_id
        JOIN LATERAL (
          SELECT state_json FROM user_app_state WHERE user_id=subscription.user_id ORDER BY updated_at DESC LIMIT 1
        ) AS current_state ON TRUE
        WHERE snooze_token.token_hash=$1 AND snooze_token.consumed_at=0 AND snooze_token.expires_at>$2
        FOR UPDATE OF snooze_token
      `, [tokenHash, now])).rows[0];
      if (!token) return false;
      const settings = getWebPushSnoozeSettings(token.stateJson, token.habitId, Number(token.snoozeCount));
      if (!settings) return false;
      const consumed = await db.query('UPDATE web_push_snooze_tokens SET consumed_at=$1 WHERE token_hash=$2 AND consumed_at=0 AND expires_at>$1', [now, tokenHash]);
      if (!consumed.rowCount) return false;
      await db.query(
        'INSERT INTO web_push_snooze_queue(id,subscription_id,user_id,habit_id,snooze_count,scheduled_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [crypto.randomUUID(), token.subscriptionId, token.userId, token.habitId, settings.nextSnoozeCount, now + settings.intervalMinutes * 60_000, now],
      );
      return true;
    });
    if (!enqueued) return response.status(410).json({ ok: false, message: 'This snooze action is no longer available.' });
    response.json({ ok: true });
  });
}
