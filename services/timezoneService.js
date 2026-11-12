/**
 * ==============================================================================
 * 🌍 خدمة التوقيت الذكي والمناطق الزمنية (Timezone & DST Service)
 * ==============================================================================
 * تدعم التوقيت الصيفي والشتوي ديناميكياً لجميع دول العالم
 * بناءً على قواعد IANA المدمجة في Node.js، مما يضمن دقة مواعيد الأذكار
 * لكل مستخدم في دولته وتوقيته المحلي الخاص.
 */

/**
 * التحقق من صحة المنطقة الزمنية وتوحيدها (مع اعتماد Africa/Cairo كافتراضي)
 * @param {string} [timeZone] 
 * @returns {string}
 */
function normalizeTimezone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') {
    return 'Africa/Cairo';
  }
  const clean = timeZone.trim();
  try {
    // اختبار صلاحية اسم المنطقة الزمنية في بيئة Intl
    Intl.DateTimeFormat(undefined, { timeZone: clean });
    return clean;
  } catch (e) {
    return 'Africa/Cairo';
  }
}

/**
 * جلب تفاصيل الوقت والتاريخ المحلي لمنطقة زمنية معينة
 * مع مراعاة التوقيت الصيفي/الشتوي (DST) تلقائياً ودون أي خطأ.
 * 
 * @param {string} [timeZone='Africa/Cairo'] 
 * @param {Date} [baseDate=new Date()]
 * @returns {{ dateStr: string, timeHM: string, hours: number, minutes: number, seconds: number }}
 */
function getUserLocalDateTime(timeZone = 'Africa/Cairo', baseDate = new Date()) {
  const validTz = normalizeTimezone(timeZone);
  const now = baseDate instanceof Date && !isNaN(baseDate) ? baseDate : new Date();

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: validTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });

    const parts = formatter.formatToParts(now);
    const p = {};
    for (const part of parts) {
      p[part.type] = part.value;
    }

    const hours = Number(p.hour || 0);
    const minutes = Number(p.minute || 0);
    const seconds = Number(p.second || 0);
    const dateStr = `${p.year}-${p.month}-${p.day}`;
    const timeHM = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    return {
      dateStr,
      timeHM,
      hours,
      minutes,
      seconds
    };
  } catch (err) {
    // في حال حدوث أي استثناء غير متوقع نلجأ لتوقيت القاهرة
    const d = new Date();
    const isoDate = d.toISOString().slice(0, 10);
    return {
      dateStr: isoDate,
      timeHM: '06:30',
      hours: 6,
      minutes: 30,
      seconds: 0
    };
  }
}

/**
 * تحويل وقت HH:MM إلى دقائق من منتصف الليل
 * @param {string} hhmm
 * @returns {number|null}
 */
function hmToMinutes(hhmm) {
  const match = String(hhmm || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * إضافة دقائق إلى وقت HH:MM مع اللف حول منتصف الليل
 * @param {string} hhmm
 * @param {number} deltaMinutes
 * @returns {string|null}
 */
function addMinutesToHm(hhmm, deltaMinutes) {
  const mins = hmToMinutes(hhmm);
  if (mins == null) return null;
  const total = ((mins + deltaMinutes) % 1440 + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * هل الوقت المحلي الحالي داخل نافذة [start, end) بالدقائق؟
 * @param {number} hours
 * @param {number} minutes
 * @param {string} startHHMM
 * @param {number} durationMinutes
 * @param {string} [endCapHHMM] حد علوي اختياري (مثل المغرب)
 * @returns {boolean}
 */
function isLocalTimeInWindow(hours, minutes, startHHMM, durationMinutes, endCapHHMM) {
  const start = hmToMinutes(startHHMM);
  if (start == null) return false;

  const current = hours * 60 + minutes;
  let end = start + durationMinutes;
  const cap = hmToMinutes(endCapHHMM);
  if (cap != null && cap > start) {
    end = Math.min(end, cap);
  }
  if (end <= start) return false;

  if (end <= 1440) {
    return current >= start && current < end;
  }
  return current >= start || current < (end - 1440);
}

/**
 * فحص نافذة أذكار الصباح: بعد الفجر بساعة (ولمدة ساعة لتغطية جدولة QStash)
 *
 * @param {string} timeZone
 * @param {Date} [baseDate]
 * @param {string} [fajrHHMM]
 * @returns {boolean}
 */
function isMorningAzkarTime(timeZone, baseDate = new Date(), fajrHHMM) {
  if (!fajrHHMM) return false;
  const { hours, minutes } = getUserLocalDateTime(timeZone, baseDate);
  const start = addMinutesToHm(fajrHHMM, 60);
  return isLocalTimeInWindow(hours, minutes, start, 60);
}

/**
 * فحص نافذة أذكار المساء: بعد العصر بساعة، وقبل المغرب
 *
 * @param {string} timeZone
 * @param {Date} [baseDate]
 * @param {string} [asrHHMM]
 * @param {string} [maghribHHMM]
 * @returns {boolean}
 */
function isEveningAzkarTime(timeZone, baseDate = new Date(), asrHHMM, maghribHHMM) {
  if (!asrHHMM) return false;
  const { hours, minutes } = getUserLocalDateTime(timeZone, baseDate);
  const start = addMinutesToHm(asrHHMM, 60);
  return isLocalTimeInWindow(hours, minutes, start, 60, maghribHHMM);
}

/**
 * حساب الطابع الزمني بالثواني (Unix Epoch) لوقت محدد (HH:MM) في أي منطقة زمنية في العالم
 * مع مراعاة التوقيت الصيفي والشتوي بدقة تامة.
 * 
 * @param {string} hhmm - الوقت بصيغة HH:MM
 * @param {string} [timeZone='Africa/Cairo'] 
 * @param {Date} [targetDate=new Date()]
 * @returns {number} Unix Timestamp بالثواني
 */
function getEpochSecondsForTimezone(hhmm, timeZone = 'Africa/Cairo', targetDate = new Date()) {
  const validTz = normalizeTimezone(timeZone);
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  const now = targetDate instanceof Date && !isNaN(targetDate) ? targetDate : new Date();

  // الحصول على تاريخ اليوم بالمنطقة الزمنية المحددة
  const dParts = new Intl.DateTimeFormat('en-US', {
    timeZone: validTz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(now);

  const parts = {};
  dParts.forEach((p) => { parts[p.type] = p.value; });

  const targetUtcApprox = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), h, m, 0);

  // حساب الفرق الحقيقي للتعامل بدقة مع التوقيت الصيفي/الشتوي (DST)
  const cParts = new Intl.DateTimeFormat('en-US', {
    timeZone: validTz,
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

  const actualUtc = Date.UTC(
    Number(cp.year),
    Number(cp.month) - 1,
    Number(cp.day),
    Number(cp.hour),
    Number(cp.minute),
    Number(cp.second)
  );

  const diff = actualUtc - targetUtcApprox;
  const finalMs = targetUtcApprox - diff;

  return Math.floor(finalMs / 1000);
}

module.exports = {
  normalizeTimezone,
  getUserLocalDateTime,
  isMorningAzkarTime,
  isEveningAzkarTime,
  getEpochSecondsForTimezone,
  hmToMinutes,
  addMinutesToHm
};

