/**
 * ==============================================================================
 * 🚀 خدمة إرسال الإشعارات الشاملة في الخلفية (Notification Service)
 * ==============================================================================
 * تقوم هذه الخدمة بقراءة اشتراكات الأجهزة من قاعدة بيانات MongoDB وإرسال
 * إشعارات الـ Web Push حتى لو كانت المتصفحات أو الأجهزة مغلقة.
 * كما تقوم تلقائياً بحذف الاشتراكات التالفة أو التي ألغى أصحابها الصلاحية.
 */

const connectDB = require('../config/db');
const { initWebPush, webpush } = require('../config/webpush');
const Subscription = require('../data/Subscription');

/**
 * إرسال إشعار Web Push لجميع الأجهزة المشتركة في MongoDB
 * 
 * @param {object|string} payloadOrTitle - كائن بيانات الإشعار أو عنوان التنبيه
 * @param {string} [bodyText] - نص الرسالة في حال تم تمرير العنوان كنص
 * @param {object} [extraOptions] - خيارات إضافية (url, tag, icon, badge)
 * @returns {Promise<{ sent: number, failed: number, deleted: number, total: number }>}
 */
async function sendNotificationToAll(payloadOrTitle, bodyText = '', extraOptions = {}) {
  // 1. ضمان الاتصال بقاعدة بيانات MongoDB وتجهيز تشفير WebPush
  await connectDB();
  initWebPush();

  // 2. توحيد وتجهيز بيانات الإشعار (Payload)
  let title = 'تطبيق ذكّر 🕌';
  let body = bodyText;
  let url = '/';
  let tag = 'zakker-notification';
  let icon = '/img/icon.png';
  let badge = '/img/badge.png';

  if (typeof payloadOrTitle === 'object' && payloadOrTitle !== null) {
    title = payloadOrTitle.title || title;
    body = payloadOrTitle.body || body;
    url = payloadOrTitle.url || url;
    tag = payloadOrTitle.tag || tag;
    icon = payloadOrTitle.icon || icon;
    badge = payloadOrTitle.badge || badge;
  } else if (typeof payloadOrTitle === 'string') {
    title = payloadOrTitle;
    if (extraOptions.url) url = extraOptions.url;
    if (extraOptions.tag) tag = extraOptions.tag;
    if (extraOptions.icon) icon = extraOptions.icon;
    if (extraOptions.badge) badge = extraOptions.badge;
  }

  const notificationPayload = JSON.stringify({
    title,
    body,
    url,
    tag,
    icon,
    badge
  });

  // 3. جلب جميع الاشتراكات المسجلة من MongoDB
  const subscriptions = await Subscription.find({}).lean();

  if (!subscriptions || subscriptions.length === 0) {
    console.log('ℹ️ [NotificationService] لا توجد اشتراكات مسجلة حالياً في قاعدة البيانات.');
    return { sent: 0, failed: 0, deleted: 0, total: 0 };
  }

  console.log(`📤 [NotificationService] بدء إرسال إشعار "${title}" إلى ${subscriptions.length} جهاز...`);

  let sentCount = 0;
  let failedCount = 0;
  const invalidSubscriptionIds = [];

  // 4. إرسال الإشعارات بالتوازي لسرعة الأداء
  const sendTasks = subscriptions.map(async (sub) => {
    const pushConfig = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.keys?.p256dh,
        auth: sub.keys?.auth
      }
    };

    try {
      await webpush.sendNotification(pushConfig, notificationPayload);
      sentCount++;
    } catch (err) {
      failedCount++;
      // إذا كان كود الخطأ 404 أو 410، فهذا يعني أن المستخدم ألغى إذن الإشعارات أو غير جهازه
      if (err.statusCode === 404 || err.statusCode === 410) {
        invalidSubscriptionIds.push(sub._id);
      } else {
        console.warn(`⚠️ [NotificationService] تعذر الإرسال لجهاز (كود ${err.statusCode || 'غير محدد'}): ${err.message}`);
      }
    }
  });

  await Promise.allSettled(sendTasks);

  // 5. تنظيف الاشتراكات المنتهية من قاعدة البيانات دفعة واحدة (Bulk Delete)
  let deletedCount = 0;
  if (invalidSubscriptionIds.length > 0) {
    try {
      const deleteResult = await Subscription.deleteMany({ _id: { $in: invalidSubscriptionIds } });
      deletedCount = deleteResult.deletedCount || 0;
      console.log(`🧹 [NotificationService] تم تنظيف وحذف ${deletedCount} اشتراك ملغي/منتهي من MongoDB.`);
    } catch (cleanErr) {
      console.error('❌ [NotificationService] خطأ أثناء حذف الاشتراكات التالفة:', cleanErr.message);
    }
  }

  const summary = {
    sent: sentCount,
    failed: failedCount,
    deleted: deletedCount,
    total: subscriptions.length
  };

  console.log(`✅ [NotificationService] تم الانتهاء: نجاح (${sentCount}) | فشل (${failedCount}) | منتهية ومحذوفة (${deletedCount}) من إجمالي (${subscriptions.length})`);
  return summary;
}

module.exports = {
  sendNotificationToAll
};
