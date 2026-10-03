# PGO Mock Lab

Occupational Therapy MCQ for CET practice: email-code login, a free 15-question demo, ten 100-question mocks, server-timed tests, subject-wise scorecards and Razorpay payments.

No packages to install. It needs only [Node.js](https://nodejs.org) 18 or newer.

## Run it on your computer

1. Put your private settings file `pgo-secrets.env` in this folder (next to `package.json`). It holds the key that unlocks the encrypted question bank. It is **not** in the repository on purpose.
2. In a terminal, in this folder:

   ```
   npm run setup     # one time: checks the key, creates a local HTTPS certificate
   npm start         # starts the site
   ```
3. Open **https://localhost:3443**. The browser warns once because the certificate is self-signed: choose Advanced, then Proceed.

In local test mode (`DEV_MODE=1`) the login code is shown on screen and payments are simulated, so you can try everything without email or Razorpay accounts.

To check everything works, keep the site running and run `npm test` in a second terminal.

## What is encrypted

| Where | How |
| --- | --- |
| Browser to server | HTTPS (TLS 1.2+) |
| Question bank and answer key (`data/bank.enc`) | AES-256-GCM |
| Students, purchases, attempts, results (`data/db.enc`) | AES-256-GCM |
| Login codes and session ids | Stored only as keyed hashes |
| Card and UPI details | Never reach this server; Razorpay handles them |

The encryption key (`DATA_KEY`) lives only in `pgo-secrets.env`. **Back that file up.** Without it the data cannot be read by anyone, including you. If the key may have been seen by someone else, stop the site and run `npm run rotate-key`.

This is encryption in transit and at rest. The server itself must read answers to mark them, so it is not "end to end" in the messaging-app sense.

## Settings (`pgo-secrets.env`)

| Setting | Meaning |
| --- | --- |
| `ADMIN_EMAIL` | Signing in with this email shows the Admin page (students, orders, give access) |
| `DEV_MODE` | `1` for local testing. Set `0` before the public can reach the site |
| `RESEND_API_KEY`, `MAIL_FROM` | Email the login codes through resend.com. Empty: codes print in the terminal |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Real payments. Webhook URL: `https://your-domain/api/webhooks/razorpay`, events `payment.captured` and `order.paid` |
| `PRICE_SINGLE_PAISE`, `PRICE_PACK_PAISE` | Prices in paise. Defaults: 49900 (Rs 499) and 349900 (Rs 3,499 for all 10). Upgrades cost the pack price minus singles already bought |
| `MAX_DEVICES` | How many devices one account can be signed in on at once. Default 2 |
| `PORT` | Default 3443 |

## How it protects the tests

- The browser gets one question at a time and never the answer key; answers are released only after submission.
- The server keeps the clock, saves every answer as it is chosen and does the scoring. An abandoned test is submitted when its time runs out.
- Two devices per account (`MAX_DEVICES`, default 2): signing in on a third signs out the oldest.
- Each student's option order is shuffled; every test and review screen carries a name-and-email watermark; copy, right-click and print shortcuts are blocked.
- Prices are computed on the server; a mock unlocks only after Razorpay's signature is verified (checkout or webhook).

## Folders

```
server/     index.js (routes), crypto.js (AES-GCM), config.js (settings)
public/     index.html, app.js, styles.css (what the browser loads)
scripts/    setup.js, selftest.js, rotate-key.js
data/       bank.enc (in the repo, encrypted) and db.enc (created when the site runs, not in the repo)
certs/      local HTTPS certificate (not in the repo)
```

## Updating the question bank

Put a new `bank.json` (same shape: `subjects`, `tests`, `merit`) in `data/` and run `npm run setup`. It is encrypted to `bank.enc` and the readable copy is deleted.

## Going online later

Run the same code on any Node host (a small VPS, Render, Railway, Fly). Put it behind the host's HTTPS, set `DEV_MODE=0`, add the Resend and Razorpay keys, and keep `data/` on a persistent disk with backups. This file-based storage suits one server and a few thousand students; move to a hosted database if you outgrow that.
