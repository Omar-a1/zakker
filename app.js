const express = require('express');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');
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
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'data', 'subscriptions.json');

function getSubscriptions() {
  try {
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('خطأ في قراءة ملف الاشتراكات:', err);
  }
  return [];
}

function saveSubscriptions(subs) {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2));
  } catch (err) {
    console.error('خطأ في حفظ الاشتراكات:', err);
  }
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

  res.status(201).json({ message: 'تم الاشتراك بنجاح وتفعيل إشعارات الخلفية' });
});

// 8. Web Push: Send notification to all subscribers
app.post('/api/send-notification', async (req, res) => {
  const { title, body, url } = req.body;
  const payload = JSON.stringify({
    title: title || 'تطبيق ذكّر 🕌',
    body: body || 'حان وقت الذكر والصلاة، ألا بذكر الله تطمئن القلوب.',
    url: url || '/'
  });

  const subs = getSubscriptions();
  let successful = 0;
  const remainingSubs = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      successful++;
      remainingSubs.push(sub);
    } catch (err) {
      console.warn('تعذر إرسال الإشعار لمشترك:', err.statusCode);
      // حذف الاشتراكات المنتهية (404 / 410)
      if (err.statusCode !== 404 && err.statusCode !== 410) {
        remainingSubs.push(sub);
      }
    }
  }

  if (remainingSubs.length !== subs.length) {
    saveSubscriptions(remainingSubs);
  }

  res.json({ success: true, sent: successful, total: subs.length });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running at: http://localhost:${PORT}`);
});
