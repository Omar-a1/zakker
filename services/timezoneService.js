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
 * فحص ما إذا كان الوقت الحالي في المنطقة الزمنية يقع ضمن نافذة أذكار الصباح
 * النافذة المعتمدة: من 06:15 صباحاً حتى 08:00 صباحاً (الموعد المستهدف: 06:30)
 * 
 * @param {string} timeZone 
 * @param {Date} [baseDate]
 * @returns {boolean}
 */
function isMorningAzkarTime(timeZone, baseDate = new Date()) {
  const { hours, minutes } = getUserLocalDateTime(timeZone, baseDate);
  // من الساعة 06:15 حتى 07:59
  if (hours === 6 && minutes >= 15) return true;
  if (hours === 7) return true;
  return false;
}

/**
 * فحص ما إذا كان الوقت الحالي في المنطقة الزمنية يقع ضمن نافذة أذكار المساء
 * النافذة المعتمدة: من 16:45 مساءً حتى 18:30 مساءً (الموعد المستهدف: 17:00 / 5:00م)
 * 
 * @param {string} timeZone 
 * @param {Date} [baseDate]
 * @returns {boolean}
 */
function isEveningAzkarTime(timeZone, baseDate = new Date()) {
  const { hours, minutes } = getUserLocalDateTime(timeZone, baseDate);
  // من 16:45 حتى 18:30
  if (hours === 16 && minutes >= 45) return true;
  if (hours === 17) return true;
  if (hours === 18 && minutes <= 30) return true;
  return false;
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
  getEpochSecondsForTimezone
};

