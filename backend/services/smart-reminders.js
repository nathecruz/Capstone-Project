// Smart reminders over Web Push, like the app's (frontend/hooks/app-state/smart-reminders.ts).
// The student is always reminded at the times they set; Smart Reminder adds a message that fits
// the habit's recent record and, for a habit at risk of being skipped, an extra nudge 30 minutes
// before the earliest set time. (It used to move the reminder itself, so a new habit, always "at
// risk", was reminded 30 minutes early, often before it even existed, and never at its time.)
// The record is the 7 days before today, which no longer change during the day.
import { computeStreak, habitSchedule, isScheduledDay } from './streaks.js';
import { getHabitReminderTimes } from './web-push-reminders.js';

const DEFAULT_TIME = { hour: 9, minute: 0 };
const EARLY_NUDGE_MINUTES = 30;

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

/**
 * The smart reminder times on `date`: every set time (9:00 AM without one), plus, when the habit is
 * at risk, a nudge 30 minutes before the earliest one (not before midnight). Each carries the risk.
 */
export function getSmartReminderTimes(habit, date) {
  const set = getHabitReminderTimes(habit).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  const times = set.length ? set : [DEFAULT_TIME];
  const riskLevel = smartReminderRisk(habit, date);
  const result = times.map((time) => ({ hour: time.hour, minute: time.minute, riskLevel }));
  if (riskLevel === 'high') {
    const early = Math.max(0, times[0].hour * 60 + times[0].minute - EARLY_NUDGE_MINUTES);
    if (!result.some((time) => time.hour * 60 + time.minute === early)) result.unshift({ hour: Math.floor(early / 60), minute: early % 60, riskLevel, early: true });
  }
  return result;
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
