#!/bin/bash
# Double-click this file to start (or restart) PGO Mock Lab on this Mac.
# If the site is already running, it is stopped first, so you always get the latest version.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
finish() { echo ""; read -r -p "Press Return to close."; exit "$1"; }

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js is not installed on this Mac."
  echo "Install it from https://nodejs.org (the LTS button), then double-click this file again."
  open "https://nodejs.org"
  finish 1
fi
echo "Using Node $(node -v)"

if [ ! -f pgo-secrets.env ]; then
  echo "pgo-secrets.env is missing from this folder. Put your private key file here, then try again."
  finish 1
fi

PORT="$(grep -E '^PORT=' pgo-secrets.env | head -1 | cut -d= -f2 | tr -d '[:space:]')"
PORT="${PORT:-3443}"

# Stop an older copy of the site if one is still running on this port.
OLD="$(lsof -ti tcp:"$PORT" 2>/dev/null)"
if [ -n "$OLD" ]; then
  echo "Stopping the copy that was already running..."
  kill $OLD 2>/dev/null
  sleep 1
fi

# Run setup when it is needed: first run, or a new question bank waiting to be encrypted.
if [ ! -f certs/cert.pem ] || [ -f data/bank.json ] || [ ! -f data/bank.enc ]; then
  node scripts/setup.js || finish 1
fi

if [ -f certs/cert.pem ]; then URL="https://localhost:$PORT"; else URL="http://localhost:$PORT"; fi
(sleep 2; open "$URL") &
echo ""
echo "Starting the site at $URL"
echo "Keep this window open while you use it. Press Control+C to stop."
echo "After any update, just double-click this file again."
node server/index.js
echo ""
echo "The site has stopped."
finish 0
