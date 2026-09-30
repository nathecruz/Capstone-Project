import assert from 'node:assert/strict';
import test from 'node:test';
import { webPushSubscriptionRequestSchema } from '../schemas.js';
import { getConfiguredVapidPublicKey, getDueHabitReminders, getHabitReminderDays, getReminderText, getHabitReminderTimes, getSnoozeLimit, getWebPushSnoozeSettings, getWebPushSnoozeUrl, hashWebPushSnoozeToken, isAllowedWebPushEndpoint, parseReminderTime } from '../services/web-push-reminders.js';

test('parses 12-hour and legacy reminder times', () => {
  assert.deepEqual(parseReminderTime('08:30 PM'), { hour: 20, minute: 30 });
  assert.deepEqual(parseReminderTime('12:05 AM'), { hour: 0, minute: 5 });
  assert.deepEqual(getHabitReminderTimes({ reminderTime: '07:00 AM' }), [{ hour: 7, minute: 0 }]);
  assert.equal(parseReminderTime('13:80 PM'), null);
});

test('checks multiple custom reminder times against the subscription timezone and weekdays', () => {
  const habit = {
    label: 'Morning run', reminderEnabled: true, frequency: 'Custom', startDate: '2026-09-28',
    meta: 'Every week • 08:30 AM, 08:30 PM • Mon, Wed',
    reminderTimes: ['08:30 AM', '08:30 PM'], reminderDays: ['Mon', 'Wed'], completionDates: [],
  };
  const mondayMorning = new Date('2026-09-28T15:30:00.000Z');
  assert.deepEqual(getDueHabitReminders(habit, 'America/Los_Angeles', mondayMorning), [{ date: '2026-09-28', time: '08:30' }]);
  assert.deepEqual(getDueHabitReminders(habit, 'America/Los_Angeles', new Date('2026-09-28T15:31:00.000Z')), [{ date: '2026-09-28', time: '08:30' }]);
  assert.deepEqual(getDueHabitReminders(habit, 'America/Los_Angeles', new Date('2026-09-28T15:35:00.000Z')), [{ date: '2026-09-28', time: '08:30' }]);
  assert.deepEqual(getDueHabitReminders(habit, 'America/Los_Angeles', new Date('2026-09-28T15:36:00.000Z')), []);
  assert.deepEqual(getDueHabitReminders(habit, 'America/New_York', mondayMorning), []);
  assert.deepEqual(getDueHabitReminders(habit, 'America/Los_Angeles', new Date('2026-09-29T15:30:00.000Z')), []);
  assert.deepEqual(getHabitReminderDays({ frequency: 'Custom', meta: habit.meta }), ['Mon', 'Wed']);
});

test('checks weekly and monthly reminders on their configured cadence', () => {
  const weekly = {
    label: 'Run', reminderEnabled: true, frequency: 'Weekly', startDate: '2026-09-28',
    reminderTime: '08:30 AM', reminderDays: ['Mon', 'Wed'], completionDates: [],
  };
  assert.deepEqual(getDueHabitReminders(weekly, 'UTC', new Date('2026-09-30T08:30:00.000Z')), [
    { date: '2026-09-30', time: '08:30' },
  ]);
  assert.deepEqual(getDueHabitReminders(weekly, 'UTC', new Date('2026-10-01T08:30:00.000Z')), []);

  const monthly = {
    label: 'Pay bills', reminderEnabled: true, frequency: 'Monthly', startDate: '2026-09-14',
    reminderTime: '08:30 AM', completionDates: [],
  };
  assert.deepEqual(getDueHabitReminders(monthly, 'UTC', new Date('2026-10-14T08:30:00.000Z')), [
    { date: '2026-10-14', time: '08:30' },
  ]);
  assert.deepEqual(getDueHabitReminders(monthly, 'UTC', new Date('2026-10-15T08:30:00.000Z')), []);
});

test('skips completed, future-start, disabled, and invalid-timezone reminders', () => {
  const habit = { label: 'Read', reminderEnabled: true, frequency: 'Daily', reminderTime: '08:30 AM', completionDates: [] };
  const now = new Date('2026-09-28T08:30:00.000Z');
  assert.deepEqual(getDueHabitReminders({ ...habit, completionDates: ['2026-09-28'] }, 'UTC', now), []);
  assert.deepEqual(getDueHabitReminders({ ...habit, startDate: '2026-09-29' }, 'UTC', now), []);
  assert.deepEqual(getDueHabitReminders({ ...habit, reminderEnabled: false }, 'UTC', now), []);
  assert.deepEqual(getDueHabitReminders(habit, 'Not/A_Timezone', now), []);
});

test('allows browser push-provider endpoints and rejects arbitrary URLs', () => {
  assert.equal(isAllowedWebPushEndpoint('https://fcm.googleapis.com/fcm/send/test'), true);
  assert.equal(isAllowedWebPushEndpoint('https://web.push.apple.com/push/test'), true);
  assert.equal(isAllowedWebPushEndpoint('http://localhost:8787/private'), false);
  assert.equal(isAllowedWebPushEndpoint('https://attacker.example/private'), false);
});

test('validates a web push subscription payload', () => {
  const payload = {
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/example',
      expirationTime: null,
      keys: { p256dh: 'public-key', auth: 'auth-key' },
    },
    timeZone: 'America/Los_Angeles',
  };
  assert.equal(webPushSubscriptionRequestSchema.safeParse(payload).success, true);
  assert.equal(webPushSubscriptionRequestSchema.safeParse({ ...payload, subscription: { ...payload.subscription, endpoint: 'http://localhost/push' } }).success, false);
});

test('does not advertise Web Push until the full VAPID configuration is present', () => {
  assert.equal(getConfiguredVapidPublicKey({ WEB_PUSH_VAPID_PUBLIC_KEY: 'public', WEB_PUSH_VAPID_PRIVATE_KEY: 'private' }), null);
  assert.equal(getConfiguredVapidPublicKey({ WEB_PUSH_VAPID_PUBLIC_KEY: 'public', WEB_PUSH_VAPID_PRIVATE_KEY: 'private', WEB_PUSH_VAPID_SUBJECT: 'mailto:owner@example.org' }), 'public');
});

test('creates safe snooze URLs and hashes one-time tokens', () => {
  assert.equal(getWebPushSnoozeUrl({ WEB_PUSH_API_URL: 'https://api.example.org/' }), 'https://api.example.org/api/web-push/snooze');
  assert.equal(getWebPushSnoozeUrl({ WEB_PUSH_API_URL: 'http://attacker.example' }), null);
  assert.equal(getWebPushSnoozeUrl({ WEB_PUSH_API_URL: 'http://localhost:8787' }), 'http://localhost:8787/api/web-push/snooze');
  assert.match(hashWebPushSnoozeToken('a'.repeat(32)), /^[a-f0-9]{64}$/);
  assert.equal(hashWebPushSnoozeToken('short'), null);
});

test('enforces Web Push snooze permission, interval, and count limits', () => {
  const state = {
    preferences: { notificationsEnabled: true },
    ringInterval: 15,
    snoozeFrequency: '2 times',
    habits: [{ id: 'habit-1', reminderEnabled: true }],
  };
  assert.equal(getSnoozeLimit('2 times'), 2);
  assert.deepEqual(getWebPushSnoozeSettings(state, 'habit-1', 0), {
    habit: { id: 'habit-1', reminderEnabled: true }, intervalMinutes: 15, nextSnoozeCount: 1, snoozeLimit: 2,
  });
  assert.equal(getWebPushSnoozeSettings(state, 'habit-1', 2), null);
  assert.equal(getWebPushSnoozeSettings({ ...state, preferences: { notificationsEnabled: false } }, 'habit-1', 0), null);
  assert.equal(getWebPushSnoozeSettings(state, 'missing-habit', 0), null);
});
test('uses the Admin Panel reminder template when one is active', () => {
  assert.deepEqual(getReminderText({ label: 'Drink Water' }), { title: 'Drink Water reminder', body: 'A small step today keeps your streak moving.' });
  assert.deepEqual(
    getReminderText({ label: 'Read' }, { title: 'Time for {{ habit }}', body: '{{habit}} keeps your {{app_name}} streak going.' }),
    { title: 'Time for Read', body: 'Read keeps your HabitAI streak going.' },
  );
  assert.equal(getReminderText({}, { title: '', body: '' }).title, 'Habit reminder');
});
