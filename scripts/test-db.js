/**
 * سكربت سريع لاختبار الاتصال بقاعدة بيانات MongoDB Atlas والتأكد من صحة الرابط
 * التشغيل: node scripts/test-db.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Subscription = require('../data/Subscription');

async function testConnection() {
  console.log('====================================================');
  console.log('🔍 فحص واختبار الاتصال بقاعدة بيانات MongoDB Atlas');
  console.log('====================================================\n');

  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('❌ خطأ: لم يتم العثور على MONGO_URI في ملف .env!');
    process.exit(1);
  }

  // فحص إذا كان المستخدم نسي كلمة <db_username>
  if (uri.includes('<db_username>')) {
    console.error('❌ خطأ في الرابط: كلمة <db_username> ما زالت موجودة في الرابط!');
    console.error('👉 الحل: استبدل <db_username> باسم مستخدم قاعدة البيانات الخاص بك من لوحة Atlas.\n');
    process.exit(1);
  }

  try {
    console.log('⏳ جارٍ محاولة الاتصال بـ MongoDB...');
    await connectDB();
    console.log('✅ تم الاتصال بقاعدة البيانات بنجاح تام! 🎉');

    const count = await Subscription.countDocuments();
    console.log(`📊 عدد الأجهزة المشتركة حالياً في جدول الإشعارات: ${count}`);

    console.log('\n🟢 كل شيء يعمل بشكل سليم ومستعد لتخزين الاشتراكات وإرسال الإشعارات.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ فشل الاتصال بقاعدة البيانات:');
    if (err.message.includes('Authentication failed') || err.message.includes('bad auth')) {
      console.error('👉 سبب المشكلة: خطأ في اسم المستخدم (Username) أو كلمة المرور (Password).');
      console.error('💡 تأكد من صحة بيانات الدخول في MongoDB Atlas -> Database Access.');
    } else if (err.message.includes('whitelist') || err.message.includes('ETIMEDOUT') || err.message.includes('ECONNREFUSED')) {
      console.error('👉 سبب المشكلة: عنوان الـ IP غير مسموح به (Network Access).');
      console.error('💡 تأكد من إضافة 0.0.0.0/0 في MongoDB Atlas -> Network Access.');
    } else {
      console.error(`👉 تفاصيل الخطأ: ${err.message}`);
    }
    process.exit(1);
  }
}

testConnection();
