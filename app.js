const express = require('express');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configure Web Push with VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:zakker-app@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Subscriptions storage helper
const DATA_DIR = path.join(__dirname, 'data');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');

function getSubscriptions() {
  try {
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      const content = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf-8');
      return JSON.parse(content || '[]');
    }
  } catch (err) {
    console.error('خطأ في قراءة ملف الاشتراكات:', err);
  }
  return [];
}

function saveSubscriptions(subs) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2));
  } catch (err) {
    console.error('خطأ في حفظ الاشتراكات:', err);
  }
}

// دالة إرسال إشعار Push موحدة لجميع الأجهزة المشتركة
async function sendPushToAllSubscribers(notificationData) {
  const subs = getSubscriptions();
  if (!subs.length) return { sent: 0, total: 0 };

  const payload = JSON.stringify({
    title: notificationData.title || 'تطبيق ذكّر 🕌',
    body: notificationData.body || 'حان وقت الذكر والصلاة، ألا بذكر الله تطمئن القلوب.',
    url: notificationData.url || '/',
    tag: notificationData.tag || 'zakker-notification'
  });

  let successful = 0;
  const remainingSubs = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      successful++;
      remainingSubs.push(sub);
    } catch (err) {
      console.warn('تعذر إرسال الإشعار لمشترك:', err.statusCode);
      // حذف الاشتراكات غير الصالحة المنتهية (404 أو 410)
      if (err.statusCode !== 404 && err.statusCode !== 410) {
        remainingSubs.push(sub);
      }
    }
  }

  if (remainingSubs.length !== subs.length) {
    saveSubscriptions(remainingSubs);
  }

  return { sent: successful, total: subs.length };
}

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Template Engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Azkar Data
const azkarData = require('./data/azkar.json');

// Routes
// 1. Home
app.get('/', (req, res) => {
  res.render('index', { 
    pageTitle: 'ذكّر - أذكار الصباح والمساء ومواقيت الصلاة',
    currentPage: 'home'
  });
});

// 2. Morning Azkar
app.get('/morning', (req, res) => {
  res.render('morning', { 
    pageTitle: 'أذكار الصباح',
    currentPage: 'morning',
    azkar: azkarData.morning
  });
});

// 3. Evening Azkar
app.get('/evening', (req, res) => {
  res.render('evening', { 
    pageTitle: 'أذكار المساء',
    currentPage: 'evening',
    azkar: azkarData.evening 
  });
});

// 4. Prayer Times
app.get('/prayers', (req, res) => {
  res.render('prayers', { 
    pageTitle: 'مواقيت الصلاة',
    currentPage: 'prayers'
  });
});

// 5. API endpoint to get Azkar JSON
app.get('/api/azkar', (req, res) => {
  res.json(azkarData);
});

// 5.1 API proxy for Prayer Times with server-side cache/fallback
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

// 6. Web Push: Get Public VAPID Key
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// 7. Web Push: Subscribe device
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'بيانات الاشتراك غير صحيحة' });
  }

  const subs = getSubscriptions();
  const exists = subs.some(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    subs.push(subscription);
    saveSubscriptions(subs);
  }

  res.status(201).json({ message: 'تم الاشتراك بنجاح وتفعيل إشعارات الخلفية عبر Web Push' });
});


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
  await sendPushToAllSubscribers({
    title: 'أذكار الصباح 🌅',
    body: 'حان الآن وقت أذكار الصباح، ابدأ يومك بذكر الله وحصّن نفسك طوال النهار.',
    url: '/morning',
    tag: 'morning-azkar'
  });
}, CRON_CAIRO_TZ);

// 2. تنبيه أذكار المساء يومياً الساعة 17:00 (5:00 عصراً/مساءً بتوقيت القاهرة)
cron.schedule('0 17 * * *', async () => {
  console.log('[Cron] إرسال تنبيه أذكار المساء في الخلفية لجميع المشتركين...');
  await sendPushToAllSubscribers({
    title: 'أذكار المساء 🌇',
    body: 'حان الآن وقت أذكار المساء، ألا بذكر الله تطمئن القلوب، حصّن نفسك حتى تصبح.',
    url: '/evening',
    tag: 'evening-azkar'
  });
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
      await sendPushToAllSubscribers({
        title: `حان الآن موعد أذان ${name} 🕌`,
        body: `حي على الصلاة، حي على الفلاح. تذكير بموعد صلاة ${name}.`,
        url: '/prayers',
        tag: `prayer-${key}`
      });
      break;
    }
  }
}, CRON_CAIRO_TZ);

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running at: http://localhost:${PORT}`);
});
