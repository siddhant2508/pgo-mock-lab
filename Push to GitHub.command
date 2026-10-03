#!/bin/bash
# Double-click this file to send the website to your GitHub repository.
# The first time, it asks for the repository address. After that, it just uploads your latest changes.
cd "$(dirname "$0")" || exit 1
finish() { echo ""; read -r -p "Press Return to close."; exit "$1"; }

if ! command -v git >/dev/null 2>&1; then
  echo "Git is not installed. A window will offer to install Apple's developer tools; accept it, then double-click this file again."
  xcode-select --install 2>/dev/null
  finish 1
fi

# Safety check: the private key file must never be uploaded.
if git ls-files --error-unmatch pgo-secrets.env >/dev/null 2>&1; then
  echo "STOP: pgo-secrets.env is being tracked by Git. Nothing was uploaded. Ask Claude to fix this."
  finish 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Paste your GitHub repository address and press Return."
  echo "It looks like:  https://github.com/YOUR-USERNAME/pgo-mock-lab.git"
  read -r -p "> " URL
  URL="$(echo "$URL" | tr -d '[:space:]')"
  case "$URL" in
    https://github.com/*/*) ;;
    *) echo "That does not look like a GitHub address. Nothing was changed."; finish 1 ;;
  esac
  case "$URL" in *.git) ;; *) URL="$URL.git" ;; esac
  git remote add origin "$URL" || finish 1
  echo "Linked this folder to $URL"
fi

git config user.name  >/dev/null 2>&1 || git config user.name "PGO Mock Lab"
git config user.email >/dev/null 2>&1 || git config user.email "noreply@pgomocklab.in"

git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "Update website $(date '+%Y-%m-%d %H:%M')" && echo "Saved your latest changes."
else
  echo "No new changes to save."
fi

echo "Uploading to $(git remote get-url origin) ..."
echo "(The first time, GitHub asks you to sign in. Use the account that owns the repository.)"
if git push -u origin main; then
  echo ""
  echo "Done. Your website code is on GitHub."
  finish 0
else
  echo ""
  echo "The upload did not go through. Common reasons:"
  echo " - The repository does not exist yet, or the address is wrong."
  echo "   To change the address: delete the link with   git remote remove origin   then run this file again."
  echo " - You signed in with a different GitHub account than the one that owns the repository."
  echo " - The repository was created with a README. Create it empty, or tell Claude."
  finish 1
fi
