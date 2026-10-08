const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const webpush = require('web-push');
const cron = require('node-cron');
require('dotenv').config();

const Subscription = require('./data/Subscription');
const { sendNotificationToAll } = require('./services/notificationService');

const app = express();
const PORT = process.env.PORT || 3000;

// ====================================================
// الاتصال بقاعدة بيانات MongoDB (Mongoose)
// ====================================================
const MONGO_URI = process.env.MONGO_URI || process.env.DATA_BASE;

if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => {
      console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح.');
    })
    .catch((err) => {
      console.error('❌ خطأ في الاتصال بقاعدة بيانات MongoDB:', err.message);
    });
} else {
  console.warn('⚠️ تحذير: لم يتم تعيين MONGO_URI أو DATA_BASE في ملف .env');
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
// Middleware
// ====================================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// ====================================================
// تشغيل السيرفر (Start Server)
// ====================================================
app.listen(PORT, () => {
  console.log(`Server is running at: http://localhost:${PORT}`);
});
