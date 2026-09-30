/**
 * مشروع ذاكِر - ملف الجافاسكريبت الرئيسي
 * يشمل:
 * 1. الوضع الليلي (Dark Mode Toggle)
 * 2. نظام الإشعارات المتطور في الخلفية (Web Push & Service Worker)
 * 3. عدادات الأذكار التفاعلية وحجم الخط
 * 4. جلب مواقيت الصلاة من Aladhan API والعد التنازلي
 */

// ----------------------------------------------------
// 1. نظام الوضع الليلي (Dark / Light Theme)
// ----------------------------------------------------
function initThemeToggle() {
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  if (!themeToggleBtn) return;

  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    try {
      localStorage.setItem('zakker_theme', newTheme);
    } catch (e) {}
  });
}

// ----------------------------------------------------
// 2. نظام الإشعارات المتطور (Service Worker + Web Push)
// ----------------------------------------------------
const notifyBtn = document.getElementById('notifyBtn');
let swRegistration = null;

// تحويل مفتاح VAPID العام إلى Uint8Array المطلوب لـ PushManager
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
      console.log('تم تسجيل Service Worker بنجاح.');
      
      // التحقق إذا كان المستخدم مشتركاً بالفعل ومزامنة اشتراكه مع السيرفر
      const existingSub = await swRegistration.pushManager.getSubscription();
      if (existingSub) {
        fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(existingSub)
        }).catch(() => {});
      }
      updateNotificationButtonUI();
    } catch (error) {
      console.error('فشل تسجيل Service Worker:', error);
    }
  }
}

async function subscribeUserToPush() {
  try {
    // 1. جلب المفتاح العام من السيرفر
    const response = await fetch('/api/vapid-public-key');
    const { publicKey } = await response.json();
    if (!publicKey) return;

    // 2. طلب الاشتراك من الـ PushManager
    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    // 3. إرسال الاشتراك وحفظه في السيرفر ليعمل في الخلفية
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    console.log('تم تسجيل الاشتراك في إشعارات الخلفية بنجاح.');
  } catch (err) {
    console.error('فشل الاشتراك في Web Push:', err);
  }
}

function updateNotificationButtonUI() {
  if (!notifyBtn) return;
  if (!('Notification' in window)) {
    notifyBtn.style.display = 'none';
    return;
  }

  const permission = Notification.permission;
  notifyBtn.className = 'btn-nav-icon btn-notify-compact';

  if (permission === 'granted') {
    notifyBtn.classList.add('granted');
    notifyBtn.title = 'التنبيهات مفعلة (ستصلك حتى عند إغلاق الموقع)';
    notifyBtn.innerHTML = `
      <svg class="icon-bell" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
    `;
  } else if (permission === 'denied') {
    notifyBtn.classList.add('denied');
    notifyBtn.title = 'الإشعارات محظورة - اضغط لمعرفة خطوات فك الحظر';
    notifyBtn.innerHTML = `
      <svg class="icon-bell" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" stroke-width="2"></line>
      </svg>
    `;
  } else {
    notifyBtn.title = 'تفعيل التنبيهات والأذكار في الخلفية';
    notifyBtn.innerHTML = `
      <svg class="icon-bell" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
    `;
  }
}

function openNotificationModal(type) {
  const overlay = document.getElementById('notifyModalOverlay');
  const softContent = document.getElementById('notifySoftPromptContent');
  const activeContent = document.getElementById('notifyActiveContent');
  const blockedContent = document.getElementById('notifyBlockedContent');

  if (!overlay) return;

  overlay.style.display = 'flex';
  if (softContent) softContent.style.display = 'none';
  if (activeContent) activeContent.style.display = 'none';
  if (blockedContent) blockedContent.style.display = 'none';

  if (type === 'blocked') {
    if (blockedContent) blockedContent.style.display = 'block';
  } else if (type === 'active') {
    if (activeContent) activeContent.style.display = 'block';
  } else {
    if (softContent) softContent.style.display = 'block';
  }
}

function closeNotificationModal() {
  const overlay = document.getElementById('notifyModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function requestNotificationPermission() {
  closeNotificationModal();

  try {
    const permission = await Notification.requestPermission();
    updateNotificationButtonUI();

    if (permission === 'granted') {
      if (swRegistration) {
        await subscribeUserToPush();
      }
      showNotification('تطبيق ذكّر 🕌', 'تم تفعيل التنبيهات بنجاح! ستصلك إشعارات الأذان والأذكار حتى لو كان الموقع مغلقاً.');
    } else if (permission === 'denied') {
      openNotificationModal('blocked');
    }
  } catch (error) {
    console.error('خطأ في طلب الإشعارات:', error);
  }
}

function initNotifications() {
  registerServiceWorker();

  if (!('Notification' in window)) {
    if (notifyBtn) notifyBtn.style.display = 'none';
    return;
  }

  updateNotificationButtonUI();

  // مستمعات النافذة المنبثقة
  const overlay = document.getElementById('notifyModalOverlay');
  const closeBtn = document.getElementById('notifyModalCloseBtn');
  const softCancelBtn = document.getElementById('notifySoftCancelBtn');
  const softConfirmBtn = document.getElementById('notifySoftConfirmBtn');
  const activeCloseBtn = document.getElementById('notifyActiveCloseBtn');
  const blockedCloseBtn = document.getElementById('notifyBlockedCloseBtn');
  const reloadBtn = document.getElementById('notifyReloadBtn');
  const testPushBtn = document.getElementById('notifyTestPushBtn');
  const testStatus = document.getElementById('notifyTestStatus');

  if (closeBtn) closeBtn.addEventListener('click', closeNotificationModal);
  if (softCancelBtn) softCancelBtn.addEventListener('click', closeNotificationModal);
  if (activeCloseBtn) activeCloseBtn.addEventListener('click', closeNotificationModal);
  if (blockedCloseBtn) blockedCloseBtn.addEventListener('click', closeNotificationModal);
  if (reloadBtn) reloadBtn.addEventListener('click', () => window.location.reload());

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeNotificationModal();
    });
  }

  if (softConfirmBtn) {
    softConfirmBtn.addEventListener('click', () => {
      requestNotificationPermission();
    });
  }

  // تجربة إرسال إشعار في الخلفية مع مهلة 5 ثوانٍ
  if (testPushBtn) {
    testPushBtn.addEventListener('click', async () => {
      testPushBtn.disabled = true;
      testPushBtn.textContent = 'جارِ إعداد الإشعار...';
      if (testStatus) {
        testStatus.style.display = 'block';
        testStatus.textContent = '⏳ سيصلك الإشعار بعد 5 ثوانٍ. يمكنك الآن إغلاق المتصفح أو تصغيره!';
      }

      try {
        const res = await fetch('/api/test-delayed-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seconds: 5 })
        });
        const data = await res.json();
        setTimeout(() => {
          testPushBtn.disabled = false;
          testPushBtn.textContent = 'تجربة إشعار في الخلفية مرة أخرى';
        }, 6000);
      } catch (err) {
        if (testStatus) testStatus.textContent = 'حدث خطأ في الاتصال بالخادم.';
        testPushBtn.disabled = false;
      }
    });
  }

  // عند الضغط على زر التنبيهات في شريط التنقل
  if (notifyBtn) {
    notifyBtn.addEventListener('click', () => {
      if (Notification.permission === 'granted') {
        openNotificationModal('active');
      } else if (Notification.permission === 'denied') {
        openNotificationModal('blocked');
      } else {
        openNotificationModal('soft');
      }
    });
  }
}

function showNotification(title, body) {
  if (Notification.permission === 'granted') {
    if (swRegistration) {
      swRegistration.showNotification(title, {
        body: body,
        icon: '/img/icon.png',
        dir: 'rtl'
      });
    } else {
      new Notification(title, {
        body: body,
        icon: '/img/icon.png'
      });
    }
  }
}

// ----------------------------------------------------
// 3. عدادات الأذكار (Azkar Counters)
// ----------------------------------------------------
function initAzkarCounters() {
  const counterButtons = document.querySelectorAll('.zekr-counter-btn');

  counterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = parseInt(btn.dataset.target, 10);
      let current = parseInt(btn.dataset.current, 10);

      if (current < target) {
        current++;
        btn.dataset.current = current;
        const countSpan = btn.querySelector('.count-num');
        if (countSpan) countSpan.textContent = current;

        // عند اكتمال العدد
        if (current >= target) {
          btn.classList.add('done');
          btn.textContent = '✓';
          const card = btn.closest('.zekr-card');
          if (card) card.classList.add('completed');
        }
      }
    });
  });
}

// ----------------------------------------------------
// 4. مواقيت الصلاة (Aladhan API Integration)
// ----------------------------------------------------
const prayerNamesArabic = {
  Fajr: 'الفجر',
  Sunrise: 'الشروق',
  Dhuhr: 'الظهر',
  Asr: 'العصر',
  Maghrib: 'المغرب',
  Isha: 'العشاء'
};

let cachedTimings = null;
let prayerTimerInterval = null;

// قاموس تحويل أسماء المدن والدول العربية الشائعة
const ARABIC_CITY_MAP = {
  'القاهرة': 'Cairo',
  'الجيزة': 'Giza',
  'الاسكندرية': 'Alexandria',
  'الإسكندرية': 'Alexandria',
  'الرياض': 'Riyadh',
  'مكة': 'Makkah',
  'مكة المكرمة': 'Makkah',
  'المدينة': 'Madinah',
  'المدينة المنورة': 'Madinah',
  'جدة': 'Jeddah',
  'الدمام': 'Dammam',
  'دبي': 'Dubai',
  'أبوظبي': 'Abu Dhabi',
  'ابوظبي': 'Abu Dhabi',
  'الشارقة': 'Sharjah',
  'عمان': 'Amman',
  'الكويت': 'Kuwait',
  'الدوحة': 'Doha',
  'المنامة': 'Manama',
  'مسقط': 'Muscat',
  'بغداد': 'Baghdad',
  'دمشق': 'Damascus',
  'بيروت': 'Beirut',
  'القدس': 'Jerusalem',
  'طرابلس': 'Tripoli',
  'تونس': 'Tunis',
  'الجزائر': 'Algiers',
  'الرباط': 'Rabat',
  'صنعاء': 'Sanaa'
};

const ARABIC_COUNTRY_MAP = {
  'مصر': 'Egypt',
  'السعودية': 'Saudi Arabia',
  'المملكة العربية السعودية': 'Saudi Arabia',
  'الإمارات': 'United Arab Emirates',
  'الامارات': 'United Arab Emirates',
  'الأردن': 'Jordan',
  'الاردن': 'Jordan',
  'الكويت': 'Kuwait',
  'قطر': 'Qatar',
  'البحرين': 'Bahrain',
  'عمان': 'Oman',
  'العراق': 'Iraq',
  'سوريا': 'Syria',
  'لبنان': 'Lebanon',
  'فلسطين': 'Palestine',
  'ليبيا': 'Libya',
  'تونس': 'Tunisia',
  'الجزائر': 'Algeria',
  'المغرب': 'Morocco',
  'اليمن': 'Yemen',
  'السودان': 'Sudan'
};

// جلب المواقيت بالمدينة والدولة مع دعم كامل للاسم العربي والاتصال البديل
async function fetchPrayerTimesByCity(city = 'Cairo', country = 'Egypt') {
  const cleanCity = (city || 'Cairo').trim();
  const cleanCountry = (country || 'Egypt').trim();
  const queryCity = ARABIC_CITY_MAP[cleanCity] || cleanCity;
  const queryCountry = ARABIC_COUNTRY_MAP[cleanCountry] || cleanCountry;

  try {
    let data = null;

    // 1. محاولة الاتصال المباشر بـ Aladhan API
    try {
      const response = await fetch(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(queryCity)}&country=${encodeURIComponent(queryCountry)}&method=5`);
      data = await response.json();
    } catch (errDirect) {
      console.warn('تعذر الاتصال الخارجي المباشر، جاري استخدام المسار المحلي للسيرفر...', errDirect.message);
    }

    // 2. إذا فشل الطلب الخارجي، نستخدم المسار المحلي للسيرفر
    if (!data || data.code !== 200 || !data.data) {
      const fallbackResponse = await fetch(`/api/prayers?city=${encodeURIComponent(queryCity)}&country=${encodeURIComponent(queryCountry)}`);
      data = await fallbackResponse.json();
    }

    if (data && (data.code === 200 || data.data)) {
      cachedTimings = data.data.timings;
      updatePrayerUI(cachedTimings, `${cleanCity}، ${cleanCountry}`);
      startNextPrayerCountdown(cachedTimings);
    }
  } catch (error) {
    console.error('خطأ في جلب مواقيت الصلاة:', error);
  }
}

// جلب المواقيت عبر الموقع الجغرافي للمستخدم
function fetchPrayerTimesByGeo() {
  const locationDisplay = document.getElementById('locationDisplay');
  if (navigator.geolocation) {
    if (locationDisplay) locationDisplay.textContent = 'جارِ تحديد موقعك الجغرافي...';
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        let data = null;
        try {
          const response = await fetch(`https://api.aladhan.com/v1/timings?latitude=${latitude}&longitude=${longitude}&method=5`);
          data = await response.json();
        } catch (e) {}

        if (!data || data.code !== 200) {
          const fallbackRes = await fetch('/api/prayers?city=Cairo&country=Egypt');
          data = await fallbackRes.json();
        }

        if (data && (data.code === 200 || data.data)) {
          cachedTimings = data.data.timings;
          updatePrayerUI(cachedTimings, 'موقعك الحالي');
          startNextPrayerCountdown(cachedTimings);
          if (locationDisplay) locationDisplay.textContent = 'تم تحديد موقعك وجلب المواقيت بنجاح.';
        }
      } catch (err) {
        if (locationDisplay) locationDisplay.textContent = 'تعذر جلب المواقيت بإحداثياتك، جاري استخدام القاهرة كافتراضي.';
        fetchPrayerTimesByCity('Cairo', 'Egypt');
      }
    }, () => {
      if (locationDisplay) locationDisplay.textContent = 'تم رفض إذن الموقع، تم استخدام القاهرة كافتراضي.';
      fetchPrayerTimesByCity('Cairo', 'Egypt');
    });
  } else {
    fetchPrayerTimesByCity('Cairo', 'Egypt');
  }
}

// تحديث واجهة المستخدم بالصلوات بمرونة كاملة لكل الحالات
function updatePrayerUI(timings, locationName) {
  const locationDisplay = document.getElementById('locationDisplay');
  if (locationDisplay) locationDisplay.textContent = `مواقيت الصلاة حسب: ${locationName}`;

  const prayers = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

  prayers.forEach(prayer => {
    // دعم جميع تسميات المعرفات (time-fajr أو time-Fajr أو داخل بطاقة الصلاة)
    const el = document.getElementById(`time-${prayer.toLowerCase()}`) ||
               document.getElementById(`time-${prayer}`) ||
               document.querySelector(`[data-prayer="${prayer}"] .time`);

    if (el && timings[prayer]) {
      const cleanTime = timings[prayer].split(' ')[0];
      el.textContent = format12Hour(cleanTime);
    }
  });
}

// تحويل الوقت من 24 إلى 12 ساعة
function format12Hour(time24) {
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'م' : 'ص';
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

// حساب الصلاة القادمة والعد التنازلي
function getNextPrayer(timings) {
  const now = new Date();
  const mainPrayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  let upcoming = [];

  for (let key of mainPrayers) {
    if (!timings[key]) continue;
    const [h, m] = timings[key].split(' ')[0].split(':').map(Number);
    const pDate = new Date();
    pDate.setHours(h, m, 0, 0);

    if (pDate > now) {
      upcoming.push({ key, name: prayerNamesArabic[key], time: pDate, originalTime: timings[key] });
    }
  }

  // إذا انتهت جميع صلوات اليوم، فالصلاة القادمة هي فجر الغد
  if (upcoming.length === 0) {
    const [h, m] = timings['Fajr'].split(' ')[0].split(':').map(Number);
    const nextFajr = new Date();
    nextFajr.setDate(nextFajr.getDate() + 1);
    nextFajr.setHours(h, m, 0, 0);
    return { key: 'Fajr', name: prayerNamesArabic['Fajr'], time: nextFajr, originalTime: timings['Fajr'] };
  }

  return upcoming[0];
}

function startNextPrayerCountdown(timings) {
  if (prayerTimerInterval) clearInterval(prayerTimerInterval);

  function update() {
    const next = getNextPrayer(timings);
    const now = new Date();
    const diffMs = next.time - now;

    if (diffMs <= 0) {
      setTimeout(() => fetchPrayerTimesByCity('Cairo', 'Egypt'), 1000);
      return;
    }

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

    const pad = (n) => n.toString().padStart(2, '0');
    const countdownStr = `متبقي: ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

    // تحديث عناصر صفحة الصلوات إن وجدت
    const nameEl = document.getElementById('nextPrayerName');
    const timeEl = document.getElementById('nextPrayerTime');
    const countEl = document.getElementById('nextPrayerTimer') || document.getElementById('nextPrayerCountdown');

    if (nameEl) nameEl.textContent = next.name;
    if (timeEl) timeEl.textContent = format12Hour(next.originalTime.split(' ')[0]);
    if (countEl) countEl.textContent = countdownStr;

    // تحديث بنر الصفحة الرئيسية (Quick Banner)
    const quickNameEl = document.getElementById('quickNextPrayerName');
    const quickTimeEl = document.getElementById('quickNextPrayerTime');
    const quickCountEl = document.getElementById('quickNextPrayerCountdown');

    if (quickNameEl) quickNameEl.textContent = next.name;
    if (quickTimeEl) quickTimeEl.textContent = format12Hour(next.originalTime.split(' ')[0]);
    if (quickCountEl) quickCountEl.textContent = countdownStr;

    // تمييز بطاقة الصلاة الحالية
    document.querySelectorAll('.prayer-box').forEach(box => {
      box.classList.toggle('active-prayer', box.dataset.prayer === next.key);
    });
  }

  update();
  prayerTimerInterval = setInterval(update, 1000);
}

// ----------------------------------------------------
// 5. التحكم بحجم خط الأذكار (Font Size Controls)
// ----------------------------------------------------
const DEFAULT_ZEKR_FONT_SIZE = 23;
let currentZekrFontSize = parseInt(localStorage.getItem('zakker_font_size') || DEFAULT_ZEKR_FONT_SIZE, 10);

function applyZekrFontSize(size) {
  currentZekrFontSize = Math.min(38, Math.max(16, size));
  const zekrElements = document.querySelectorAll('.zekr-text');
  zekrElements.forEach(el => {
    el.style.fontSize = `${currentZekrFontSize}px`;
  });
  localStorage.setItem('zakker_font_size', currentZekrFontSize);
}

function initFontSizeControls() {
  const fontPlusBtn = document.getElementById('font-plus');
  const fontMinusBtn = document.getElementById('font-minus');
  const fontResetBtn = document.getElementById('font-reset');

  if (document.querySelector('.zekr-text')) {
    applyZekrFontSize(currentZekrFontSize);
  }

  if (fontPlusBtn) {
    fontPlusBtn.addEventListener('click', () => {
      applyZekrFontSize(currentZekrFontSize + 2);
    });
  }

  if (fontMinusBtn) {
    fontMinusBtn.addEventListener('click', () => {
      applyZekrFontSize(currentZekrFontSize - 2);
    });
  }

  if (fontResetBtn) {
    fontResetBtn.addEventListener('click', () => {
      applyZekrFontSize(DEFAULT_ZEKR_FONT_SIZE);
    });
  }
}

// ----------------------------------------------------
// 6. تهيئة الصفحة عند التحميل (DOMContentLoaded)
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initNotifications();
  initAzkarCounters();
  initFontSizeControls();

  // مستمعات صفحة الصلوات
  const fetchBtn = document.getElementById('fetchPrayersBtn');
  const geoBtn = document.getElementById('geoLocateBtn');
  const cityInput = document.getElementById('cityInput');
  const countryInput = document.getElementById('countryInput');

  if (fetchBtn) {
    fetchBtn.addEventListener('click', () => {
      const city = cityInput.value.trim() || 'Cairo';
      const country = countryInput.value.trim() || 'Egypt';
      fetchPrayerTimesByCity(city, country);
    });
  }

  if (geoBtn) {
    geoBtn.addEventListener('click', () => {
      fetchPrayerTimesByGeo();
    });
  }

  // جلب المواقيت الافتراضية
  fetchPrayerTimesByCity('Cairo', 'Egypt');
});
