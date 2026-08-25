#!/usr/bin/env bash
# Commit all local changes and push to GitHub. GitHub Pages rebuilds the
# live site (recorder + find) automatically within ~1 minute.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."

MSG="${1:-Update AFD}"

# Sync the cache-bust stamp (?v=) to the canonical BUILD so the shared files can
# never be served stale, and so index/find never disagree. Safe to run every time.
echo "==> Syncing cache-bust stamp"
bash "$HERE/sync-stamp.sh"

if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
  echo "Nothing to publish — no changes since the last push."
  exit 0
fi

echo "==> Staging all changes"
git add -A
echo "==> Committing: $MSG"
git commit -m "$MSG"
echo "==> Pushing to GitHub"
git push origin main
echo "==> Pushed. The live site updates in about a minute."
echo "    Then hard-refresh the page:  Ctrl+Shift+R"
