const admin = require('../config/firebase');
const User = require('../entities/User');

async function sendPushNotification(userId, { title, body, data = {} }) {
  try {
    const user = await User.findById(userId).select('fcmToken notificationsEnabled');

    if (!user || !user.fcmToken || user.notificationsEnabled === false) {
      console.log(`[Push] Skip: User ${userId} has no token or notifications disabled`);
      return;
    }

    const message = {
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      token: user.fcmToken,
    };

    const response = await admin.messaging().send(message);
    console.log(`[Push] Sent to ${userId}: ${response}`);
    return response;
  } catch (error) {
    console.error(`[Push] Error sending to ${userId}:`, error);
  }
}

module.exports = { sendPushNotification };
