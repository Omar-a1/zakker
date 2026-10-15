const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const webpush = require('web-push');
const cron = require('node-cron');
require('dotenv').config();

const Subscription = require('./data/Subscription');
const { sendNotificationToAll } = require('./services/notificationService');
const {
  verifyQStashSignature,
  initQStashSchedules,
  scheduleDailyPrayersWithQStash
} = require('./services/qstashService');

const app = express();
const PORT = process.env.PORT || 3000;

// ====================================================
// الاتصال بقاعدة بيانات MongoDB (Mongoose)
// ====================================================
const MONGO_URI = process.env.MONGO_URI || process.env.DATA_BASE;

if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => {
      console.log(' تم الاتصال بقاعدة بيانات MongoDB بنجاح.');
    })
    .catch((err) => {
      console.error(' خطأ في الاتصال بقاعدة بيانات MongoDB:', err.message);
    });
} else {
  console.warn(' تحذير: لم يتم تعيين MONGO_URI أو DATA_BASE في ملف .env');
}

// ====================================================
// إعداد مفاتيح Web Push (VAPID)
// ====================================================
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:zakker-app@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ====================================================
// إعدادات CORS ودعم الاتصال بين النطاقات (Cross-Origin)
// ====================================================
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');

  // الاستجابة الفورية لطلبات الفحص التمهيدي (Preflight)
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

// Middleware
// ====================================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf-8');
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// مسار فحص صحة الخادم وإبقائه نشطاً (Ping / Keep-Alive)
app.get('/api/ping', (req, res) => {
  res.status(200).json({ status: 'active', message: 'Zakker server is awake! 🟢', timestamp: new Date() });
});

// Template Engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Azkar Data
const azkarData = require('./data/azkar.json');

// ====================================================
// مسارات الصفحات الأساسية (Routes)
// ====================================================
// 1. الصفحة الرئيسية
app.get('/', (req, res) => {
  res.render('index', { 
    pageTitle: 'ذكّر - أذكار الصباح والمساء ومواقيت الصلاة',
    currentPage: 'home'
  });
});

// 2. أذكار الصباح
app.get('/morning', (req, res) => {
  res.render('morning', { 
    pageTitle: 'أذكار الصباح',
    currentPage: 'morning',
    azkar: azkarData.morning
  });
});

// 3. أذكار المساء
app.get('/evening', (req, res) => {
  res.render('evening', { 
    pageTitle: 'أذكار المساء',
    currentPage: 'evening',
    azkar: azkarData.evening 
  });
});

// 4. مواقيت الصلاة
app.get('/prayers', (req, res) => {
  res.render('prayers', { 
    pageTitle: 'مواقيت الصلاة',
    currentPage: 'prayers'
  });
});

// 5. مسار بيانات الأذكار كـ JSON
app.get('/api/azkar', (req, res) => {
  res.json(azkarData);
});

// 5.1 وكيل لجلب مواقيت الصلاة مع تخزين احتياطي في السيرفر
app.get('/api/prayers', async (req, res) => {
  const city = req.query.city || 'Cairo';
  const country = req.query.country || 'Egypt';
  try {
    const response = await fetch(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=5`);
    const data = await response.json();
    if (data.code === 200) {
      return res.json(data);
    }
  } catch (err) {
    console.warn('تعذر جلب المواقيت مباشرة من Aladhan API، استخدام النسخة الاحتياطية:', err.message);
  }

  if (todayPrayerTimings) {
    return res.json({
      code: 200,
      data: {
        timings: todayPrayerTimings
      }
    });
  }

  res.status(500).json({ error: 'تعذر جلب مواقيت الصلاة' });
});

// ====================================================
// مسارات Web Push API
// ====================================================

// 6. استرجاع المفتاح العام VAPID Public Key للمتصفح
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// 7. حفظ / تحديث اشتراك المستخدم في MongoDB (Upsert)
const handleSaveSubscription = async (req, res) => {
  try {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'بيانات الاشتراك غير صحيحة أو غير مكتملة' });
    }

    // حفظ أو تحديث الاشتراك بناءً على رابط الـ endpoint
    await Subscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime || null,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({ 
      message: 'تم حفظ الاشتراك بنجاح في قاعدة البيانات وتفعيل إشعارات الخلفية عبر Web Push' 
    });
  } catch (err) {
    console.error('خطأ في حفظ الاشتراك في MongoDB:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء حفظ الاشتراك في الخادم' });
  }
};

app.post('/api/save-subscription', handleSaveSubscription);
app.post('/api/subscribe', handleSaveSubscription); // مسار بديل للتوافقية

// ====================================================
// مسارات وتكامل Upstash QStash (حل Cold Start ومحاولات الإعادة)
// ====================================================

// 8. نقطة النهاية المخصصة لاستقبال Webhooks من QStash حصرياً
app.post('/api/send-notification', async (req, res) => {
  // 1. التحقق من التوقيع الرقمي لمنع أي استدعاءات غير مصرح بها
  const isSignatureValid = await verifyQStashSignature(req);
  if (!isSignatureValid) {
    return res.status(401).json({ error: 'غير مصرح: توقيع QStash غير صحيح أو مفقود' });
  }

  const payload = req.body || {};
  console.log('[QStash Webhook] استلام مهمة إشعار:', JSON.stringify(payload));

  try {
    let result = null;

    // أذكار الصباح
    if (payload.type === 'morning-azkar') {
      result = await sendNotificationToAll({
        title: 'أذكار الصباح 🌅',
        body: 'حان الآن وقت أذكار الصباح، ابدأ يومك بذكر الله وحصّن نفسك طوال النهار.',
        url: '/morning',
        tag: 'morning-azkar'
      });
    }
    // أذكار المساء
    else if (payload.type === 'evening-azkar') {
      result = await sendNotificationToAll({
        title: 'أذكار المساء 🌇',
        body: 'حان الآن وقت أذكار المساء، ألا بذكر الله تطمئن القلوب، حصّن نفسك حتى تصبح.',
        url: '/evening',
        tag: 'evening-azkar'
      });
    }
    // تنبيه أذان صلاة محددة
    else if (payload.type === 'prayer') {
      const prayerName = payload.prayerName || 'الصلاة';
      const prayerKey = payload.prayerKey || 'prayer';
      result = await sendNotificationToAll({
        title: `حان الآن موعد أذان ${prayerName} 🕌`,
        body: `حي على الصلاة، حي على الفلاح. تذكير بموعد صلاة ${prayerName}.`,
        url: '/prayers',
        tag: `prayer-${prayerKey}`
      });
    }
    // مجدول مواقيت الصلاة اليومي: نشر مهام مؤجلة لكل صلاة في QStash
    else if (payload.type === 'schedule-daily-prayers') {
      const hostUrl = `${req.protocol}://${req.get('host')}`;
      result = await scheduleDailyPrayersWithQStash(process.env.APP_URL || hostUrl);
    }
    // إشعار مخصص عبر تمرير title و body
    else if (payload.title) {
      result = await sendNotificationToAll({
        title: payload.title,
        body: payload.body || '',
        url: payload.url || '/',
        tag: payload.tag || 'zakker-notification'
      });
    } else {
      return res.status(400).json({ error: 'نوع المهمة غير معروف أو بيانات الإشعار ناقصة' });
    }

    return res.status(200).json({
      success: true,
      message: 'تمت معالجة وإرسال التنبيه بنجاح عبر Web Push',
      result
    });
  } catch (err) {
    console.error('❌ [QStash Webhook] حدث خطأ أثناء معالجة الإشعار:', err);
    // إرجاع رمز 500 يوجّه QStash لتفعيل خاصية إعادة المحاولة (Automatic Retries)
    return res.status(500).json({
      error: 'فشل في إرسال الإشعار',
      details: err.message
    });
  }
});

// 9. مسار تهيئة وتحديث جداول QStash الدورية
const handleInitSchedules = async (req, res) => {
  try {
    const hostUrl = `${req.protocol}://${req.get('host')}`;
    const targetUrl = process.env.APP_URL || hostUrl;
    const results = await initQStashSchedules(targetUrl);
    return res.json({
      success: true,
      message: 'تمت تهيئة جداول QStash بنجاح',
      targetUrl,
      schedules: results
    });
  } catch (err) {
    console.error('❌ [QStash Setup] فشل تهيئة جداول QStash:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

app.post('/api/qstash/init-schedules', handleInitSchedules);
app.get('/api/qstash/init-schedules', handleInitSchedules);

// ====================================================
// نظام جدولة التنبيهات في الخلفية عبر السيرفر (Node-Cron)
// ====================================================

function extractHHMM(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function getCairoTimeHM() {
  const cairoTimeStr = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Cairo',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  return extractHHMM(cairoTimeStr);
}

// في بيئة التطوير المحلية، يعمل node-cron كحل احتياطي
// أما في بيئة Vercel Serverless فيتم الاعتماد كلياً على Upstash QStash لتفادي مشكلة النوم (Cold Start)
if (!process.env.VERCEL) {
  const CRON_CAIRO_TZ = { timezone: 'Africa/Cairo' };

  // 1. تنبيه أذكار الصباح يومياً الساعة 06:30 صباحاً (توقيت القاهرة)
  cron.schedule('30 6 * * *', async () => {
    console.log('[Cron] إرسال تنبيه أذكار الصباح في الخلفية لجميع المشتركين...');
    try {
      await sendNotificationToAll({
        title: 'أذكار الصباح 🌅',
        body: 'حان الآن وقت أذكار الصباح، ابدأ يومك بذكر الله وحصّن نفسك طوال النهار.',
        url: '/morning',
        tag: 'morning-azkar'
      });
    } catch (err) {
      console.error('[Cron] فشل في إرسال أذكار الصباح:', err.message);
    }
  }, CRON_CAIRO_TZ);

  // 2. تنبيه أذكار المساء يومياً الساعة 17:00 (5:00 مساءً بتوقيت القاهرة)
  cron.schedule('0 17 * * *', async () => {
    console.log('[Cron] إرسال تنبيه أذكار المساء في الخلفية لجميع المشتركين...');
    try {
      await sendNotificationToAll({
        title: 'أذكار المساء 🌇',
        body: 'حان الآن وقت أذكار المساء، ألا بذكر الله تطمئن القلوب، حصّن نفسك حتى تصبح.',
        url: '/evening',
        tag: 'evening-azkar'
      });
    } catch (err) {
      console.error('[Cron] فشل في إرسال أذكار المساء:', err.message);
    }
  }, CRON_CAIRO_TZ);

  // 3. جلب مواقيت الصلاة وفحصها في الخلفية
  let todayPrayerTimings = null;
  let lastNotifiedMinute = null;

  async function refreshPrayerTimes() {
    try {
      const response = await fetch('https://api.aladhan.com/v1/timingsByCity?city=Cairo&country=Egypt&method=5');
      const data = await response.json();
      if (data.code === 200) {
        todayPrayerTimings = data.data.timings;
        console.log('[Prayer Scheduler] تم تحديث مواقيت صلاة اليوم بنجاح.');
      }
    } catch (e) {
      console.error('[Prayer Scheduler] تعذر جلب مواقيت الصلاة للسيرفر:', e.message);
    }
  }

  // تحديث يومي عند 00:05 بتوقيت القاهرة وعمل فحص عند إقلاع السيرفر
  cron.schedule('5 0 * * *', refreshPrayerTimes, CRON_CAIRO_TZ);
  refreshPrayerTimes();

  // فحص كل دقيقة لمطابقة توقيت الصلوات الخمس
  cron.schedule('* * * * *', async () => {
    if (!todayPrayerTimings) return;

    const currentHM = getCairoTimeHM();
    if (!currentHM || lastNotifiedMinute === currentHM) return;

    const prayersMap = {
      Fajr: 'الفجر',
      Dhuhr: 'الظهر',
      Asr: 'العصر',
      Maghrib: 'المغرب',
      Isha: 'العشاء'
    };

    for (const [key, name] of Object.entries(prayersMap)) {
      const rawTime = todayPrayerTimings[key];
      if (!rawTime) continue;

      const cleanPrayerTime = extractHHMM(rawTime);
      if (cleanPrayerTime === currentHM) {
        lastNotifiedMinute = currentHM;
        console.log(`[Prayer Scheduler] إرسال تنبيه أذان صلاة ${name} عبر Web Push...`);
        try {
          await sendNotificationToAll({
            title: `حان الآن موعد أذان ${name} 🕌`,
            body: `حي على الصلاة، حي على الفلاح. تذكير بموعد صلاة ${name}.`,
            url: '/prayers',
            tag: `prayer-${key}`
          });
        } catch (err) {
          console.error(`[Prayer Scheduler] فشل إرسال تنبيه صلاة ${name}:`, err.message);
        }
        break;
      }
    }
  }, CRON_CAIRO_TZ);
} else {
  console.log('⚡ [Vercel Serverless] يعمل التطبيق على Vercel؛ تتم إدارة وإرسال التنبيهات عبر Upstash QStash مع تفعيل الـ Retries التلقائية.');
}

// ====================================================
// تشغيل السيرفر وتصدير التطبيق لدعم Vercel Serverless
// ====================================================
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running at: http://localhost:${PORT}`);
  });
}

module.exports = app;
