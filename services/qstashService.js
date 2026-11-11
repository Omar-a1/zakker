const { Client, Receiver } = require('@upstash/qstash');
const { getEpochSecondsForTimezone } = require('./timezoneService');

/**
 * الحصول على عميل QStash لإرسال المهام والجدولة
 */
function getQStashClient() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    return null;
  }
  return new Client({ token });
}

/**
 * الحصول على مستقبل QStash للتحقق من التوقيع الرقمي للـ Webhooks
 */
function getQStashReceiver() {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!currentSigningKey) {
    return null;
  }

  return new Receiver({
    currentSigningKey,
    nextSigningKey: nextSigningKey || currentSigningKey,
  });
}

/**
 * دالة التحقق من صحة توقيع QStash القادم في الطلب
 * @param {import('express').Request} req 
 * @returns {Promise<boolean>}
 */
async function verifyQStashSignature(req) {
  const receiver = getQStashReceiver();

  // في حال لم يتم ضبط مفتاح التوقيع بعد (مثلاً في بيئة التطوير المحلية)، نسمح بالمرور مع إظهار تحذير
  if (!receiver) {
    console.warn('⚠️ [QStash Receiver] QSTASH_CURRENT_SIGNING_KEY غير محدد. يتم تخطي التحقق من التوقيع مؤقتاً.');
    return true;
  }

  const signature = req.headers['upstash-signature'];
  if (!signature) {
    console.error('❌ [QStash Receiver] الترويسة upstash-signature غير موجودة في الطلب.');
    return false;
  }

  // استخدام rawBody المخزن من Express
  const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

  try {
    const isValid = await receiver.verify({
      signature,
      body: rawBody,
    });
    return isValid;
  } catch (err) {
    console.error('❌ [QStash Receiver] فشل التحقق من توقيع QStash:', err.message);
    return false;
  }
}

/**
 * حساب الطابع الزمني بالثواني (Unix Epoch) لتوقيت القاهرة (متوافق مع الصيفي والشتوي)
 * @param {string} hhmm - الوقت بصيغة HH:MM
 * @param {Date} [targetDate]
 * @returns {number}
 */
function getEpochSecondsForCairo(hhmm, targetDate = new Date()) {
  return getEpochSecondsForTimezone(hhmm, 'Africa/Cairo', targetDate);
}

/**
 * تسجيل وتحديث الجداول الدورية الأساسية في QStash
 * @param {string} [appUrl] - رابط التطبيق على Vercel أو النطاق العام
 */
async function initQStashSchedules(appUrl) {
  const client = getQStashClient();
  if (!client) {
    throw new Error('QSTASH_TOKEN غير مضبوط في المتغيرات البيئية.');
  }

  const baseUrl = (appUrl || process.env.APP_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('يرجى تحديد APP_URL (رابط مشروعك على Vercel) لربطه بـ QStash.');
  }

  const destination = `${baseUrl}/api/send-notification`;
  const retries = Number(process.env.QSTASH_RETRIES || 3);

  console.log(`[QStash] تهيئة الجداول الدورية على الوجهة: ${destination} مع ${retries} محاولات إعادة (Retries)...`);

  // تنظيف أي جداول قديمة موجهة لنفس الرابط لتجنب تجاوز حد الـ 10 جداول في الخطة المجانية
  try {
    const existingList = await client.schedules.list();
    const toDelete = existingList.filter((s) => s.destination === destination);
    if (toDelete.length > 0) {
      console.log(`🧹 [QStash Cleanup] جارِ حذف ${toDelete.length} جدول قديم مكرر لتفريغ المساحة...`);
      for (const oldSch of toDelete) {
        await client.schedules.delete(oldSch.scheduleId).catch(() => {});
      }
      console.log('✅ [QStash Cleanup] تم تنظيف الجداول القديمة بنجاح.');
    }
  } catch (cleanErr) {
    console.warn('⚠️ [QStash Cleanup] تعذر فحص الجداول السابقة:', cleanErr.message);
  }

  // الجداول الدورية الحديثة المتوافقة مع التوقيت الصيفي والشتوي وجميع دول العالم
  const schedulesToSet = [
    {
      id: 'zakker-smart-azkar-check',
      cron: 'CRON_TZ=UTC 0,30 * * * *', // تشغيل كل 30 دقيقة بتوقيت UTC لفحص كافة دول العالم
      body: { type: 'check-scheduled-azkar' },
      description: 'فحص وإرسال أذكار الصباح والمساء الذكي لكافة الدول والتوقيتات'
    },
    {
      id: 'zakker-morning-azkar-cairo',
      cron: 'CRON_TZ=Africa/Cairo 30 6 * * *', // 06:30 صباحاً بتوقيت القاهرة كنسخة احتياطية
      body: { type: 'morning-azkar' },
      description: 'أذكار الصباح اليومية (توقيت القاهرة)'
    },
    {
      id: 'zakker-evening-azkar-cairo',
      cron: 'CRON_TZ=Africa/Cairo 0 17 * * *', // 05:00 مساءً بتوقيت القاهرة كنسخة احتياطية
      body: { type: 'evening-azkar' },
      description: 'أذكار المساء اليومية (توقيت القاهرة)'
    },
    {
      id: 'zakker-daily-prayers',
      cron: 'CRON_TZ=Africa/Cairo 5 0 * * *', // 00:05 بعد منتصف الليل لجدولة صلوات اليوم
      body: { type: 'schedule-daily-prayers' },
      description: 'مجدول مواقيت الصلاة اليومي'
    }
  ];

  const results = [];

  for (const item of schedulesToSet) {
    try {
      const res = await client.schedules.create({
        destination,
        cron: item.cron,
        body: JSON.stringify(item.body),
        headers: {
          'Content-Type': 'application/json'
        },
        retries,
      });

      results.push({
        name: item.id,
        description: item.description,
        cron: item.cron,
        status: 'created',
        scheduleId: res.scheduleId
      });
      console.log(`✅ [QStash] تم تسجيل جدول (${item.description}) بنجاح: ID ${res.scheduleId}`);
    } catch (err) {
      console.error(`❌ [QStash] فشل إنشاء جدول (${item.description}):`, err.message);
      results.push({
        name: item.id,
        description: item.description,
        status: 'error',
        error: err.message
      });
    }
  }

  return results;
}

/**
 * جدولة إشعارات الصلوات الخمس ليوم كامل عبر نشر 5 رسائل مؤجلة في QStash
 * @param {string} [appUrl] 
 */
async function scheduleDailyPrayersWithQStash(appUrl) {
  const client = getQStashClient();
  if (!client) {
    console.warn('[QStash Prayers] تعذر الجدولة: QSTASH_TOKEN غير مضبوط.');
    return { error: 'QSTASH_TOKEN missing' };
  }

  const baseUrl = (appUrl || process.env.APP_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    console.warn('[QStash Prayers] تعذر الجدولة: APP_URL غير مضبوط.');
    return { error: 'APP_URL missing' };
  }

  const destination = `${baseUrl}/api/send-notification`;
  const retries = Number(process.env.QSTASH_RETRIES || 3);

  // جلب مواقيت الصلاة لمدينة القاهرة
  let timings = null;
  try {
    const res = await fetch('https://api.aladhan.com/v1/timingsByCity?city=Cairo&country=Egypt&method=5');
    const json = await res.json();
    if (json.code === 200 && json.data) {
      timings = json.data.timings;
    }
  } catch (err) {
    console.error('[QStash Prayers] فشل جلب المواقيت من Aladhan API:', err.message);
    return { error: 'Aladhan API unreachable' };
  }

  if (!timings) {
    return { error: 'No timings returned' };
  }

  const prayersMap = [
    { key: 'Fajr', name: 'الفجر' },
    { key: 'Dhuhr', name: 'الظهر' },
    { key: 'Asr', name: 'العصر' },
    { key: 'Maghrib', name: 'المغرب' },
    { key: 'Isha', name: 'العشاء' }
  ];

  const currentEpochSeconds = Math.floor(Date.now() / 1000);
  let scheduledPrayers = [];

  // دالة مساعدة لجدولة مصفوفة صلوات ليوم معين
  async function schedulePrayersForDay(dayTimings, targetDate, dateLabel) {
    const results = [];
    const isoDateStr = targetDate.toISOString().slice(0, 10);

    for (const prayer of prayersMap) {
      const rawTime = dayTimings[prayer.key];
      if (!rawTime) continue;

      const timeClean = rawTime.slice(0, 5);
      const prayerEpoch = getEpochSecondsForTimezone(timeClean, 'Africa/Cairo', targetDate);

      // التأكد من أن وقت الصلاة ما زال في المستقبل
      if (prayerEpoch > currentEpochSeconds) {
        const deduplicationId = `prayer-${prayer.key}-${isoDateStr}`;
        try {
          const msgRes = await client.publishJSON({
            url: destination,
            body: {
              type: 'prayer',
              prayerKey: prayer.key,
              prayerName: prayer.name,
              prayerTime: timeClean
            },
            notBefore: prayerEpoch,
            retries,
            deduplicationId
          });

          results.push({
            prayer: prayer.name,
            time: timeClean,
            epoch: prayerEpoch,
            date: dateLabel,
            messageId: msgRes.messageId
          });
          console.log(`🕌 [QStash Prayers] تمت جدولة أذان ${prayer.name} (${dateLabel}) للساعة ${timeClean} بتوقيت القاهرة (ID: ${msgRes.messageId})`);
        } catch (err) {
          console.error(`❌ [QStash Prayers] خطأ في جدولة ${prayer.name}:`, err.message);
        }
      } else {
        console.log(`⏩ [QStash Prayers] صلاة ${prayer.name} (${timeClean} - ${dateLabel}) انقضت، تم تخطيها.`);
      }
    }
    return results;
  }

  // 1. محاولة جدولة صلوات اليوم المتبقية
  const todayDate = new Date();
  scheduledPrayers = await schedulePrayersForDay(timings, todayDate, 'اليوم');

  // 2. إذا كانت جميع صلوات اليوم قد انقضت (مثلاً في المساء بعد العشاء)، نقوم بجدولة صلوات الغد فوراً
  if (scheduledPrayers.length === 0) {
    console.log('🌙 [QStash Prayers] انقضت جميع صلوات اليوم، جاري جلب وجدولة صلوات الغد...');
    try {
      const tomorrowDate = new Date(Date.now() + 24 * 3600 * 1000);
      const d = String(tomorrowDate.getDate()).padStart(2, '0');
      const m = String(tomorrowDate.getMonth() + 1).padStart(2, '0');
      const y = tomorrowDate.getFullYear();
      const dateStr = `${d}-${m}-${y}`;

      const resTomorrow = await fetch(`https://api.aladhan.com/v1/timingsByCity/${dateStr}?city=Cairo&country=Egypt&method=5`);
      const jsonTomorrow = await resTomorrow.json();
      if (jsonTomorrow.code === 200 && jsonTomorrow.data) {
        const tomorrowResults = await schedulePrayersForDay(jsonTomorrow.data.timings, tomorrowDate, 'الغد');
        scheduledPrayers = scheduledPrayers.concat(tomorrowResults);
      }
    } catch (tomErr) {
      console.error('❌ [QStash Prayers] فشل جلب مواقيت الغد:', tomErr.message);
    }
  }

  return {
    scheduledCount: scheduledPrayers.length,
    prayers: scheduledPrayers
  };
}

/**
 * إرسال مهمة إشعار فورية أو مؤجلة عبر QStash مع تفعيل المحاولات التلقائية (Retries)
 */
async function publishNotificationTask({ destinationUrl, payload, delaySeconds = 0, retries = 3 }) {
  const client = getQStashClient();
  if (!client) {
    throw new Error('QSTASH_TOKEN is not configured');
  }

  const destination = destinationUrl || `${(process.env.APP_URL || '').replace(/\/$/, '')}/api/send-notification`;

  const options = {
    url: destination,
    body: payload,
    retries: Number(retries || 3),
  };

  if (delaySeconds > 0) {
    options.delay = delaySeconds;
  }

  return await client.publishJSON(options);
}

module.exports = {
  getQStashClient,
  getQStashReceiver,
  verifyQStashSignature,
  initQStashSchedules,
  scheduleDailyPrayersWithQStash,
  publishNotificationTask,
  getEpochSecondsForCairo,
  getEpochSecondsForTimezone
};
