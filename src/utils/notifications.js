const admin = require('../config/firebase');
const User = require('../entities/User');

async function sendPushNotification(userId, { title, body, data = {} }) {
  try {
    // Skip FCM only if the user has the app in FOREGROUND (visible).
    // Un socket conectado NO basta: las apps en segundo plano mantienen
    // el socket vivo, y ahí sí necesitamos el push. El cliente reporta su
    // estado con el evento 'app:state' (socket.data.foreground).
    try {
      const { getIO } = require('../socket/socketManager');
      const io = getIO();
      const sockets = await io.in(`user:${userId}`).fetchSockets();
      const hasForegroundSocket = sockets.some(
        (s) => s.data && s.data.foreground === true
      );
      if (hasForegroundSocket) {
        console.log(`[Push] Skip FCM for ${userId}: app en primer plano`);
        return;
      }
    } catch (_) {}

    const user = await User.findById(userId).select('fcmToken notificationsEnabled');

    if (!user || !user.fcmToken || user.notificationsEnabled === false) {
      console.log(`[Push] Skip: User ${userId} — no token or notifications disabled`);
      return;
    }

    const message = {
      notification: {
        title,
        body,
      },
      android: {
        notification: {
          channelId: 'fixradar_channel',
          priority: 'high',
          sound: 'default',
        },
        priority: 'high',
      },
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: 'default',
            badge: 1,
          },
        },
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
    const code = error?.errorInfo?.code || error?.code;

    // Token inválido/no registrado: limpiar para no reintentar siempre.
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/invalid-argument'
    ) {
      console.warn(`[Push] Token inválido para ${userId} (${code}). Limpiando fcmToken.`);
      try {
        await User.findByIdAndUpdate(userId, { $unset: { fcmToken: 1 } });
      } catch (_) {}
      return;
    }

    // Credenciales del service account rechazadas por Google.
    if (code === 'app/invalid-credential' || code === 'messaging/authentication-error') {
      console.error(
        `[Push] ❌ Credencial de Firebase rechazada (${code}). ` +
          'Causas probables: (1) la hora del servidor está desincronizada ' +
          `(ahora UTC: ${new Date().toISOString()}) → sincroniza NTP; o ` +
          '(2) la service account key fue revocada/regenerada → actualiza ' +
          'FIREBASE_PRIVATE_KEY/FIREBASE_PRIVATE_KEY_ID en el .env. ' +
          'Ningún push se enviará hasta corregirlo.'
      );
      return;
    }

    console.error(`[Push] Error sending to ${userId}:`, error);
  }
}

module.exports = { sendPushNotification };
