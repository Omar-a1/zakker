const webpush = require('web-push');
const Subscription = require('../data/Subscription');

// التأكد من تهيئة مفاتيح VAPID
function ensureVapidConfig() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL || 'mailto:zakker-app@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  }
}

/**
 * إرسال إشعار Push لجميع المشتركين المخزنين في MongoDB
 * وحذف الاشتراكات المنتهية (404 / 410) تلقائياً
 * 
 * @param {string|object} titleOrPayload - عنوان الإشعار أو كائن يحوي البيانات كاملة
 * @param {string} [body] - نص الإشعار
 * @param {object} [options] - خيارات إضافية (url, tag, icon, badge)
 */
async function sendNotificationToAll(titleOrPayload, body = '', options = {}) {
  ensureVapidConfig();

  // دعم تمرير كائن أو معاملات منفصلة
  let title = 'تطبيق ذكّر 🕌';
  let messageBody = body;
  let url = '/';
  let tag = 'zakker-notification';
  let icon = '/img/icon.png';
  let badge = '/img/badge.png';

  if (typeof titleOrPayload === 'object' && titleOrPayload !== null) {
    title = titleOrPayload.title || title;
    messageBody = titleOrPayload.body || messageBody;
    url = titleOrPayload.url || url;
    tag = titleOrPayload.tag || tag;
    icon = titleOrPayload.icon || icon;
    badge = titleOrPayload.badge || badge;
  } else if (typeof titleOrPayload === 'string') {
    title = titleOrPayload;
    if (options.url) url = options.url;
    if (options.tag) tag = options.tag;
    if (options.icon) icon = options.icon;
    if (options.badge) badge = options.badge;
  }

  const payload = JSON.stringify({
    title,
    body: messageBody,
    url,
    tag,
    icon,
    badge
  });

  try {
    const subscriptions = await Subscription.find({});
    if (!subscriptions || subscriptions.length === 0) {
      console.log('[NotificationService] لا توجد اشتراكات مسجلة حالياً في قاعدة البيانات.');
      return { sent: 0, failed: 0, deleted: 0, total: 0 };
    }

    let sentCount = 0;
    let failedCount = 0;
    let deletedCount = 0;

    const pushPromises = subscriptions.map(async (sub) => {
      const pushConfig = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth
        }
      };

      try {
        await webpush.sendNotification(pushConfig, payload);
        sentCount++;
      } catch (err) {
        failedCount++;
        // إذا كان الخطأ 404 أو 410، فهذا يعني أن الجهاز ألغى الاشتراك أو انتهت صلاحيته
        if (err.statusCode === 404 || err.statusCode === 410) {
          console.warn(`[NotificationService] اشتراك غير صالح (${err.statusCode}). جارٍ حذفه من MongoDB: ${sub.endpoint.slice(0, 35)}...`);
          try {
            await Subscription.deleteOne({ _id: sub._id });
            deletedCount++;
          } catch (deleteErr) {
            console.error('[NotificationService] فشل حذف الاشتراك التالف:', deleteErr.message);
          }
        } else {
          console.warn(`[NotificationService] تعذر الإرسال للمشترك (رمز الخطأ: ${err.statusCode || 'N/A'}): ${err.message}`);
        }
      }
    });

    await Promise.allSettled(pushPromises);

    console.log(`[NotificationService] اكتمل إرسال الإشعارات: نجح ${sentCount} | فشل ${failedCount} | حُذف ${deletedCount} من إجمالي ${subscriptions.length}`);
    return {
      sent: sentCount,
      failed: failedCount,
      deleted: deletedCount,
      total: subscriptions.length
    };
  } catch (error) {
    console.error('[NotificationService] خطأ أثناء استرجاع الاشتراكات من MongoDB:', error);
    throw error;
  }
}

module.exports = {
  sendNotificationToAll
};
