// Builds anonymized outcome rows for the ML service (ml-service/README.md → "Model evaluation").
// Each row describes one habit at one past reference day using the same features the app sends
// to /api/habit/predict, plus the observed outcome: was the habit done in the following 7 days?
// Rows never carry names, emails, habit labels, or ids.
import { computeStreak } from './streaks.js';

export const TRAINING_COLUMNS = [
  'streak', 'completion_rate', 'missed_days', 'last_7_days',
  'average_session_minutes', 'priority', 'goal_type', 'completed_next_7_days',
];

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Same category → goal_type mapping as the Insights screen. */
export function goalTypeFor(category) {
  const value = String(category || '').toLowerCase();
  if (value.includes('health')) return 'health';
  if (value.includes('mind')) return 'mindfulness';
  if (value.includes('productivity')) return 'productivity';
  return 'balanced';
}

/**
 * One row per `stepDays` reference days, starting a week after the first check-in and ending
 * so that the full 7-day outcome window lies before `today` (today itself is still in progress).
 * `sessionMinutes` is a constant: the app does not measure session length, and the ML service
 * uses the training mean when a prediction request omits it, so a constant keeps both sides equal.
 */
export function buildTrainingRows(habit, completionDates, { today, stepDays = 7, sessionMinutes = 15 } = {}) {
  const done = new Set((completionDates || []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)));
  if (!done.size || !today) return [];
  const sorted = [...done].sort();
  const lastReference = shiftDay(today, -8);
  const rows = [];
  for (let reference = shiftDay(sorted[0], 6); reference <= lastReference; reference = shiftDay(reference, stepDays)) {
    const history = sorted.filter((date) => date <= reference);
    const lastSevenDays = Array.from({ length: 7 }, (_, index) => (done.has(shiftDay(reference, index - 6)) ? 1 : 0));
    const completedDays = lastSevenDays.reduce((total, value) => total + value, 0);
    const completedNextWeek = Array.from({ length: 7 }, (_, index) => shiftDay(reference, index + 1)).some((date) => done.has(date));
    // The app derives priority from today's progress; on a past day that is "done that day or not".
    const priority = done.has(reference) ? 'low' : 'high';
    rows.push({
      streak: computeStreak(habit, history, reference),
      completion_rate: Number((completedDays / 7).toFixed(4)),
      missed_days: 7 - completedDays,
      last_7_days: lastSevenDays.join(','),
      average_session_minutes: sessionMinutes,
      priority,
      goal_type: goalTypeFor(habit?.category),
      completed_next_7_days: completedNextWeek ? 1 : 0,
    });
  }
  return rows;
}

const csvCell = (value) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

export function toCsv(rows) {
  return [TRAINING_COLUMNS.join(','), ...rows.map((row) => TRAINING_COLUMNS.map((column) => csvCell(row[column])).join(','))].join('\n') + '\n';
}
