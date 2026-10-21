/**
 * ==============================================================================
 * 📦 ملف إعداد والاتصال بقاعدة بيانات MongoDB (Mongoose)
 * ==============================================================================
 * 
 * 📌 أين تضع رابط قاعدة البيانات الخاص بك؟ (Database Connection String)
 * ------------------------------------------------------------------------------
 * افتح ملف [.env] الموجود في المجلد الرئيسي للمشروع، وابحث عن السطر:
 * 
 * MONGO_URI="mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/zakker?retryWrites=true&w=majority"
 * 
 * 💡 خطوات الحصول على الرابط مجاناً من MongoDB Atlas:
 * 1. ادخل على موقع https://www.mongodb.com/atlas وأنشئ حساباً مجانياً (M0 Free Cluster).
 * 2. أنشئ مستخدم قاعدة بيانات (Database User) وحدد اسم المستخدم وكلمة المرور.
 * 3. في إعدادات Network Access، أضف الآي بي (0.0.0.0/0) للسماح بالاتصال من أي استضافة سحابية.
 * 4. اضغط على زر (Connect) ثم اختر (Drivers) وانسخ رابط الاتصال بالكامل وضعه في .env.
 * ------------------------------------------------------------------------------
 */

const mongoose = require('mongoose');

// متغير كاش عام لحفظ الاتصال ومنع تكرار فتح اتصالات جديدة في بيئات Serverless (مثل Vercel)
let cached = global.mongooseConnection;

if (!cached) {
  cached = global.mongooseConnection = { conn: null, promise: null };
}

/**
 * دالة الاتصال الموحدة بقاعدة البيانات (مع معالجة إعادة الاتصال التلقائي والكاش)
 * @returns {Promise<typeof mongoose>}
 */
async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.DATA_BASE;

  if (!uri) {
    console.warn('⚠️ [MongoDB] تحذير: لم يتم العثور على رابط الاتصال MONGO_URI في ملف .env!');
    console.warn('⚠️ لن يتم حفظ اشتراكات الإشعارات حتى تقوم بإضافة رابط قاعدة البيانات.');
    return null;
  }

  // إذا كان الاتصال مفتوحاً بالفعل، أعد استخدامه فوراً
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false, // تعطيل التخزين المؤقت للأوامر لتجنب تعليق الطلبات في حال تعثر الاتصال
      serverSelectionTimeoutMS: 8000, // مهلة 8 ثوانٍ لاكتشاف الخطأ سريعاً
    };

    console.log('🔄 [MongoDB] جارٍ الاتصال بقاعدة البيانات الخارجية...');

    cached.promise = mongoose.connect(uri, opts).then((mongooseInstance) => {
      console.log('✅ [MongoDB] تم الاتصال بقاعدة بيانات MongoDB بنجاح وتجهيز جداول الاشتراكات.');
      return mongooseInstance;
    }).catch((err) => {
      cached.promise = null;
      console.error('❌ [MongoDB] خطأ أثناء الاتصال بقاعدة البيانات:', err.message);
      throw err;
    });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    cached.promise = null;
    throw error;
  }
}

module.exports = connectDB;
