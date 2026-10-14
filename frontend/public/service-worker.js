// HabitAI service worker: shows Web Push reminders and handles their Snooze action, and caches the
// app shell so an installed HabitAI opens and runs with no connection (habits, check-ins, streaks
// and settings all live on the device; only the server-backed extras need a connection).
// The phone plays its notification sound for these (a web page cannot choose the sound of a
// notification); when HabitAI is open, the page also plays the HabitAI reminder sound.

const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';

// Bump this to retire an older cache. The app's JS/CSS are content-hashed, so a cached copy is
// never stale; only the shell cache name is versioned.
const SHELL_CACHE = 'habitai-shell-v2';
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/favicon.ico', ICON, BADGE];

/**
 * Caches the shell AND the JS/CSS the current index.html references, so the app opens offline after
 * one online visit. The bundle names are content-hashed and unknown ahead of time, so they are read
 * from index.html here (inside install's waitUntil, which keeps the worker alive until it finishes —
 * a fire-and-forget cache write during fetch can be dropped when the worker sleeps).
 */
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
  try {
    const response = await fetch('/index.html', { cache: 'no-store' });
    if (!response.ok) return;
    await cache.put('/index.html', response.clone());
    const html = await response.text();
    const assets = new Set();
    for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
      const value = match[1];
      if (/\.(?:js|css)(?:\?|#|$)/.test(value) && (value.startsWith('/') || value.startsWith(self.location.origin))) {
        assets.add(value);
      }
    }
    await Promise.allSettled([...assets].map((asset) => cache.add(asset)));
  } catch {
    // Offline during install: the runtime cache below fills these in on the next online visit.
  }
}

// A new version takes over right away instead of waiting for every tab to close.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop shell caches from earlier versions.
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('habitai-shell-') && name !== SHELL_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Serve HabitAI offline: a page navigation uses the network first and falls back to the cached
// shell; same-origin static assets are cache-first; cross-origin requests (the API) and non-GET
// requests are left to the network, so they fail cleanly offline and the app uses its local copy.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        void caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', fresh.clone())).catch(() => undefined);
        return fresh;
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      // Keep a copy of same-origin assets. The write is awaited (and guarded) so the worker is not
      // killed before it finishes, which is what left the JS bundle uncached before.
      if (fresh.ok && fresh.type === 'basic') {
        try {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(request, fresh.clone());
        } catch {
          // Cache write failed (e.g. storage full): still serve the response.
        }
      }
      return fresh;
    } catch {
      return cached || Response.error();
    }
  })());
});

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
