const { Client, Receiver } = require('@upstash/qstash');

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
      // عدم تمرير url يمنع المشاكل الناتجة عن تغيير البروتوكول https/http خلف بروكسي Vercel
    });
    return isValid;
  } catch (err) {
    console.error('❌ [QStash Receiver] فشل التحقق من توقيع QStash:', err.message);
    return false;
  }
}

/**
 * حساب الطابع الزمني بالثواني (Unix Epoch) لتوقيت القاهرة مع دعم إزاحة الأيام
 * @param {string} hhmm - الوقت بصيغة HH:MM
 * @param {number} [dayOffset=0] - 0 لليوم الحالي، 1 للغد
 * @returns {number}
 */
function getEpochSecondsForCairo(hhmm, dayOffset = 0) {
  const [h, m] = hhmm.split(':').map(Number);
  const targetDate = new Date();
  if (dayOffset !== 0) {
    targetDate.setDate(targetDate.getDate() + dayOffset);
  }

  // الحصول على التاريخ المطلوب بتوقيت القاهرة
  const dParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(targetDate);

  const parts = {};
  dParts.forEach((p) => { parts[p.type] = p.value; });

  const targetUtcApprox = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), h, m, 0);

  // حساب الفرق الحقيقي للتعامل بدقة مع التوقيت الصيفي/الشتوي في مصر
  const cParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23'
  }).formatToParts(new Date(targetUtcApprox));

  const cp = {};
  cParts.forEach((p) => { cp[p.type] = p.value; });

  const actualUtc = Date.UTC(Number(cp.year), Number(cp.month) - 1, Number(cp.day), Number(cp.hour), Number(cp.minute), Number(cp.second));
  const diff = actualUtc - targetUtcApprox;
  const finalMs = targetUtcApprox - diff;

  return Math.floor(finalMs / 1000);
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

  const schedulesToSet = [
    {
      id: 'zakker-morning-azkar',
      cron: 'CRON_TZ=Africa/Cairo 30 6 * * *', // 06:30 صباحاً بتوقيت القاهرة
      body: { type: 'morning-azkar' },
      description: 'أذكار الصباح اليومية'
    },
    {
      id: 'zakker-evening-azkar',
      cron: 'CRON_TZ=Africa/Cairo 0 17 * * *', // 05:00 مساءً بتوقيت القاهرة
      body: { type: 'evening-azkar' },
      description: 'أذكار المساء اليومية'
    },
    {
      id: 'zakker-daily-prayers',
      cron: 'CRON_TZ=Africa/Cairo 5 0 * * *', // 00:05 بعد منتصف الليل يومياً بتوقيت القاهرة لجدولة صلوات اليوم
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

  // جدولة صلوات اليوم/الغد فوراً دون انتظار موعد منتصف الليل
  try {
    console.log('🕌 [QStash Setup] جارِ جدولة الصلوات الخمس مباشرة في QStash...');
    const prayerResults = await scheduleDailyPrayersWithQStash(baseUrl);
    results.push({
      name: 'immediate-prayers-schedule',
      description: 'جدولة الصلوات الخمس القادمة',
      status: 'created',
      details: prayerResults
    });
  } catch (prayerErr) {
    console.warn('⚠️ [QStash Setup] تعذر الجدولة الفورية للصلوات:', prayerErr.message);
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
  const nowIsoDate = new Date().toISOString().slice(0, 10);
  const scheduledPrayers = [];

  for (const prayer of prayersMap) {
    const rawTime = timings[prayer.key];
    if (!rawTime) continue;

    const timeClean = rawTime.slice(0, 5);
    let targetEpoch = getEpochSecondsForCairo(timeClean, 0);
    let targetDateStr = nowIsoDate;

    // إذا كانت صلاة اليوم قد انقضت، نجدول موعد صلاة الغد تلقائياً
    if (targetEpoch <= currentEpochSeconds) {
      targetEpoch = getEpochSecondsForCairo(timeClean, 1);
      const tomorrowDate = new Date();
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      targetDateStr = tomorrowDate.toISOString().slice(0, 10);
    }

    const deduplicationId = `prayer-${prayer.key}-${targetDateStr}`;
    try {
      // استخدام url بدلاً من destination المطلوب لمكتبة QStash في دالة publishJSON
      const msgRes = await client.publishJSON({
        url: destination,
        body: {
          type: 'prayer',
          prayerKey: prayer.key,
          prayerName: prayer.name,
          prayerTime: timeClean
        },
        notBefore: targetEpoch,
        retries,
        deduplicationId
      });

      scheduledPrayers.push({
        prayer: prayer.name,
        time: timeClean,
        epoch: targetEpoch,
        date: targetDateStr,
        messageId: msgRes.messageId
      });
      console.log(`🕌 [QStash Prayers] تمت جدولة أذان ${prayer.name} (${targetDateStr} الساعة ${timeClean} بتوقيت القاهرة) بنجاح: ID ${msgRes.messageId}`);
    } catch (err) {
      console.error(`❌ [QStash Prayers] خطأ في جدولة ${prayer.name}:`, err.message);
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
  getEpochSecondsForCairo
};
