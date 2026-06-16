const forge = require('node-forge');

let _privateKey = null;
let _publicKeyPem = null;

function initRsaKeys() {
  if (process.env.RSA_PRIVATE_KEY && process.env.RSA_PUBLIC_KEY) {
    _privateKey = forge.pki.privateKeyFromPem(process.env.RSA_PRIVATE_KEY);
    _publicKeyPem = process.env.RSA_PUBLIC_KEY;
    console.log('[RSA] Keys loaded from environment');
    return;
  }

  console.log('[RSA] Generating 2048-bit key pair (store in .env for persistence)...');
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  _privateKey = keypair.privateKey;
  _publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
  console.log('[RSA] Key pair ready');
  console.log('[RSA] Add these to .env to persist across restarts:');
  console.log(`RSA_PUBLIC_KEY="${_publicKeyPem.replace(/\n/g, '\\n')}"`);
  console.log(`RSA_PRIVATE_KEY="${forge.pki.privateKeyToPem(_privateKey).replace(/\n/g, '\\n')}"`);
}

function getPublicKeyPem() {
  if (!_publicKeyPem) initRsaKeys();
  return _publicKeyPem;
}

// Decrypts a base64-encoded RSA-PKCS1-encrypted string
function decryptPassword(encryptedBase64) {
  if (!_privateKey) initRsaKeys();
  const encryptedBytes = forge.util.decode64(encryptedBase64);
  return _privateKey.decrypt(encryptedBytes, 'RSAES-PKCS1-V1_5');
}

module.exports = { initRsaKeys, getPublicKeyPem, decryptPassword };
