/**
 * ==============================================================================
 * 📱 Service Worker لمشروع ذكّر (PWA & Offline & Web Push)
 * ==============================================================================
 * المميزات:
 * 1. استراتيجيات تخزين ذكية (Precache لجميع الأذكار والصفحات، Cache First للملفات الثابتة والخطوط).
 * 2. دعم كامل للعمل بدون إنترنت (Offline Mode) لجميع الصفحات وخاصة خانة "جميع الأذكار" (/azkar).
 * 3. استقبال إشعارات Web Push السحابية حتى عند إغلاق المتصفح (push, notificationclick).
 * 4. فحص وجدولة وإطلاق الإشعارات المحلية أوفلاين في التطبيق المثبت عبر IndexedDB و TimestampTrigger و PeriodicSync.
 */

const STATIC_CACHE_NAME = 'zakker-static-v6';
const DYNAMIC_CACHE_NAME = 'zakker-dynamic-v6';

// الملفات والصفحات الأساسية التي يتم تخزينها مسبقاً فور تثبيت التطبيق للعمل أوفلاين 100%
const PRECACHE_ASSETS = [
  '/',
  '/morning',
  '/evening',
  '/azkar',
  '/daily',
  '/sleep',
  '/waking',
  '/home-azkar',
  '/restroom',
  '/wudu',
  '/prayers',
  '/api/azkar',
  '/css/style.css',
  '/css/thmanyah.css',
  '/js/main.js',
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
  console.log('👷 [SW] جاري تثبيت الـ Service Worker وتخزين جميع صفحات الأذكار للعمل Offline...');
  self.skipWaiting();

  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then(async (cache) => {
      // تخزين الملفات بأمان: إن تعذر أحدها، يتم تخزين البقية دون إيقاف التثبيت
      const promises = PRECACHE_ASSETS.map(async (asset) => {
        try {
          const res = await fetch(asset);
          if (res.ok) {
            await cache.put(asset, res);
          }
        } catch (err) {
          console.warn(`⚠️ [SW Cache] تعذر التخزين المسبق للملف (${asset}):`, err.message);
        }
      });
      return Promise.all(promises);
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('🚀 [SW] تم تفعيل Service Worker v6 وتنظيف الكاش القديم.');
  event.waitUntil(
    Promise.all([
      clients.claim(),
      // مسح الكاش القديم
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
      // فحص أي تنبيهات مستحقة في IndexedDB
      checkScheduledNotificationsFromSW()
    ])
  );
});

// ==============================================================================
// 2. استراتيجيات جلب البيانات (Fetch Strategy & Offline Support)
// ==============================================================================

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // استبعاد طلبات غير GET ومسارات API الحساسة للإشعارات السحابية
  if (request.method !== 'GET' || url.pathname.startsWith('/api/send-notification') || url.pathname.startsWith('/api/save-subscription')) {
    return;
  }

  // أ. استراتيجية Cache First للملفات الثابتة والخطوط والصور
  const isStaticAsset = (
    url.origin === location.origin && (
      url.pathname.startsWith('/css/') ||
      url.pathname.startsWith('/js/') ||
      url.pathname.startsWith('/img/') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.woff2') ||
      url.pathname.endsWith('.woff') ||
      url.pathname === '/manifest.json'
    )
  ) || (
    url.origin.includes('fonts.googleapis.com') ||
    url.origin.includes('fonts.gstatic.com') ||
    url.origin.includes('cdn.jsdelivr.net')
  );

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        }).catch(() => {
          // محاولة أخيرة بالمطابقة بدون المعاملات
          return caches.match(url.pathname, { ignoreSearch: true });
        });
      })
    );
    return;
  }

  // ب. استراتيجية Network First للصفحات مع Fallback كامل للكاش أوفلاين
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(DYNAMIC_CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      })
      .catch(async () => {
        // عند انقطاع الإنترنت، نسترجع الصفحة المخزنة من الكاش
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;

        // محاولة مطابقة المسار بدون query parameters
        const pathCached = await caches.match(url.pathname, { ignoreSearch: true });
        if (pathCached) return pathCached;

        // إذا كان الطلب لصفحة HTML ولم توجد، نعيد الصفحة الرئيسية كـ Fallback
        if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) {
          const homeCached = await caches.match('/');
          if (homeCached) return homeCached;
        }

        // لو كان طلباً للـ API الخاص بالأذكار
        if (url.pathname === '/api/azkar') {
          return caches.match('/api/azkar');
        }
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
 * فحص التنبيهات المستحقة في IndexedDB وإظهارها حتى بدون إنترنت
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
        if (item.status === 'pending') {
          // إذا حان وقته (خلال آخر ساعتين لعدم إطلاق إشعارات قديمة جداً)
          if (item.triggerTimestamp <= now && (now - item.triggerTimestamp) < (2 * 60 * 60 * 1000)) {
            await self.registration.showNotification(item.title, {
              body: item.body,
              icon: item.icon || '/zakker logo-modified.png',
              tag: item.tag || 'zakker-offline-alert',
              data: { url: item.url || '/' },
              dir: 'rtl',
              lang: 'ar',
              vibrate: [200, 100, 200]
            });

            item.status = 'completed';
            item.triggeredAt = now;
            store.put(item);
            console.log(`⏰ [SW Offline Scheduler] تم إظهار التنبيه الأوفلاين: ${item.title}`);
          } else if (item.triggerTimestamp < now - (2 * 60 * 60 * 1000)) {
            // تنبيه قديم فات وقته بأكثر من ساعتين يتم وسمه كمنتهٍ
            item.status = 'expired';
            store.put(item);
          }
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

// Periodic Background Sync للأجهزة المدعومة (Chrome Android / PWA)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-azkar-offline' || event.tag === 'sync-notifications') {
    event.waitUntil(checkScheduledNotificationsFromSW());
  }
});

// Background Sync عند عودة الاتصال أو تنشيط الـ Service Worker
self.addEventListener('sync', (event) => {
  if (event.tag === 'check-azkar-offline' || event.tag === 'sync-notifications') {
    event.waitUntil(checkScheduledNotificationsFromSW());
  }
});

// فحص دوري خفيف كل دقيقة طالما الـ Service Worker نشط في الذاكرة
setInterval(() => {
  checkScheduledNotificationsFromSW();
}, 60 * 1000);
