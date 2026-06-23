// Envío de SMS para verificación de teléfono.
//
// En producción usa Twilio (requiere las variables de entorno
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_PHONE_NUMBER).
// En desarrollo —o si Twilio no está configurado/instalado— hace un fallback:
// registra el código en consola para poder probar el flujo de punta a punta.

let _client = null;
let _initTried = false;

function getClient() {
  if (_initTried) return _client;
  _initTried = true;

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;

  try {
    // Carga perezosa: si el paquete no está instalado, caemos al fallback.
    const twilio = require('twilio');
    _client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  } catch (err) {
    console.warn('[sms] Twilio no disponible, usando fallback de consola:', err.message);
    _client = null;
  }
  return _client;
}

async function sendVerificationSms(phone, code) {
  const client = getClient();
  const body = `${code} es tu código de verificación de FixRadar. Expira en 10 minutos.`;

  if (!client) {
    // Fallback de desarrollo: el flujo funciona sin proveedor real.
    console.log(`[sms:dev] Código para ${phone}: ${code}`);
    return { dev: true };
  }

  return client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to: phone,
    body,
  });
}

module.exports = { sendVerificationSms };
