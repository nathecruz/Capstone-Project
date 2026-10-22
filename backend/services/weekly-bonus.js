// Weekly consistency bonus: +10, +20 or +30 tokens for doing 60%, 75% or 90% of last week's due
// check-ins, claimed during the next week (it lapses at 00:00 the Monday after). The rate is worked
// out on the server from the habits and check-ins, never from the app's numbers. Habits added after
// Wednesday count from the next week, and the due check-ins of days that are over are recorded
// before every save that can drop or reschedule habits (weekly_due_marks: the count and the last
// day it covers), so deleting a missed habit, even mid-week, cannot raise it. Past days cannot be
// checked in, so a paid bonus never needs taking back.
import { runAll } from '../db/run-all.js';
import { periodResetsAt } from '../lib/http.js';
import { isHabitActiveOn, weekEndKey } from './habit-week.js';
import { isHabitInWeek, loadDoneByDate, loadHabits, weekStartOf } from './quests.js';
import { habitSchedule, isScheduledDay } from './streaks.js';

export const WEEKLY_BONUS_TIERS = [
  { percent: 60, amount: 10, label: 'Steady week' },
  { percent: 75, amount: 20, label: 'Strong week' },
  { percent: 90, amount: 30, label: 'Consistent week' },
];
// A week earns the bonus only with this many due check-ins and days with a check-in.
export const WEEKLY_BONUS_MIN_SCHEDULED = 7;
export const WEEKLY_BONUS_MIN_DAYS = 3;

const NOT_EARNED = {
  'few-scheduled': () => `Last week had fewer than ${WEEKLY_BONUS_MIN_SCHEDULED} scheduled check-ins.`,
  'few-days': () => `Check in on at least ${WEEKLY_BONUS_MIN_DAYS} days of a week to earn the bonus.`,
  'low-rate': (percent) => `Last week reached ${percent}%. Reach ${WEEKLY_BONUS_TIERS[0].percent}% this week for +${WEEKLY_BONUS_TIERS[0].amount} tokens.`,
};

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const bonusId = (userId, weekStart) => `${userId}:token:week:${weekStart}`;

/** The highest tier `percent` reaches, or null. */
export function bonusTier(percent) {
  return WEEKLY_BONUS_TIERS.reduce((reached, tier) => (percent >= tier.percent ? tier : reached), null);
}

/** The habits that count for the week: in it, and started by its Wednesday, so late additions cannot pad the rate. */
function countedHabits(habits, weekStart) {
  const wednesday = shiftDay(weekStart, 2);
  return habits
    .filter((habit) => isHabitInWeek(habit, weekStart) && (!habit.startDate || habit.startDate <= wednesday))
    .map((habit) => ({ habit, schedule: habitSchedule(habit) }));
}

/** Each day from `from` to `to`: { date, due, done }, for the counted habits active and scheduled that day. */
function dueDays(counted, doneByDate, from, to) {
  const days = [];
  for (let date = from; date <= to; date = shiftDay(date, 1)) {
    const checkedIn = doneByDate.get(date) ?? new Set();
    const due = counted.filter(({ habit, schedule }) => isHabitActiveOn(habit, date) && isScheduledDay(schedule, date));
    days.push({ date, due: due.length, done: due.filter(({ habit }) => checkedIn.has(habit.id)).length });
  }
  return days;
}

const sum = (days, key) => days.reduce((total, day) => total + day[key], 0);

/**
 * The due check-ins of `days`, never fewer than a due mark: `dueMark` for the days up to
 * `markedThrough` plus the habits' own count for the days after it (a null `markedThrough`: the mark
 * covers all of them).
 */
function dueWithMark(days, dueMark, markedThrough) {
  const after = markedThrough ? sum(days.filter((day) => day.date > markedThrough), 'due') : 0;
  return Math.max(sum(days, 'due'), dueMark + after);
}

/**
 * The week starting `weekStart`, from its Monday to `lastDay`: due and done check-ins of the habits
 * that count (every category; a streak-frozen day stays due), the days with a check-in, and whether
 * it earns the bonus. `dueMark` is the most that was ever due on the week's days up to
 * `markedThrough` (weekly_due_marks), so `scheduled` never shrinks when a habit is deleted or
 * reshaped: the days after it count as the habits are now.
 * `habits`: [{ id, frequency, startDate, activeUntil, reminderDays, meta }]; `doneByDate`: Map(date -> Set(habit id)).
 */
export function weeklyConsistency({ habits, doneByDate, weekStart, lastDay, dueMark = 0, markedThrough = null }) {
  const days = dueDays(countedHabits(habits, weekStart), doneByDate, weekStart, lastDay);
  const due = sum(days, 'due');
  const done = sum(days, 'done');
  const activeDays = days.filter((day) => day.done > 0).length;
  const scheduled = dueWithMark(days, dueMark, markedThrough);
  const percent = scheduled ? Math.floor((100 * done) / scheduled) : 0;
  let reason = null;
  if (scheduled < WEEKLY_BONUS_MIN_SCHEDULED) reason = 'few-scheduled';
  else if (activeDays < WEEKLY_BONUS_MIN_DAYS) reason = 'few-days';
  else if (percent < WEEKLY_BONUS_TIERS[0].percent) reason = 'low-rate';
  return { due, done, scheduled, percent, activeDays, eligible: !reason, reason, tier: reason ? null : bonusTier(percent) };
}

/**
 * This week up to `today` (both included): the rate so far and the next tier above it, measured
 * against the whole week's due check-ins. It is reachable when the check-ins it needs are still
 * open from today to Sunday (and the week can still have enough due check-ins and active days).
 */
export function weekSoFar({ habits, doneByDate, today, dueMark = 0, markedThrough = null }) {
  const weekStart = weekStartOf(today);
  const weekEnd = weekEndKey(today);
  const soFar = weeklyConsistency({ habits, doneByDate, weekStart, lastDay: today, dueMark, markedThrough });
  const days = dueDays(countedHabits(habits, weekStart), doneByDate, weekStart, weekEnd);
  const dueWeek = dueWithMark(days, dueMark, markedThrough);
  const coming = days.filter((day) => day.date >= today);
  const open = sum(coming, 'due') - sum(coming, 'done');
  const possibleDays = days.filter((day) => day.done > 0 || (day.date >= today && day.due > day.done)).length;
  const tier = WEEKLY_BONUS_TIERS.find((entry) => entry.percent > soFar.percent) ?? null;
  const checkInsNeeded = tier ? Math.ceil((tier.percent * dueWeek) / 100) - soFar.done : 0;
  return {
    weekStart,
    weekEnd,
    dueSoFar: soFar.scheduled,
    doneSoFar: soFar.done,
    dueWeek,
    percentSoFar: soFar.percent,
    next: tier ? {
      percent: tier.percent,
      amount: tier.amount,
      checkInsNeeded,
      reachable: checkInsNeeded <= open && dueWeek >= WEEKLY_BONUS_MIN_SCHEDULED && possibleDays >= WEEKLY_BONUS_MIN_DAYS,
    } : null,
  };
}

/**
 * The due check-ins of the days already over, before `today`, from `habits`: all of last week and
 * this week up to yesterday, as [{ weekStart, lastDay, due }]. A habit added and removed on the same
 * day is never counted.
 */
export function closedDue(habits, today) {
  const thisWeek = weekStartOf(today);
  const yesterday = shiftDay(today, -1);
  return [[shiftDay(thisWeek, -7), shiftDay(thisWeek, -1)], [thisWeek, yesterday]]
    .filter(([weekStart, lastDay]) => lastDay >= weekStart)
    .map(([weekStart, lastDay]) => ({ weekStart, lastDay, due: weeklyConsistency({ habits, doneByDate: new Map(), weekStart, lastDay }).due }));
}

/**
 * The due mark a save keeps for a week: `closed` (from closedDue, with the habits as stored) joined
 * with the mark stored before it (`previous` { due, lastDay }, or null). The days the previous mark
 * covers keep the most that was ever due on them; the days after it count the stored habits, which
 * are the ones that stood when those days ended (every change of habits is a save that records
 * first). So a missed habit deleted on Wednesday still counts its Monday and Tuesday on top of the
 * other habits' rest of the week. A mark with no last day covers its whole week.
 */
export function nextDueMark(habits, closed, previous) {
  if (!previous) return closed;
  const covered = previous.lastDay ?? shiftDay(closed.weekStart, 6);
  if (covered >= closed.lastDay) return { weekStart: closed.weekStart, lastDay: covered, due: Math.max(previous.due, closed.due) };
  const since = sum(dueDays(countedHabits(habits, closed.weekStart), new Map(), shiftDay(covered, 1), closed.lastDay), 'due');
  return { weekStart: closed.weekStart, lastDay: closed.lastDay, due: Math.max(closed.due, previous.due + since) };
}

/** The stored due marks of the weeks from `from` on: Map(week start -> { due, lastDay }). */
async function loadDueMarks(db, userId, from) {
  const result = await db.query('SELECT week_start::text AS "weekStart", due, last_day::text AS "lastDay" FROM weekly_due_marks WHERE user_id=$1 AND week_start >= $2::date', [userId, from]);
  return new Map(result.rows.map((row) => [row.weekStart, { due: Number(row.due), lastDay: row.lastDay ?? null }]));
}

/**
 * Records the due check-ins of the days already over (closedDue) from the habits as stored, joined
 * with the marks already kept (nextDueMark), so a week's count never shrinks. Call inside the save's
 * transaction, after locking the user row and before syncNormalizedState (the only path that drops
 * or reschedules habits).
 */
export async function recordDueMarks(db, userId, today, now = Date.now()) {
  const [habits, stored] = await runAll(db, [() => loadHabits(db, userId), () => loadDueMarks(db, userId, shiftDay(weekStartOf(today), -7))]);
  for (const closed of closedDue(habits, today)) {
    const previous = stored.get(closed.weekStart) ?? null;
    const mark = nextDueMark(habits, closed, previous);
    if (previous ? mark.due === previous.due && mark.lastDay === previous.lastDay : !mark.due) continue;
    await db.query(
      `INSERT INTO weekly_due_marks(user_id, week_start, due, last_day, updated_at) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, week_start) DO UPDATE SET due=GREATEST(weekly_due_marks.due, excluded.due),
         last_day=GREATEST(weekly_due_marks.last_day, excluded.last_day), updated_at=excluded.updated_at`,
      [userId, mark.weekStart, mark.due, mark.lastDay, now],
    );
  }
}

/** How a stored mark (or none) enters weeklyConsistency and weekSoFar. */
const markInput = (mark) => ({ dueMark: mark?.due ?? 0, markedThrough: mark?.lastDay ?? null });

/**
 * The bonus as the app shows it (the API's WeeklyBonus), from the loaded data: last week, which can
 * be claimed until 00:00 next Monday in the account's zone, and this week so far. `marks`:
 * Map(week start -> { due, lastDay }); `claimedAmount`: last week's paid bonus, or null.
 */
export function weeklyBonus({ habits, doneByDate, today, timeZone, marks = new Map(), claimedAmount = null }) {
  const weekStart = shiftDay(weekStartOf(today), -7);
  const weekEnd = shiftDay(weekStart, 6);
  const { done, scheduled, percent, activeDays, eligible, reason, tier } = weeklyConsistency({ habits, doneByDate, weekStart, lastDay: weekEnd, ...markInput(marks.get(weekStart)) });
  const thisWeek = weekSoFar({ habits, doneByDate, today, ...markInput(marks.get(weekStartOf(today))) });
  return {
    lastWeek: {
      weekStart,
      weekEnd,
      scheduled,
      done,
      percent,
      activeDays,
      eligible,
      reason,
      tier,
      claimed: claimedAmount !== null,
      claimedAmount,
      claimable: eligible && claimedAmount === null,
      lapsesAt: periodResetsAt({ end: thisWeek.weekEnd }, timeZone),
    },
    thisWeek,
    tiers: WEEKLY_BONUS_TIERS,
  };
}

/** Loads what weeklyBonus needs for the account day `today` (its Monday a week ago to today). */
async function loadWeeks(db, userId, today) {
  const lastWeek = shiftDay(weekStartOf(today), -7);
  const [habits, doneByDate, marks, claimed] = await runAll(db, [
    () => loadHabits(db, userId),
    () => loadDoneByDate(db, userId, lastWeek, today),
    () => loadDueMarks(db, userId, lastWeek),
    () => db.query('SELECT amount FROM token_transactions WHERE id=$1', [bonusId(userId, lastWeek)]),
  ]);
  return { habits, doneByDate, marks, claimedAmount: claimed.rowCount ? Number(claimed.rows[0].amount) : null };
}

/** The weekly bonus for the account day ({ today, timeZone }, services/account-day.js). */
export async function getWeeklyBonus(db, userId, { today, timeZone }) {
  return weeklyBonus({ ...await loadWeeks(db, userId, today), today, timeZone });
}

/**
 * Claims last week's bonus on the account day `today`: recomputed here, paid once per week (a
 * second claim, from a double tap or another device, gets the amount already paid). Returns
 * { refused: message } when the week did not earn it, else { amount, alreadyClaimed, percent, tier }.
 * Call inside a transaction that locked the user row.
 */
export async function claimWeeklyBonus(db, userId, today, now = Date.now()) {
  const { habits, doneByDate, marks, claimedAmount } = await loadWeeks(db, userId, today);
  const weekStart = shiftDay(weekStartOf(today), -7);
  const week = weeklyConsistency({ habits, doneByDate, weekStart, lastDay: shiftDay(weekStart, 6), ...markInput(marks.get(weekStart)) });
  const paid = (amount) => ({ amount, alreadyClaimed: true, percent: week.percent, tier: WEEKLY_BONUS_TIERS.find((tier) => tier.amount === amount) ?? null });
  if (claimedAmount !== null) return paid(claimedAmount);
  if (!week.eligible) return { refused: NOT_EARNED[week.reason](week.percent) };
  const inserted = await db.query(
    'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id',
    [bonusId(userId, weekStart), userId, week.tier.amount, `Weekly bonus: ${week.percent}% (${week.tier.label})`, new Date(now).toISOString(), now],
  );
  if (!inserted.rowCount) return paid(Number((await db.query('SELECT amount FROM token_transactions WHERE id=$1', [bonusId(userId, weekStart)])).rows[0].amount));
  return { amount: week.tier.amount, alreadyClaimed: false, percent: week.percent, tier: week.tier };
}
