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
  assert.equal(isAllowedWebPushEndpoint('https://wns2-sg2p.notify.windows.com/w/?token=test'), true);
  assert.equal(isAllowedWebPushEndpoint('http://localhost:8787/private'), false);
  assert.equal(isAllowedWebPushEndpoint('https://attacker.example/private'), false);
  assert.equal(isAllowedWebPushEndpoint('https://notify.windows.com.attacker.example/w'), false);
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

test('the scheduler plans reminder minutes ahead and a longer lookback catches late runs', async () => {
  const { getReminderWakeTimes } = await import('../services/web-push-reminders.js');
  const habit = { id: 'h1', label: 'Walk', reminderEnabled: true, frequency: 'Daily', reminderTimes: ['08:30 AM', '09:00 AM'], completionDates: [] };
  const rows = [
    { timeZone: 'Asia/Manila', state: { habits: [habit] } },
    { timeZone: 'Asia/Manila', state: { habits: [{ ...habit, id: 'h2' }], preferences: { notificationsEnabled: false } } },
  ];
  const now = new Date('2026-10-01T00:10:00.000Z'); // 08:10 in Manila
  assert.deepEqual(getReminderWakeTimes(rows, now, 70).map((time) => new Date(time).toISOString()), ['2026-10-01T00:30:00.000Z', '2026-10-01T01:00:00.000Z']);
  assert.deepEqual(getReminderWakeTimes(rows, now, 10), []);

  const twentyMinutesLate = new Date('2026-10-01T00:50:00.000Z');
  assert.deepEqual(getDueHabitReminders(habit, 'Asia/Manila', twentyMinutesLate), []);
  assert.deepEqual(getDueHabitReminders(habit, 'Asia/Manila', twentyMinutesLate, 30), [{ date: '2026-10-01', time: '08:30' }]);
});

test('the scheduler only wakes the database when something is due', async () => {
  const { decideWake, lookbackMinutes, nextPlan, parsePlan } = await import('../services/web-push-schedule.js');
  const now = Date.parse('2026-10-01T00:22:00.000Z');
  const plan = { version: 1, refreshedAt: now - 20 * 60_000, lastWakeAt: now - 20 * 60_000, wakeTimes: [now + 8 * 60_000, now + 40 * 60_000] };

  assert.equal(decideWake(plan, now).wake, false, 'next reminder is 8 minutes away');
  assert.deepEqual(decideWake(plan, now + 3 * 60_000), { wake: true, at: now + 8 * 60_000, reason: 'reminder due in the next few minutes' });
  assert.equal(decideWake(plan, now + 9 * 60_000).at, now + 9 * 60_000, 'a late run wakes immediately');
  assert.equal(decideWake({ ...plan, lastWakeAt: now + 8 * 60_000 }, now + 9 * 60_000).wake, false, 'already handled');
  assert.equal(decideWake(plan, now + 41 * 60_000).reason, 'plan refresh');
  assert.equal(decideWake(null, Date.parse('2026-10-01T01:02:00.000Z')).wake, true, 'first plan at the top of the hour');
  assert.equal(decideWake(null, Date.parse('2026-10-01T01:32:00.000Z')).wake, true, 'or at half past');
  assert.equal(decideWake(null, Date.parse('2026-10-01T01:42:00.000Z')).wake, false, 'a lost cache cannot wake the database every run');
  assert.equal(decideWake(plan, now, { force: true }).wake, true);

  assert.equal(lookbackMinutes(null, now), 30);
  assert.equal(lookbackMinutes(plan, now), 20);
  assert.equal(lookbackMinutes({ ...plan, lastWakeAt: now - 60_000 }, now), 5);

  const woke = nextPlan(plan, now + 8 * 60_000, { followUps: [now + 50 * 60_000] });
  assert.deepEqual(woke.wakeTimes, [now + 40 * 60_000, now + 50 * 60_000]);
  assert.equal(woke.refreshedAt, plan.refreshedAt);
  const refreshed = nextPlan(plan, now + 41 * 60_000, { refreshed: true, wakeTimes: [now + 90 * 60_000, now + 30 * 60_000] });
  assert.deepEqual(refreshed.wakeTimes, [now + 90 * 60_000]);
  assert.equal(refreshed.refreshedAt, now + 41 * 60_000);
  assert.deepEqual(parsePlan(JSON.stringify(refreshed)), refreshed);
  assert.equal(parsePlan('not json'), null);
});

test('a run stays up for the reminders in its window and sends each at its minute', async () => {
  const { decideWake, nextWakeWithin } = await import('../services/web-push-schedule.js');
  const now = Date.parse('2026-10-08T00:20:00.000Z');
  const plan = { version: 1, refreshedAt: now - 60_000, lastWakeAt: now - 60_000, wakeTimes: [now - 120_000, now + 10 * 60_000, now + 20 * 60_000] };
  assert.equal(decideWake(plan, now).wake, false, 'the old 5-minute window waits for the next run');
  assert.deepEqual(decideWake(plan, now, { sleepWindowMs: 28 * 60_000 }), { wake: true, at: now + 10 * 60_000, reason: 'reminder due in the next few minutes' });
  assert.equal(nextWakeWithin(plan, now + 28 * 60_000), now + 10 * 60_000);
  assert.equal(nextWakeWithin({ ...plan, lastWakeAt: now + 10 * 60_000 }, now + 28 * 60_000), now + 20 * 60_000);
  assert.equal(nextWakeWithin({ ...plan, lastWakeAt: now + 20 * 60_000 }, now + 28 * 60_000), null);
  assert.equal(nextWakeWithin(plan, now + 5 * 60_000), null, 'later reminders are left to the next run');
  assert.equal(nextWakeWithin(null, now), null);
});

test('smart reminders move with the recent record and replace the set times', async () => {
  const { getSmartReminderText, getSmartReminderTime } = await import('../services/smart-reminders.js');
  const { getReminderWakeTimes } = await import('../services/web-push-reminders.js');
  const habit = { label: 'Read', frequency: 'Daily', startDate: '2026-09-01', reminderTime: '08:00 AM', reminderTimes: ['08:00 AM'], reminderEnabled: false, smartReminderEnabled: true, completionDates: [] };
  const october = (...days) => days.map((day) => `2026-10-${String(day).padStart(2, '0')}`);

  // The 7 days before October 8: all done is going well (later), 4 with a 2-day streak is medium, none is at risk (earlier).
  assert.deepEqual(getSmartReminderTime({ ...habit, completionDates: october(1, 2, 3, 4, 5, 6, 7) }, '2026-10-08'), { hour: 8, minute: 45, riskLevel: 'low' });
  assert.deepEqual(getSmartReminderTime({ ...habit, completionDates: october(1, 3, 6, 7) }, '2026-10-08'), { hour: 8, minute: 15, riskLevel: 'medium' });
  assert.deepEqual(getSmartReminderTime(habit, '2026-10-08'), { hour: 7, minute: 30, riskLevel: 'high' });
  assert.deepEqual(getSmartReminderTime({ ...habit, reminderTimes: ['12:10 AM'], reminderTime: '12:10 AM' }, '2026-10-08'), { hour: 0, minute: 0, riskLevel: 'high' }, 'never before midnight');

  // 7:30 AM in Manila on October 8; works even with the plain reminder off.
  const smartMinute = new Date('2026-10-07T23:30:00.000Z');
  assert.deepEqual(getDueHabitReminders(habit, 'Asia/Manila', smartMinute), [{ date: '2026-10-08', time: '07:30', smart: { riskLevel: 'high' } }]);
  assert.deepEqual(getDueHabitReminders({ ...habit, reminderEnabled: true }, 'Asia/Manila', new Date('2026-10-08T00:00:00.000Z')), [], 'the set 8:00 AM time is replaced');
  assert.deepEqual(getDueHabitReminders({ ...habit, completionDates: ['2026-10-08'] }, 'Asia/Manila', smartMinute), [], 'not once done today');
  assert.deepEqual(getReminderWakeTimes([{ timeZone: 'Asia/Manila', state: { habits: [habit] } }], new Date('2026-10-07T23:00:00.000Z'), 60), [smartMinute.getTime()]);
  assert.ok(getWebPushSnoozeSettings({ habits: [{ ...habit, id: 'read' }] }, 'read', 0), 'smart reminders can be snoozed');

  assert.equal(getSmartReminderText(habit, 'high').title, 'Smart reminder: Read');
  assert.match(getSmartReminderText(habit, 'high').body, /at risk of being skipped/);
});
