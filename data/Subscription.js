const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  endpoint: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  expirationTime: {
    type: Number,
    default: null
  },
  keys: {
    p256dh: {
      type: String,
      required: true,
      trim: true
    },
    auth: {
      type: String,
      required: true,
      trim: true
    }
  },
  // المنطقة الزمنية الرسمية لجهاز المستخدم (IANA Timezone مثل Africa/Cairo, Asia/Riyadh, Asia/Dubai)
  timezone: {
    type: String,
    default: 'Africa/Cairo',
    trim: true,
    index: true
  },
  // فرق التوقيت بالدقائق عن UTC (للتوافق الإضافي)
  timezoneOffset: {
    type: Number,
    default: -120
  },
  // المدينة والدولة لحساب مواقيت الصلاة بدقة
  city: {
    type: String,
    default: 'Cairo',
    trim: true
  },
  country: {
    type: String,
    default: 'Egypt',
    trim: true
  },
  // تاريخ آخر إشعار صباح ومساء تم إرساله بتوقيت المستخدم المحلي لمنع التكرار
  lastMorningNotification: {
    type: String,
    default: null
  },
  lastEveningNotification: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
