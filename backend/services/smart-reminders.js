// Smart reminders over Web Push: the reminder time moves with the habit's recent record, like the
// app's smart reminders (frontend/hooks/app-state/smart-reminders.ts). A habit at risk of being
// skipped is reminded 30 minutes before its set time, one going well a little later, and the
// message matches. The record is the 7 days before today, which no longer change during the day,
// so the time stays the same all day.
import { computeStreak, habitSchedule, isScheduledDay } from './streaks.js';
import { getHabitReminderTimes } from './web-push-reminders.js';

const DEFAULT_TIME = { hour: 9, minute: 0 };
const OFFSET_MINUTES = { high: -30, medium: 15, low: 45 };

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 'high' | 'medium' | 'low': how likely the habit is to be skipped, from the 7 days before `date`. */
export function smartReminderRisk(habit, date) {
  const done = new Set((Array.isArray(habit?.completionDates) ? habit.completionDates : []).filter((day) => typeof day === 'string'));
  const schedule = habitSchedule(habit);
  let scheduled = 0;
  let completed = 0;
  for (let back = 1; back <= 7; back += 1) {
    const day = shiftDay(date, -back);
    if (habit?.startDate && day < habit.startDate) continue;
    if (!isScheduledDay(schedule, day)) continue;
    scheduled += 1;
    if (done.has(day)) completed += 1;
  }
  const rate = scheduled ? completed / scheduled : 0;
  const streak = computeStreak(habit, [...done], shiftDay(date, -1));
  return rate < 0.4 || streak <= 1 ? 'high' : rate < 0.7 ? 'medium' : 'low';
}

/** The smart reminder's time on `date`: the habit's earliest set time (9:00 AM without one), moved by risk. */
export function getSmartReminderTime(habit, date) {
  const base = getHabitReminderTimes(habit).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))[0] ?? DEFAULT_TIME;
  const riskLevel = smartReminderRisk(habit, date);
  const minutes = Math.min(23 * 60 + 59, Math.max(0, base.hour * 60 + base.minute + OFFSET_MINUTES[riskLevel]));
  return { hour: Math.floor(minutes / 60), minute: minutes % 60, riskLevel };
}

export function getSmartReminderText(habit, riskLevel) {
  const name = String(habit?.label || 'Habit').slice(0, 120);
  const body = {
    low: `You have a good rhythm with ${name}. Keep the momentum going with one small win today.`,
    medium: `A quick ${name} check-in now could help you stay on track before the day gets busy.`,
    high: `${name} is at risk of being skipped today. A short action now will protect your streak.`,
  }[riskLevel] ?? `A small step on ${name} today keeps your streak moving.`;
  return { title: `Smart reminder: ${name}`, body };
}
