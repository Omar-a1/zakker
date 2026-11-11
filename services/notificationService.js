/**
 * ==============================================================================
 * 🚀 خدمة إرسال الإشعارات الشاملة في الخلفية (Notification Service)
 * ==============================================================================
 * تقوم هذه الخدمة بإرسال إشعارات Web Push لجميع الأجهزة المسجلة في MongoDB
 * مع دعم التوقيت الصيفي والشتوي والتوقيت المحلي لكل دولة حول العالم بدقة.
 */

const connectDB = require('../config/db');
const { initWebPush, webpush } = require('../config/webpush');
const Subscription = require('../data/Subscription');
const {
  getUserLocalDateTime,
  isMorningAzkarTime,
  isEveningAzkarTime,
  normalizeTimezone
} = require('./timezoneService');

/**
 * إرسال إشعار لجهاز محدد عبر PushManager
 * @param {object} sub - مستند الاشتراك
 * @param {string} payloadString - البيانات المشفرة
 * @returns {Promise<{ success: boolean, statusCode?: number, error?: string }>}
 */
async function sendToSingleSubscription(sub, payloadString) {
  const pushConfig = {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.keys?.p256dh,
      auth: sub.keys?.auth
    }
  };

  try {
    await webpush.sendNotification(pushConfig, payloadString);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      statusCode: err.statusCode,
      error: err.message
    };
  }
}

/**
 * فحص وإرسال إشعارات الأذكار الدورية الذكية لجميع المشتركين
 * بناءً على توقيت كل مستخدم المحلي (سواء بالتوقيت الصيفي أو الشتوي وفي أي دولة)
 * 
 * @returns {Promise<{ morningSent: number, eveningSent: number, failed: number, deleted: number, total: number }>}
 */
async function sendScheduledAzkarNotifications() {
  await connectDB();
  initWebPush();

  const subscriptions = await Subscription.find({});
  if (!subscriptions || subscriptions.length === 0) {
    console.log('ℹ️ [Scheduled Azkar] لا توجد اشتراكات مسجلة في قاعدة البيانات.');
    return { morningSent: 0, eveningSent: 0, failed: 0, deleted: 0, total: 0 };
  }

  console.log(`🧭 [Scheduled Azkar] فحص مواعيد الأذكار لـ ${subscriptions.length} جهاز حسب التوقيت المحلي...`);

  let morningSent = 0;
  let eveningSent = 0;
  let failed = 0;
  const invalidSubscriptionIds = [];
  const updatePromises = [];

  const morningPayload = JSON.stringify({
    title: 'أذكار الصباح 🌅',
    body: 'حان الآن وقت أذكار الصباح، ابدأ يومك بذكر الله وحصّن نفسك طوال النهار.',
    url: '/morning',
    tag: 'morning-azkar',
    icon: '/img/icon.png',
    badge: '/img/badge.png'
  });

  const eveningPayload = JSON.stringify({
    title: 'أذكار المساء 🌇',
    body: 'حان الآن وقت أذكار المساء، ألا بذكر الله تطمئن القلوب، حصّن نفسك حتى تصبح.',
    url: '/evening',
    tag: 'evening-azkar',
    icon: '/img/icon.png',
    badge: '/img/badge.png'
  });

  for (const sub of subscriptions) {
    const tz = normalizeTimezone(sub.timezone);
    const local = getUserLocalDateTime(tz);

    let needsUpdate = false;
    let updateFields = {};

    // 1. فحص أذكار الصباح
    const isMorning = isMorningAzkarTime(tz);
    const hasReceivedMorningToday = sub.lastMorningNotification === local.dateStr;

    if (isMorning && !hasReceivedMorningToday) {
      const res = await sendToSingleSubscription(sub, morningPayload);
      if (res.success) {
        morningSent++;
        needsUpdate = true;
        updateFields.lastMorningNotification = local.dateStr;
        console.log(`🌅 [Morning Azkar] أُرسلت بنجاح إلى جهاز (${tz} - الساعة ${local.timeHM})`);
      } else {
        failed++;
        if (res.statusCode === 404 || res.statusCode === 410) {
          invalidSubscriptionIds.push(sub._id);
        }
      }
    }

    // 2. فحص أذكار المساء
    const isEvening = isEveningAzkarTime(tz);
    const hasReceivedEveningToday = sub.lastEveningNotification === local.dateStr;

    if (isEvening && !hasReceivedEveningToday) {
      const res = await sendToSingleSubscription(sub, eveningPayload);
      if (res.success) {
        eveningSent++;
        needsUpdate = true;
        updateFields.lastEveningNotification = local.dateStr;
        console.log(`🌇 [Evening Azkar] أُرسلت بنجاح إلى جهاز (${tz} - الساعة ${local.timeHM})`);
      } else {
        failed++;
        if (res.statusCode === 404 || res.statusCode === 410) {
          invalidSubscriptionIds.push(sub._id);
        }
      }
    }

    if (needsUpdate && !invalidSubscriptionIds.includes(sub._id)) {
      updatePromises.push(
        Subscription.updateOne({ _id: sub._id }, { $set: updateFields }).catch((err) => {
          console.warn('⚠️ فشل تحديث تاريخ الإشعار في MongoDB:', err.message);
        })
      );
    }
  }

  await Promise.allSettled(updatePromises);

  // تنظيف الاشتراكات المنتهية
  let deletedCount = 0;
  if (invalidSubscriptionIds.length > 0) {
    try {
      const delRes = await Subscription.deleteMany({ _id: { $in: invalidSubscriptionIds } });
      deletedCount = delRes.deletedCount || 0;
      console.log(`🧹 [Scheduled Azkar] تم حذف ${deletedCount} اشتراك منتهٍ.`);
    } catch (cleanErr) {
      console.error('❌ خطأ في حذف الاشتراكات التالفة:', cleanErr.message);
    }
  }

  const summary = {
    morningSent,
    eveningSent,
    failed,
    deleted: deletedCount,
    total: subscriptions.length
  };

  console.log(`✅ [Scheduled Azkar] ملخص الإرسال الذكي: صباح (${morningSent}) | مساء (${eveningSent}) | فشل (${failed}) من إجمالي (${subscriptions.length})`);
  return summary;
}

/**
 * إرسال إشعار Web Push عام لجميع الأجهزة المشتركة في MongoDB
 * 
 * @param {object|string} payloadOrTitle - كائن بيانات الإشعار أو عنوان التنبيه
 * @param {string} [bodyText] - نص الرسالة في حال تم تمرير العنوان كنص
 * @param {object} [extraOptions] - خيارات إضافية (url, tag, icon, badge, force)
 * @returns {Promise<{ sent: number, failed: number, deleted: number, total: number }>}
 */
async function sendNotificationToAll(payloadOrTitle, bodyText = '', extraOptions = {}) {
  await connectDB();
  initWebPush();

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

  const subscriptions = await Subscription.find({}).lean();
  if (!subscriptions || subscriptions.length === 0) {
    console.log('ℹ️ [NotificationService] لا توجد اشتراكات مسجلة حالياً.');
    return { sent: 0, failed: 0, deleted: 0, total: 0 };
  }

  console.log(`📤 [NotificationService] إرسال إشعار عام "${title}" إلى ${subscriptions.length} جهاز...`);

  let sentCount = 0;
  let failedCount = 0;
  const invalidSubscriptionIds = [];

  const sendTasks = subscriptions.map(async (sub) => {
    const res = await sendToSingleSubscription(sub, notificationPayload);
    if (res.success) {
      sentCount++;
    } else {
      failedCount++;
      if (res.statusCode === 404 || res.statusCode === 410) {
        invalidSubscriptionIds.push(sub._id);
      }
    }
  });

  await Promise.allSettled(sendTasks);

  let deletedCount = 0;
  if (invalidSubscriptionIds.length > 0) {
    try {
      const deleteResult = await Subscription.deleteMany({ _id: { $in: invalidSubscriptionIds } });
      deletedCount = deleteResult.deletedCount || 0;
      console.log(`🧹 [NotificationService] تم تنظيف ${deletedCount} اشتراك ملغي.`);
    } catch (cleanErr) {
      console.error('❌ خطأ أثناء حذف الاشتراكات التالفة:', cleanErr.message);
    }
  }

  return {
    sent: sentCount,
    failed: failedCount,
    deleted: deletedCount,
    total: subscriptions.length
  };
}

module.exports = {
  sendNotificationToAll,
  sendScheduledAzkarNotifications,
  sendToSingleSubscription
};
