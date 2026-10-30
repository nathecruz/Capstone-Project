// What the AI goal planner knows about the student: the habits of the last 4 weeks (habits last
// one week, services/habit-week.js), how each one went up to its last day, when the student
// usually checked it in, its ML forecast and the account streak. Computed on the server from the
// habits and habit_completions tables, never taken from the client.
import { runAll } from '../db/run-all.js';
import { accountStreak } from './account-streak.js';
import { dateKeyInZone, shiftDay } from './ai-context.js';
import { DEFAULT_HABIT_CATEGORIES, formatClock, plannerCategories } from './ai-prompts.js';
import { forecastFor, rulesForecast } from './forecast-rules.js';
import { mlSignal } from './habit-analysis.js';
import { hasHabitEnded, isDateKey, weekEndKey } from './habit-week.js';
import { getFrozenDays, getKeptDays } from './streak-freeze.js';
import { computeStreak, habitFromRow, habitSchedule, isScheduledDay } from './streaks.js';

const DEFAULT_TIME_ZONE = 'Asia/Manila';
const LOOKBACK_DAYS = 28;
const MAX_HABITS = 12;
/** All the forecasts together wait at most this long; the ones still out use the rules. */
export const PLANNER_FORECAST_CAP_MS = 6000;
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const round2 = (value) => Math.round(value * 100) / 100;
const weekDayOf = (dateKey) => WEEK_DAYS[(new Date(`${dateKey}T00:00:00Z`).getUTCDay() + 6) % 7];

/** The local day and minute of the day of a check-in time (ms), in the time zone. */
function localClock(timeZone) {
  const formatterFor = (zone) => new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let formatter;
  try {
    formatter = formatterFor(timeZone || DEFAULT_TIME_ZONE);
  } catch {
    formatter = formatterFor(DEFAULT_TIME_ZONE);
  }
  return (timestamp) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
  };
}

/**
 * The median time of day of these check-ins, or null with fewer than two. A check-in synced on a
 * later day (made offline) carries the sync time, so only times on the check-in's own day count.
 */
export function usualCheckInTime(completions, timeZone) {
  const clock = localClock(timeZone);
  const minutes = completions
    .filter((item) => Number(item.completedAt) > 0)
    .map((item) => ({ date: item.date, local: clock(Number(item.completedAt)) }))
    .filter(({ date, local }) => local.date === date)
    .map(({ local }) => local.minutes)
    .sort((a, b) => a - b);
  if (minutes.length < 2) return null;
  const middle = Math.floor(minutes.length / 2);
  return formatClock(minutes.length % 2 ? minutes[middle] : Math.round((minutes[middle - 1] + minutes[middle]) / 2));
}

/**
 * One habit's last 4 weeks, counted from its start date to today or its last day, whichever is
 * first (days after a habit's week never count as missed). Today is still open, so it only counts
 * once it is done. Returns the facts for the planner, the ML signal (null without a counted
 * day yet, when a forecast would say nothing) and the counted days by weekday.
 */
function habitHistory(row, completions, { today, windowStart, timeZone, frozenDays }) {
  const habit = habitFromRow(row);
  const status = hasHabitEnded(habit, today) ? 'ended' : 'current';
  const schedule = habitSchedule(habit);
  const lastDay = isDateKey(habit.activeUntil) && habit.activeUntil < today ? habit.activeUntil : today;
  const firstDay = isDateKey(habit.startDate) && habit.startDate > windowStart ? habit.startDate : windowStart;
  const inRange = completions.filter((item) => item.date >= firstDay && item.date <= lastDay);
  const done = new Set(inRange.map((item) => item.date));
  let scheduledDays = 0;
  let checkIns = 0;
  const weekdays = new Map();
  for (let day = firstDay; day <= lastDay; day = shiftDay(day, 1)) {
    if (!isScheduledDay(schedule, day) || (day === today && !done.has(day))) continue;
    scheduledDays += 1;
    if (done.has(day)) checkIns += 1;
    const tally = weekdays.get(weekDayOf(day)) ?? { scheduled: 0, done: 0 };
    weekdays.set(weekDayOf(day), { scheduled: tally.scheduled + 1, done: tally.done + (done.has(day) ? 1 : 0) });
  }
  const completionRate = scheduledDays ? checkIns / scheduledDays : 0;
  const name = String(row.label || 'Habit').slice(0, 60);
  const facts = {
    name,
    category: row.category || 'Other',
    frequency: habit.frequency,
    days: schedule.type === 'weekly' ? WEEK_DAYS.filter((day) => schedule.days.includes(day)) : [],
    reminderTime: row.reminderEnabled && row.reminderTime ? String(row.reminderTime).slice(0, 20) : null,
    status,
    week: { from: isDateKey(habit.startDate) ? habit.startDate : null, to: isDateKey(habit.activeUntil) ? habit.activeUntil : null },
    scheduledDays,
    checkIns,
    completionRate: scheduledDays ? round2(completionRate) : null,
    usualCheckInTime: usualCheckInTime(inRange, timeZone),
    mlForecast: null,
  };
  // The same signal the habit analysis sends (mlSignal), over the habit's last week of activity.
  const signal = scheduledDays ? mlSignal({
    name,
    category: facts.category,
    streak: computeStreak(habit, completions.map((item) => item.date), today, frozenDays),
    completionRate,
    missedDays: scheduledDays - checkIns,
    last7Days: Array.from({ length: 7 }, (_, index) => (done.has(shiftDay(lastDay, index - 6)) ? 1 : 0)),
  }) : null;
  return { facts, signal, weekdays };
}

/**
 * The weekdays with the best and the worst check-in rate over these habits' counted days, in week
 * order on a tie; null for both when fewer than two weekdays have two scheduled days, or all rates
 * are the same.
 */
export function weekdayStrengths(tallies) {
  const totals = new Map();
  for (const weekdays of tallies) {
    for (const [day, { scheduled, done }] of weekdays) {
      const total = totals.get(day) ?? { scheduled: 0, done: 0 };
      totals.set(day, { scheduled: total.scheduled + scheduled, done: total.done + done });
    }
  }
  const rated = WEEK_DAYS.filter((day) => (totals.get(day)?.scheduled ?? 0) >= 2).map((day) => ({ day, rate: totals.get(day).done / totals.get(day).scheduled }));
  if (rated.length < 2) return { strongestWeekday: null, weakestWeekday: null };
  const strongest = rated.reduce((best, entry) => (entry.rate > best.rate ? entry : best));
  const weakest = rated.reduce((worst, entry) => (entry.rate < worst.rate ? entry : worst));
  return strongest.rate > weakest.rate ? { strongestWeekday: strongest.day, weakestWeekday: weakest.day } : { strongestWeekday: null, weakestWeekday: null };
}

/**
 * The planner's view of the student, without the ML forecasts. `habits` are habits table rows
 * ({ id, label, category, meta, frequency, start_date, reminder_days, reminderEnabled, reminderTime,
 * activeUntil }, ids without the user prefix); `completions` are all their check-ins
 * ({ habitId, date, completedAt }). Lists the current habits, then the newest ended in the last
 * 4 weeks, at most 12. `signals` lines up with `history.habits`.
 */
export function buildPlannerHistory({ habits = [], completions = [], frozenDays = [], keptDays = {}, now = new Date(), timeZone = DEFAULT_TIME_ZONE }) {
  const today = dateKeyInZone(now, timeZone);
  const windowStart = shiftDay(today, -(LOOKBACK_DAYS - 1));
  const byHabit = new Map();
  for (const completion of completions) {
    if (!isDateKey(completion.date)) continue;
    if (!byHabit.has(completion.habitId)) byHabit.set(completion.habitId, []);
    byHabit.get(completion.habitId).push(completion);
  }
  const rows = habits.map((row) => ({ row, habit: habitFromRow(row), completions: byHabit.get(String(row.id)) ?? [] }));
  const current = rows.filter(({ habit }) => !hasHabitEnded(habit, today));
  const ended = rows
    .filter(({ habit }) => hasHabitEnded(habit, today) && habit.activeUntil >= windowStart)
    .sort((a, b) => (a.habit.activeUntil < b.habit.activeUntil ? 1 : a.habit.activeUntil > b.habit.activeUntil ? -1 : 0));
  const listed = [...current, ...ended].slice(0, MAX_HABITS)
    .map(({ row, completions: habitCompletions }) => habitHistory(row, habitCompletions, { today, windowStart, timeZone, frozenDays }));

  return {
    history: {
      today,
      weekEnds: weekEndKey(today),
      note: listed.length
        ? 'habits: the last 4 weeks, current ones first. Habits last one week (Monday to Sunday): status "ended" habits finished with their week and are history only; "current" ones run this week. scheduledDays and checkIns count from the start date to today or the habit\'s last day. completionRate is checkIns / scheduledDays (null before any counted day). usualCheckInTime is when the student usually checked it in. mlForecast is the machine-learning forecast for continuing it. strongestWeekday and weakestWeekday are the weekdays with the best and worst check-in rate over these habits (null with too little data).'
        : 'No habits in the last 4 weeks (for example a new student): plan from the goal alone.',
      accountStreakDays: accountStreak(rows.map(({ habit, completions: habitCompletions }) => ({ ...habit, completionDates: habitCompletions.map((item) => item.date) })), today, frozenDays, keptDays),
      currentHabitNames: current.map(({ row }) => String(row.label || '').trim()).filter(Boolean),
      ...weekdayStrengths(listed.map(({ weekdays }) => weekdays)),
      habits: listed.map(({ facts }) => facts),
    },
    signals: listed.map(({ signal }) => signal),
  };
}

const forecastSummary = (prediction) => ({
  completionProbability: round2(Number(prediction.completion_probability) || 0),
  dropoutRisk: round2(typeof prediction.dropout_risk === 'number' ? prediction.dropout_risk : 1 - (Number(prediction.completion_probability) || 0)),
});

/**
 * Adds each habit's ML forecast. They are asked for in parallel and all wait at most `capMs`
 * together; a habit whose forecast did not come back by then (or failed) gets the rules forecast.
 * `forecast(signal)` answers like forecastFor ({ prediction, source }).
 */
export async function withForecasts({ history, signals }, { forecast, capMs = PLANNER_FORECAST_CAP_MS }) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, capMs, null);
  });
  try {
    const predictions = await Promise.all(signals.map((signal) => (signal
      ? Promise.race([Promise.resolve().then(() => forecast(signal)).then((result) => result?.prediction ?? null, () => null), deadline])
      : null)));
    return {
      ...history,
      habits: history.habits.map((facts, index) => {
        const signal = signals[index];
        if (!signal) return facts;
        const prediction = typeof predictions[index]?.completion_probability === 'number' ? predictions[index] : rulesForecast(signal);
        return { ...facts, mlForecast: forecastSummary(prediction) };
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The planner's history of this student, read from the database (`db.query`), with ML forecasts from `ml` (config.ml). */
export async function loadPlannerHistory(db, userId, timeZone = DEFAULT_TIME_ZONE, { ml = {}, now = new Date() } = {}) {
  const [habits, completions, frozenDays, keptDays] = await runAll(db, [
    () => db.query('SELECT id, label, category, meta, frequency, start_date, reminder_days, reminder_enabled AS "reminderEnabled", reminder_time AS "reminderTime", active_until AS "activeUntil" FROM habits WHERE user_id=$1 ORDER BY sort_order, id', [userId]),
    // Every check-in: the account streak can be older than 4 weeks.
    () => db.query('SELECT habit_id AS "habitId", completed_date::text AS date, completed_at AS "completedAt" FROM habit_completions WHERE user_id=$1', [userId]),
    () => getFrozenDays(db, userId),
    () => getKeptDays(db, userId),
  ]);
  const built = buildPlannerHistory({
    habits: habits.rows.map((row) => ({ ...row, id: String(row.id).replace(`${userId}:habit:`, '') })),
    completions: completions.rows,
    frozenDays,
    keptDays,
    now,
    timeZone,
  });
  return withForecasts(built, { forecast: (signal) => forecastFor(signal, ml) });
}

/** The habit categories the planner may choose: the app's managed ones (GET /api/habit-categories), without Bad Habit. */
export async function loadPlannerCategories(db) {
  try {
    const result = await db.query('SELECT label FROM habit_categories WHERE is_active ORDER BY sort_order, label');
    return plannerCategories(result.rows.map((row) => row.label));
  } catch (error) {
    // The Admin Panel creates the table; without it the app uses its built-in categories.
    if (error?.code === '42P01') return [...DEFAULT_HABIT_CATEGORIES];
    throw error;
  }
}
