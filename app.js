/**
 * ==============================================================================
 * 🕌 مشروع ذكّر (Zakker) - ملف الخادم الرئيسي (Clean Code Edition)
 * ==============================================================================
 * 
 * 📌 أين تضع رابط قاعدة البيانات؟ (Database Connection String):
 * ------------------------------------------------------------------------------
 * رابط قاعدة البيانات لا يوضع مباشرة داخل كود السيرفر لأسباب أمنية؛
 * بل يوضع داخل ملف [.env] في السطر التالي:
 * 
 * MONGO_URI="mongodb+srv://اسم_المستخدم:كلمة_المرور@cluster0.xxxxx.mongodb.net/zakker?retryWrites=true&w=majority"
 * 
 * 💡 ملحوظة لتفادي نوم السيرفر المجاني (Free Hosting Inactivity / Cold Start):
 * - الاستضافات المجانية مثل Render أو Vercel تنام تلقائياً بعد فترة خمول.
 * - تم تجهيز مسار [/api/ping] الذي يمكنك ربطه بخدمة مجانية مثل (UptimeRobot)
 *   أو (cron-job.org) ليرسل طلباً كل 5 دقائق فيبقي السيرفر مستيقظاً 24/7!
 * - بالإضافة إلى ذلك، تم دمج Upstash QStash ليرسل تنبيهات الأذكار مع خاصية 
 *   إعادة المحاولة التلقائية (Retries) حتى إذا كان السيرفر في وضع النوم.
 * ------------------------------------------------------------------------------
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');

// إعدادات وقواعد البيانات
const connectDB = require('./config/db');
const { initWebPush } = require('./config/webpush');
const Subscription = require('./data/Subscription');
const azkarData = require('./data/azkar.json');

// خدمات الإشعارات والجدولة
const { sendNotificationToAll } = require('./services/notificationService');
const {
  verifyQStashSignature,
  initQStashSchedules,
  scheduleDailyPrayersWithQStash
} = require('./services/qstashService');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. تهيئة الاتصال بقاعدة البيانات وخدمة Web Push
connectDB().catch((err) => {
  console.error('❌ تعذر الاتصال المبدئي بقاعدة البيانات:', err.message);
});
initWebPush();

// 2. كاش لمواقيت الصلاة في الذاكرة (لتجنب أخطاء ReferenceError في Serverless)
let cachedPrayerTimings = null;
let lastNotifiedPrayerMinute = null;

// ==============================================================================
// ⚙️ البرمجيات الوسيطة (Middlewares)
// ==============================================================================

// إعدادات CORS للسماح بالاتصال من الواجهات والمتصفحات
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, Upstash-Signature'
  );
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// معالجة البيانات القادمة في الطلبات (مع حفظ rawBody للتحقق من توقيع QStash)
app.use(express.urlencoded({ extended: true }));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf-8');
  }
}));

// ترويسة خاصة بـ Service Worker للسماح بالنطاق الكامل /
app.use((req, res, next) => {
  if (req.url === '/sw.js') {
    res.setHeader('Service-Worker-Allowed', '/');
  }
  next();
});

// تقديم الملفات الثابتة (CSS, JS, الصور، manifest)
app.use(express.static(path.join(__dirname, 'public')));

// إعداد محرك القوالب EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==============================================================================
// 🌐 مسارات الصفحات الرئيسية (Frontend Views)
// ==============================================================================

// الصفحة الرئيسية
app.get('/', (req, res) => {
  res.render('index', { 
    pageTitle: 'ذكّر - أذكار الصباح والمساء ومواقيت الصلاة',
    currentPage: 'home'
  });
});

// صفحة أذكار الصباح
app.get('/morning', (req, res) => {
  res.render('morning', { 
    pageTitle: 'أذكار الصباح',
    currentPage: 'morning',
    azkar: azkarData.morning
  });
});

// صفحة أذكار المساء
app.get('/evening', (req, res) => {
  res.render('evening', { 
    pageTitle: 'أذكار المساء',
    currentPage: 'evening',
    azkar: azkarData.evening 
  });
});

// صفحة مواقيت الصلاة
app.get('/prayers', (req, res) => {
  res.render('prayers', { 
    pageTitle: 'مواقيت الصلاة',
    currentPage: 'prayers'
  });
});

// ==============================================================================
// 📡 مسارات الواجهة البرمجية (REST API Endpoints)
// ==============================================================================

// 1. فحص صحة الخادم وإبقائه مستيقظاً (Keep-Alive / Ping)
// 💡 استخدم هذا الرابط في UptimeRobot (https://uptimerobot.com) ليطلب /api/ping كل 5 دقائق
app.get('/api/ping', (req, res) => {
  res.status(200).json({ 
    status: 'active', 
    message: 'Zakker server is awake! 🟢', 
    timestamp: new Date().toISOString() 
  });
});

// 2. إرجاع بيانات الأذكار كاملة كـ JSON
app.get('/api/azkar', (req, res) => {
  res.json(azkarData);
});

// 3. جلب مواقيت الصلاة من Aladhan API مع كاش احتياطي
app.get('/api/prayers', async (req, res) => {
  const city = req.query.city || 'Cairo';
  const country = req.query.country || 'Egypt';

  try {
    const response = await fetch(
      `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=5`
    );
    const data = await response.json();
    if (data.code === 200) {
      if (city.toLowerCase() === 'cairo') {
        cachedPrayerTimings = data.data.timings;
      }
      return res.json(data);
    }
  } catch (err) {
    console.warn('⚠️ تعذر جلب المواقيت مباشرة من Aladhan API، الاعتماد على النسخة المخزنة:', err.message);
  }

  if (cachedPrayerTimings) {
    return res.json({
      code: 200,
      data: { timings: cachedPrayerTimings }
    });
  }

  res.status(500).json({ error: 'تعذر جلب مواقيت الصلاة حالياً' });
});

// 4. إرجاع المفتاح العام لتشفير Web Push
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// 5. حفظ وتحديث اشتراك الجهاز في قاعدة بيانات MongoDB (Upsert)
const handleSaveSubscription = async (req, res) => {
  try {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'بيانات اشتراك الجهاز غير مكتملة أو غير صالحة.' });
    }

    // التأكد من الاتصال بقاعدة البيانات قبل الحفظ
    await connectDB();

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
      success: true,
      message: 'تم حفظ اشتراك الجهاز بنجاح في قاعدة البيانات وتفعيل الإشعارات.' 
    });
  } catch (err) {
    console.error('❌ خطأ أثناء حفظ الاشتراك في MongoDB:', err.message);
    return res.status(500).json({ error: 'تعذر حفظ الاشتراك في السيرفر حالياً.' });
  }
};

app.post('/api/save-subscription', handleSaveSubscription);
app.post('/api/subscribe', handleSaveSubscription); // مسار بديل للتوافقية

// ==============================================================================
// 🔔 مسارات استقبال مهام الإشعارات الخارجية (QStash Webhooks)
// ==============================================================================

// استلام وتنفيذ مهام الإشعارات من خدمة QStash السحابية (مع دعم Retries عند الاستيقاظ من النوم)
app.post('/api/send-notification', async (req, res) => {
  // التحقق من أمان التوقيع الرقمي للطلب
  const isSignatureValid = await verifyQStashSignature(req);
  if (!isSignatureValid) {
    return res.status(401).json({ error: 'غير مصرح: توقيع QStash غير صحيح أو مفقود.' });
  }

  const payload = req.body || {};
  console.log('📥 [QStash Webhook] استلام مهمة إشعار جديدة:', JSON.stringify(payload));

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
    // جدولة الصلوات اليومية عبر QStash
    else if (payload.type === 'schedule-daily-prayers') {
      const hostUrl = `${req.protocol}://${req.get('host')}`;
      result = await scheduleDailyPrayersWithQStash(process.env.APP_URL || hostUrl);
    }
    // إشعار عام مخصص
    else if (payload.title) {
      result = await sendNotificationToAll({
        title: payload.title,
        body: payload.body || '',
        url: payload.url || '/',
        tag: payload.tag || 'zakker-notification'
      });
    } else {
      return res.status(400).json({ error: 'نوع المهمة غير معروف أو بيانات الإشعار ناقصة.' });
    }

    return res.status(200).json({
      success: true,
      message: 'تم إرسال الإشعار بنجاح لجميع المشتركين.',
      result
    });
  } catch (err) {
    console.error('❌ [QStash Webhook] حدث خطأ أثناء معالجة الإشعار:', err);
    // إرجاع كود 500 يجعل QStash يعيد المحاولة تلقائياً بعد فترة قصيرة
    return res.status(500).json({
      error: 'فشل في إرسال الإشعار',
      details: err.message
    });
  }
});

// تهيئة جداول QStash السحابية بضغطة واحدة
const handleInitSchedules = async (req, res) => {
  try {
    const hostUrl = `${req.protocol}://${req.get('host')}`;
    const targetUrl = process.env.APP_URL || hostUrl;
    const results = await initQStashSchedules(targetUrl);
    return res.json({
      success: true,
      message: 'تمت تهيئة وتسجيل جداول QStash بنجاح.',
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

// مسار لجدولة مواقيت الصلاة فوراً في QStash
const handleSchedulePrayers = async (req, res) => {
  try {
    const hostUrl = `${req.protocol}://${req.get('host')}`;
    const targetUrl = process.env.APP_URL || hostUrl;
    const result = await scheduleDailyPrayersWithQStash(targetUrl);
    return res.json({
      success: true,
      message: 'تمت جدولة مواقيت الصلاة في QStash بنجاح.',
      result
    });
  } catch (err) {
    console.error('❌ [QStash Prayers] خطأ أثناء جدولة الصلوات:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

app.post('/api/qstash/schedule-prayers', handleSchedulePrayers);
app.get('/api/qstash/schedule-prayers', handleSchedulePrayers);

// ==============================================================================
// ⏱️ الجدولة الداخلية بالسيرفر (Node-Cron للخوادم الدائمة)
// ==============================================================================

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

// إذا كان السيرفر يعمل على بيئة مستمرة (مثل السيرفر المحلي أو Render مع Ping)
if (!process.env.VERCEL) {
  const CRON_CAIRO_TZ = { timezone: 'Africa/Cairo' };

  // 1. أذكار الصباح يومياً 06:30 صباحاً (توقيت القاهرة)
  cron.schedule('30 6 * * *', async () => {
    console.log('⏰ [Cron] إرسال أذكار الصباح...');
    try {
      await sendNotificationToAll({
        title: 'أذكار الصباح 🌅',
        body: 'حان الآن وقت أذكار الصباح، ابدأ يومك بذكر الله وحصّن نفسك طوال النهار.',
        url: '/morning',
        tag: 'morning-azkar'
      });
    } catch (err) {
      console.error('❌ [Cron] فشل إرسال أذكار الصباح:', err.message);
    }
  }, CRON_CAIRO_TZ);

  // 2. أذكار المساء يومياً 17:00 (5:00 مساءً بتوقيت القاهرة)
  cron.schedule('0 17 * * *', async () => {
    console.log('⏰ [Cron] إرسال أذكار المساء...');
    try {
      await sendNotificationToAll({
        title: 'أذكار المساء 🌇',
        body: 'حان الآن وقت أذكار المساء، ألا بذكر الله تطمئن القلوب، حصّن نفسك حتى تصبح.',
        url: '/evening',
        tag: 'evening-azkar'
      });
    } catch (err) {
      console.error('❌ [Cron] فشل إرسال أذكار المساء:', err.message);
    }
  }, CRON_CAIRO_TZ);

  // 3. تحديث مواقيت صلاة اليوم وفحص الأذان كل دقيقة
  async function refreshPrayerTimes() {
    try {
      const response = await fetch('https://api.aladhan.com/v1/timingsByCity?city=Cairo&country=Egypt&method=5');
      const data = await response.json();
      if (data.code === 200) {
        cachedPrayerTimings = data.data.timings;
        console.log('🕌 [Prayer Cron] تم تحديث مواقيت صلاة اليوم بنجاح.');
      }
    } catch (e) {
      console.error('⚠️ [Prayer Cron] تعذر جلب مواقيت الصلاة:', e.message);
    }
  }

  cron.schedule('5 0 * * *', refreshPrayerTimes, CRON_CAIRO_TZ);
  refreshPrayerTimes();

  cron.schedule('* * * * *', async () => {
    if (!cachedPrayerTimings) return;

    const currentHM = getCairoTimeHM();
    if (!currentHM || lastNotifiedPrayerMinute === currentHM) return;

    const prayersMap = {
      Fajr: 'الفجر',
      Dhuhr: 'الظهر',
      Asr: 'العصر',
      Maghrib: 'المغرب',
      Isha: 'العشاء'
    };

    for (const [key, name] of Object.entries(prayersMap)) {
      const rawTime = cachedPrayerTimings[key];
      if (!rawTime) continue;

      if (extractHHMM(rawTime) === currentHM) {
        lastNotifiedPrayerMinute = currentHM;
        console.log(`🕌 [Prayer Cron] إرسال تنبيه أذان صلاة ${name}...`);
        try {
          await sendNotificationToAll({
            title: `حان الآن موعد أذان ${name} 🕌`,
            body: `حي على الصلاة، حي على الفلاح. تذكير بموعد صلاة ${name}.`,
            url: '/prayers',
            tag: `prayer-${key}`
          });
        } catch (err) {
          console.error(`❌ [Prayer Cron] فشل إرسال تنبيه صلاة ${name}:`, err.message);
        }
        break;
      }
    }
  }, CRON_CAIRO_TZ);
}

// ==============================================================================
// 🚀 بدء تشغيل السيرفر
// ==============================================================================
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 [Server] السيرفر يعمل الآن بنجاح على: http://localhost:${PORT}`);
  });
}

module.exports = app;
