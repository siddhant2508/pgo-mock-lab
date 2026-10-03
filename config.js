// Loads settings from pgo-secrets.env (never committed to GitHub) into one object.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const envFile = path.join(ROOT, 'pgo-secrets.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const env = process.env;
const flag = (v, d) => (v === undefined || v === '' ? d : v === '1' || v === 'true');

module.exports = {
  ROOT,
  PORT: Number(env.PORT || 3443),
  DATA_KEY: env.DATA_KEY || '',
  SESSION_SECRET: env.SESSION_SECRET || '',
  ADMIN_EMAIL: (env.ADMIN_EMAIL || '').toLowerCase(),
  SITE_NAME: env.SITE_NAME || 'PGO Mock Lab',
  // Email: with a Resend API key, login codes are emailed. Without one, the code is
  // printed in this terminal and (in DEV_MODE) shown on the login screen.
  RESEND_API_KEY: env.RESEND_API_KEY || '',
  MAIL_FROM: env.MAIL_FROM || '',
  // Payments: with Razorpay keys, real checkout runs. Without them, DEV_MODE lets
  // you "buy" with a simulated payment so the whole site can be tried locally.
  RAZORPAY_KEY_ID: env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: env.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: env.RAZORPAY_WEBHOOK_SECRET || '',
  DEV_MODE: flag(env.DEV_MODE, true),
  MAX_DEVICES: Math.max(1, Number(env.MAX_DEVICES || 2)), // how many devices one account can be signed in on at once
  PRICE_SINGLE_PAISE: Number(env.PRICE_SINGLE_PAISE || 49900),
  PRICE_PACK_PAISE: Number(env.PRICE_PACK_PAISE || 349900),
  TLS_KEY: path.join(ROOT, 'certs', 'key.pem'),
  TLS_CERT: path.join(ROOT, 'certs', 'cert.pem'),
  DB_FILE: path.join(ROOT, 'data', 'db.enc'),
  BANK_FILE: path.join(ROOT, 'data', 'bank.enc'),
};
