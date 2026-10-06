// Sends Web Push reminders on their exact minute while this API is awake.
//
// A free Render instance sleeps after 15 idle minutes; the GitHub Actions scheduler
// (scripts/web-push-scheduler.js) covers those hours. But GitHub starts its runs only every
// 15-30 minutes and rebuilds its plan of reminder times every 30, so a reminder made a few
// minutes earlier could come late. While students use HabitAI this API is awake anyway, so this
// clock sends every reminder on its minute and picks up new or changed reminder times within
// seconds. Both claim each delivery in web_push_deliveries, so a reminder is never sent twice.
//
// Like the GitHub scheduler, it reads the database only when a reminder or snooze is due, when a
// student changes reminders, and every 30 minutes, never every minute (Neon free plan, see
// services/web-push-schedule.js). A change reloads only that student's plan, which keeps the
// work small on a 0.1-CPU instance. Its timers do not keep the instance awake: Render only counts
// incoming requests.
import webpush from 'web-push';
import { dispatchDueReminders, dispatchDueSnoozes, loadReminderTemplate, loadSubscriptionStates, pendingSnoozes } from './web-push-dispatch.js';
import { getConfiguredVapidDetails, getReminderWakeTimes, getWebPushSnoozeUrl } from './web-push-reminders.js';

const REFRESH_MS = 30 * 60_000;
// Longer than the refresh interval, so the plan never runs out between refreshes.
const HORIZON_MINUTES = 40;
// Several quick edits (a new habit, then its reminder times) cause one reload.
const CHANGE_DELAY_MS = 5_000;
// A moment into the minute, so the reminder's minute has started on every clock.
const FIRE_OFFSET_MS = 1_000;
const RETRY_MS = 60_000;
const MAX_RETRIES = 3;
// After a restart, reminders missed in the last 30 minutes (while asleep) are sent, as on GitHub.
const MAX_LOOKBACK_MINUTES = 30;
const ALL = '*';

/**
 * The clock itself, with its database work passed in (testable without a database or real time).
 *
 * - `loadWakeTimes(at, userIds)` resolves to a Map of user id -> epoch-ms minutes at which a
 *   reminder or snooze of that user is due (earlier ones are due now). `userIds` is null for
 *   everyone; for a list, users missing from the Map have nothing planned any more.
 * - `dispatch({ lookbackMinutes, userIds })` sends what is due in that many past minutes, for
 *   those users (null: everyone).
 */
export function createReminderClock({
  loadWakeTimes,
  dispatch,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = console.log,
  refreshMs = REFRESH_MS,
  changeDelayMs = CHANGE_DELAY_MS,
}) {
  // user id (or ALL for catch-up and retries) -> sorted minutes still ahead.
  let plan = new Map();
  let refreshedAt = 0;
  let lastDispatchAt = 0;
  let failures = 0;
  let timer = null;
  let changeTimer = null;
  const changedUsers = new Set();
  let busy = null;
  let pending = null;
  let stopped = true;

  const nextWake = () => {
    let next = Infinity;
    for (const times of plan.values()) if (times.length && times[0] < next) next = times[0];
    return next;
  };

  const setTimes = (userId, times, at) => {
    // Anything already due (an overdue snooze) fires right away.
    const clean = [...new Set(times.map((time) => Math.max(Number(time), at - FIRE_OFFSET_MS)))]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (clean.length) plan.set(userId, clean);
    else plan.delete(userId);
  };

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimer(timer);
    const at = Math.min(nextWake() + FIRE_OFFSET_MS, refreshedAt + refreshMs);
    timer = setTimer(() => {
      timer = null;
      void run({});
    }, Math.max(0, at - now()));
    timer?.unref?.();
  };

  const reload = async (at, userIds) => {
    try {
      const loaded = await loadWakeTimes(at, userIds);
      if (!userIds) {
        const keep = plan.get(ALL);
        plan = new Map();
        if (keep) plan.set(ALL, keep);
        refreshedAt = at;
      }
      for (const userId of userIds ?? []) if (!loaded.has(userId)) plan.delete(userId);
      for (const [userId, times] of loaded) setTimes(userId, times, at);
      return true;
    } catch (error) {
      log(`[reminders] could not load reminder times: ${error?.message || error}`);
      // Try a full reload in a minute rather than every moment.
      refreshedAt = at - refreshMs + RETRY_MS;
      return false;
    }
  };

  const work = async ({ refresh = false, users = null }) => {
    const at = now();
    if (refresh || at - refreshedAt >= refreshMs) {
      if (!await reload(at, null)) return;
    } else if (users?.length) {
      if (!await reload(at, users)) return;
    }

    const due = [...plan].filter(([, times]) => times[0] + FIRE_OFFSET_MS <= at).map(([userId]) => userId);
    if (!due.length) return;
    const everyone = due.includes(ALL);
    const earliest = Math.min(...due.map((userId) => plan.get(userId)[0]));
    const minutesSince = (time) => Math.max(1, Math.min(MAX_LOOKBACK_MINUTES, Math.ceil((at - time) / 60_000) + 1));
    // Everyone: back to the last complete run (or 30 minutes after a restart). Planned users: back
    // to their reminder's minute, even if this timer fired a little late.
    const lookbackMinutes = everyone
      ? (lastDispatchAt ? minutesSince(lastDispatchAt) : MAX_LOOKBACK_MINUTES)
      : minutesSince(earliest);
    for (const userId of due) setTimes(userId, plan.get(userId).filter((time) => time + FIRE_OFFSET_MS > at), at);
    try {
      await dispatch({ lookbackMinutes, userIds: everyone ? null : due });
      if (everyone) lastDispatchAt = at;
      failures = 0;
    } catch (error) {
      failures += 1;
      log(`[reminders] sending failed (${failures}/${MAX_RETRIES}): ${error?.message || error}`);
      // Retry everyone in a minute; it looks back to the last good run, so the missed minute is covered.
      if (failures < MAX_RETRIES) setTimes(ALL, [...(plan.get(ALL) ?? []), at + RETRY_MS - FIRE_OFFSET_MS], at);
    }
  };

  /** One reload or dispatch at a time; requests made meanwhile are merged and run right after. */
  const run = (options) => {
    if (stopped) return Promise.resolve();
    if (busy) {
      pending = {
        refresh: Boolean(pending?.refresh || options.refresh),
        users: [...new Set([...(pending?.users ?? []), ...(options.users ?? [])])],
      };
      return busy;
    }
    busy = work(options).finally(() => {
      busy = null;
      const next = pending;
      pending = null;
      if (next) void run(next);
      else schedule();
    });
    return busy;
  };

  return {
    /** Loads the plan and sends anything missed while the API was asleep. */
    start() {
      stopped = false;
      plan.set(ALL, [now() - FIRE_OFFSET_MS]);
      return run({ refresh: true });
    },
    /** A student changed habits, reminder times, devices or snoozes: reload their plan shortly. */
    notifyChange(userId) {
      if (stopped || !userId) return;
      changedUsers.add(String(userId));
      if (changeTimer) return;
      changeTimer = setTimer(() => {
        changeTimer = null;
        const users = [...changedUsers];
        changedUsers.clear();
        void run({ users });
      }, changeDelayMs);
      changeTimer?.unref?.();
    },
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      if (changeTimer) clearTimer(changeTimer);
      timer = null;
      changeTimer = null;
    },
    /** For tests and logs. */
    get plan() {
      return { users: Object.fromEntries([...plan].map(([userId, times]) => [userId, [...times]])), refreshedAt, lastDispatchAt };
    },
  };
}

let activeClock = null;
// For /health: whether the clock runs and how its last send went (counts only, no personal data).
const lastSend = { at: null, sent: 0, failed: 0 };

/**
 * Starts the clock on this API when Web Push is configured (WEB_PUSH_CLOCK=off turns it off).
 * `query` is the database's (passed in, so importing this module never needs a database).
 */
export function startReminderClock({ query, log = console.log, environment = process.env }) {
  const vapid = getConfiguredVapidDetails(environment);
  if (!query || !vapid || environment.WEB_PUSH_CLOCK === 'off') return null;
  try {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  } catch (error) {
    // Bad keys must not stop the API; reminders then wait for them to be fixed.
    log(`[reminders] clock off: ${error?.message || error}`);
    return null;
  }
  const db = { query };
  const clock = createReminderClock({
    log,
    loadWakeTimes: async (at, userIds) => {
      const rows = await loadSubscriptionStates(db, userIds);
      const byUser = new Map();
      for (const row of rows) {
        const userId = String(row.userId);
        if (!byUser.has(userId)) byUser.set(userId, []);
        byUser.get(userId).push(row);
      }
      const plan = new Map();
      for (const [userId, userRows] of byUser) plan.set(userId, getReminderWakeTimes(userRows, new Date(at), HORIZON_MINUTES));
      for (const snooze of await pendingSnoozes(db, at + HORIZON_MINUTES * 60_000, userIds)) {
        const userId = String(snooze.userId);
        plan.set(userId, [...(plan.get(userId) ?? []), snooze.scheduledAt]);
      }
      return plan;
    },
    dispatch: async ({ lookbackMinutes, userIds }) => {
      const rows = await loadSubscriptionStates(db, userIds);
      const options = { webpush, template: await loadReminderTemplate(db), snoozeUrl: getWebPushSnoozeUrl(environment), rows };
      const reminders = await dispatchDueReminders(db, { ...options, lookbackMinutes });
      const snoozes = await dispatchDueSnoozes(db, options);
      const sent = reminders.sent + snoozes.sent;
      const failed = reminders.failed + snoozes.failed;
      if (sent || failed) Object.assign(lastSend, { at: new Date().toISOString(), sent, failed });
      if (sent || failed) log(`[reminders] sent ${sent}, expired ${reminders.expired + snoozes.expired}, failed ${failed}`);
    },
  });
  activeClock = clock;
  void clock.start();
  return clock;
}

/** Called by the API after a change that can move a student's reminders (no-op when the clock is off). */
export function notifyReminderChange(userId) {
  activeClock?.notifyChange(userId);
}

export function reminderClockStatus() {
  return { on: Boolean(activeClock), lastSendAt: lastSend.at, lastSent: lastSend.sent, lastFailed: lastSend.failed };
}

export function stopReminderClock() {
  activeClock?.stop();
  activeClock = null;
}
