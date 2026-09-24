/**
 * Service Worker لمشروع ذكّر
 * يستقبل الإشعارات عبر خادم الـ Web Push حتى لو كان المتصفح مغلقاً أو في الخلفية
 */

self.addEventListener('push', (event) => {
  let data = {
    title: 'تطبيق ذكّر 🕌',
    body: 'حان وقت الذكر والصلاة، ألا بذكر الله تطمئن القلوب.',
    url: '/'
  };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (err) {
    console.warn('تعذر قراءة بيانات الإشعار كـ JSON، استخدام النص المباشر:', err);
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/img/icon.png',
    badge: data.badge || '/img/badge.png',
    data: {
      url: data.url || '/'
    },
    dir: 'rtl',
    lang: 'ar',
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // إذا كان هناك تبويب مفتوح للموقع بالفعل نقوم بفتحه والتركيز عليه
      for (let client of windowClients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // وإلا نفتح نافذة جديدة بالرابط المطلوب
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
