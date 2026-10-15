require('dotenv').config();
const { initQStashSchedules, getQStashClient } = require('../services/qstashService');

async function main() {
  console.log('====================================================');
  console.log('🚀 إعداد ومزامنة جداول Upstash QStash لمشروع ذكّر');
  console.log('====================================================\n');

  const token = process.env.QSTASH_TOKEN;
  const appUrl = process.env.APP_URL;

  if (!token) {
    console.error('❌ خطأ: متغير البيئة QSTASH_TOKEN غير موجود في ملف .env!');
    console.error('احصل عليه من لوحة تحكم Upstash (https://console.upstash.com/qstash)');
    process.exit(1);
  }

  if (!appUrl) {
    console.warn('⚠️ تنبيه: متغير البيئة APP_URL غير موجود في ملف .env.');
    console.warn('يرجى تحديد رابط استضافة مشروعك على Vercel مثل: APP_URL=https://zakker.vercel.app\n');
  }

  try {
    const results = await initQStashSchedules(appUrl);
    console.log('\n📊 نتائج تسجيل الجداول:');
    console.table(results);

    // استعراض الجداول الحالية من QStash
    const client = getQStashClient();
    if (client) {
      console.log('\n🔍 فحص الجداول النشطة في حساب QStash:');
      const schedules = await client.schedules.list();
      console.table(
        schedules.map((s) => ({
          'معرّف الجدول': s.scheduleId,
          'التوقيت': s.cron,
          'الرابط': s.destination,
          'الحالة': s.isPaused ? 'متوقف مؤقتاً ⏸️' : 'نشط ويعمل 🟢'
        }))
      );
    }

    console.log('\n🎉 تمت تهيئة الجداول بنجاح! سيقوم QStash بإيقاظ السيرفر وإرسال الإشعارات مع Retries تلقائياً.');
  } catch (err) {
    console.error('\n❌ حدث خطأ أثناء إعداد QStash:', err.message);
    process.exit(1);
  }
}

main();
