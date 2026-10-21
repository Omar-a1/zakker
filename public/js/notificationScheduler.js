/**
 * ==============================================================================
 * ⏰ وحدة جدولة الإشعارات المحلية ودعم Offline عبر IndexedDB
 * (Notification Scheduler & Offline PWA Module)
 * ==============================================================================
 * تتيح هذه الوحدة:
 * 1. حفظ وجدولة الإشعارات المحلية بدون إنترنت في IndexedDB.
 * 2. استخدام NotificationTrigger API الأصلي إن كان مدعوماً في المتصفح.
 * 3. آلية بديلة (Fallback) تعمل عبر التايمرات والـ Service Worker في حال عدم دعم الـ API.
 * 4. إدارة صلاحيات الإشعارات بأمان وسلاسة.
 */

const NotificationScheduler = (function() {
  const DB_NAME = 'zakker_pwa_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'scheduled_notifications';

  let dbPromise = null;
  const activeTimers = new Map();

  /**
   * 1. تهيئة وفتح قاعدة بيانات IndexedDB المحلية
   * @returns {Promise<IDBDatabase>}
   */
  function initDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        console.warn('⚠️ [Scheduler] المتصفح لا يدعم IndexedDB.');
        return resolve(null);
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('triggerTimestamp', 'triggerTimestamp', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          console.log('📦 [IndexedDB] تم إنشاء جدول scheduled_notifications بنجاح.');
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        console.error('❌ [IndexedDB] خطأ في فتح قاعدة البيانات:', event.target.error);
        reject(event.target.error);
      };
    });

    return dbPromise;
  }

  /**
   * 2. طلب صلاحية الإشعارات بأمان مع التعامل مع الرفض
   * @returns {Promise<'granted'|'denied'|'default'>}
   */
  async function requestPermissionSafe() {
    if (!('Notification' in window)) {
      console.warn('⚠️ [Scheduler] الإشعارات غير مدعومة في هذا المتصفح.');
      return 'denied';
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    if (Notification.permission === 'denied') {
      console.warn('⚠️ [Scheduler] تم حظر الإشعارات مسبقاً من إعدادات المتصفح.');
      return 'denied';
    }

    try {
      const permission = await Notification.requestPermission();
      return permission;
    } catch (err) {
      console.error('❌ [Scheduler] فشل طلب إذن الإشعارات:', err);
      return 'denied';
    }
  }

  /**
   * 3. التحقق مما إذا كان المتصفح يدعم خاصية NotificationTrigger (TimestampTrigger) الأصلية
   * @returns {boolean}
   */
  function isNotificationTriggerSupported() {
    return (
      'Notification' in window &&
      'showTrigger' in Notification.prototype &&
      typeof window.TimestampTrigger !== 'undefined'
    );
  }

  /**
   * 4. حفظ تنبيه مجدول في IndexedDB
   * @param {object} item 
   * @returns {Promise<boolean>}
   */
  async function saveToIndexedDB(item) {
    const db = await initDB();
    if (!db) return false;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(item);

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * 5. جدولة إشعار جديد محلياً (مع دعم Native Trigger والـ Fallback)
   * @param {object} options
   * @param {string} options.id - معرف فريد للتنبيه
   * @param {string} options.title - عنوان التنبيه
   * @param {string} options.body - نص التنبيه
   * @param {number} options.triggerTimestamp - وقت التفعيل بالميلي ثانية (Unix Timestamp)
   * @param {string} [options.url] - الرابط عند النقر
   * @param {string} [options.tag] - وسم الإشعار لمنع التكرار
   * @param {string} [options.icon] - أيقونة التنبيه
   */
  async function scheduleNotification({
    id,
    title,
    body,
    triggerTimestamp,
    url = '/',
    tag = 'zakker-scheduled',
    icon = '/zakker logo-modified.png'
  }) {
    const permission = await requestPermissionSafe();
    if (permission !== 'granted') {
      console.warn('⚠️ [Scheduler] تعذر الجدولة: صلاحية الإشعارات غير ممنوحة.');
      return false;
    }

    const notificationItem = {
      id: id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title,
      body,
      triggerTimestamp,
      url,
      tag,
      icon,
      status: 'pending',
      createdAt: Date.now()
    };

    // 1. حفظ السجل دائماً في IndexedDB لضمان البقاء أوفلاين
    await saveToIndexedDB(notificationItem);

    // 2. التحقق من دعم NotificationTrigger الأصلي
    if (isNotificationTriggerSupported() && 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body,
          icon,
          tag,
          data: { url, id: notificationItem.id },
          showTrigger: new TimestampTrigger(triggerTimestamp),
          dir: 'rtl',
          lang: 'ar'
        });
        console.log(`✅ [Scheduler] تمت الجدولة عبر Native TimestampTrigger للتوقيت: ${new Date(triggerTimestamp).toLocaleTimeString('ar-EG')}`);
        return notificationItem.id;
      } catch (triggerErr) {
        console.warn('⚠️ [Scheduler] تعذر استخدام TimestampTrigger، الانتقال للآلية البديلة (Fallback):', triggerErr);
      }
    }

    // 3. الآلية البديلة (Fallback Mechanism): مؤقت في الذاكرة ومزامنة Service Worker
    const delay = triggerTimestamp - Date.now();
    if (delay > 0) {
      if (activeTimers.has(notificationItem.id)) {
        clearTimeout(activeTimers.get(notificationItem.id));
      }

      const timerId = setTimeout(async () => {
        await triggerNotification(notificationItem);
        activeTimers.delete(notificationItem.id);
      }, delay);

      activeTimers.set(notificationItem.id, timerId);
    } else {
      // إذا كان الوقت قد حان بالفعل
      await triggerNotification(notificationItem);
    }

    // إشعار الـ Service Worker ليقوم بفحص التنبيهات أيضاً عند استيقاظه
    notifyServiceWorkerToCheck();

    console.log(`⏱️ [Scheduler Fallback] تمت جدولة التنبيه محلياً للتوقيت: ${new Date(triggerTimestamp).toLocaleTimeString('ar-EG')}`);
    return notificationItem.id;
  }

  /**
   * 6. تفعيل وإظهار الإشعار وتحديث حالته في IndexedDB
   * @param {object} item 
   */
  async function triggerNotification(item) {
    if (!item) return;

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(item.title, {
          body: item.body,
          icon: item.icon || '/zakker logo-modified.png',
          tag: item.tag || 'zakker-scheduled',
          data: { url: item.url || '/', id: item.id },
          dir: 'rtl',
          lang: 'ar',
          vibrate: [200, 100, 200]
        });
      } else if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(item.title, {
          body: item.body,
          icon: item.icon || '/zakker logo-modified.png',
          tag: item.tag,
          dir: 'rtl'
        });
      }

      // تحديث الحالة في IndexedDB إلى مكتمل
      const db = await initDB();
      if (db) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        item.status = 'completed';
        item.triggeredAt = Date.now();
        store.put(item);
      }
    } catch (e) {
      console.error('❌ [Scheduler] خطأ أثناء إظهار التنبيه:', e);
    }
  }

  /**
   * 7. فحص التنبيهات المستحقة في IndexedDB وإطلاقها فوراً (عند فتح التطبيق أو عودة الاتصال)
   */
  async function checkAndTriggerDueNotifications() {
    const db = await initDB();
    if (!db) return;

    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = async () => {
      const items = request.result || [];
      const now = Date.now();

      for (const item of items) {
        if (item.status === 'pending') {
          if (item.triggerTimestamp <= now) {
            // مستحق الآن
            await triggerNotification(item);
          } else if (!activeTimers.has(item.id)) {
            // مستحق في المستقبل، نعيد ربطه بالتايمر في الذاكرة
            const remaining = item.triggerTimestamp - now;
            const timerId = setTimeout(async () => {
              await triggerNotification(item);
              activeTimers.delete(item.id);
            }, remaining);
            activeTimers.set(item.id, timerId);
          }
        }
      }
    };
  }

  /**
   * 8. إلغاء إشعار مجدول
   * @param {string} id 
   */
  async function cancelScheduledNotification(id) {
    if (activeTimers.has(id)) {
      clearTimeout(activeTimers.get(id));
      activeTimers.delete(id);
    }

    const db = await initDB();
    if (db) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
    }
    console.log(`🗑️ [Scheduler] تم إلغاء التنبيه: ${id}`);
  }

  /**
   * 9. إرسال رسالة للـ Service Worker ليفحص IndexedDB
   */
  function notifyServiceWorkerToCheck() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CHECK_SCHEDULED_NOTIFICATIONS'
      });
    }
  }

  // فحص دوري للتنبيهات عند إقلاع النافذة
  if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
      initDB().then(() => {
        checkAndTriggerDueNotifications();
      });
    });

    // إعادة الفحص عند عودة التطبيق للواجهة (Visibility Change)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkAndTriggerDueNotifications();
      }
    });
  }

  return {
    initDB,
    requestPermissionSafe,
    isNotificationTriggerSupported,
    scheduleNotification,
    cancelScheduledNotification,
    checkAndTriggerDueNotifications
  };
})();

// تصدير للاستخدام في المتصفح أو بيئات الاختبار
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotificationScheduler;
}
