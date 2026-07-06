self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'Estado de tu pedido';
  const options = {
    body: payload.body || 'Tu pedido fue actualizado.',
    tag: payload.tag || 'order-status',
    data: payload.data || {},
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existingClient = clientsList.find((client) => 'focus' in client);

    if (existingClient) {
      await existingClient.focus();
      return;
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
