// Reminder times as students see them ("07:30 AM"): building them, naming the part of the day,
// sorting, the wait until the next one, and the "Daily • 07:30 AM" part of a habit's meta.
export type Period = 'AM' | 'PM';

/** "07:30 AM" or "19:30" as 24-hour { hour, minute }, or null. */
export function parseReminderTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3]?.toUpperCase();
  if (!Number.isInteger(minute) || minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

export const MAX_REMINDER_TIMES = 2;

/** Quick picks for the time picker. */
export const REMINDER_PRESETS = [
  { label: 'Morning', time: '07:00 AM', icon: 'sunny-outline' },
  { label: 'Lunch', time: '12:00 PM', icon: 'restaurant-outline' },
  { label: 'After class', time: '04:00 PM', icon: 'school-outline' },
  { label: 'Evening', time: '07:00 PM', icon: 'partly-sunny-outline' },
  { label: 'Before bed', time: '09:30 PM', icon: 'moon-outline' },
] as const;

export function formatReminderTime(hour12: number, minute: number, period: Period) {
  return `${String(hour12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${period}`;
}

/** The picker's time moved by `minutes` (negative for earlier), round midnight too: 11:59 PM + 1 is 12:00 AM. */
export function shiftReminderParts(parts: { hour: number; minute: number; period: Period }, minutes: number): { hour: number; minute: number; period: Period } {
  const total = ((parts.hour % 12) + (parts.period === 'PM' ? 12 : 0)) * 60 + parts.minute;
  const next = (((total + minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour24 = Math.floor(next / 60);
  return { hour: hour24 % 12 || 12, minute: next % 60, period: hour24 < 12 ? 'AM' : 'PM' };
}

/**
 * What an hour or minute field holds after a change: digits only, at most two. Typing into a full
 * field starts it over with the digits just typed, wherever the cursor was ("75" + 4 → "4").
 */
export function nextTimeFieldText(previous: string, input: string) {
  const digits = input.replace(/\D/g, '');
  if (digits.length <= 2) return digits;
  let start = 0;
  while (start < previous.length && previous[start] === digits[start]) start += 1;
  let end = 0;
  while (end < previous.length - start && previous[previous.length - 1 - end] === digits[digits.length - 1 - end]) end += 1;
  return (digits.slice(start, digits.length - end) || digits).slice(-2);
}

/** A typed hour (1 to 12) or minute (0 to 59), or null while the text is not one. */
export function readTimeField(text: string, field: 'hour' | 'minute') {
  if (!/^\d{1,2}$/.test(text)) return null;
  const value = Number(text);
  if (field === 'hour') return value >= 1 && value <= 12 ? value : null;
  return value <= 59 ? value : null;
}

/** "07:30 AM" as its parts, for the picker; a time it cannot read becomes 07:00 AM. */
export function reminderParts(time: string): { hour: number; minute: number; period: Period } {
  const parsed = parseReminderTime(time);
  if (!parsed) return { hour: 7, minute: 0, period: 'AM' };
  return { hour: parsed.hour % 12 || 12, minute: parsed.minute, period: parsed.hour < 12 ? 'AM' : 'PM' };
}

const minutesOfDay = (time: string) => {
  const parsed = parseReminderTime(time);
  return parsed ? parsed.hour * 60 + parsed.minute : null;
};

/** Morning (5 AM to noon), afternoon (to 6 PM), evening (to 9 PM) or night. */
export function partOfDay(time: string) {
  const minutes = minutesOfDay(time);
  if (minutes === null) return 'Reminder';
  if (minutes >= 5 * 60 && minutes < 12 * 60) return 'Morning';
  if (minutes >= 12 * 60 && minutes < 18 * 60) return 'Afternoon';
  if (minutes >= 18 * 60 && minutes < 21 * 60) return 'Evening';
  return 'Night';
}

/** Earliest first. */
export function sortReminderTimes(times: string[]) {
  return [...times].sort((left, right) => (minutesOfDay(left) ?? 0) - (minutesOfDay(right) ?? 0));
}

/** "in 2 h 15 min" (or "in 19 h" when it is hours away) until the time next comes round (today, or tomorrow if it has passed). */
export function timeUntil(time: string, now: Date) {
  const minutes = minutesOfDay(time);
  if (minutes === null) return '';
  const current = now.getHours() * 60 + now.getMinutes();
  const wait = (minutes - current + 24 * 60) % (24 * 60) || 24 * 60;
  const hours = Math.floor(wait / 60);
  const rest = hours >= 3 ? 0 : wait % 60;
  return `in ${hours ? `${hours} h` : ''}${hours && rest ? ' ' : ''}${rest ? `${rest} min` : ''}`;
}

/**
 * A habit's meta with new reminder times: "Daily • 07:00 AM, 09:30 PM" (or "Anytime" with none).
 * A custom schedule's days ("... • Mon, Wed") stay at the end.
 */
export function metaWithReminders(meta: string, times: string[] | null) {
  const [schedule = 'Daily', , ...rest] = meta.split(' • ');
  const when = times?.length ? sortReminderTimes(times).join(', ') : 'Anytime';
  return [schedule, when, ...rest].join(' • ');
}
