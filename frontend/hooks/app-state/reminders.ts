// Reminder schedules and notification permissions (native notifications and Web Push).
import { Platform } from 'react-native';
import { getWebPushVapidPublicKey, saveWebPushSubscription } from '@/authentication/authService';
import type { Habit } from './types';

export type NotificationsModule = typeof import('expo-notifications');
let notificationsModule: NotificationsModule | null = null;

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

export function getHabitReminderTimes(habit: Pick<Habit, 'reminderTime' | 'reminderTimes'>) {
  const values = habit.reminderTimes?.length ? habit.reminderTimes : [habit.reminderTime];
  return values.map(parseReminderTime).filter((time): time is { hour: number; minute: number } => Boolean(time));
}

const reminderDayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const reminderDayNumbers: Record<(typeof reminderDayLabels)[number], number> = {
  Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7,
};

export function getHabitReminderDays(habit: Pick<Habit, 'frequency' | 'meta' | 'reminderDays'>) {
  const metaParts = habit.meta.split(' • ');
  const configuredDays = habit.reminderDays?.length
    ? habit.reminderDays
    : habit.frequency === 'Custom'
      ? (metaParts[metaParts.length - 1] || '').split(',').map((day) => day.trim())
      : [];
  return configuredDays.filter((day): day is (typeof reminderDayLabels)[number] => reminderDayLabels.includes(day as (typeof reminderDayLabels)[number]));
}

export function getHabitReminderSchedule(habit: Pick<Habit, 'frequency' | 'meta' | 'reminderDays' | 'startDate'>) {
  if (habit.frequency === 'Monthly') {
    const day = Number(habit.startDate.slice(8, 10));
    return { type: 'monthly' as const, day: day >= 1 && day <= 31 ? day : 1 };
  }
  if (habit.frequency === 'Weekly' || habit.frequency === 'Custom') {
    const days = getHabitReminderDays(habit);
    if (!days.length && habit.frequency === 'Weekly' && /^\d{4}-\d{2}-\d{2}$/.test(habit.startDate)) {
      return { type: 'weekly' as const, days: [reminderDayLabels[new Date(`${habit.startDate}T00:00:00`).getDay()]] };
    }
    return { type: 'weekly' as const, days };
  }
  return { type: 'daily' as const };
}

export function isHabitReminderDay(habit: Pick<Habit, 'frequency' | 'meta' | 'reminderDays' | 'startDate'>, date: Date) {
  const schedule = getHabitReminderSchedule(habit);
  if (schedule.type === 'weekly') return schedule.days.includes(reminderDayLabels[date.getDay()]);
  if (schedule.type === 'monthly') return date.getDate() === schedule.day;
  return true;
}

export function getSnoozeLimit(frequency: string) {
  if (frequency === 'Once') return 1;
  const count = Number.parseInt(frequency, 10);
  return Number.isFinite(count) ? Math.max(1, Math.min(5, count)) : 1;
}

export async function getNotificationsModule() {
  if (Platform.OS === 'web') return null;
  try {
    notificationsModule ??= await import('expo-notifications');
    notificationsModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    return notificationsModule;
  } catch {
    return null;
  }
}

export async function getBrowserNotificationRegistration() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function decodeVapidPublicKey(value: string) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`;
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

export async function requestNotificationAccess() {
  if (Platform.OS === 'web') {
    try {
      if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return false;
      let permission = window.Notification.permission;
      if (permission === 'default') permission = await window.Notification.requestPermission();
      if (permission !== 'granted') return false;
      const registration = await getBrowserNotificationRegistration();
      if (!registration) return false;
      const publicKey = await getWebPushVapidPublicKey();
      if (!publicKey) return false;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(publicKey).buffer as ArrayBuffer,
        });
      }
      const serialized = subscription.toJSON();
      if (!serialized.endpoint || !serialized.keys?.auth || !serialized.keys.p256dh) return false;
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      return saveWebPushSubscription({
        endpoint: serialized.endpoint,
        expirationTime: serialized.expirationTime,
        keys: { auth: serialized.keys.auth, p256dh: serialized.keys.p256dh },
      }, timeZone);
    } catch {
      return false;
    }
  }
  const Notifications = await getNotificationsModule();
  if (!Notifications) return false;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status === 'granted') return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

export { isHabitMissedYesterday } from '@/utils/habit-visibility';
