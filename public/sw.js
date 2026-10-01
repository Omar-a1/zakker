/**
 * Service Worker لمشروع ذكّر
 * يستقبل الإشعارات عبر خادم الـ Web Push حتى لو كان المتصفح مغلقاً أو في الخلفية
 */

self.addEventListener('push', function(event) {
  let notificationData = {};

  if (event.data) {
    try {
      notificationData = event.data.json();
    } catch (e) {
      notificationData = {
        title: 'تطبيق ذكّر 🕌',
        body: event.data.text()
      };
    }
  }

  const title = notificationData.title || 'تطبيق ذكّر 🕌';
  const options = {
    body: notificationData.body || 'حان وقت الذكر والصلاة، ألا بذكر الله تطمئن القلوب.',
    icon: notificationData.icon || '/img/icon.png',
    badge: notificationData.badge || '/img/badge.png',
    data: {
      url: notificationData.url || '/'
    },
    tag: notificationData.tag || 'zakker-notification',
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
