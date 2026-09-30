// Every-minute Web Push dispatcher (for a paid Render cron job or a local cron).
// On free hosting use scripts/web-push-scheduler.js from GitHub Actions instead.
import webpush from 'web-push';
import { closeDatabase, query } from '../db/client.js';
import { dispatchDueReminders, dispatchDueSnoozes, loadReminderTemplate } from '../services/web-push-dispatch.js';
import { getWebPushSnoozeUrl } from '../services/web-push-reminders.js';

const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();

if (!publicKey || !privateKey || !subject) {
  throw new Error('WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_VAPID_SUBJECT must be configured.');
}

webpush.setVapidDetails(subject, publicKey, privateKey);
const db = { query };

try {
  const options = { webpush, template: await loadReminderTemplate(db), snoozeUrl: getWebPushSnoozeUrl() };
  const reminders = await dispatchDueReminders(db, options);
  const snoozes = await dispatchDueSnoozes(db, options);
  console.log(`Web Push dispatch complete: ${reminders.sent + snoozes.sent} sent, ${reminders.expired + snoozes.expired} expired subscriptions, ${reminders.failed + snoozes.failed} retryable failures.`);
} catch (error) {
  console.error('Web Push dispatch failed.', error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
