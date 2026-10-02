// Per-habit analysis: facts computed from the student's check-ins on the server, the ML
// service's forecast for those facts, and the AI's advice grounded in both.
import { z } from 'zod';
import { dateKeyInZone, shiftDay } from './ai-context.js';
import { computeStreak, habitSchedule, isScheduledDay } from './streaks.js';

const LOOKBACK_DAYS = 28;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayOf = (dateKey) => WEEKDAYS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()];

function hourInZone(timestamp, timeZone) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(timestamp)));
  } catch {
    return new Date(timestamp).getUTCHours();
  }
}

function formatHour(hour) {
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 || 12}:00 ${suffix}`;
}

/**
 * Facts about one habit over the last 4 weeks. `completions` are its check-ins
 * ({ date: 'YYYY-MM-DD', completedAt: ms }); days before the habit started are not counted.
 */
export function habitStats({ habit, completions, now = new Date(), timeZone = 'Asia/Manila' }) {
  const today = dateKeyInZone(now, timeZone);
  const done = new Set(completions.map((item) => item.date));
  const schedule = habitSchedule(habit);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(habit.startDate || '') ? habit.startDate : null;
  const days = Array.from({ length: LOOKBACK_DAYS }, (_, index) => shiftDay(today, index - (LOOKBACK_DAYS - 1)))
    .filter((day) => !startDate || day >= startDate);
  // Today is still open, so it only counts once it is done.
  const scheduled = days.filter((day) => isScheduledDay(schedule, day) && (day !== today || done.has(day)));
  const completed = scheduled.filter((day) => done.has(day));
  const byWeekday = new Map();
  for (const day of scheduled) {
    const entry = byWeekday.get(weekdayOf(day)) ?? { scheduled: 0, done: 0 };
    entry.scheduled += 1;
    if (done.has(day)) entry.done += 1;
    byWeekday.set(weekdayOf(day), entry);
  }
  const rated = [...byWeekday.entries()].filter(([, entry]) => entry.scheduled >= 2).map(([day, entry]) => ({ day, rate: entry.done / entry.scheduled }));
  rated.sort((a, b) => b.rate - a.rate);
  const hours = completions
    .filter((item) => days.includes(item.date) && Number.isFinite(Number(item.completedAt)))
    .map((item) => hourInZone(Number(item.completedAt), timeZone))
    .sort((a, b) => a - b);

  return {
    name: habit.label,
    category: habit.category || 'Other',
    schedule: habit.frequency || 'Daily',
    reminder: habit.reminderEnabled ? habit.reminderTime || 'on' : 'off',
    daysTracked: days.length,
    scheduledDays: scheduled.length,
    completedDays: completed.length,
    missedDays: scheduled.length - completed.length,
    completionRate: scheduled.length ? completed.length / scheduled.length : 0,
    streak: computeStreak(habit, [...done], today),
    doneToday: done.has(today),
    last7Days: Array.from({ length: 7 }, (_, index) => (done.has(shiftDay(today, index - 6)) ? 1 : 0)),
    strongestWeekday: rated.length >= 2 && rated[0].rate > rated.at(-1).rate ? rated[0].day : null,
    weakestWeekday: rated.length >= 2 && rated[0].rate > rated.at(-1).rate ? rated.at(-1).day : null,
    usualCheckInTime: hours.length >= 3 ? formatHour(hours[Math.floor(hours.length / 2)]) : null,
  };
}

/** The ML service's input for these facts (see ml-service/app/schemas.py HabitSignal). */
export function mlSignal(stats) {
  return {
    habit_name: stats.name,
    streak: stats.streak,
    completion_rate: Math.round(stats.completionRate * 1000) / 1000,
    missed_days: stats.missedDays,
    last_7_days: stats.last7Days,
    priority: 'balanced',
    goal_type: String(stats.category).toLowerCase(),
  };
}

/** The parts of the ML response the app shows. */
export function mlSummary(result) {
  if (!result || typeof result.completion_probability !== 'number') return null;
  return {
    completionProbability: result.completion_probability,
    dropoutRisk: typeof result.dropout_risk === 'number' ? result.dropout_risk : null,
    recommendedAction: String(result.recommended_action || ''),
    suggestedReminderTime: String(result.suggested_reminder_time || ''),
    source: result.is_fallback || result.prediction_source === 'fallback' ? 'rules' : 'model',
  };
}

export const HABIT_ANALYSIS_SYSTEM = `You are the HabitAI habit analyst inside HabitAI, a habit tracker used by PSAU students in the Philippines.
You get read-only facts about ONE habit, computed from the student's check-ins, and the machine-learning forecast for it.
Explain the best way for this student to keep doing this habit: when to do it, how to make it easier, and what to watch out for.
Rules:
- Use only the facts given. Never invent numbers, days or times. If there is little data (fewer than 4 scheduled days), say it is early and keep the advice general.
- Be specific, warm and realistic for a busy university student. Each step is one concrete action.
- Plain text inside the JSON strings: no markdown, emojis or bullet symbols.
- You are not a doctor. Do not give medical, legal or financial advice.`;

export const habitAnalysisJsonSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One sentence on how this habit is going, at most 120 characters.' },
    bestTime: { type: 'string', description: 'When to do it and why, at most 120 characters.' },
    steps: { type: 'array', items: { type: 'string', description: 'One concrete action, at most 140 characters.' }, minItems: 3, maxItems: 3 },
    watchOut: { type: 'string', description: 'The most likely obstacle and how to handle it, at most 160 characters.' },
  },
  required: ['headline', 'bestTime', 'steps', 'watchOut'],
};

const text = (max) => z.string().trim().min(1).transform((value) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value));
export const habitAnalysisSchema = z.object({
  headline: text(160),
  bestTime: text(160),
  steps: z.array(text(180)).min(3).transform((steps) => steps.slice(0, 3)),
  watchOut: text(200),
});

export function habitAnalysisPrompt(stats, ml) {
  const facts = {
    ...stats,
    completionRate: `${Math.round(stats.completionRate * 100)}%`,
    last7Days: stats.last7Days.map((value) => (value ? 'done' : '-')).join(' '),
  };
  return [
    'HABIT FACTS (JSON, read-only, last 4 weeks):',
    JSON.stringify(facts),
    '',
    'ML FORECAST (JSON, read-only):',
    JSON.stringify(ml ? {
      chanceToCompleteNextTime: `${Math.round(ml.completionProbability * 100)}%`,
      dropoutRisk: ml.dropoutRisk === null ? 'unknown' : `${Math.round(ml.dropoutRisk * 100)}%`,
      recommendedAction: ml.recommendedAction,
      suggestedReminderTime: ml.suggestedReminderTime,
    } : { unavailable: true }),
    '',
    'Write the analysis for the student.',
  ].join('\n');
}
