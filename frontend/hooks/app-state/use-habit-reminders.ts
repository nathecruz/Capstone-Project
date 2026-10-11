// Schedules habit reminders (native notifications; on web, reminders shown by an open HabitAI tab
// alongside Web Push) and handles the Snooze action. Rescheduled at midnight and whenever the app returns to the foreground.
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { getLocalDateKey } from './habit-progress';
import { enableWebReminders, getBrowserNotificationRegistration, getHabitReminderTimes, getNotificationsModule, getSnoozeLimit, isHabitReminderDay, nextReminderOccurrence, playReminderSound, requestWebNotificationPermission, type NotificationsModule } from './reminders';
import { computeSmartReminderTimes, getSmartReminderMessage, requestHabitPrediction } from './smart-reminders';
import type { Habit, Preferences } from './types';

export function useHabitReminders({ habits, preferences, ringInterval, snoozeFrequency }: {
  habits: Habit[];
  preferences: Preferences;
  ringInterval: number;
  snoozeFrequency: string;
}) {
  const [reminderScheduleRevision, setReminderScheduleRevision] = useState(0);
  const sentBrowserRemindersRef = useRef(new Set<string>());
  const handledSnoozeActionsRef = useRef(new Set<string>());

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
        if (!registration) return;
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
            if ((habit.startDate && habit.startDate > today) || !isHabitReminderDay(habit, now) || habit.completionDates.includes(today)) continue;
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
      const Notifications = await getNotificationsModule();
      if (!Notifications) return;
      await Notifications.setNotificationCategoryAsync('habit-reminder-snooze', [{
        identifier: 'SNOOZE',
        buttonTitle: 'Snooze',
        options: { opensAppToForeground: false },
      }]);
      await Notifications.cancelAllScheduledNotificationsAsync();
      if (!preferences.notificationsEnabled) return;
      const reminders = habits
        .map((habit) => ({ habit, times: getHabitReminderTimes(habit) }))
        .filter((entry): entry is { habit: Habit; times: { hour: number; minute: number }[] } => entry.habit.reminderEnabled && entry.times.length > 0 && (!entry.habit.startDate || entry.habit.startDate <= getLocalDateKey()));
      if (!reminders.length) return;
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('habit-reminders-sound-v2', {
          name: 'Habit reminders', importance: Notifications.AndroidImportance.HIGH, sound: 'reminder_sound.mp3',
        });
        await Notifications.setNotificationChannelAsync('habit-reminders-silent-v2', {
          name: 'Silent habit reminders', importance: Notifications.AndroidImportance.HIGH, sound: null,
        });
      }
      const permission = await Notifications.getPermissionsAsync();
      if (permission.status !== 'granted') {
        const requested = await Notifications.requestPermissionsAsync();
        if (requested.status !== 'granted') return;
      }
      const smartReminders = reminders.filter(({ habit }) => habit.smartReminderEnabled);
      for (const { habit, times } of reminders.filter(({ habit }) => !habit.smartReminderEnabled)) {
        const now = new Date();
        const soundEnabled = habit.reminderSoundEnabled !== false;
        const channel = Platform.OS === 'android'
          ? { channelId: soundEnabled ? 'habit-reminders-sound-v2' : 'habit-reminders-silent-v2' }
          : {};
        // Once the habit is checked off for today, skip today's reminder and aim at the next day.
        // Scheduled as the next occurrence (not a repeating trigger) and refreshed at midnight and
        // whenever the app opens, so a completed habit no longer nudges for the rest of the day.
        const completedToday = habit.completionDates.includes(getLocalDateKey(now));
        for (const time of times) {
          if (cancelled) return;
          const target = nextReminderOccurrence(habit, time, now, completedToday);
          if (!target) continue;
          await Notifications.scheduleNotificationAsync({
            content: {
              title: `${habit.label} reminder`,
              body: 'A small step today keeps your streak moving.',
              sound: soundEnabled ? 'reminder_sound.mp3' : false,
              data: { habitId: habit.id, snoozeCount: 0 },
              categoryIdentifier: 'habit-reminder-snooze',
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: target, ...channel },
          });
        }

        if (habit.frequency === 'Custom') continue;
        const lastReminderTime = times.reduce((latest, time) => time.hour * 60 + time.minute > latest.hour * 60 + latest.minute ? time : latest);
        const missedAt = new Date(now);
        missedAt.setHours(lastReminderTime.hour, lastReminderTime.minute + 1, 0, 0);
        // Done for today: skip the "still open for today" nudge and aim it at the next day instead.
        if (missedAt <= now || completedToday) missedAt.setDate(missedAt.getDate() + 1);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Smart Reminder',
            body: `${habit.label} is still open for today. Complete it before the day ends to keep your streak.`,
            sound: soundEnabled ? 'reminder_sound.mp3' : false,
            data: { habitId: habit.id, type: 'missed-habit', snoozeCount: 0 },
            categoryIdentifier: 'habit-reminder-snooze',
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: missedAt, ...channel },
        });
      }

      const predictions = await Promise.all(smartReminders.map(async ({ habit }) => ({
        habit,
        prediction: await requestHabitPrediction(habit),
      })));
      if (cancelled) return;
      for (const { habit, prediction } of predictions) {
        if (cancelled) return;
        const modelRisk = prediction && typeof prediction.dropout_risk === 'number' && typeof prediction.completion_probability === 'number'
          ? { dropoutRisk: prediction.dropout_risk, completionProbability: prediction.completion_probability }
          : undefined;
        const now = new Date();
        const { times, riskLevel } = computeSmartReminderTimes(habit, now, modelRisk);
        const soundEnabled = habit.reminderSoundEnabled !== false;
        const channel = Platform.OS === 'android'
          ? { channelId: soundEnabled ? 'habit-reminders-sound-v2' : 'habit-reminders-silent-v2' }
          : {};
        // Once the habit is checked off for today, its smart reminder is done until the next day.
        const completedToday = habit.completionDates.includes(getLocalDateKey(now));
        // The next time of each (today if still ahead and not yet done, else tomorrow); rescheduled
        // at midnight and whenever the app opens, so the message follows the latest record.
        for (const time of times) {
          if (cancelled) return;
          const target = new Date(now);
          target.setHours(time.hour, time.minute, 0, 0);
          if (target <= now || completedToday) target.setDate(target.getDate() + 1);
          if (!isHabitReminderDay(habit, target)) continue;
          await Notifications.scheduleNotificationAsync({
            content: {
              title: `Smart reminder: ${habit.label}`,
              body: prediction?.recommended_action || getSmartReminderMessage(habit, riskLevel),
              sound: soundEnabled ? 'reminder_sound.mp3' : false,
              data: { habitId: habit.id, type: 'smart-reminder', riskLevel, snoozeCount: 0 },
              categoryIdentifier: 'habit-reminder-snooze',
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: target, ...channel },
          });
        }
      }
    };
    void scheduleReminders().catch(() => undefined);
    return () => {
      cancelled = true;
      if (browserReminderTimer) clearInterval(browserReminderTimer);
    };
  }, [habits, preferences.notificationsEnabled, reminderScheduleRevision]);

  useEffect(() => {
    let active = true;
    let responseSubscription: { remove: () => void } | undefined;

    const handleResponse = async (Notifications: NotificationsModule, response: import('expo-notifications').NotificationResponse) => {
      if (response.actionIdentifier !== 'SNOOZE') return;
      const actionKey = `${response.notification.request.identifier}:SNOOZE`;
      if (handledSnoozeActionsRef.current.has(actionKey)) return;
      handledSnoozeActionsRef.current.add(actionKey);

      const data = response.notification.request.content.data ?? {};
      const snoozeCount = Number(data.snoozeCount) || 0;
      const snoozeLimit = getSnoozeLimit(snoozeFrequency);
      if (snoozeCount >= snoozeLimit) return;
      const habitId = typeof data.habitId === 'string' ? data.habitId : '';
      const habit = habits.find((item) => item.id === habitId);
      const soundEnabled = habit?.reminderSoundEnabled !== false;
      const channel = Platform.OS === 'android'
        ? { channelId: soundEnabled ? 'habit-reminders-sound-v2' : 'habit-reminders-silent-v2' }
        : {};
      const notificationContent = response.notification.request.content;
      const nextSnoozeCount = snoozeCount + 1;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: notificationContent.title || 'Habit reminder',
          body: notificationContent.body || 'A small step today keeps your streak moving.',
          sound: soundEnabled ? 'reminder_sound.mp3' : false,
          data: { ...data, snoozeCount: nextSnoozeCount },
          ...(nextSnoozeCount < snoozeLimit ? { categoryIdentifier: 'habit-reminder-snooze' } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(Date.now() + ringInterval * 60_000),
          ...channel,
        },
      });
    };

    const register = async () => {
      const Notifications = await getNotificationsModule();
      if (!Notifications || !active) return;
      await Notifications.setNotificationCategoryAsync('habit-reminder-snooze', [{
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
  }, [habits, ringInterval, snoozeFrequency]);
}
