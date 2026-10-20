// The reminders the Android/iOS app has the phone schedule. The phone shows them while HabitAI is
// closed, so the next two weeks are scheduled: they keep coming on days the app is not opened, and
// are planned again (with the latest check-ins) whenever it opens.
import { getLocalDateKey } from './habit-progress';
import { canSnoozeAt, getHabitReminderTimes, isHabitReminderDay } from './reminders';
import { computeSmartReminderTimes, getSmartReminderMessage, type HabitPrediction } from './smart-reminders';
import type { Habit } from './types';

const PLAN_DAYS = 14;
// How far to look for a reminder time's next day: a monthly habit's can be a month away.
const SEARCH_DAYS = 62;

export type PlannedReminder = {
  identifier: string;
  date: Date;
  title: string;
  body: string;
  soundEnabled: boolean;
  /** Offers Snooze: a snooze tapped right away comes back before the habit is missed. */
  snooze: boolean;
  /** The notification's data. Its `plan` tells whether a scheduled reminder is still this one. */
  data: Record<string, unknown>;
};

function modelRisk(prediction: HabitPrediction | null | undefined) {
  return prediction && typeof prediction.dropout_risk === 'number' && typeof prediction.completion_probability === 'number'
    ? { dropoutRisk: prediction.dropout_risk, completionProbability: prediction.completion_probability }
    : undefined;
}

/**
 * The reminders to have scheduled at `now`, soonest first: each reminder time on the habit's days
 * of the next two weeks, from its start date, except today's once the habit is done or the time has
 * passed. At most `limit` of them (the soonest), plus the next one of every reminder time however
 * far ahead. A smart habit's times, risk and message are today's on every day.
 */
export function planReminders(habits: Habit[], now: Date, { ringInterval, limit, predictions = {} }: {
  ringInterval: number;
  limit: number;
  predictions?: Record<string, HabitPrediction | null>;
}): PlannedReminder[] {
  const today = getLocalDateKey(now);
  const candidates: (PlannedReminder & { next: boolean })[] = [];
  for (const habit of habits) {
    if (!habit.reminderEnabled || !getHabitReminderTimes(habit).length) continue;
    const prediction = predictions[habit.id];
    const smart = habit.smartReminderEnabled ? computeSmartReminderTimes(habit, now, modelRisk(prediction)) : null;
    const content = smart
      ? {
        title: `Smart reminder: ${habit.label}`,
        body: prediction?.recommended_action || getSmartReminderMessage(habit, smart.riskLevel),
        data: { habitId: habit.id, type: 'smart-reminder', riskLevel: smart.riskLevel, snoozeCount: 0 },
      }
      : { title: `${habit.label} reminder`, body: 'A small step today keeps your streak moving.', data: { habitId: habit.id, snoozeCount: 0 } };
    const soundEnabled = habit.reminderSoundEnabled !== false;
    const doneToday = habit.completionDates.includes(today);
    for (const time of smart ? smart.times : getHabitReminderTimes(habit)) {
      const snooze = canSnoozeAt(habit, time.hour * 60 + time.minute, ringInterval);
      const clock = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
      let next = true;
      for (let offset = 0; offset < SEARCH_DAYS; offset += 1) {
        // After the next one, only the two weeks ahead.
        if (!next && offset >= PLAN_DAYS) break;
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, time.hour, time.minute);
        const day = getLocalDateKey(date);
        if (date <= now || (day === today && doneToday) || (habit.startDate && day < habit.startDate) || !isHabitReminderDay(habit, date)) continue;
        // A scheduled reminder with another time (e.g. after a time zone change), text or sound is replaced.
        const plan = JSON.stringify([date.getTime(), content, soundEnabled, snooze]);
        candidates.push({ identifier: `habitai-reminder:${habit.id}:${day}:${clock}`, date, ...content, soundEnabled, snooze, data: { ...content.data, plan }, next });
        next = false;
      }
    }
  }
  candidates.sort((a, b) => a.date.getTime() - b.date.getTime());
  let room = limit - candidates.filter((reminder) => reminder.next).length;
  const planned: PlannedReminder[] = [];
  for (const { next, ...reminder } of candidates) {
    if (!next) {
      if (room <= 0) continue;
      room -= 1;
    }
    planned.push(reminder);
  }
  return planned;
}
