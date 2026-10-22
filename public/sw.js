/**
 * ==============================================================================
 * 📱 Service Worker لمشروع ذكّر (PWA & Offline & Web Push)
 * ==============================================================================
 * المميزات:
 * 1. استراتيجيات تخزين ذكية (Cache First للملفات الثابتة، Network First للصفحات مع دعم كامل لـ Offline).
 * 2. استقبال إشعارات Web Push السحابية حتى عند إغلاق المتصفح (push, notificationclick, notificationclose).
 * 3. فحص وجدولة الإشعارات المحلية أوفلاين عبر IndexedDB.
 */

const STATIC_CACHE_NAME = 'zakker-static-v4';
const DYNAMIC_CACHE_NAME = 'zakker-dynamic-v4';

// الملفات الثابتة والصفحات الأساسية التي يتم تخزينها فور تثبيت التطبيق للعمل بدون إنترنت
const PRECACHE_ASSETS = [
  '/',
  '/morning',
  '/evening',
  '/prayers',
  '/css/style.css',
  '/css/thmanyah.css',
  '/js/main.js?v=2.0',
  '/js/notificationScheduler.js',
  '/manifest.json',
  '/zakker logo-modified.png',
  '/zakker-logo.png',
  '/mosque-svgrepo-com.svg'
];

// ==============================================================================
// 1. دورة حياة Service Worker (Install & Activate)
// ==============================================================================

self.addEventListener('install', (event) => {
  console.log('👷 [SW] جاري تثبيت الـ Service Worker وتخزين الملفات الأساسية للعمل Offline...');
  self.skipWaiting();

  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('⚠️ [SW Cache] تعذر تحميل بعض الملفات أثناء التثبيت المبدئي:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('🚀 [SW] تم تفعيل الـ Service Worker الجديد وتنظيف الكاش القديم.');
  event.waitUntil(
    Promise.all([
      // تفعيل التحكم الفوري بالصفحات المفتوحة
      clients.claim(),
      // مسح أي كاش قديم لتحديث الملفات
      caches.keys().then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== STATIC_CACHE_NAME && key !== DYNAMIC_CACHE_NAME) {
              console.log('🧹 [SW] حذف كاش قديم:', key);
              return caches.delete(key);
            }
          })
        );
      }),
      // فحص أي إشعارات مجدولة في IndexedDB
      checkScheduledNotificationsFromSW()
    ])
  );
});

// ==============================================================================
// 2. استراتيجيات جلب البيانات (Fetch Strategy)
// ==============================================================================

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // استبعاد طلبات غير الـ GET وطلبات الـ API السحابية الخاصة بـ QStash و Push
  if (request.method !== 'GET' || url.pathname.startsWith('/api/send-notification')) {
    return;
  }

  // أ. استراتيجية Cache First للملفات الثابتة (CSS, JS, Fonts, Images)
  const isStaticAsset = (
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/img/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff') ||
    url.pathname === '/manifest.json'
  );

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // ب. استراتيجية Network First للصفحات التفاعلية مع دعم العودة للكاش عند انقطاع الإنترنت (Offline Fallback)
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // إذا نجح الاتصال، نحفظ نسخة في الكاش الديناميكي
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(DYNAMIC_CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      })
      .catch(() => {
        // عند انقطاع الإنترنت، نسترجع النسخة المحفوظة من الكاش
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // إذا كان الطلب لصفحة HTML ولم توجد في الكاش، نعيد الصفحة الرئيسية كـ Fallback
          if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) {
            return caches.match('/');
          }
        });
      })
  );
});

// ==============================================================================
// 3. استقبال إشعارات Web Push السحابية (Push Events)
// ==============================================================================

self.addEventListener('push', (event) => {
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
    icon: notificationData.icon || '/zakker logo-modified.png',
    badge: notificationData.badge || '/zakker logo-modified.png',
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
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

self.addEventListener('notificationclose', (event) => {
  console.log('🔕 [SW] تم إغلاق الإشعار:', event.notification.tag);
});

// ==============================================================================
// 4. فحص وإطلاق الإشعارات المجدولة أوفلاين في IndexedDB
// ==============================================================================

/**
 * فتح قاعدة بيانات IndexedDB من داخل الـ Service Worker
 */
function openIDB() {
  return new Promise((resolve) => {
    if (!('indexedDB' in self)) {
      return resolve(null);
    }
    const req = indexedDB.open('zakker_pwa_db', 1);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => resolve(null);
  });
}

/**
 * فحص التنبيهات المستحقة في IndexedDB وإظهارها
 */
async function checkScheduledNotificationsFromSW() {
  try {
    const db = await openIDB();
    if (!db || !db.objectStoreNames.contains('scheduled_notifications')) return;

    const tx = db.transaction('scheduled_notifications', 'readwrite');
    const store = tx.objectStore('scheduled_notifications');
    const req = store.getAll();

    req.onsuccess = async () => {
      const items = req.result || [];
      const now = Date.now();

      for (const item of items) {
        if (item.status === 'pending' && item.triggerTimestamp <= now) {
          await self.registration.showNotification(item.title, {
            body: item.body,
            icon: item.icon || '/zakker logo-modified.png',
            tag: item.tag || 'zakker-scheduled',
            data: { url: item.url || '/' },
            dir: 'rtl',
            lang: 'ar',
            vibrate: [200, 100, 200]
          });

          // تحديث الحالة لمكتمل
          item.status = 'completed';
          item.triggeredAt = now;
          store.put(item);
          console.log(`⏰ [SW Offline Scheduler] تم إظهار التنبيه المجدول: ${item.title}`);
        }
      }
    };
  } catch (err) {
    console.warn('⚠️ [SW] خطأ أثناء فحص التنبيهات في IndexedDB:', err);
  }
}

// استقبال رسائل من الواجهة الأمامية لمزامنة الإشعارات فوراً
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CHECK_SCHEDULED_NOTIFICATIONS') {
    event.waitUntil(checkScheduledNotificationsFromSW());
  }
});
