// Streaks are derived from check-in dates and the habit's schedule, never stored counters.
// The same rules live in frontend/utils/streaks.ts so the app shows the same number offline.
import { getHabitReminderDays } from './web-push-reminders.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_LOOKBACK_DAYS = 1100;

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const weekdayOf = (dateKey) => DAY_LABELS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()];

/** 'daily' | { weekly: [...days] } | { monthly: dayOfMonth } — same rules as reminder scheduling. */
export function habitSchedule(habit) {
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(habit?.startDate || '') ? habit.startDate : null;
  if (habit?.frequency === 'Monthly') {
    const day = startDate ? Number(startDate.slice(8, 10)) : 1;
    return { type: 'monthly', day: day >= 1 && day <= 31 ? day : 1 };
  }
  if (habit?.frequency === 'Weekly' || habit?.frequency === 'Custom') {
    const days = getHabitReminderDays({ ...habit, meta: habit.meta || '' });
    if (!days.length && habit.frequency === 'Weekly' && startDate) return { type: 'weekly', days: [weekdayOf(startDate)] };
    return { type: 'weekly', days };
  }
  return { type: 'daily' };
}

export function isScheduledDay(schedule, dateKey) {
  if (schedule.type === 'weekly') return schedule.days.includes(weekdayOf(dateKey));
  if (schedule.type === 'monthly') return Number(dateKey.slice(8, 10)) === schedule.day;
  return true;
}

/**
 * A `habits` table row (frequency, start_date, reminder_days, meta) as the habit shape used
 * here. Rows synced before those columns existed fall back to the frequency in `meta`.
 */
export function habitFromRow(row) {
  const metaFrequency = String(row?.meta || '').split('•')[0].trim();
  return {
    frequency: row?.frequency || (['Weekly', 'Monthly', 'Custom'].includes(metaFrequency) ? metaFrequency : 'Daily'),
    startDate: row?.start_date || row?.startDate || '',
    reminderDays: Array.isArray(row?.reminder_days) ? row.reminder_days : Array.isArray(row?.reminderDays) ? row.reminderDays : [],
    meta: row?.meta || '',
  };
}

/**
 * Consecutive scheduled days completed, counting back from `today`.
 * Today only extends the streak once done; an unfinished today never breaks it.
 * Unscheduled days are skipped, so a Mon/Wed/Fri habit is not broken on Tuesday, and so are days
 * covered by a streak freeze (`frozenDays`): they neither count nor break the streak.
 */
export function computeStreak(habit, completionDates, today, frozenDays = []) {
  const done = new Set((completionDates || []).filter((date) => typeof date === 'string'));
  if (!done.size) return 0;
  const frozen = new Set(frozenDays);
  const schedule = habitSchedule(habit);
  if (schedule.type === 'weekly' && !schedule.days.length) return 0;
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(habit?.startDate || '') ? habit.startDate : null;
  let streak = 0;
  for (let offset = 0; offset < MAX_LOOKBACK_DAYS; offset += 1) {
    const day = shiftDay(today, -offset);
    if (startDate && day < startDate && !done.has(day)) break;
    if (!isScheduledDay(schedule, day)) continue;
    if (frozen.has(day) && !done.has(day)) continue;
    if (done.has(day)) streak += 1;
    else if (day !== today) break;
  }
  return streak;
}
