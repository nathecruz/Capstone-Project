self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
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