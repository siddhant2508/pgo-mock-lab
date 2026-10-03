// PGO Mock Lab server. No external packages: Node's own http/https, crypto and fs.
// The browser never receives the answer key or more than one question at a time.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const C = require('./crypto');

if (!cfg.DATA_KEY || !cfg.SESSION_SECRET || !fs.existsSync(cfg.BANK_FILE)) {
  console.error('\nNot set up yet. Run:  npm run setup\n'); process.exit(1);
}
const KEY = C.keyFromHex(cfg.DATA_KEY);

/* ---------------- encrypted storage ---------------- */
const BANK = C.readEncryptedJson(KEY, cfg.BANK_FILE); // { subjects, tests:[{id,title,kind,minutes,pricePaise,questions}], merit }
const TESTS = Object.fromEntries(BANK.tests.map(t => [t.id, t]));
const FULL_IDS = BANK.tests.filter(t => t.kind === 'full').map(t => t.id);

let db = { users: {}, emailIndex: {}, otps: {}, sessions: {}, entitlements: {}, orders: {}, attempts: {}, audit: [] };
if (fs.existsSync(cfg.DB_FILE)) db = Object.assign(db, C.readEncryptedJson(KEY, cfg.DB_FILE));
let saveTimer = null;
const saveNow = () => { clearTimeout(saveTimer); saveTimer = null; C.writeEncryptedJson(KEY, cfg.DB_FILE, JSON.parse(JSON.stringify(db, (k, v) => (k === '_sid' ? undefined : v)))); };
const save = () => { if (!saveTimer) saveTimer = setTimeout(saveNow, 150); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveNow(); process.exit(0); });
const audit = (userId, event, details) => { db.audit.push({ at: Date.now(), userId, event, details }); if (db.audit.length > 5000) db.audit.splice(0, 1000); };

/* ---------------- small helpers ---------------- */
const now = () => Date.now();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (status, message) => { throw new HttpError(status, message); };

function readBody(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(body);
}

/* ---------------- rate limiting (in memory) ---------------- */
const hits = new Map();
function limit(key, max, windowMs) {
  const t = now(), list = (hits.get(key) || []).filter(x => t - x < windowMs);
  if (list.length >= max) bad(429, 'Too many attempts. Please wait a few minutes and try again.');
  list.push(t); hits.set(key, list);
}

/* ---------------- sessions: up to MAX_DEVICES devices per account ---------------- */
const MAX_DEVICES = cfg.MAX_DEVICES;
const devicesOf = user => { if (!user.sessions) { user.sessions = user.activeSid ? [user.activeSid] : []; delete user.activeSid; } return user.sessions; };
let IS_HTTPS = false;
function sessionCookie(sid, maxAgeSec) {
  return `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${IS_HTTPS ? '; Secure' : ''}`;
}
function currentUser(req) {
  const sid = cookies(req).sid; if (!sid) return null;
  const sess = db.sessions[C.hmac(cfg.SESSION_SECRET, sid)]; if (!sess) return null;
  const user = db.users[sess.userId]; if (!user) return null;
  if (!devicesOf(user).includes(C.hmac(cfg.SESSION_SECRET, sid))) return null; // pushed out by a newer device
  user._sid = C.hmac(cfg.SESSION_SECRET, sid);
  return user;
}
function requireUser(req) { const u = currentUser(req); if (!u) bad(401, `Please sign in again. Your account can be open on ${MAX_DEVICES} devices at a time, and a newer sign-in has replaced this one.`); return u; }
const isAdmin = u => cfg.ADMIN_EMAIL && u.email === cfg.ADMIN_EMAIL;

/* ---------------- email ---------------- */
function sendLoginEmail(email, code) {
  if (!cfg.RESEND_API_KEY || !cfg.MAIL_FROM) { console.log(`\n  Login code for ${email}:  ${code}  (valid 10 minutes)\n`); return Promise.resolve(false); }
  const payload = JSON.stringify({ from: cfg.MAIL_FROM, to: [email], subject: `${code} is your ${cfg.SITE_NAME} login code`, text: `Your ${cfg.SITE_NAME} login code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this email.` });
  return new Promise((resolve, reject) => {
    const r = https.request({ hostname: 'api.resend.com', path: '/emails', method: 'POST', headers: { Authorization: `Bearer ${cfg.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, resp => { resp.resume(); resp.on('end', () => resp.statusCode < 300 ? resolve(true) : reject(new HttpError(502, 'Could not send the email. Try again shortly.'))); });
    r.on('error', () => reject(new HttpError(502, 'Could not send the email. Try again shortly.'))); r.end(payload);
  });
}

/* ---------------- entitlements and pricing ---------------- */
const owned = userId => db.entitlements[userId] || [];
function grant(userId, testIds, orderId) {
  const set = new Set(owned(userId)); testIds.forEach(t => set.add(t)); db.entitlements[userId] = [...set];
  audit(userId, 'grant', { testIds, orderId }); save();
}
function quote(userId, item) { // the price is always worked out here, never taken from the browser
  const have = owned(userId).filter(t => FULL_IDS.includes(t));
  if (item === 'pack') {
    const missing = FULL_IDS.filter(t => !have.includes(t));
    if (!missing.length) bad(400, 'You already own all the mocks.');
    return { amount: Math.max(0, cfg.PRICE_PACK_PAISE - have.length * cfg.PRICE_SINGLE_PAISE), testIds: missing, label: have.length ? 'Upgrade to all 4 mocks' : 'All 4 full mocks' };
  }
  if (!FULL_IDS.includes(item)) bad(400, 'Unknown item.');
  if (have.includes(item)) bad(400, 'You already own this mock.');
  return { amount: cfg.PRICE_SINGLE_PAISE, testIds: [item], label: TESTS[item].title };
}
function razorpay(method, apiPath, body) {
  const payload = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const r = https.request({ hostname: 'api.razorpay.com', path: apiPath, method, auth: `${cfg.RAZORPAY_KEY_ID}:${cfg.RAZORPAY_KEY_SECRET}`, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, resp => {
      const chunks = []; resp.on('data', c => chunks.push(c));
      resp.on('end', () => { try { const j = JSON.parse(Buffer.concat(chunks).toString() || '{}'); resp.statusCode < 300 ? resolve(j) : reject(new HttpError(502, 'Payment service error. No money was taken.')); } catch { reject(new HttpError(502, 'Payment service error. No money was taken.')); } });
    });
    r.on('error', () => reject(new HttpError(502, 'Could not reach the payment service.'))); r.end(payload);
  });
}
function markPaid(order, paymentId, via) { // safe to call twice: access is granted once
  if (order.status !== 'paid') { order.status = 'paid'; order.paymentId = paymentId; order.paidAt = now(); order.via = via; grant(order.userId, order.testIds, order.id); }
}

/* ---------------- attempts ---------------- */
function shuffled(n) { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = require('crypto').randomInt(i + 1);[a[i], a[j]] = [a[j], a[i]]; } return a; }
function finalize(at) {
  if (at.submittedAt) return;
  const qs = TESTS[at.testId].questions;
  at.submittedAt = Math.min(now(), at.endsAt);
  at.score = qs.reduce((s, q, i) => s + (at.ans[i] !== null && at.perm[i][at.ans[i]] === q.a ? 1 : 0), 0);
  audit(at.userId, 'submit', { attempt: at.id, score: at.score }); save();
}
function getAttempt(user, id) {
  const at = db.attempts[id];
  if (!at || at.userId !== user.id) bad(404, 'Attempt not found.');
  if (!at.submittedAt && now() >= at.endsAt) finalize(at); // time ran out
  return at;
}
setInterval(() => { for (const at of Object.values(db.attempts)) if (!at.submittedAt && now() >= at.endsAt) finalize(at); }, 60 * 1000).unref();

function testSummary(user) {
  const mine = Object.values(db.attempts).filter(a => a.userId === user.id);
  return BANK.tests.map(t => {
    const done = mine.filter(a => a.testId === t.id && a.submittedAt).sort((a, b) => b.submittedAt - a.submittedAt);
    const open = mine.find(a => a.testId === t.id && !a.submittedAt && now() < a.endsAt);
    return { id: t.id, title: t.title, kind: t.kind, minutes: t.minutes, n: t.questions.length, owned: t.kind === 'demo' || owned(user.id).includes(t.id),
      openAttempt: open ? open.id : null, last: done[0] ? { attemptId: done[0].id, score: done[0].score, n: t.questions.length, when: done[0].submittedAt } : null, attempts: done.length };
  });
}

/* ---------------- API routes ---------------- */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('POST', '/api/auth/request', async (req, res, { body, ip }) => {
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 120) bad(400, 'Enter a valid email address, like name@gmail.com.');
  limit('otp-ip:' + ip, 20, 15 * 60 * 1000); limit('otp-email:' + email, 5, 15 * 60 * 1000);
  const code = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
  db.otps[email] = { hash: C.hmac(cfg.SESSION_SECRET, email + ':' + code), exp: now() + 10 * 60 * 1000, tries: 0 }; save();
  const emailed = await sendLoginEmail(email, code);
  sendJson(res, 200, { ok: true, emailed, devCode: !emailed && cfg.DEV_MODE ? code : undefined });
});

route('POST', '/api/auth/verify', async (req, res, { body, ip }) => {
  const email = String(body.email || '').trim().toLowerCase(), code = String(body.code || '');
  limit('verify-ip:' + ip, 30, 15 * 60 * 1000);
  const otp = db.otps[email];
  if (!otp || now() > otp.exp) bad(400, 'That code has expired. Ask for a new one.');
  if (otp.tries >= 5) { delete db.otps[email]; save(); bad(400, 'Too many wrong tries. Ask for a new code.'); }
  if (!C.safeEqual(otp.hash, C.hmac(cfg.SESSION_SECRET, email + ':' + code))) { otp.tries++; save(); bad(400, 'That code is not right. Check the email and try again.'); }
  delete db.otps[email];
  let id = db.emailIndex[email];
  if (!id) { id = C.randomId(8); db.emailIndex[email] = id; db.users[id] = { id, email, name: '', createdAt: now() }; }
  const user = db.users[id];
  const list = devicesOf(user);
  while (list.length >= MAX_DEVICES) delete db.sessions[list.shift()]; // the oldest device is signed out to make room
  const sid = C.randomId(32), sidHash = C.hmac(cfg.SESSION_SECRET, sid);
  db.sessions[sidHash] = { userId: id, createdAt: now() }; list.push(sidHash);
  audit(id, 'login', { ip }); save();
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(sid, 30 * 24 * 3600) });
});

route('POST', '/api/auth/logout', async (req, res) => {
  const u = currentUser(req);
  if (u) { delete db.sessions[u._sid]; u.sessions = devicesOf(u).filter(x => x !== u._sid); save(); }
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
});

route('GET', '/api/me', async (req, res) => {
  const u = requireUser(req);
  const have = owned(u.id).filter(t => FULL_IDS.includes(t)).length;
  sendJson(res, 200, { email: u.email, name: u.name, admin: !!isAdmin(u), devices: devicesOf(u).length, maxDevices: MAX_DEVICES, site: cfg.SITE_NAME, subjects: BANK.subjects, tests: testSummary(u),
    pricing: { single: cfg.PRICE_SINGLE_PAISE, pack: cfg.PRICE_PACK_PAISE, packNow: have >= FULL_IDS.length ? 0 : Math.max(0, cfg.PRICE_PACK_PAISE - have * cfg.PRICE_SINGLE_PAISE), ownedFull: have, fullCount: FULL_IDS.length },
    payments: cfg.RAZORPAY_KEY_ID ? 'razorpay' : (cfg.DEV_MODE ? 'dev' : 'off') });
});

route('POST', '/api/profile', async (req, res, { body }) => {
  const u = requireUser(req); const name = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 40);
  if (!name) bad(400, 'Enter your name.'); u.name = name; save(); sendJson(res, 200, { ok: true });
});

route('POST', '/api/attempts', async (req, res, { body }) => {
  const u = requireUser(req), t = TESTS[body.testId];
  if (!t) bad(404, 'Test not found.');
  if (t.kind !== 'demo' && !owned(u.id).includes(t.id)) bad(403, 'Buy this mock to start it.');
  const open = Object.values(db.attempts).find(a => a.userId === u.id && a.testId === t.id && !a.submittedAt && now() < a.endsAt);
  if (open) return sendJson(res, 200, { attemptId: open.id, resumed: true });
  const n = t.questions.length, id = C.randomId(12);
  db.attempts[id] = { id, userId: u.id, testId: t.id, startedAt: now(), endsAt: now() + t.minutes * 60000, submittedAt: null, score: null, tabs: 0,
    perm: t.questions.map(q => (q.f ? shuffled(4) : [0, 1, 2, 3])), ans: Array(n).fill(null), secs: Array(n).fill(0), mark: Array(n).fill(false), seen: Array(n).fill(false) };
  audit(u.id, 'start', { attempt: id, test: t.id }); save();
  sendJson(res, 200, { attemptId: id });
});

route('GET', '/api/attempts/:id', async (req, res, { params }) => {
  const u = requireUser(req), at = getAttempt(u, params.id), t = TESTS[at.testId];
  sendJson(res, 200, { id: at.id, testId: t.id, title: t.title, minutes: t.minutes, n: t.questions.length, endsAt: at.endsAt, serverNow: now(), submitted: !!at.submittedAt,
    ans: at.ans, mark: at.mark, seen: at.seen, tabs: at.tabs, subjectOf: t.questions.map(q => q.s) });
});

route('GET', '/api/attempts/:id/q/:n', async (req, res, { params }) => { // one question, no answer
  const u = requireUser(req), at = getAttempt(u, params.id), i = Number(params.n);
  if (at.submittedAt) bad(409, 'This test has been submitted.');
  const q = TESTS[at.testId].questions[i]; if (!q) bad(404, 'No such question.');
  if (!at.seen[i]) { at.seen[i] = true; save(); }
  sendJson(res, 200, { n: i, subject: q.s, text: q.q, options: at.perm[i].map(k => q.o[k]) });
});

route('POST', '/api/attempts/:id/answer', async (req, res, { params, body }) => {
  const u = requireUser(req), at = getAttempt(u, params.id), i = Number(body.n);
  if (at.submittedAt) bad(409, 'Time is up. This test has been submitted.');
  if (!Number.isInteger(i) || i < 0 || i >= at.ans.length) bad(400, 'Bad question number.');
  if (body.chosen !== undefined) { if (body.chosen !== null && ![0, 1, 2, 3].includes(body.chosen)) bad(400, 'Bad option.'); at.ans[i] = body.chosen; }
  if (typeof body.marked === 'boolean') at.mark[i] = body.marked;
  const add = Number(body.seconds); if (add > 0) at.secs[i] = Math.min(at.secs[i] + Math.min(add, 3600), (at.endsAt - at.startedAt) / 1000);
  save(); sendJson(res, 200, { ok: true });
});

route('POST', '/api/attempts/:id/tab', async (req, res, { params }) => {
  const u = requireUser(req), at = getAttempt(u, params.id); if (!at.submittedAt) { at.tabs++; save(); } sendJson(res, 200, { tabs: at.tabs });
});

route('POST', '/api/attempts/:id/submit', async (req, res, { params }) => {
  const u = requireUser(req), at = getAttempt(u, params.id); finalize(at); sendJson(res, 200, { ok: true });
});

route('GET', '/api/attempts/:id/result', async (req, res, { params }) => { // answers are released only after submission
  const u = requireUser(req), at = getAttempt(u, params.id), t = TESTS[at.testId];
  if (!at.submittedAt) bad(409, 'Submit the test to see your result.');
  sendJson(res, 200, { id: at.id, testId: t.id, title: t.title, kind: t.kind, minutes: t.minutes, score: at.score, tabs: at.tabs, used: (at.submittedAt - at.startedAt) / 1000,
    merit: BANK.merit, rows: t.questions.map((q, i) => ({ s: q.s, q: q.q, o: at.perm[i].map(k => q.o[k]), a: at.perm[i].indexOf(q.a), ua: at.ans[i], t: at.secs[i], src: q.src, e: q.e || '' })) });
});

route('POST', '/api/checkout', async (req, res, { body }) => {
  const u = requireUser(req), q = quote(u.id, String(body.item || ''));
  const method = ['upi', 'credit', 'debit', 'netbanking', 'wallet'].includes(body.method) ? body.method : '';
  const id = C.randomId(10);
  const order = db.orders[id] = { id, userId: u.id, item: body.item, testIds: q.testIds, amount: q.amount, label: q.label, method, status: 'created', createdAt: now() };
  if (cfg.RAZORPAY_KEY_ID && cfg.RAZORPAY_KEY_SECRET) {
    const rz = await razorpay('POST', '/v1/orders', { amount: q.amount, currency: 'INR', receipt: id, notes: { orderId: id } });
    order.razorpayOrderId = rz.id; save();
    return sendJson(res, 200, { mode: 'razorpay', keyId: cfg.RAZORPAY_KEY_ID, razorpayOrderId: rz.id, amount: q.amount, label: q.label, email: u.email, name: cfg.SITE_NAME });
  }
  if (!cfg.DEV_MODE) bad(503, 'Payments are not switched on yet.');
  markPaid(order, 'dev_' + id, 'dev'); // local testing only: no money moves
  sendJson(res, 200, { mode: 'dev', amount: q.amount, label: q.label });
});

route('POST', '/api/checkout/verify', async (req, res, { body }) => {
  const u = requireUser(req);
  const order = Object.values(db.orders).find(o => o.razorpayOrderId === body.razorpay_order_id && o.userId === u.id);
  if (!order) bad(404, 'Order not found.');
  const expected = C.hmac(cfg.RAZORPAY_KEY_SECRET, `${body.razorpay_order_id}|${body.razorpay_payment_id}`);
  if (!C.safeEqual(expected, String(body.razorpay_signature || ''))) { audit(u.id, 'bad-signature', { order: order.id }); save(); bad(400, 'Payment could not be verified. If money was taken, it will be refunded or your mock will unlock shortly.'); }
  markPaid(order, body.razorpay_payment_id, 'checkout');
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/webhooks/razorpay', async (req, res, { raw }) => { // Razorpay calls this server to server
  if (!cfg.RAZORPAY_WEBHOOK_SECRET) bad(503, 'Webhook not configured.');
  if (!C.safeEqual(C.hmac(cfg.RAZORPAY_WEBHOOK_SECRET, raw.toString('utf8')), String(req.headers['x-razorpay-signature'] || ''))) bad(400, 'Bad signature.');
  const ev = JSON.parse(raw.toString('utf8')), pay = ev.payload && ev.payload.payment && ev.payload.payment.entity;
  if (pay && (ev.event === 'payment.captured' || ev.event === 'order.paid')) {
    const order = Object.values(db.orders).find(o => o.razorpayOrderId === pay.order_id);
    if (order && pay.amount === order.amount) markPaid(order, pay.id, 'webhook');
  }
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/admin/overview', async (req, res) => {
  const u = requireUser(req); if (!isAdmin(u)) bad(403, 'Admins only.');
  const users = Object.values(db.users).map(x => ({ email: x.email, name: x.name, joined: x.createdAt, owns: owned(x.id), logins: db.audit.filter(a => a.userId === x.id && a.event === 'login').length,
    attempts: Object.values(db.attempts).filter(a => a.userId === x.id && a.submittedAt).map(a => ({ test: a.testId, score: a.score, when: a.submittedAt, tabs: a.tabs })) }));
  const orders = Object.values(db.orders).filter(o => o.status === 'paid').map(o => ({ email: db.users[o.userId] && db.users[o.userId].email, label: o.label, amount: o.amount, paidAt: o.paidAt, via: o.via, method: o.method || '' }));
  sendJson(res, 200, { users, orders, revenue: orders.filter(o => o.via !== 'dev').reduce((s, o) => s + o.amount, 0), tests: BANK.tests.map(t => ({ id: t.id, title: t.title, n: t.questions.length })) });
});

route('POST', '/api/admin/grant', async (req, res, { body }) => {
  const u = requireUser(req); if (!isAdmin(u)) bad(403, 'Admins only.');
  const id = db.emailIndex[String(body.email || '').toLowerCase()]; if (!id) bad(404, 'No student with that email has signed in yet.');
  const ids = body.testId === 'pack' ? FULL_IDS : [body.testId]; if (!ids.every(t => FULL_IDS.includes(t))) bad(400, 'Unknown mock.');
  grant(id, ids, 'admin:' + u.email); sendJson(res, 200, { ok: true });
});

/* ---------------- static files and security headers ---------------- */
const PUBLIC = path.join(cfg.ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; connect-src 'self' https://*.razorpay.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (IS_HTTPS) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html'); // single-page app
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

async function handle(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, 'http://x'), ip = req.socket.remoteAddress || '';
  try {
    if (!url.pathname.startsWith('/api/')) { if (req.method !== 'GET' && req.method !== 'HEAD') bad(405, 'Method not allowed'); return serveStatic(req, res, url.pathname); }
    for (const r of routes) {
      const m = r.method === req.method && url.pathname.match(r.re); if (!m) continue;
      let raw = Buffer.alloc(0), body = {};
      if (req.method === 'POST') {
        raw = await readBody(req);
        const isWebhook = url.pathname.startsWith('/api/webhooks/');
        // Browsers cannot send this header cross-site without permission, which blocks forged requests (CSRF)
        if (!isWebhook && req.headers['x-requested-with'] !== 'pgo') bad(403, 'Forbidden');
        if (!isWebhook && raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { bad(400, 'Bad request'); } }
      }
      return await r.handler(req, res, { params: m.groups || {}, body, raw, ip });
    }
    bad(404, 'Not found');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong on our side. Please try again.' });
  }
}

/* ---------------- start ---------------- */
let server;
if (fs.existsSync(cfg.TLS_KEY) && fs.existsSync(cfg.TLS_CERT)) { IS_HTTPS = true; server = https.createServer({ key: fs.readFileSync(cfg.TLS_KEY), cert: fs.readFileSync(cfg.TLS_CERT), minVersion: 'TLSv1.2' }, handle); }
else server = http.createServer(handle);
server.listen(cfg.PORT, () => {
  console.log(`\n${cfg.SITE_NAME} is running:  ${IS_HTTPS ? 'https' : 'http'}://localhost:${cfg.PORT}`);
  console.log(`  Storage: encrypted (AES-256-GCM)   Transport: ${IS_HTTPS ? 'HTTPS (TLS)' : 'HTTP only - run "npm run setup" to create a certificate'}`);
  console.log(`  Email: ${cfg.RESEND_API_KEY ? 'Resend' : 'codes print in this window'}   Payments: ${cfg.RAZORPAY_KEY_ID ? 'Razorpay' : cfg.DEV_MODE ? 'simulated (DEV_MODE)' : 'off'}\n`);
});
