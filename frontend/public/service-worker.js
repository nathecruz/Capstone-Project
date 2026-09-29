self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
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
          body: 'Open HabitMind and check your connection before trying again.',
          tag: 'snooze-unavailable',
        });
      }
      return;
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appWindow = windows.find((client) => 'focus' in client);
    if (appWindow) {
      await appWindow.focus();
      return;
    }
    await self.clients.openWindow('/');
  })());
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data?.json() ?? {};
    } catch {
      payload = { body: event.data?.text() ?? '' };
    }
    await self.registration.showNotification(payload.title || 'Habit reminder', {
      body: payload.body || 'A small step today keeps your streak moving.',
      tag: payload.tag,
      data: payload.data,
      silent: payload.soundEnabled === false,
    });
  })());
});