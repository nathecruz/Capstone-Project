import crypto from 'node:crypto';
import { getSmartReminderTime } from './smart-reminders.js';

const reminderDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** { subject, publicKey, privateKey } when Web Push is fully configured, else null. */
export function getConfiguredVapidDetails(environment = process.env) {
  const publicKey = environment.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = environment.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = environment.WEB_PUSH_VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { subject, publicKey, privateKey } : null;
}

export function getConfiguredVapidPublicKey(environment = process.env) {
  const publicKey = environment.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = environment.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = environment.WEB_PUSH_VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? publicKey : null;
}

export function isAllowedWebPushEndpoint(value) {
  try {
    const endpoint = new URL(value);
    const hostname = endpoint.hostname.toLowerCase();
    return endpoint.protocol === 'https:' && (
      hostname === 'fcm.googleapis.com'
      || hostname === 'web.push.apple.com'
      || hostname === 'updates.push.services.mozilla.com'
      || hostname.endsWith('.push.services.mozilla.com')
      // Microsoft Edge on Windows (Windows Push Notification Services).
      || hostname.endsWith('.notify.windows.com')
    );
  } catch {
    return false;
  }
}

export function parseReminderTime(value) {
  if (typeof value !== 'string') return null;
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

export function getHabitReminderTimes(habit) {
  const configuredTimes = Array.isArray(habit.reminderTimes) && habit.reminderTimes.length
    ? habit.reminderTimes
    : [habit.reminderTime];
  const parsedTimes = configuredTimes.map(parseReminderTime).filter(Boolean);
  return [...new Map(parsedTimes.map((time) => [`${time.hour}:${time.minute}`, time])).values()];
}

export function getHabitReminderDays(habit) {
  const configuredDays = Array.isArray(habit.reminderDays) && habit.reminderDays.length
    ? habit.reminderDays
    : habit.frequency === 'Custom'
      ? String(habit.meta || '').split(' • ').at(-1).split(',').map((day) => day.trim())
      : [];
  return configuredDays.filter((day) => reminderDays.includes(day));
}

function isScheduledReminderDay(habit, local, days) {
  if (habit.frequency === 'Weekly' || habit.frequency === 'Custom') {
    if (days.length) return days.includes(local.day);
    if (habit.frequency === 'Weekly' && /^\d{4}-\d{2}-\d{2}$/.test(habit.startDate || '')) {
      const weekday = new Date(`${habit.startDate}T00:00:00Z`).getUTCDay();
      return local.day === reminderDays[weekday];
    }
    return false;
  }
  if (habit.frequency === 'Monthly') {
    const scheduledDay = Number(String(habit.startDate || '').slice(8, 10)) || 1;
    return local.dayOfMonth === scheduledDay;
  }
  return true;
}

// Creating a formatter is far slower than using one, and planning reminders formats thousands of
// minutes, so each time zone's formatter is made once.
const localFormatters = new Map();

function getLocalParts(date, timeZone) {
  try {
    let formatter = localFormatters.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
      if (localFormatters.size < 500) localFormatters.set(timeZone, formatter);
    }
    const parts = formatter.formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      day: values.weekday,
      dayOfMonth: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
    };
  } catch {
    return null;
  }
}

/**
 * Reminders due in the last `lookbackMinutes` (covers a late or skipped dispatcher run). A habit
 * with Smart Reminder on gets one reminder a day at its smart time instead of its set times;
 * those entries carry `smart: { riskLevel }`.
 */
export function getDueHabitReminders(habit, timeZone, now = new Date(), lookbackMinutes = 5) {
  const smart = habit?.smartReminderEnabled === true;
  if ((!habit?.reminderEnabled && !smart) || typeof habit.label !== 'string') return [];
  const times = getHabitReminderTimes(habit);
  const days = getHabitReminderDays(habit);
  const smartTimes = new Map();
  const timesOn = (date) => {
    if (!smart) return times;
    if (!smartTimes.has(date)) smartTimes.set(date, [getSmartReminderTime(habit, date)]);
    return smartTimes.get(date);
  };
  const due = new Map();
  for (let minutesAgo = 0; minutesAgo <= lookbackMinutes; minutesAgo += 1) {
    const candidate = new Date(now.getTime() - minutesAgo * 60_000);
    const local = getLocalParts(candidate, timeZone);
    if (!local || !isScheduledReminderDay(habit, local, days)) continue;
    if (habit.startDate && habit.startDate > local.date) continue;
    if (Array.isArray(habit.completionDates) && habit.completionDates.includes(local.date)) continue;
    for (const time of timesOn(local.date)) {
      if (time.hour === local.hour && time.minute === local.minute) {
        const formattedTime = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
        due.set(`${local.date}|${formattedTime}`, smart
          ? { date: local.date, time: formattedTime, smart: { riskLevel: time.riskLevel } }
          : { date: local.date, time: formattedTime });
      }
    }
  }
  return [...due.values()];
}

/**
 * Minutes (epoch ms, minute-aligned) in (now, now + horizonMinutes] at which any reminder of
 * these subscriptions is due. `rows` are { timeZone, state } as loaded by the dispatcher. The
 * scheduler only wakes the database at these times, so Neon can scale to zero in between.
 */
export function getReminderWakeTimes(rows, now = new Date(), horizonMinutes = 70) {
  const start = Math.floor(now.getTime() / 60_000) * 60_000;
  const wakeTimes = new Set();
  for (const { timeZone, state } of rows) {
    if (state?.preferences?.notificationsEnabled === false) continue;
    const habits = (Array.isArray(state?.habits) ? state.habits : []).filter((habit) => habit?.smartReminderEnabled === true || (habit?.reminderEnabled && getHabitReminderTimes(habit).length));
    if (!habits.length) continue;
    for (let minute = 1; minute <= horizonMinutes; minute += 1) {
      const at = start + minute * 60_000;
      if (habits.some((habit) => getDueHabitReminders(habit, timeZone, new Date(at), 0).length)) wakeTimes.add(at);
    }
  }
  return [...wakeTimes].sort((a, b) => a - b);
}

/**
 * Reminder title/body. `template` is the Admin Panel's "habit-reminder" notification
 * template ({ title, body } with a {{habit}} placeholder) or null for the built-in text.
 */
export function getReminderText(habit, template = null) {
  const name = String(habit?.label || 'Habit').slice(0, 120);
  if (!template?.title || !template?.body) {
    return { title: `${name} reminder`, body: 'A small step today keeps your streak moving.' };
  }
  const fill = (text) => String(text).replace(/\{\{\s*habit\s*\}\}/gi, name).replace(/\{\{\s*app_name\s*\}\}/gi, 'HabitAI');
  return { title: fill(template.title).slice(0, 160), body: fill(template.body).slice(0, 600) };
}

export function getSnoozeLimit(frequency) {
  if (frequency === 'Once') return 1;
  const count = Number.parseInt(frequency, 10);
  return Number.isFinite(count) ? Math.max(1, Math.min(5, count)) : 1;
}

export function hashWebPushSnoozeToken(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function getWebPushSnoozeUrl(environment = process.env) {
  const configuredUrl = environment.WEB_PUSH_API_URL?.trim() || environment.RENDER_EXTERNAL_URL?.trim();
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) return null;
    return new URL('/api/web-push/snooze', url).toString();
  } catch {
    return null;
  }
}

export function getWebPushSnoozeSettings(state, habitId, snoozeCount) {
  const savedState = typeof state === 'string' ? JSON.parse(state) : state;
  if (!savedState || savedState.preferences?.notificationsEnabled === false) return null;
  const habit = Array.isArray(savedState.habits) ? savedState.habits.find((item) => item.id === habitId) : null;
  if (!habit?.reminderEnabled && habit?.smartReminderEnabled !== true) return null;
  const snoozeLimit = getSnoozeLimit(savedState.snoozeFrequency || 'Once');
  const count = Number(snoozeCount);
  if (!Number.isInteger(count) || count < 0 || count >= snoozeLimit) return null;
  const configuredInterval = Number(savedState.ringInterval);
  const intervalMinutes = Number.isFinite(configuredInterval)
    ? Math.max(1, Math.min(1440, Math.trunc(configuredInterval)))
    : 30;
  return { habit, intervalMinutes, nextSnoozeCount: count + 1, snoozeLimit };
}