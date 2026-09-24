/**
 * مشروع ذاكِر - ملف الجافاسكريبت الرئيسي
 * يشمل:
 * 1. عدادات الأذكار التفاعلية
 * 2. جلب مواقيت الصلاة من Aladhan API وحساب الصلاة القادمة
 * 3. نظام الإشعارات والتنبيهات للأذكار وأوقات الصلاة
 */

// ----------------------------------------------------
// 1. نظام الإشعارات المتطور (Service Worker + Web Push)
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
      
      // التحقق إذا كان المستخدم مشتركاً بالفعل
      const existingSub = await swRegistration.pushManager.getSubscription();
      if (existingSub && notifyBtn) {
        notifyBtn.textContent = 'الإشعارات مفعلة ✓';
      }
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

    // 3. إرسال الاشتراك وحفظه في السيرفر
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    console.log('تم الاشتراك في إشعارات السيرفر بنجاح.');
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
  if (permission === 'granted') {
    notifyBtn.className = 'btn-notify granted';
    notifyBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <span>الإشعارات مفعلة</span>
    `;
    notifyBtn.title = 'التنبيهات مفعلة بنجاح';
  } else if (permission === 'denied') {
    notifyBtn.className = 'btn-notify denied';
    notifyBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
      <span>الإشعارات محظورة (اضغط للحل)</span>
    `;
    notifyBtn.title = 'المتصفح يحظر الإشعارات - اضغط لمعرفة خطوات فك الحظر';
  } else {
    notifyBtn.className = 'btn-notify';
    notifyBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
      <span>تفعيل التنبيهات</span>
    `;
    notifyBtn.title = 'تفعيل الإشعارات والتذكير';
  }
}

function openNotificationModal(type) {
  const overlay = document.getElementById('notifyModalOverlay');
  const softContent = document.getElementById('notifySoftPromptContent');
  const blockedContent = document.getElementById('notifyBlockedContent');

  if (!overlay) return;

  overlay.style.display = 'flex';
  if (type === 'blocked') {
    if (softContent) softContent.style.display = 'none';
    if (blockedContent) blockedContent.style.display = 'block';
  } else {
    if (blockedContent) blockedContent.style.display = 'none';
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
  const blockedCloseBtn = document.getElementById('notifyBlockedCloseBtn');
  const reloadBtn = document.getElementById('notifyReloadBtn');

  if (closeBtn) closeBtn.addEventListener('click', closeNotificationModal);
  if (softCancelBtn) softCancelBtn.addEventListener('click', closeNotificationModal);
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

  // عند الضغط على زر التنبيهات في شريط التنقل
  if (notifyBtn) {
    notifyBtn.addEventListener('click', () => {
      if (Notification.permission === 'granted') {
        showNotification('تطبيق ذكّر 🕌', 'التنبيهات مفعلة لديك بالفعل وتعمل في الخلفية.');
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

// فحص دوري محلي للتذكير بأذكار الصباح والمساء
function checkAzkarReminders() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  // تذكير أذكار الصباح الساعة 6:30 صباحاً
  if (hours === 6 && minutes === 30) {
    showNotification('أذكار الصباح 🌅', 'حان الآن وقت أذكار الصباح، ابدأ يومك بذكر الله وحصّن نفسك.');
  }

  // تذكير أذكار المساء الساعة 5:00 مساءً
  if (hours === 17 && minutes === 0) {
    showNotification('أذكار المساء 🌇', 'حان الآن وقت أذكار المساء، ألا بذكر الله تطمئن القلوب.');
  }
}

// ----------------------------------------------------
// 2. عدادات الأذكار (Azkar Counters)
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
        btn.querySelector('.count-num').textContent = current;

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
// 3. مواقيت الصلاة (Aladhan API Integration)
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

// جلب المواقيت بالمدينة والدولة
async function fetchPrayerTimesByCity(city = 'Cairo', country = 'Egypt') {
  try {
    const response = await fetch(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=5`);
    const data = await response.json();

    if (data.code === 200) {
      cachedTimings = data.data.timings;
      updatePrayerUI(cachedTimings, `${city}، ${country}`);
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
        const response = await fetch(`https://api.aladhan.com/v1/timings?latitude=${latitude}&longitude=${longitude}&method=5`);
        const data = await response.json();
        if (data.code === 200) {
          cachedTimings = data.data.timings;
          updatePrayerUI(cachedTimings, 'موقعك الحالي');
          startNextPrayerCountdown(cachedTimings);
          if (locationDisplay) locationDisplay.textContent = 'تم تحديد موقعك وجلب المواقيت بنجاح.';
        }
      } catch (err) {
        console.error('فشل جلب المواقيت بالإحداثيات:', err);
      }
    }, (error) => {
      alert('تعذر الوصول لموقعك الجغرافي، سيتم استخدام القاهرة افتراضياً.');
      fetchPrayerTimesByCity('Cairo', 'Egypt');
    });
  } else {
    fetchPrayerTimesByCity('Cairo', 'Egypt');
  }
}

// تحديث الواجهة بالمواقيت
function updatePrayerUI(timings, locationName) {
  // تحديث بطاقات صفحة المواقيت (prayers.ejs)
  Object.keys(prayerNamesArabic).forEach(key => {
    const el = document.getElementById(`time-${key}`);
    if (el && timings[key]) {
      el.textContent = timings[key];
    }
  });

  const locationDisplay = document.getElementById('locationDisplay');
  if (locationDisplay) {
    locationDisplay.textContent = `المواقيت المعروضة لـ: ${locationName}`;
  }
}

// حساب الصلاة القادمة والعد التنازلي
function getNextPrayer(timings) {
  const now = new Date();
  const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

  for (let key of prayers) {
    const [hours, minutes] = timings[key].split(':').map(Number);
    const prayerTime = new Date();
    prayerTime.setHours(hours, minutes, 0, 0);

    if (prayerTime > now) {
      return { key, name: prayerNamesArabic[key], time: timings[key], date: prayerTime };
    }
  }

  // إذا انقضت كل الصلوات اليوم، الصلاة القادمة هي فجر الغد
  const [fajrHours, fajrMinutes] = timings['Fajr'].split(':').map(Number);
  const tomorrowFajr = new Date();
  tomorrowFajr.setDate(tomorrowFajr.getDate() + 1);
  tomorrowFajr.setHours(fajrHours, fajrMinutes, 0, 0);

  return { key: 'Fajr', name: prayerNamesArabic['Fajr'], time: timings['Fajr'], date: tomorrowFajr };
}

// تشغيل العداد التنازلي
function startNextPrayerCountdown(timings) {
  if (prayerTimerInterval) clearInterval(prayerTimerInterval);

  function update() {
    const next = getNextPrayer(timings);
    const now = new Date();
    const diff = next.date - now;

    if (diff <= 0) {
      // حان وقت الصلاة! إرسال إشعار
      showNotification('حان وقت الصلاة 🕌', `حان الآن موعد أذان ${next.name}`);
      return;
    }

    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);

    const formattedTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    // عناصر الصفحة الرئيسية (index.ejs)
    const quickName = document.getElementById('quickNextPrayerName');
    const quickTime = document.getElementById('quickNextPrayerTime');
    const quickCountdown = document.getElementById('quickNextPrayerCountdown');

    if (quickName) quickName.textContent = next.name;
    if (quickTime) quickTime.textContent = next.time;
    if (quickCountdown) quickCountdown.textContent = `متبقي: ${formattedTime}`;

    // عناصر صفحة الصلوات (prayers.ejs)
    const nextName = document.getElementById('nextPrayerName');
    const nextTimer = document.getElementById('nextPrayerTimer');

    if (nextName) nextName.textContent = next.name;
    if (nextTimer) nextTimer.textContent = formattedTime;

    // تمييز بطاقة الصلاة الحالية
    document.querySelectorAll('.prayer-box').forEach(box => {
      box.classList.toggle('active-prayer', box.dataset.prayer === next.key);
    });
  }

  update();
  prayerTimerInterval = setInterval(update, 1000);
}

// ----------------------------------------------------
// 4. تهيئة الصفحة عند التحميل (DOMContentLoaded)
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initNotifications();
  initAzkarCounters();
  initFontSizeControls();

  // فحص أذكار الصباح والمساء كل دقيقة
  setInterval(checkAzkarReminders, 60000);

  // مستمعات عناصر صفحة الصلوات
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

// ----------------------------------------------------
// 5. التحكم بحجم خط جميع الأذكار (Font Size Controls)
// ----------------------------------------------------
const DEFAULT_ZEKR_FONT_SIZE = 23; // الحجم الافتراضي المريح (1.45rem)
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

  // تطبيق الحجم المحفوظ سابقاً لجميع البطاقات
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
