// One-time setup: makes secret keys, encrypts the question bank, creates a local HTTPS certificate.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), envFile = path.join(ROOT, 'pgo-secrets.env');
const C = require('../server/crypto');

let env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];
const set = (k, v) => { env = get(k) !== undefined ? env.replace(new RegExp('^' + k + '=.*$', 'm'), `${k}=${v}`) : env + `${k}=${v}\n`; };

if (!get('DATA_KEY')) { set('DATA_KEY', crypto.randomBytes(32).toString('hex')); console.log('Created DATA_KEY (encrypts everything in data/).'); }
if (!get('SESSION_SECRET')) { set('SESSION_SECRET', crypto.randomBytes(32).toString('hex')); console.log('Created SESSION_SECRET.'); }
for (const [k, v] of [['PORT', '3443'], ['SITE_NAME', 'PGO Mock Lab'], ['DEV_MODE', '1'], ['ADMIN_EMAIL', ''], ['RESEND_API_KEY', ''], ['MAIL_FROM', ''], ['RAZORPAY_KEY_ID', ''], ['RAZORPAY_KEY_SECRET', ''], ['RAZORPAY_WEBHOOK_SECRET', ''], ['PRICE_SINGLE_PAISE', '49900'], ['PRICE_PACK_PAISE', '349900']]) if (get(k) === undefined) set(k, v);
fs.writeFileSync(envFile, env, { mode: 0o600 });

const key = C.keyFromHex(get('DATA_KEY'));
const plain = path.join(ROOT, 'data', 'bank.json'), enc = path.join(ROOT, 'data', 'bank.enc');
if (fs.existsSync(plain)) {
  const bank = JSON.parse(fs.readFileSync(plain, 'utf8'));
  C.writeEncryptedJson(key, enc, bank);
  fs.unlinkSync(plain);
  console.log(`Encrypted the question bank (${bank.tests.map(t => `${t.id}: ${t.questions.length}`).join(', ')}) to data/bank.enc and removed the readable copy.`);
} else if (fs.existsSync(enc)) {
  try { C.readEncryptedJson(key, enc); console.log('Question bank is already encrypted and opens with your key.'); }
  catch { console.error('data/bank.enc cannot be opened with the DATA_KEY in pgo-secrets.env. Restore your original pgo-secrets.env, or put a fresh data/bank.json in place and run setup again.'); process.exit(1); }
} else { console.error('No question bank found. Put bank.json in data/ and run setup again.'); process.exit(1); }

const certDir = path.join(ROOT, 'certs');
if (!fs.existsSync(path.join(certDir, 'cert.pem'))) {
  fs.mkdirSync(certDir, { recursive: true });
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825', '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem'), '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    console.log('Created a local HTTPS certificate in certs/. Your browser will warn once because it is self-signed; choose "Advanced" then "Proceed".');
  } catch { console.log('OpenSSL not found, so no certificate was made. The site will run on plain http://localhost. (On Windows, run this from "Git Bash", which includes OpenSSL.)'); }
}
console.log('\nSetup done. Start the site with:  npm start\nBack up your pgo-secrets.env file somewhere safe: without DATA_KEY the encrypted data cannot be read.\n');
