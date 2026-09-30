// Live habit streaks for the Admin Panel. The `habits.streak` column is only as fresh as the
// student's last sync, so a student who stopped using the app would keep an old streak.
// These are the same rules as the app backend (backend/services/streaks.js): consecutive
// scheduled days with a check-in, counting back from today; an unfinished today does not
// break the streak and unscheduled days are skipped.
import { query } from '../db.js';
import { todayInZone } from './metrics.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_LOOKBACK_DAYS = 1100;

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const weekdayOf = (dateKey) => DAY_LABELS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()];

/** Schedule from a habits row (frequency, start_date, reminder_days, meta). */
export function habitSchedule(row) {
  const meta = String(row?.meta || '');
  const metaFrequency = meta.split('•')[0].trim();
  const frequency = row?.frequency || (['Weekly', 'Monthly', 'Custom'].includes(metaFrequency) ? metaFrequency : 'Daily');
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(row?.start_date || '') ? row.start_date : null;
  if (frequency === 'Monthly') {
    const day = startDate ? Number(startDate.slice(8, 10)) : 1;
    return { type: 'monthly', day: day >= 1 && day <= 31 ? day : 1, startDate };
  }
  if (frequency === 'Weekly' || frequency === 'Custom') {
    const configured = Array.isArray(row?.reminder_days) && row.reminder_days.length
      ? row.reminder_days
      : frequency === 'Custom' ? (meta.split(' • ').at(-1) || '').split(',').map((day) => day.trim()) : [];
    const days = configured.filter((day) => DAY_LABELS.includes(day));
    if (!days.length && frequency === 'Weekly' && startDate) return { type: 'weekly', days: [weekdayOf(startDate)], startDate };
    return { type: 'weekly', days, startDate };
  }
  return { type: 'daily', startDate };
}

function isScheduledDay(schedule, dateKey) {
  if (schedule.type === 'weekly') return schedule.days.includes(weekdayOf(dateKey));
  if (schedule.type === 'monthly') return Number(dateKey.slice(8, 10)) === schedule.day;
  return true;
}

export function computeStreak(row, completionDates, today) {
  const done = new Set(completionDates);
  if (!done.size) return 0;
  const schedule = habitSchedule(row);
  if (schedule.type === 'weekly' && !schedule.days.length) return 0;
  let streak = 0;
  for (let offset = 0; offset < MAX_LOOKBACK_DAYS; offset += 1) {
    const day = shiftDay(today, -offset);
    if (schedule.startDate && day < schedule.startDate && !done.has(day)) break;
    if (!isScheduledDay(schedule, day)) continue;
    if (done.has(day)) streak += 1;
    else if (day !== today) break;
  }
  return streak;
}

/**
 * Map of habits.id -> live streak, for one student (`userId`) or all students.
 */
export async function loadLiveStreaks(timeZone, userId = null) {
  const today = todayInZone(timeZone);
  const filter = userId ? 'WHERE h.user_id = $1' : "JOIN users u ON u.id = h.user_id AND u.role = 'user'";
  const params = userId ? [userId] : [];
  const [habits, completions] = await Promise.all([
    query(`SELECT h.id, h.meta, h.frequency, h.start_date, h.reminder_days FROM habits h ${filter}`, params),
    query(
      `SELECT hc.user_id || ':habit:' || hc.habit_id AS "habitId", hc.completed_date::text AS date
         FROM habit_completions hc ${userId ? 'WHERE hc.user_id = $1' : "JOIN users u ON u.id = hc.user_id AND u.role = 'user'"}`,
      params,
    ),
  ]);
  const datesByHabit = new Map();
  for (const { habitId, date } of completions.rows) {
    if (!datesByHabit.has(habitId)) datesByHabit.set(habitId, []);
    datesByHabit.get(habitId).push(date);
  }
  return new Map(habits.rows.map((row) => [row.id, computeStreak(row, datesByHabit.get(row.id) || [], today)]));
}
