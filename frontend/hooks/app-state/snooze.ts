// Snooze on Android/iOS reminders: schedules the snooze a tapped Snooze asks for, and decides which
// pending snoozes stay when the app schedules its reminders again. Used by the reminders hook and,
// on Android, by the background task that handles a Snooze tapped while HabitAI is closed.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotificationRequest, NotificationResponse } from 'expo-notifications';
import { Platform } from 'react-native';
import { getCurrentSession } from '@/authentication/session';
import { getLocalDateKey } from './habit-progress';
import { canRemindAt, canSnoozeAt, getSnoozeLimit, notificationShownAt, type NotificationsModule } from './reminders';
import { APP_STATE_KEY_PREFIX } from './sync-storage';
import type { Habit } from './types';

export const SNOOZE_CATEGORY = 'habit-reminder-snooze';
const HANDLED_SNOOZES_KEY = 'habitai_handled_snoozes';
const handledSnoozes = new Set<string>();

export type SnoozeSettings = { habits: Habit[]; ringInterval: number; snoozeFrequency: string };

/**
 * Whether a scheduled notification is a snooze to keep when the reminders are scheduled again: its
 * habit still exists with reminders on, and it comes back while the habit can still be checked in.
 * Regular reminders are not kept; they are scheduled again from the habits.
 */
export function keepsSnooze(request: NotificationRequest, habits: Habit[], now = new Date()) {
  const data = request.content.data ?? {};
  if (!(Number(data.snoozeCount) > 0)) return false;
  const habit = habits.find((item) => item.id === data.habitId);
  if (!habit || (!habit.reminderEnabled && !habit.smartReminderEnabled)) return false;
  // Snoozes set by older versions have no time; they are kept while the habit is still open now.
  const snoozeAt = Number(data.snoozeAt);
  return canRemindAt(habit, snoozeAt > 0 ? new Date(snoozeAt) : now, now);
}

/** One snooze per tap: claimed by the app or the background task, and never again after a restart. */
async function claimSnooze(key: string) {
  if (handledSnoozes.has(key)) return false;
  handledSnoozes.add(key);
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(HANDLED_SNOOZES_KEY)) ?? '[]') as string[];
    if (saved.includes(key)) return false;
    await AsyncStorage.setItem(HANDLED_SNOOZES_KEY, JSON.stringify([...saved, key].slice(-50)));
  } catch {
    // Storage unavailable: it is still handled once while the app runs.
  }
  return true;
}

/**
 * Schedules the snooze a tapped Snooze asks for; false when there is none to set. None is set for a
 * reminder from an older day, past the snooze limit, or when it would come back once the habit is
 * done or missed. A habit has one pending snooze at most: a newer one replaces it.
 */
export async function snoozeReminder(Notifications: NotificationsModule, response: NotificationResponse, { habits, ringInterval, snoozeFrequency }: SnoozeSettings, now = new Date()) {
  if (response.actionIdentifier !== 'SNOOZE') return false;
  if (!await claimSnooze(`${response.notification.request.identifier}:SNOOZE`)) return false;
  const data = response.notification.request.content.data ?? {};
  const snoozeCount = Number(data.snoozeCount) || 0;
  const snoozeLimit = getSnoozeLimit(snoozeFrequency);
  if (snoozeCount >= snoozeLimit) return false;
  const habitId = typeof data.habitId === 'string' ? data.habitId : '';
  const habit = habits.find((item) => item.id === habitId);
  const snoozeAt = new Date(now.getTime() + ringInterval * 60_000);
  if (getLocalDateKey(notificationShownAt(response.notification.date, now)) !== getLocalDateKey(now)) return false;
  if (habit && !canRemindAt(habit, snoozeAt, now)) return false;
  const soundEnabled = habit?.reminderSoundEnabled !== false;
  const channel = Platform.OS === 'android'
    ? { channelId: soundEnabled ? 'habit-reminders-sound-v2' : 'habit-reminders-silent-v2' }
    : {};
  const content = response.notification.request.content;
  const nextSnoozeCount = snoozeCount + 1;
  await Notifications.scheduleNotificationAsync({
    ...(habitId ? { identifier: `habitai-snooze:${habitId}` } : {}),
    content: {
      title: content.title || 'Habit reminder',
      body: content.body || 'A small step today keeps your streak moving.',
      sound: soundEnabled ? 'reminder_sound.mp3' : false,
      data: { ...data, snoozeCount: nextSnoozeCount, snoozeAt: snoozeAt.getTime() },
      // Snooze again only while that snooze could still come back before the habit is missed.
      ...(nextSnoozeCount < snoozeLimit && (!habit || canSnoozeAt(habit, snoozeAt.getHours() * 60 + snoozeAt.getMinutes(), ringInterval)) ? { categoryIdentifier: SNOOZE_CATEGORY } : {}),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: snoozeAt, ...channel },
  });
  return true;
}

/**
 * The signed-in account's habits and snooze settings as last saved on this device, for a Snooze
 * handled before the app has loaded them (or by the background task); null when signed out.
 */
export async function loadSnoozeSettings(): Promise<(SnoozeSettings & { notificationsEnabled: boolean }) | null> {
  try {
    const email = (await getCurrentSession())?.email.trim().toLowerCase();
    if (!email) return null;
    const saved = JSON.parse((await AsyncStorage.getItem(`${APP_STATE_KEY_PREFIX}${email}`)) ?? '{}') as {
      habits?: Habit[]; ringInterval?: number; snoozeFrequency?: string; preferences?: { notificationsEnabled?: boolean };
    };
    return {
      habits: Array.isArray(saved.habits) ? saved.habits : [],
      ringInterval: typeof saved.ringInterval === 'number' ? saved.ringInterval : 30,
      snoozeFrequency: typeof saved.snoozeFrequency === 'string' ? saved.snoozeFrequency : 'Once',
      notificationsEnabled: saved.preferences?.notificationsEnabled !== false,
    };
  } catch {
    return null;
  }
}

/**
 * The notification response in an Android background task's payload, or null for anything else.
 * There the notification's data arrives as a JSON string (`dataString`), not yet parsed.
 */
export function responseFromTaskPayload(payload: unknown): NotificationResponse | null {
  const response = payload as { actionIdentifier?: unknown; notification?: { date?: unknown; request?: { identifier?: unknown; content?: Record<string, unknown> } } } | null;
  const request = response?.notification?.request;
  if (typeof response?.actionIdentifier !== 'string' || typeof request?.identifier !== 'string') return null;
  const content = request.content ?? {};
  let data = content.data as Record<string, unknown> | undefined;
  if (!data && typeof content.dataString === 'string') {
    try {
      data = JSON.parse(content.dataString) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  return {
    actionIdentifier: response.actionIdentifier,
    notification: {
      date: Number(response.notification?.date) || 0,
      request: { ...request, identifier: request.identifier, content: { ...content, data: data ?? {} } },
    },
  } as unknown as NotificationResponse;
}
