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