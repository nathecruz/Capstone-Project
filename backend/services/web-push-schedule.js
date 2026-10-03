// Decides when the GitHub Actions scheduler may wake the database. No imports on purpose:
// the check step runs before `npm ci`, and most runs end here without touching Neon.
//
// Neon's free plan has 100 CU-hours a month and suspends the database after 5 idle minutes.
// A job that queried it every 5 minutes would keep it awake all month (~186 CU-hours) and
// the whole app would stop when the quota ran out. Instead the scheduler builds a plan of
// reminder times once an hour and only connects when one of them (or a snooze) is due.

export const PLAN_VERSION = 1;

export function emptyPlan() {
  return { version: PLAN_VERSION, refreshedAt: 0, lastWakeAt: 0, wakeTimes: [] };
}

export function parsePlan(text) {
  try {
    const plan = JSON.parse(text);
    if (plan?.version !== PLAN_VERSION || !Array.isArray(plan.wakeTimes)) return null;
    return {
      version: PLAN_VERSION,
      refreshedAt: Number(plan.refreshedAt) || 0,
      lastWakeAt: Number(plan.lastWakeAt) || 0,
      wakeTimes: plan.wakeTimes.map(Number).filter(Number.isFinite),
    };
  } catch {
    return null;
  }
}

/**
 * Returns { wake, at, reason }. `at` is when to connect: now, or a due time within the next
 * `sleepWindowMs` (the job waits for it instead of leaving it to the next run).
 */
export function decideWake(plan, now, { refreshMinutes = 60, sleepWindowMs = 5.5 * 60_000, force = false } = {}) {
  if (force) return { wake: true, at: now, reason: 'manual refresh' };
  if (!plan) {
    // First run or lost cache: build a plan at most twice an hour so a broken cache cannot
    // turn into a database connection every 5 minutes.
    return new Date(now).getUTCMinutes() % 30 < 10
      ? { wake: true, at: now, reason: 'no plan yet' }
      : { wake: false, reason: 'no plan yet; building one at :00 or :30' };
  }
  if (now - plan.refreshedAt >= refreshMinutes * 60_000) return { wake: true, at: now, reason: 'plan refresh' };
  const next = plan.wakeTimes.filter((time) => time > plan.lastWakeAt).sort((a, b) => a - b)[0];
  if (next === undefined) return { wake: false, reason: 'nothing due before the next refresh' };
  if (next <= now) return { wake: true, at: now, reason: 'reminder due' };
  if (next - now <= sleepWindowMs) return { wake: true, at: next, reason: 'reminder due in the next few minutes' };
  return { wake: false, reason: `next reminder at ${new Date(next).toISOString()}` };
}

/** The next planned wake-up after the last one, if it is no later than `until` (an overdue one counts). */
export function nextWakeWithin(plan, until) {
  if (!plan) return null;
  const next = plan.wakeTimes.filter((time) => time > plan.lastWakeAt).sort((a, b) => a - b)[0];
  return next !== undefined && next <= until ? next : null;
}

/** Minutes of reminders to look back on a wake: covers the gap since the last one, at most 30. */
export function lookbackMinutes(plan, now) {
  const since = plan?.lastWakeAt ? Math.ceil((now - plan.lastWakeAt) / 60_000) : 30;
  return Math.max(5, Math.min(30, since));
}

/** The plan after a wake: fresh reminder times (on refresh) plus snooze follow-ups still ahead. */
export function nextPlan(plan, now, { refreshed = false, wakeTimes = [], followUps = [] } = {}) {
  const base = plan ?? emptyPlan();
  const kept = refreshed ? [] : base.wakeTimes;
  const times = [...new Set([...kept, ...wakeTimes, ...followUps].map(Number))]
    .filter((time) => Number.isFinite(time) && time > now)
    .sort((a, b) => a - b);
  return { version: PLAN_VERSION, refreshedAt: refreshed ? now : base.refreshedAt, lastWakeAt: now, wakeTimes: times };
}
