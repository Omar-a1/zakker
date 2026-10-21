/**
 * ==============================================================================
 * 🔔 إعدادات Web Push ومفاتيح التشفير VAPID
 * ==============================================================================
 */

const webpush = require('web-push');

let isConfigured = false;

function initWebPush() {
  if (isConfigured) return webpush;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL || 'mailto:zakker-app@example.com';

  if (publicKey && privateKey) {
    webpush.setVapidDetails(email, publicKey, privateKey);
    isConfigured = true;
  } else {
    console.warn('⚠️ [WebPush] تحذير: مفاتيح VAPID غير مكتملة في ملف .env');
  }

  return webpush;
}

module.exports = {
  initWebPush,
  webpush
};
