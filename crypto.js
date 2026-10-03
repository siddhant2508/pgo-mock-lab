// AES-256-GCM helpers. Everything stored on disk (question bank, answer key,
// student data) passes through here, so the files are unreadable without DATA_KEY.
const crypto = require('crypto');
const fs = require('fs');

function keyFromHex(hex) {
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error('DATA_KEY must be 64 hex characters. Run: npm run setup');
  return Buffer.from(hex, 'hex');
}

// File layout: "PGO1" | 12-byte IV | 16-byte auth tag | ciphertext
function encrypt(key, plainBuffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  return Buffer.concat([Buffer.from('PGO1'), iv, cipher.getAuthTag(), body]);
}

function decrypt(key, fileBuffer) {
  if (fileBuffer.subarray(0, 4).toString() !== 'PGO1') throw new Error('Not an encrypted PGO file');
  const iv = fileBuffer.subarray(4, 16), tag = fileBuffer.subarray(16, 32), body = fileBuffer.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]); // throws if the key is wrong or the file was altered
}

function writeEncryptedJson(key, file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, encrypt(key, Buffer.from(JSON.stringify(value))));
  fs.renameSync(tmp, file); // atomic swap so a crash never leaves a half-written file
}

function readEncryptedJson(key, file) {
  return JSON.parse(decrypt(key, fs.readFileSync(file)).toString('utf8'));
}

const hmac = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('hex');
const randomId = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = { keyFromHex, encrypt, decrypt, writeEncryptedJson, readEncryptedJson, hmac, randomId, safeEqual };
