// Free Web Push scheduler for GitHub Actions (.github/workflows/web-push-reminders.yml).
//
//   node scripts/web-push-scheduler.js check   decide from the cached plan; no dependencies, no database
//   node scripts/web-push-scheduler.js run     send due reminders/snoozes and update the plan
//
// The plan (reminder times only, no personal data) lives in WEB_PUSH_PLAN_FILE, which the
// workflow keeps in the Actions cache between runs. See services/web-push-schedule.js.
//
// GitHub starts scheduled runs every 15-25 minutes in practice, not every 5. So a run stays up
// for WEB_PUSH_WINDOW_MINUTES and sends each reminder due in that window at its minute, sleeping
// (with no database connection) in between; the next run, queued meanwhile, takes over after it.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decideWake, lookbackMinutes, nextPlan, nextWakeWithin, parsePlan } from '../services/web-push-schedule.js';

const REFRESH_MINUTES = Number(process.env.WEB_PUSH_REFRESH_MINUTES || 60);
const WINDOW_MINUTES = Number(process.env.WEB_PUSH_WINDOW_MINUTES || 28);
// A snooze tapped a few minutes after the reminder is still picked up by its follow-up check.
const SNOOZE_SLACK_MS = 5 * 60_000;
const planFile = path.resolve(process.env.WEB_PUSH_PLAN_FILE || '.web-push/plan.json');
const force = process.env.WEB_PUSH_FORCE_REFRESH === 'true';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readPlan() {
  return existsSync(planFile) ? parsePlan(readFileSync(planFile, 'utf8')) : null;
}

function setOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

async function check() {
  const plan = readPlan();
  const decision = decideWake(plan, Date.now(), { refreshMinutes: REFRESH_MINUTES, sleepWindowMs: WINDOW_MINUTES * 60_000, force });
  console.log(`${decision.wake ? 'Waking the database' : 'Not waking the database'}: ${decision.reason}.`);
  setOutput({ wake: decision.wake, at: decision.at ?? 0 });
}

async function run() {
  const windowEnd = Date.now() + WINDOW_MINUTES * 60_000;
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) throw new Error('WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY and WEB_PUSH_VAPID_SUBJECT are required.');

  const { default: webpush } = await import('web-push');
  const { closeDatabase, query } = await import('../db/client.js');
  const { dispatchDueReminders, dispatchDueSnoozes, loadReminderTemplate, loadSubscriptionStates, pendingSnoozeTimes } = await import('../services/web-push-dispatch.js');
  const { getReminderWakeTimes, getWebPushSnoozeUrl } = await import('../services/web-push-reminders.js');
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const db = { query };

  /** One wake: send what is due, refresh the plan when it is old, and save it. */
  const wake = async (plan, forceRefresh) => {
    const now = Date.now();
    const rows = await loadSubscriptionStates(db);
    const options = { webpush, template: await loadReminderTemplate(db), snoozeUrl: getWebPushSnoozeUrl(), rows };
    const reminders = await dispatchDueReminders(db, { ...options, lookbackMinutes: lookbackMinutes(plan, now) });
    const snoozes = await dispatchDueSnoozes(db, options);

    const refreshed = forceRefresh || !plan || now - plan.refreshedAt >= REFRESH_MINUTES * 60_000;
    const horizonMinutes = REFRESH_MINUTES + 10;
    const wakeTimes = refreshed
      ? [...getReminderWakeTimes(rows, new Date(now), horizonMinutes), ...await pendingSnoozeTimes(db, now + horizonMinutes * 60_000)]
      : [];
    const followUps = [...reminders.followUps, ...snoozes.followUps].map((time) => time + SNOOZE_SLACK_MS);
    const updated = nextPlan(plan, now, { refreshed, wakeTimes, followUps });

    mkdirSync(path.dirname(planFile), { recursive: true });
    writeFileSync(planFile, JSON.stringify(updated));
    console.log(`${new Date(now).toISOString()} sent ${reminders.sent + snoozes.sent} (expired ${reminders.expired + snoozes.expired}, retry ${reminders.failed + snoozes.failed}). `
      + `${refreshed ? 'Plan refreshed; ' : ''}${updated.wakeTimes.length} upcoming wake-ups, next ${updated.wakeTimes[0] ? new Date(updated.wakeTimes[0]).toISOString() : 'at the next refresh'}.`);
    return updated;
  };

  try {
    let plan = readPlan();
    let wakeAt = Number(process.env.WEB_PUSH_WAKE_AT || 0);
    let first = true;
    for (;;) {
      const wait = Math.max(0, Math.min(wakeAt, windowEnd) - Date.now());
      if (wait) await sleep(wait);
      plan = await wake(plan, first && force);
      first = false;
      const next = nextWakeWithin(plan, windowEnd);
      if (next === null) break;
      wakeAt = next;
    }
  } finally {
    await closeDatabase();
  }
}

const mode = process.argv[2];
try {
  if (mode === 'check') await check();
  else if (mode === 'run') await run();
  else throw new Error('Usage: node scripts/web-push-scheduler.js check|run');
} catch (error) {
  console.error('Web Push scheduler failed.', error);
  process.exitCode = 1;
}
