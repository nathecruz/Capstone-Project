// Schedules habit reminders (native notifications, the next two weeks of them so they keep coming
// while the app is not opened; on web, reminders shown by an open HabitAI tab alongside Web Push)
// and handles the Snooze action. Planned again at midnight and whenever the app returns to the foreground.
import type { NotificationResponse } from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { isHabitActiveOn } from '@/utils/habit-week';
import { getLocalDateKey } from './habit-progress';
import { planReminders, type PlannedReminder } from './native-reminders';
import { canRemindAt, enableWebReminders, getBrowserNotificationRegistration, getHabitReminderTimes, getNotificationsModule, isHabitReminderDay, playReminderSound, requestWebNotificationPermission, type NotificationsModule } from './reminders';
import { computeSmartReminderTimes, getSmartReminderMessage, requestHabitPrediction } from './smart-reminders';
import { keepsSnooze, loadSnoozeSettings, SNOOZE_CATEGORY, snoozeReminder } from './snooze';
import type { Habit, Preferences } from './types';

/**
 * `habits`: this week's habits (the app passes its current ones); one whose week has ended is never
 * reminded or snoozed either way. `ready`: the account's habits and settings have loaded. Until then
 * the Android/iOS reminders are left as scheduled, since rescheduling from the empty startup state
 * would cancel them all.
 */
export function useHabitReminders({ habits, preferences, ringInterval, snoozeFrequency, ready }: {
  habits: Habit[];
  preferences: Preferences;
  ringInterval: number;
  snoozeFrequency: string;
  ready: boolean;
}) {
  const [reminderScheduleRevision, setReminderScheduleRevision] = useState(0);
  const sentBrowserRemindersRef = useRef(new Set<string>());
  const schedulingRef = useRef(Promise.resolve());
  // The schedule revision whose run scheduled every planned reminder again (Android, see below).
  const alarmsSetRevisionRef = useRef(-1);

  useEffect(() => {
    const refreshAtMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return setTimeout(() => setReminderScheduleRevision((revision) => revision + 1), nextMidnight.getTime() - now.getTime() + 100);
    };
    let midnightTimer = refreshAtMidnight();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setReminderScheduleRevision((revision) => revision + 1);
      clearTimeout(midnightTimer);
      midnightTimer = refreshAtMidnight();
    });
    return () => {
      clearTimeout(midnightTimer);
      appStateSubscription.remove();
    };
  }, []);

  // Web: keep this browser's push subscription (and time zone) current on the server, so habits
  // made on another device still remind this one. Only refreshes a permission already given.
  const hasHabits = habits.length > 0;
  useEffect(() => {
    if (Platform.OS !== 'web' || !preferences.notificationsEnabled || !hasHabits) return;
    void enableWebReminders({ prompt: false });
  }, [hasHabits, preferences.notificationsEnabled]);

  // Web: a browser only grants notification permission from a tap. When reminders are on but this
  // browser has never been asked (e.g. the habits came from another device), ask on the next tap so
  // an open tab can start alerting — no settings trip or extra control needed.
  useEffect(() => {
    if (Platform.OS !== 'web' || !preferences.notificationsEnabled) return;
    if (typeof window === 'undefined' || typeof window.Notification === 'undefined' || window.Notification.permission !== 'default') return;
    const hasReminderHabits = habits.some((habit) => habit.smartReminderEnabled || (habit.reminderEnabled && getHabitReminderTimes(habit).length > 0));
    if (!hasReminderHabits) return;
    const ask = () => {
      void requestWebNotificationPermission().then((granted) => { if (granted) setReminderScheduleRevision((revision) => revision + 1); });
    };
    window.addEventListener('pointerdown', ask, { once: true });
    return () => window.removeEventListener('pointerdown', ask);
  }, [habits, preferences.notificationsEnabled]);

  // Web: a reminder arriving while HabitAI is open also plays the HabitAI reminder sound, and this
  // tab then does not show that reminder again itself.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'habitai-reminder') return;
      if (typeof event.data.tag === 'string') sentBrowserRemindersRef.current.add(event.data.tag);
      if (event.data.soundEnabled !== false) playReminderSound();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let browserReminderTimer: ReturnType<typeof setInterval> | undefined;
    const scheduleReminders = async () => {
      if (cancelled) return;
      if (Platform.OS === 'web') {
        if (!preferences.notificationsEnabled || typeof window === 'undefined' || typeof window.Notification === 'undefined' || window.Notification.permission !== 'granted') return;
        const registration = await getBrowserNotificationRegistration();
        // Rescheduled while waiting (habits changed, or the screen closed): starting the timer now
        // would leave it running forever next to the new one.
        if (!registration || cancelled) return;
        const reminders = habits.filter((habit) => habit.smartReminderEnabled || (habit.reminderEnabled && getHabitReminderTimes(habit).length > 0));
        if (!reminders.length) return;

        // While HabitAI is open, this tab shows each reminder on its minute itself, with the same
        // timing and Smart Reminder rules as the server, so it is on time even when the server is
        // asleep or a push is slow. It uses the server's tag: the Web Push for the same reminder
        // then quietly replaces it (adding Done and Snooze) instead of alerting twice.
        let checking = false;
        const notifyDueReminders = async () => {
          if (cancelled || checking) return;
          checking = true;
          try {
            await showDueReminders();
          } finally {
            checking = false;
          }
        };
        const showDueReminders = async () => {
          const now = new Date();
          const today = getLocalDateKey(now);
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          for (const key of sentBrowserRemindersRef.current) {
            if (!key.includes(`-${today}-`)) sentBrowserRemindersRef.current.delete(key);
          }
          for (const habit of reminders) {
            // Not active today (not started yet, or its week has ended), done, or missed (past its
            // last reminder time): it cannot be checked in today.
            if (!isHabitActiveOn(habit, today) || !isHabitReminderDay(habit, now) || !canRemindAt(habit, now, now)) continue;
            const smart = habit.smartReminderEnabled ? computeSmartReminderTimes(habit, now) : null;
            const times = smart ? smart.times : getHabitReminderTimes(habit);
            for (const time of times) {
              // Due this minute or a few minutes ago: a tab in the background may run its timers
              // only once a minute, so an exact-minute check could skip the reminder.
              const minutesLate = nowMinutes - (time.hour * 60 + time.minute);
              if (minutesLate < 0 || minutesLate > 3) continue;
              // The server's tag for this reminder (habit, local date, 24-hour time).
              const key = `${habit.id}-${today}-${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
              if (sentBrowserRemindersRef.current.has(key)) continue;
              sentBrowserRemindersRef.current.add(key);
              // The push for it may already be on screen.
              const shown = await registration.getNotifications({ tag: key }).catch(() => []);
              if (shown.length) continue;
              const soundEnabled = habit.reminderSoundEnabled !== false;
              void registration.showNotification(smart ? `Smart reminder: ${habit.label}` : `${habit.label} reminder`, {
                body: smart ? getSmartReminderMessage(habit, smart.riskLevel) : 'A small step today keeps your streak moving.',
                tag: key,
                icon: '/icons/icon-192.png',
                badge: '/icons/badge-96.png',
                silent: !soundEnabled,
                requireInteraction: true,
              }).catch(() => undefined);
              if (soundEnabled) playReminderSound();
            }
          }
        };

        void notifyDueReminders();
        browserReminderTimer = setInterval(() => void notifyDueReminders(), 5000);
        return;
      }
      if (!ready) return;
      const Notifications = await getNotificationsModule();
      if (!Notifications) return;
      await Notifications.setNotificationCategoryAsync(SNOOZE_CATEGORY, [{
        identifier: 'SNOOZE',
        buttonTitle: 'Snooze',
        options: { opensAppToForeground: false },
      }]);
      const reminders = preferences.notificationsEnabled
        ? habits.filter((habit) => habit.reminderEnabled && getHabitReminderTimes(habit).length > 0)
        : [];
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
        if (permission.status === 'granted' || (await Notifications.requestPermissionsAsync()).status === 'granted') {
          const predictions = Object.fromEntries(await Promise.all(reminders
            .filter((habit) => habit.smartReminderEnabled)
            .map(async (habit) => [habit.id, await requestHabitPrediction(habit)] as const)));
          if (cancelled) return;
          // iOS keeps 64 scheduled notifications: a place is left for a snooze of each habit.
          // Android allows 500 alarms per app.
          plan = planReminders(reminders, new Date(), { ringInterval, predictions, limit: Platform.OS === 'ios' ? 64 - reminders.length : 200 });
        }
      }
      // A reminder already scheduled as planned stays; the others are cancelled, except a snooze the
      // student asked for that can still be acted on (opening the app used to cancel it).
      const scheduledNow = new Date();
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      if (cancelled) return;
      const planned = new Map(plan.map((reminder) => [reminder.identifier, reminder]));
      await Promise.all(scheduled
        .filter((request) => !planned.has(request.identifier) && !(preferences.notificationsEnabled && keepsSnooze(request, habits, scheduledNow)))
        .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)));
      // Android removes an app's alarms when it is force stopped (some phones do it when the app is
      // swiped away) while expo-notifications still lists them as scheduled, and an alarm set before
      // exact alarms were allowed stays inexact. So once each launch, each return to the app and at
      // midnight (a new schedule revision), every reminder is scheduled again, which sets its alarm.
      const rearm = Platform.OS === 'android' && alarmsSetRevisionRef.current !== reminderScheduleRevision;
      const current = new Set(rearm ? [] : scheduled
        .filter((request) => planned.has(request.identifier) && request.content.data?.plan === planned.get(request.identifier)?.data.plan)
        .map((request) => request.identifier));
      for (const reminder of plan) {
        if (cancelled) return;
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
      alarmsSetRevisionRef.current = reminderScheduleRevision;
    };
    // One at a time: a schedule still running when the habits change finishes before the next one
    // reads what is scheduled, so it cannot leave behind a reminder the next plan no longer has.
    schedulingRef.current = schedulingRef.current.then(() => scheduleReminders()).catch(() => undefined);
    return () => {
      cancelled = true;
      if (browserReminderTimer) clearInterval(browserReminderTimer);
    };
  }, [habits, preferences.notificationsEnabled, ready, reminderScheduleRevision, ringInterval]);

  useEffect(() => {
    let active = true;
    let responseSubscription: { remove: () => void } | undefined;

    const handleResponse = async (Notifications: NotificationsModule, response: NotificationResponse) => {
      if (response.actionIdentifier !== 'SNOOZE') return;
      // Before the account has loaded (the tap opened the app), its habits and snooze settings as
      // last saved on this device.
      const settings = ready ? { habits, ringInterval, snoozeFrequency, notificationsEnabled: preferences.notificationsEnabled } : await loadSnoozeSettings();
      if (!active || !settings) return;
      await snoozeReminder(Notifications, response, settings);
    };

    const register = async () => {
      const Notifications = await getNotificationsModule();
      if (!Notifications || !active) return;
      await Notifications.setNotificationCategoryAsync(SNOOZE_CATEGORY, [{
        identifier: 'SNOOZE',
        buttonTitle: 'Snooze',
        options: { opensAppToForeground: false },
      }]);
      responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
        void handleResponse(Notifications, response).catch(() => undefined);
      });
      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      if (active && lastResponse) await handleResponse(Notifications, lastResponse).catch(() => undefined);
    };

    void register();
    return () => {
      active = false;
      responseSubscription?.remove();
    };
  }, [habits, preferences.notificationsEnabled, ready, ringInterval, snoozeFrequency]);
}
