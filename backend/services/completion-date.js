import { getHabitReminderTimes } from './web-push-reminders.js';

export function getDateKeyInTimeZone(date, timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function getMinutesOfDayInTimeZone(date, timeZone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return Number(values.hour) * 60 + Number(values.minute);
  } catch {
    return null;
  }
}

/** The habit's deadline for the day: its latest reminder time in minutes, or null with no active reminder. */
export function habitDeadlineMinutes(habit) {
  if (!habit?.reminderEnabled) return null;
  const times = getHabitReminderTimes(habit);
  if (!times.length) return null;
  return Math.max(...times.map((time) => time.hour * 60 + time.minute));
}

/**
 * True when the habit's last reminder time for `date` (today in the student's time zone) has already
 * passed and it is still open. A habit with no active reminder has no deadline and can be checked in
 * until the day ends.
 */
export function isPastHabitDeadline(habit, date, timeZone = 'UTC', now = new Date()) {
  const deadline = habitDeadlineMinutes(habit);
  if (deadline === null) return false;
  if (date !== getDateKeyInTimeZone(now, timeZone)) return false;
  const minutes = getMinutesOfDayInTimeZone(now, timeZone);
  return minutes !== null && minutes > deadline;
}

export function isValidCompletionDate(date, timeZone = 'UTC', now = new Date()) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false;
  try {
    return date <= getDateKeyInTimeZone(now, timeZone);
  } catch {
    return false;
  }
}

/**
 * Check-ins (and their undo) are only open for today in the student's time zone: once a day
 * is over, a missed habit stays missed and a done one stays done.
 */
export function isOpenCheckInDate(date, timeZone = 'UTC', now = new Date()) {
  if (!isValidCompletionDate(date, timeZone, now)) return false;
  return date === getDateKeyInTimeZone(now, timeZone);
}

/**
 * Seconds until a check-in of the habit for `date` (today) closes at `now`: the end of its last
 * reminder minute, or the end of the day without a reminder; 0 once closed. A reminder push lives
 * only that long, so a phone that was offline or asleep never shows it after the habit is missed.
 */
export function secondsUntilCheckInCloses(habit, date, timeZone = 'UTC', now = new Date()) {
  if (!isOpenCheckInDate(date, timeZone, now)) return 0;
  const minutes = getMinutesOfDayInTimeZone(now, timeZone);
  if (minutes === null) return 0;
  const closesAtMinute = (habitDeadlineMinutes(habit) ?? 24 * 60 - 1) + 1;
  // Time zones are whole minutes off UTC, so the seconds into the minute are the same everywhere.
  return Math.max(0, (closesAtMinute - minutes) * 60 - now.getUTCSeconds());
}

/**
 * Whether a check-in of the habit for `date` would still be accepted at `now`: the day is today
 * and the habit's last reminder time has not passed. Otherwise the habit is missed for that day
 * (or done), so a reminder about it is not sent.
 */
export function canStillCheckIn(habit, date, timeZone = 'UTC', now = new Date()) {
  if (Array.isArray(habit?.completionDates) && habit.completionDates.includes(date)) return false;
  return isOpenCheckInDate(date, timeZone, now) && !isPastHabitDeadline(habit, date, timeZone, now);
}
