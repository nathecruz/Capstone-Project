import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { getDateKeyInTimeZone } from '../services/completion-date.js';
import { weekStartOf } from '../services/quests.js';

/** Validates the JSON body; on failure sends a 400 and returns null. */
export function parse(schema, request, response) {
  const result = schema.safeParse(request.body ?? {});
  if (!result.success) {
    response.status(400).json({ ok: false, message: 'Request contains invalid or unsupported fields.', issues: result.error.issues });
    return null;
  }
  return result.data;
}

export function normalizeEmail(value) {
  return String(value).trim().toLowerCase();
}

export function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function authToken(request) {
  const header = request.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The leaderboard period on the campus calendar: { start, end } (YYYY-MM-DD, both included), or
 * null for 'All Time'. This Week is Monday to Sunday and This Month the calendar month, both in
 * `timeZone`, so a Monday 01:00 check-in in Manila counts for the new week. One shared board, so
 * one zone for everyone.
 */
export function getPeriodRange(period, now = new Date(), timeZone = config.appTimeZone) {
  if (period === 'All Time') return null;
  const today = getDateKeyInTimeZone(now, timeZone);
  if (period === 'This Month') {
    const [year, month] = today.split('-').map(Number);
    return { start: `${today.slice(0, 7)}-01`, end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
  }
  const start = weekStartOf(today);
  return { start, end: shiftDay(start, 6) };
}

/** The zone's offset from UTC at `date`, in minutes (480 in Manila). */
function offsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, Number(part)]));
  return Math.round((Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute) - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/** When the period resets: 00:00 on the day after its end, in the zone (epoch ms). */
export function periodResetsAt(range, timeZone = config.appTimeZone) {
  const [year, month, day] = shiftDay(range.end, 1).split('-').map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day);
  // The offset at the guess, then at the result, so a daylight saving change that day is counted.
  const guess = midnightUtc - offsetMinutes(new Date(midnightUtc), timeZone) * 60_000;
  return midnightUtc - offsetMinutes(new Date(guess), timeZone) * 60_000;
}

/** The period as the board shows it: 'Oct 26 - Nov 1'. */
export function periodLabel(range) {
  const format = (dateKey) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${dateKey}T00:00:00Z`));
  return `${format(range.start)} - ${format(range.end)}`;
}
