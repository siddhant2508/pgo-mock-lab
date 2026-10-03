// Replaces DATA_KEY with a fresh one and re-encrypts data/bank.enc and data/db.enc.
// Stop the site first. Back up pgo-secrets.env afterwards.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const C = require('../server/crypto');
const ROOT = path.join(__dirname, '..'), envFile = path.join(ROOT, 'pgo-secrets.env');
let env = fs.readFileSync(envFile, 'utf8');
const oldHex = (env.match(/^DATA_KEY=(.*)$/m) || [])[1], oldKey = C.keyFromHex(oldHex);
const newHex = crypto.randomBytes(32).toString('hex'), newKey = C.keyFromHex(newHex);
const files = ['bank.enc', 'db.enc'].map(f => path.join(ROOT, 'data', f)).filter(f => fs.existsSync(f));
const contents = files.map(f => C.readEncryptedJson(oldKey, f)); // read everything first so a wrong key changes nothing
fs.copyFileSync(envFile, envFile + '.before-rotate');
files.forEach((f, i) => C.writeEncryptedJson(newKey, f, contents[i]));
fs.writeFileSync(envFile, env.replace(/^DATA_KEY=.*$/m, 'DATA_KEY=' + newHex), { mode: 0o600 });
console.log(`Re-encrypted ${files.length} file(s) with a new key. The old settings are saved as pgo-secrets.env.before-rotate; delete that file once the site starts correctly.`);
