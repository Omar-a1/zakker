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

// تحويل كائن الاشتراك إلى بيانات متكاملة تشمل التوقيت الصيفي/الشتوي والمنطقة الزمنية
function buildSubscriptionData(subscription) {
  const subData = subscription.toJSON ? subscription.toJSON() : JSON.parse(JSON.stringify(subscription));
  let tz = 'Africa/Cairo';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo';
  } catch (e) {}

  subData.timezone = tz;
  subData.timezoneOffset = new Date().getTimezoneOffset();
  subData.city = localStorage.getItem('zakker_city') || 'Cairo';
  subData.country = localStorage.getItem('zakker_country') || 'Egypt';
  return subData;
}

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
      
      // انتظار جاهزية السيرفس ووركر
      const readyReg = await navigator.serviceWorker.ready;
      swRegistration = readyReg;

      // فحص إذا كان الجهاز مسجلاً في PushManager ومزامنة التوقيت المحلي معه
      const existingSub = await readyReg.pushManager.getSubscription();
      if (existingSub) {
        console.log('تم العثور على اشتراك موجود، جارٍ مزامنة التوقيت مع MongoDB...');
        const payload = buildSubscriptionData(existingSub);
        await fetch('/api/save-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => {});
      } else if (Notification.permission === 'granted') {
        // الإذن ممنوح ولكن لم ينشأ اشتراك Push بعد
        console.log('الإذن ممنوح، جارٍ إنشاء اشتراك Push وحفظه في MongoDB...');
        await subscribeUserToPush();
      }
      updateNotificationButtonUI();
    } catch (error) {
      console.error('فشل تسجيل Service Worker:', error);
    }
  }
}

async function subscribeUserToPush() {
  try {
    if (!window.isSecureContext) {
      throw new Error('بيئة غير آمنة (يجب استخدام localhost أو HTTPS)');
    }

    const reg = swRegistration || (await navigator.serviceWorker.ready);
    if (!reg) {
      throw new Error('Service Worker غير جاهز في المتصفح');
    }

    // 1. جلب المفتاح العام من السيرفر
    const response = await fetch('/api/vapid-public-key');
    if (!response.ok) {
      throw new Error(`تعذر جلب VAPID Key من السيرفر (${response.status})`);
    }
    const { publicKey } = await response.json();
    if (!publicKey) {
      throw new Error('مفتاح VAPID العام غير موجود في .env');
    }

    // 2. التحقق من وجود اشتراك قديم في المتصفح وإلغاؤه لتفادي تعارض المفاتيح القديمة
    const existingSub = await reg.pushManager.getSubscription();
    if (existingSub) {
      try {
        console.log('إلغاء الاشتراك القديم لتجديده بمفاتيح VAPID الجديدة...');
        await existingSub.unsubscribe();
      } catch (unsubErr) {
        console.warn('تعذر إلغاء الاشتراك السابق:', unsubErr);
      }
    }

    // 3. طلب اشتراك Push جديد تماماً
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    // 4. إرسال الاشتراك وحفظه في MongoDB شاملاً المنطقة الزمنية والتوقيت الصيفي/الشتوي
    const payload = buildSubscriptionData(subscription);
    const saveRes = await fetch('/api/save-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const resJson = await saveRes.json();
    if (!saveRes.ok) {
      throw new Error(resJson.error || `فشل السيرفر في الحفظ (كود ${saveRes.status})`);
    }

    console.log('✅ تم حفظ الاشتراك في MongoDB بنجاح مع التوقيت الذكي:', resJson);
    return { success: true };
  } catch (err) {
    console.error('❌ فشل الاشتراك في Web Push:', err);
    return { success: false, error: err.message || String(err) };
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
  const resyncBtn = document.getElementById('notifyResyncBtn');

  if (resyncBtn) {
    resyncBtn.addEventListener('click', async () => {
      resyncBtn.disabled = true;
      resyncBtn.textContent = 'جارٍ المزامنة مع قاعدة البيانات... ⏳';
      const result = await subscribeUserToPush();
      if (result.success) {
        resyncBtn.textContent = 'تم حفظ الاشتراك في MongoDB بنجاح! ✓';
        showNotification('تطبيق ذكّر 🕌', 'تم تأكيد تسجيل اشتراك جهازك في قاعدة البيانات بنجاح!');
        setTimeout(() => {
          closeNotificationModal();
          resyncBtn.disabled = false;
          resyncBtn.textContent = 'تأكيد وتحديث اشتراك جهازي الآن 🔄';
        }, 1500);
      } else {
        resyncBtn.textContent = `فشل: ${result.error} ⚠️`;
        console.error('خطأ مزامنة الاشتراك:', result.error);
        resyncBtn.disabled = false;
      }
    });
  }

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
// 3. عدادات الأذكار وحفظ التقدم (Azkar Counters & State Persistence)
// ----------------------------------------------------

function getCurrentAzkarPageKey() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/morning') return 'morning';
  if (path === '/evening') return 'evening';
  if (path === '/azkar' || path === '/daily') return 'azkar';
  if (path === '/sleep') return 'sleep';
  if (path === '/waking') return 'waking';
  if (path === '/home-azkar') return 'home_azkar';
  if (path === '/restroom') return 'restroom';
  if (path === '/wudu') return 'wudu';
  return null;
}

function getAzkarStorageKey(pageKey) {
  return `zakker_counters_${pageKey}`;
}

function loadAzkarProgress(pageKey) {
  if (!pageKey) return {};
  try {
    const raw = localStorage.getItem(getAzkarStorageKey(pageKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    // تصفير تلقائي لأذكار الصباح والمساء في يوم جديد
    if (parsed.date && parsed.date !== today && (pageKey === 'morning' || pageKey === 'evening')) {
      localStorage.removeItem(getAzkarStorageKey(pageKey));
      return {};
    }
    return parsed.counters || {};
  } catch (e) {
    return {};
  }
}

function saveAzkarProgress(pageKey, counters) {
  if (!pageKey) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(getAzkarStorageKey(pageKey), JSON.stringify({
      date: today,
      counters: counters
    }));
  } catch (e) {}
}

function initAzkarCounters() {
  const pageKey = getCurrentAzkarPageKey();
  const counterButtons = document.querySelectorAll('.zekr-counter-btn');
  if (counterButtons.length === 0) return;

  const savedCounters = pageKey ? loadAzkarProgress(pageKey) : {};

  counterButtons.forEach((btn, idx) => {
    const card = btn.closest('.zekr-card');
    const cardId = (card && card.id) ? card.id : `zekr-card-${idx}`;
    const target = parseInt(btn.dataset.target, 10) || 1;
    let saved = savedCounters[cardId] !== undefined ? parseInt(savedCounters[cardId], 10) : 0;

    // استعادة الحالة المحفوظة للزر والبطاقة
    if (saved > 0) {
      if (saved > target) saved = target;
      btn.dataset.current = saved;
      const countSpan = btn.querySelector('.count-num');
      if (countSpan) countSpan.textContent = saved;

      if (saved >= target) {
        btn.classList.add('done');
        btn.textContent = '✓';
        if (card) card.classList.add('completed');
      }
    }

    btn.addEventListener('click', () => {
      const curTarget = parseInt(btn.dataset.target, 10) || 1;
      let cur = parseInt(btn.dataset.current, 10) || 0;

      if (cur < curTarget) {
        cur++;
        btn.dataset.current = cur;
        const countSpan = btn.querySelector('.count-num');
        if (countSpan) countSpan.textContent = cur;

        // اهتزاز لمسي خفيف على الهواتف الذكية (Haptic feedback)
        if ('vibrate' in navigator) {
          try { navigator.vibrate(25); } catch (e) {}
        }

        // عند اكتمال العدد
        if (cur >= curTarget) {
          btn.classList.add('done');
          btn.textContent = '✓';
          const parentCard = btn.closest('.zekr-card');
          if (parentCard) parentCard.classList.add('completed');

          if ('vibrate' in navigator) {
            try { navigator.vibrate([40, 50, 40]); } catch (e) {}
          }
        }

        // حفظ التقدم في localStorage
        if (pageKey) {
          savedCounters[cardId] = cur;
          saveAzkarProgress(pageKey, savedCounters);
        }

        // تحديث شريط التقدم الفوري
        if (typeof updateReadingProgressBar === 'function') {
          updateReadingProgressBar();
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

      // حفظ المدينة والدولة المختارة ومزامنتها مع اشتراك الإشعارات
      try {
        localStorage.setItem('zakker_city', cleanCity);
        localStorage.setItem('zakker_country', cleanCountry);
        if (swRegistration && swRegistration.pushManager) {
          swRegistration.pushManager.getSubscription().then((sub) => {
            if (sub) {
              fetch('/api/save-subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildSubscriptionData(sub))
              }).catch(() => {});
            }
          }).catch(() => {});
        }
      } catch (e) {}
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
// 6. شريط تقدم القراءة (Reading Progress Bar)
// ----------------------------------------------------

function updateReadingProgressBar() {
  const bar = document.getElementById('reading-progress-bar');
  if (!bar) return;

  const allCards = document.querySelectorAll('.zekr-card');
  const total = allCards.length;
  if (total === 0) {
    bar.style.display = 'none';
    return;
  }

  const completed = document.querySelectorAll('.zekr-card.completed').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const pctEl = document.getElementById('reading-progress-pct');
  const fillEl = document.getElementById('reading-progress-fill');
  const labelEl = document.getElementById('reading-progress-label');
  const restoreBtn = document.getElementById('reading-progress-restore');

  if (pctEl) pctEl.textContent = `${pct}%`;
  if (fillEl) {
    fillEl.style.width = `${pct}%`;
    if (pct === 100) {
      fillEl.classList.add('all-done');
    } else {
      fillEl.classList.remove('all-done');
    }
  }

  if (labelEl) {
    if (pct === 100) {
      labelEl.textContent = 'أتممت الأذكار كاملة 🎉';
    } else {
      labelEl.textContent = `${completed} من ${total} مكتمل`;
    }
  }

  // إظهار زر "استكمال" فقط إذا كان هناك أذكار مكتملة وأخرى متبقية
  if (restoreBtn) {
    if (completed > 0 && completed < total) {
      restoreBtn.classList.add('visible');
    } else {
      restoreBtn.classList.remove('visible');
    }
  }
}

function initReadingProgress() {
  const pageKey = getCurrentAzkarPageKey();
  const allCards = document.querySelectorAll('.zekr-card');
  const bar = document.getElementById('reading-progress-bar');

  if (!pageKey || allCards.length === 0 || !bar) {
    if (bar) bar.style.display = 'none';
    return;
  }

  // تفعيل شريط التقدم وإضافة مسافة سفلية للـ body
  bar.style.display = 'block';
  document.body.classList.add('has-progress-bar');

  // تحديث الشريط بحالة الأذكار الابتدائية
  updateReadingProgressBar();

  // زر استكمال القراءة: التمرير السلس لأول ذكر غير مكتمل
  const restoreBtn = document.getElementById('reading-progress-restore');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      const firstIncomplete = document.querySelector('.zekr-card:not(.completed)');
      if (firstIncomplete) {
        const headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height') || '64', 10);
        const top = firstIncomplete.getBoundingClientRect().top + window.scrollY - headerH - 16;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    });
  }

  // زر إعادة تعيين الأذكار للبدء من جديد
  const resetBtn = document.getElementById('reading-progress-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm('هل ترغب في إعادة ضبط العدادات للبدء من جديد؟')) {
        const storageKey = getAzkarStorageKey(pageKey);
        localStorage.removeItem(storageKey);

        allCards.forEach(card => {
          card.classList.remove('completed');
          const btn = card.querySelector('.zekr-counter-btn');
          if (btn) {
            btn.classList.remove('done');
            const target = btn.dataset.target || '1';
            btn.dataset.current = '0';
            btn.innerHTML = `<span class="count-num">0</span> / ${target}`;
          }
        });

        updateReadingProgressBar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }
}

// ----------------------------------------------------
// 7. تهيئة الصفحة عند التحميل (DOMContentLoaded)
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initNotifications();
  initAzkarCounters();
  initFontSizeControls();
  initReadingProgress();

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
