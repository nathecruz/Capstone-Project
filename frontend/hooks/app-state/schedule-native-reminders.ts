// Schedules the Android/iOS reminders the phone shows while HabitAI is closed (the plan of
// native-reminders.ts). Used by the reminders hook while the app is open and by the Android
// background reminder sync (reminder-sync.ts) while it is not; one schedule runs at a time, so one
// cannot cancel a reminder the other just scheduled.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getCurrentSession } from '@/authentication/session';
import { planReminders, type PlannedReminder } from './native-reminders';
import { getHabitReminderTimes, type NotificationsModule } from './reminders';
import { requestHabitPrediction, type HabitPrediction } from './smart-reminders';
import { keepsSnooze, SNOOZE_CATEGORY } from './snooze';
import type { Habit } from './types';

export type ReminderPredictions = Record<string, HabitPrediction | null>;

// The smart reminders' last predictions, per account: the background sync schedules with them
// instead of asking the server (and waking the ML service) every hour.
const PREDICTIONS_KEY_PREFIX = 'habitai_reminder_predictions:';

let queue: Promise<unknown> = Promise.resolve();

/** Runs `task` once the schedule before it has finished. */
export function runReminderScheduling<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

async function predictionsKey() {
  const email = (await getCurrentSession())?.email.trim().toLowerCase();
  return email ? `${PREDICTIONS_KEY_PREFIX}${email}` : null;
}

/** The predictions the app last scheduled with on this device ({} when none). */
export async function loadSavedPredictions(): Promise<ReminderPredictions> {
  try {
    const key = await predictionsKey();
    const saved = key ? JSON.parse((await AsyncStorage.getItem(key)) ?? '{}') as unknown : {};
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as ReminderPredictions : {};
  } catch {
    return {};
  }
}

async function savePredictions(predictions: ReminderPredictions) {
  try {
    const key = await predictionsKey();
    if (key) await AsyncStorage.setItem(key, JSON.stringify(predictions));
  } catch {
    // Storage unavailable: the background sync schedules smart reminders from the rules instead.
  }
}

/**
 * Schedules the reminders of `habits` (this week's): a reminder already scheduled as planned stays,
 * the others are cancelled, except a snooze the student asked for that can still be acted on.
 * `predictions`: 'ask' asks the server for each smart habit's (and keeps them on the device), else
 * the ones given. `rearm`: Android removes an app's alarms when it is force stopped (some phones do
 * it when the app is swiped away) while expo-notifications still lists them as scheduled, and an
 * alarm set before exact alarms were allowed stays inexact, so every planned reminder is scheduled
 * again, which sets its alarm. `askPermission`: notification permission may be asked for (never
 * from the background). Returns false when `isCancelled` stopped it.
 */
export async function scheduleNativeReminders(Notifications: NotificationsModule, { habits, notificationsEnabled, ringInterval, rearm, predictions, askPermission, isCancelled = () => false }: {
  habits: Habit[];
  notificationsEnabled: boolean;
  ringInterval: number;
  rearm: boolean;
  predictions: 'ask' | ReminderPredictions;
  askPermission: boolean;
  isCancelled?: () => boolean;
}): Promise<boolean> {
  await Notifications.setNotificationCategoryAsync(SNOOZE_CATEGORY, [{
    identifier: 'SNOOZE',
    buttonTitle: 'Snooze',
    options: { opensAppToForeground: false },
  }]);
  const reminders = notificationsEnabled ? habits.filter((habit) => habit.reminderEnabled && getHabitReminderTimes(habit).length > 0) : [];
  let plan: PlannedReminder[] = [];
  if (reminders.length) {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('habit-reminders-sound-v2', {
        name: 'Habit reminders', importance: Notifications.AndroidImportance.HIGH, sound: 'reminder_sound.mp3',
      });
      await Notifications.setNotificationChannelAsync('habit-reminders-silent-v2', {
        name: 'Silent habit reminders', importance: Notifications.AndroidImportance.HIGH, sound: null,
      });
    }
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status === 'granted' || (askPermission && (await Notifications.requestPermissionsAsync()).status === 'granted')) {
      let known = predictions === 'ask' ? {} : predictions;
      if (predictions === 'ask') {
        known = Object.fromEntries(await Promise.all(reminders
          .filter((habit) => habit.smartReminderEnabled)
          .map(async (habit) => [habit.id, await requestHabitPrediction(habit)] as const)));
        void savePredictions(known);
      }
      if (isCancelled()) return false;
      // iOS keeps 64 scheduled notifications: a place is left for a snooze of each habit.
      // Android allows 500 alarms per app.
      plan = planReminders(reminders, new Date(), { ringInterval, predictions: known, limit: Platform.OS === 'ios' ? 64 - reminders.length : 200 });
    }
  }
  const scheduledNow = new Date();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  if (isCancelled()) return false;
  const planned = new Map(plan.map((reminder) => [reminder.identifier, reminder]));
  await Promise.all(scheduled
    .filter((request) => !planned.has(request.identifier) && !(notificationsEnabled && keepsSnooze(request, habits, scheduledNow)))
    .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)));
  const current = new Set(rearm ? [] : scheduled
    .filter((request) => planned.has(request.identifier) && request.content.data?.plan === planned.get(request.identifier)?.data.plan)
    .map((request) => request.identifier));
  for (const reminder of plan) {
    if (isCancelled()) return false;
    if (current.has(reminder.identifier)) continue;
    // Scheduling it again under its identifier replaces an outdated one. One that cannot be
    // scheduled (its time passed meanwhile) does not stop the rest.
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.identifier,
      content: {
        title: reminder.title,
        body: reminder.body,
        sound: reminder.soundEnabled ? 'reminder_sound.mp3' : false,
        data: reminder.data,
        ...(reminder.snooze ? { categoryIdentifier: SNOOZE_CATEGORY } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.date,
        ...(Platform.OS === 'android' ? { channelId: reminder.soundEnabled ? 'habit-reminders-sound-v2' : 'habit-reminders-silent-v2' } : {}),
      },
    }).catch(() => undefined);
  }
  return true;
}
