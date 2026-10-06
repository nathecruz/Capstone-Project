// HabitAI service worker: shows Web Push reminders and handles their Snooze action.
// The phone plays its notification sound for these (a web page cannot choose the sound of a
// notification); when HabitAI is open, the page also plays the HabitAI reminder sound.

// A new version takes over right away instead of waiting for every tab to close.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';

/**
 * Shows a reminder so it alerts: sound (unless turned off for the habit), vibration, and it stays
 * until seen. `quiet`: it replaces the same reminder already on screen without alerting again.
 */
function showReminder(title, options) {
  const silent = options.soundEnabled === false || options.quiet === true;
  return self.registration.showNotification(title, {
    body: options.body,
    tag: options.tag,
    data: options.data,
    actions: Array.isArray(options.actions) ? options.actions.slice(0, 2) : [],
    icon: ICON,
    badge: BADGE,
    silent,
    vibrate: silent ? undefined : [250, 120, 250],
    renotify: Boolean(options.tag) && options.quiet !== true,
    requireInteraction: true,
    timestamp: Date.now(),
  });
}

/** Tells open HabitAI windows about the reminder, so they can play the reminder sound. */
async function tellOpenWindows(message) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) client.postMessage(message);
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data?.json() ?? {};
    } catch {
      payload = { body: event.data?.text() ?? '' };
    }
    const title = payload.title || 'Habit reminder';
    // An open HabitAI tab may have shown this reminder on its minute already (same tag): replace
    // it quietly, adding the Done and Snooze buttons, instead of alerting twice.
    const onScreen = payload.tag ? await self.registration.getNotifications({ tag: payload.tag }).catch(() => []) : [];
    const quiet = onScreen.length > 0;
    await showReminder(title, {
      body: payload.body || 'A small step today keeps your streak moving.',
      tag: payload.tag,
      data: payload.data,
      actions: payload.actions,
      soundEnabled: payload.soundEnabled,
      quiet,
    });
    await tellOpenWindows({ type: 'habitai-reminder', title, tag: payload.tag, soundEnabled: !quiet && payload.soundEnabled !== false });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    // Done: check the habit off from the notification, without opening the app.
    if (event.action === 'DONE') {
      const { doneToken, doneUrl, label, habitId } = event.notification.data || {};
      if (!doneToken || !doneUrl) return;
      try {
        const response = await fetch(doneUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: doneToken }),
          cache: 'no-store',
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'Open HabitAI to check in.');
        await self.registration.showNotification(`✓ ${body.label || label || 'Habit'} done!`, {
          body: 'Checked off for today: +5 tokens. Keep the streak going!',
          tag: event.notification.tag,
          icon: ICON,
          badge: BADGE,
          silent: true,
        });
        await tellOpenWindows({ type: 'habitai-checked-in', habitId });
      } catch (error) {
        await self.registration.showNotification('Could not check it off', {
          body: (error && error.message) || 'Open HabitAI to check in.',
          tag: 'done-failed',
          icon: ICON,
          badge: BADGE,
        });
      }
      return;
    }
    if (event.action === 'SNOOZE') {
      const { snoozeToken, snoozeUrl } = event.notification.data || {};
      if (!snoozeToken || !snoozeUrl) return;
      try {
        const response = await fetch(snoozeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: snoozeToken }),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Snooze request rejected.');
      } catch {
        await self.registration.showNotification('Snooze unavailable', {
          body: 'Open HabitAI and check your connection before trying again.',
          tag: 'snooze-unavailable',
          icon: ICON,
          badge: BADGE,
        });
      }
      return;
    }
    const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appWindow = windows.find((client) => 'focus' in client);
    if (appWindow) {
      await appWindow.focus();
      return;
    }
    await self.clients.openWindow(target);
  })());
});
