const reminderDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

function getLocalParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
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

export function getDueHabitReminders(habit, timeZone, now = new Date()) {
  if (!habit.reminderEnabled || typeof habit.label !== 'string') return [];
  const times = getHabitReminderTimes(habit);
  const days = getHabitReminderDays(habit);
  const due = new Map();
  for (let minutesAgo = 0; minutesAgo <= 5; minutesAgo += 1) {
    const candidate = new Date(now.getTime() - minutesAgo * 60_000);
    const local = getLocalParts(candidate, timeZone);
    if (!local || !isScheduledReminderDay(habit, local, days)) continue;
    if (habit.startDate && habit.startDate > local.date) continue;
    if (Array.isArray(habit.completionDates) && habit.completionDates.includes(local.date)) continue;
    for (const time of times) {
      if (time.hour === local.hour && time.minute === local.minute) {
        const formattedTime = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
        due.set(`${local.date}|${formattedTime}`, { date: local.date, time: formattedTime });
      }
    }
  }
  return [...due.values()];
}