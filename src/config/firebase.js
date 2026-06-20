const admin = require('firebase-admin');

/**
 * Normaliza la private key del service account.
 * Soporta los formatos típicos con que queda en un .env:
 *  - una sola línea con '\n' literales (lo más común con pm2)
 *  - envuelta en comillas dobles o simples
 *  - con saltos de línea reales ya expandidos
 */
function normalizePrivateKey(raw) {
  if (!raw) return undefined;
  let key = raw.trim();
  // Quitar comillas envolventes si las hubiera
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  // Convertir '\n' literales en saltos de línea reales
  key = key.replace(/\\n/g, '\n');
  return key;
}

const projectId = process.env.FIREBASE_PROJECT_ID;
const privateKeyId = process.env.FIREBASE_PRIVATE_KEY_ID;
const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

/** Diagnóstico seguro (NO imprime la clave) para depurar en `pm2 logs`. */
function logCredentialDiagnostics() {
  const missing = [];
  if (!projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!privateKeyId) missing.push('FIREBASE_PRIVATE_KEY_ID');
  if (!privateKey) missing.push('FIREBASE_PRIVATE_KEY');
  if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');

  if (missing.length) {
    console.error(
      `[Firebase Admin] Faltan variables de entorno: ${missing.join(', ')}`
    );
  }

  const keyLooksValid =
    !!privateKey &&
    privateKey.includes('-----BEGIN PRIVATE KEY-----') &&
    privateKey.includes('-----END PRIVATE KEY-----') &&
    privateKey.includes('\n');

  console.log(
    '[Firebase Admin] Diagnóstico credenciales:',
    JSON.stringify({
      projectId: projectId || '(vacío)',
      clientEmail: clientEmail || '(vacío)',
      privateKeyId: privateKeyId
        ? `${privateKeyId.slice(0, 6)}… (len ${privateKeyId.length})`
        : '(vacío)',
      privateKeyFormatoValido: keyLooksValid,
      horaServidorUTC: new Date().toISOString(),
    })
  );

  if (privateKey && !keyLooksValid) {
    console.error(
      '[Firebase Admin] ⚠️ La FIREBASE_PRIVATE_KEY no tiene el formato esperado ' +
        '(debe empezar con "-----BEGIN PRIVATE KEY-----", terminar con ' +
        '"-----END PRIVATE KEY-----" y contener saltos de línea \\n).'
    );
  }
}

let firebaseReady = false;

if (!admin.apps.length) {
  logCredentialDiagnostics();
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        privateKeyId,
        privateKey,
        clientEmail,
        clientId: process.env.FIREBASE_CLIENT_ID,
        authUri: process.env.FIREBASE_AUTH_URI,
        tokenUri: process.env.FIREBASE_TOKEN_URI,
      }),
    });
    firebaseReady = true;
    console.log('[Firebase Admin] Initialized');
  } catch (err) {
    console.error(
      '[Firebase Admin] ❌ Error al inicializar. Los push NO se enviarán:',
      err.message
    );
  }
} else {
  firebaseReady = true;
}

admin.firebaseReady = firebaseReady;

module.exports = admin;
