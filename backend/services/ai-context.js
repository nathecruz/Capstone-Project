// Builds the compact, factual snapshot of a student's habits that AI prompts are grounded in.
// It is computed on the server from database records, never taken from the client.
// Habits last one week (services/habit-week.js): this week's habits are listed apart from those of
// the past 4 weeks, which are only history.
import { accountStreak } from './account-streak.js';
import { hasHabitEnded } from './habit-week.js';
import { habitFromRow, habitSchedule, isScheduledDay } from './streaks.js';

const PAST_WEEKS_DAYS = 28;

export function dateKeyInZone(date, timeZone = 'Asia/Manila') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

export function habitFrequency(meta) {
  const first = String(meta || '').split('•')[0].trim();
  if (first === 'Daily' || first === 'Weekly' || first === 'Monthly') return first;
  if (!first) return 'Daily';
  const days = String(meta).split('•').at(-1).trim();
  return /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(days) ? `Custom (${days})` : `Custom (${first})`;
}

/**
 * Scheduled days of a habit from its start date (or `from`) to its last day, and how many of them
 * were checked in.
 */
function weekResults(habit, dates, from, lastDay) {
  const schedule = habitSchedule(habit);
  let scheduledDays = 0;
  let checkIns = 0;
  const first = habit.startDate && habit.startDate > from ? habit.startDate : from;
  for (let day = first; day <= lastDay; day = shiftDay(day, 1)) {
    if (!isScheduledDay(schedule, day)) continue;
    scheduledDays += 1;
    if (dates.has(day)) checkIns += 1;
  }
  return { scheduledDays, checkIns, completionRate: scheduledDays ? Math.round((checkIns / scheduledDays) * 100) / 100 : null };
}

/**
 * @param {object} input
 * @param {{id:string,label:string,category?:string,meta?:string,frequency?:string,start_date?:string,activeUntil?:string,reminder_days?:string[],streak?:number,reminderEnabled?:boolean,reminderTime?:string}[]} input.habits
 *   every habit, also those whose week has ended (`activeUntil`, YYYY-MM-DD)
 * @param {{habitId:string,date:string}[]} input.completions  check-ins (YYYY-MM-DD) of the last 4 weeks, any order
 * @param {{title:string,category?:string,progress?:number,status?:string,details?:object}[]} [input.goals]
 * @param {Date} [input.now]
 * @param {string} [input.timeZone]
 * @param {string[]} [input.frozenDays]  days a streak freeze covered
 * @param {Object<string,string>} [input.keptDays]  days the account streak keeps (services/streak-history.js)
 * @param {number} [input.accountStreakDays]  the account streak, when the caller has every check-in
 *   (otherwise it is counted from `completions`, so at most 4 weeks)
 */
export function buildHabitContext({ habits = [], completions = [], goals = [], now = new Date(), timeZone = 'Asia/Manila', frozenDays = [], keptDays = {}, accountStreakDays }) {
  const today = dateKeyInZone(now, timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(now);
  const last7 = Array.from({ length: 7 }, (_, index) => shiftDay(today, index - 6));
  const previous7Start = shiftDay(today, -13);
  const pastStart = shiftDay(today, -(PAST_WEEKS_DAYS - 1));

  const datesByHabit = new Map();
  for (const completion of completions) {
    if (!datesByHabit.has(completion.habitId)) datesByHabit.set(completion.habitId, new Set());
    datesByHabit.get(completion.habitId).add(completion.date);
  }
  // Each habit with its schedule fields, from a table row (start_date...) or a synced habit (startDate...).
  const all = habits.map((habit) => ({ habit, fields: habitFromRow(habit), dates: datesByHabit.get(habit.id) ?? new Set() }));
  const current = all.filter(({ fields }) => !hasHabitEnded(fields, today));
  const past = all
    .filter(({ fields }) => hasHabitEnded(fields, today) && fields.activeUntil >= pastStart)
    .sort((a, b) => b.fields.activeUntil.localeCompare(a.fields.activeUntil));

  // Check-ins are history: those of every habit count, ended or not.
  let checkInsLast7 = 0;
  let checkInsPrevious7 = 0;
  for (const { dates } of all) {
    for (const date of dates) {
      if (date >= last7[0] && date <= today) checkInsLast7 += 1;
      else if (date >= previous7Start && date < last7[0]) checkInsPrevious7 += 1;
    }
  }

  const habitFacts = current.slice(0, 25).map(({ habit, dates }) => {
    const sorted = [...dates].filter((date) => date <= today).sort();
    const lastCheckIn = sorted.at(-1) ?? null;
    return {
      name: String(habit.label || 'Habit').slice(0, 60),
      category: habit.category || 'Other',
      frequency: habitFrequency(habit.meta),
      reminder: habit.reminderEnabled ? habit.reminderTime || 'on' : 'off',
      currentStreakDays: Math.max(0, Number(habit.streak) || 0),
      doneToday: dates.has(today),
      last7Days: last7.map((day) => (dates.has(day) ? 1 : 0)),
      checkInsLast14Days: sorted.filter((date) => date >= previous7Start).length,
      lastCheckIn,
      daysSinceLastCheckIn: lastCheckIn ? daysBetween(lastCheckIn, today) : null,
    };
  });

  // Counted only up to the day each habit's week ended.
  const pastHabits = past.slice(0, 15).map(({ habit, fields, dates }) => ({
    name: String(habit.label || 'Habit').slice(0, 60),
    category: habit.category || 'Other',
    frequency: habitFrequency(habit.meta),
    weekEnded: fields.activeUntil,
    ...weekResults(fields, dates, pastStart, fields.activeUntil),
  }));

  const daily = habitFacts.filter((habit) => habit.frequency === 'Daily' && !habit.doneToday);
  const needsAttention = daily.sort((a, b) => (b.daysSinceLastCheckIn ?? 99) - (a.daysSinceLastCheckIn ?? 99))[0];

  return {
    today,
    weekday,
    note: 'Habits last one week (Monday to Sunday). habits are this week\'s; pastHabits ended with their week and are history only (the student no longer tracks them), counted up to the day they ended. last7Days lists check-ins from 6 days ago to today (1 = checked in). accountStreakDays counts days in a row with any check-in.',
    summary: {
      habitsTracked: current.length,
      doneToday: habitFacts.filter((habit) => habit.doneToday).length,
      checkInsLast7Days: checkInsLast7,
      checkInsPrevious7Days: checkInsPrevious7,
      bestCurrentStreakDays: Math.max(0, ...habitFacts.map((habit) => habit.currentStreakDays)),
      accountStreakDays: Number.isFinite(accountStreakDays)
        ? accountStreakDays
        : accountStreak(all.map(({ fields, dates }) => ({ ...fields, completionDates: [...dates] })), today, frozenDays, keptDays),
      dailyHabitNeedingAttention: needsAttention?.name ?? null,
    },
    habits: habitFacts,
    pastHabits,
    goals: goals.slice(0, 5).map((goal) => {
      const steps = Array.isArray(goal.details?.actionPlan) ? goal.details.actionPlan : [];
      const done = Array.isArray(goal.details?.completedSteps) ? goal.details.completedSteps : [];
      const nextIndex = steps.findIndex((_, index) => !done[index]);
      return {
        title: String(goal.title || '').slice(0, 80),
        category: goal.category || '',
        progressPercent: Math.max(0, Math.min(100, Number(goal.progress) || 0)),
        status: goal.status || '',
        nextStep: nextIndex >= 0 ? String(steps[nextIndex]).slice(0, 100) : null,
      };
    }),
  };
}
