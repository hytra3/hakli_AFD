#!/usr/bin/env bash
# Commit all local changes and push to GitHub. GitHub Pages rebuilds the
# live site (recorder + find) automatically within ~1 minute.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."

MSG="${1:-Update AFD}"

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
