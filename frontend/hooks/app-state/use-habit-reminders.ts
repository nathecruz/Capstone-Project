// Schedules habit reminders (native notifications, or in-tab reminders on web without Web Push)
// and handles the Snooze action. Rescheduled at midnight and whenever the app returns to the foreground.
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { getLocalDateKey } from './habit-progress';
import { getBrowserNotificationRegistration, getHabitReminderSchedule, getHabitReminderTimes, getNotificationsModule, getSnoozeLimit, isHabitReminderDay, reminderDayNumbers, type NotificationsModule } from './reminders';
import { computeSmartReminderTime, getSmartReminderMessage, requestHabitPrediction } from './smart-reminders';
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

  useEffect(() => {
    let cancelled = false;
    let browserReminderTimer: ReturnType<typeof setInterval> | undefined;
    const scheduleReminders = async () => {
      if (cancelled) return;
      if (Platform.OS === 'web') {
        if (!preferences.notificationsEnabled || typeof window === 'undefined' || typeof window.Notification === 'undefined' || window.Notification.permission !== 'granted') return;
        const registration = await getBrowserNotificationRegistration();
        if (!registration) return;
        if (await registration.pushManager.getSubscription()) return;
        const reminders = habits
          .map((habit) => ({ habit, times: getHabitReminderTimes(habit) }))
          .filter((entry) => entry.habit.reminderEnabled && entry.times.length > 0);
        if (!reminders.length) return;

        const notifyDueReminders = () => {
          if (cancelled) return;
          const now = new Date();
          const today = getLocalDateKey(now);
          for (const key of sentBrowserRemindersRef.current) {
            if (key.split('|')[1] !== today) sentBrowserRemindersRef.current.delete(key);
          }
          for (const { habit, times } of reminders) {
            if ((habit.startDate && habit.startDate > today) || !isHabitReminderDay(habit, now)) continue;
            for (const time of times) {
              if (now.getHours() !== time.hour || now.getMinutes() !== time.minute) continue;
              const key = `${habit.id}|${today}|${time.hour}:${time.minute}`;
              if (sentBrowserRemindersRef.current.has(key)) continue;
              sentBrowserRemindersRef.current.add(key);
              void registration.showNotification(`${habit.label} reminder`, {
                body: 'A small step today keeps your streak moving.',
                tag: key,
                silent: habit.reminderSoundEnabled === false,
              }).catch(() => undefined);
            }
          }
        };

        notifyDueReminders();
        browserReminderTimer = setInterval(notifyDueReminders, 15000);
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
        const soundEnabled = habit.reminderSoundEnabled !== false;
        const channel = Platform.OS === 'android'
          ? { channelId: soundEnabled ? 'habit-reminders-sound-v2' : 'habit-reminders-silent-v2' }
          : {};
        for (const time of times) {
          if (cancelled) return;
          const schedule = getHabitReminderSchedule(habit);
          const content = {
            title: `${habit.label} reminder`,
            body: 'A small step today keeps your streak moving.',
            sound: soundEnabled ? 'reminder_sound.mp3' : false,
            data: { habitId: habit.id, snoozeCount: 0 },
            categoryIdentifier: 'habit-reminder-snooze',
          };
          if (schedule.type === 'weekly') {
            for (const day of schedule.days) {
              await Notifications.scheduleNotificationAsync({
                content,
                trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: reminderDayNumbers[day], hour: time.hour, minute: time.minute, ...channel },
              });
            }
          } else if (schedule.type === 'monthly') {
            await Notifications.scheduleNotificationAsync({
              content,
              trigger: { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, day: schedule.day, hour: time.hour, minute: time.minute, repeats: true, ...channel },
            });
          } else {
            await Notifications.scheduleNotificationAsync({
              content,
              trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: time.hour, minute: time.minute, ...channel },
            });
          }
        }

        if (habit.frequency === 'Custom') continue;
        const lastReminderTime = times.reduce((latest, time) => time.hour * 60 + time.minute > latest.hour * 60 + latest.minute ? time : latest);
        const missedAt = new Date();
        missedAt.setHours(lastReminderTime.hour, lastReminderTime.minute + 1, 0, 0);
        if (missedAt <= new Date()) missedAt.setDate(missedAt.getDate() + 1);
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
        const { target, riskLevel } = computeSmartReminderTime(habit, new Date(), modelRisk);
        const soundEnabled = habit.reminderSoundEnabled !== false;
        const channel = Platform.OS === 'android'
          ? { channelId: soundEnabled ? 'habit-reminders-sound-v2' : 'habit-reminders-silent-v2' }
          : {};
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
