#!/usr/bin/env bash
# sync-stamp.sh — make the cache-bust stamp impossible to drift.
#
# find.html is the canonical surface, so its BUILD const is the source of truth.
# This script reads that stamp and propagates it to:
#   - every  ?v=...  query on the shared files + favicon across the three pages
#   - index.html's own BUILD const (so both pages report the same stamp)
#
# Workflow stays exactly as before: bump BUILD in find.html, then publish.
# publish-site.sh calls this automatically, so you can also just bump-and-publish.
#
# Note: because ?v= tracks BUILD, every publish gives afd-core.js / afd-words.js a
# fresh URL and users re-fetch them even if unchanged. They're tiny; the trade is
# "always fresh, never stale," which is the correct trade for a community tool.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."

# --- read canonical stamp from find.html ---
STAMP="$(grep -oE 'const BUILD *= *"[^"]+"' find.html | grep -oE 'b[0-9a-z]+' | head -1)"
if [ -z "${STAMP:-}" ]; then
  echo "sync-stamp: could not read BUILD from find.html — aborting." >&2
  exit 1
fi
echo "sync-stamp: canonical stamp = $STAMP"

# --- propagate to every ?v= across the three pages ---
for f in index.html find.html dictionary.html; do
  [ -f "$f" ] || continue
  sed -i -E "s/(\?v=)b[0-9a-z]+/\1$STAMP/g" "$f"
done

# --- keep index.html's BUILD in lockstep with find.html's ---
sed -i -E "s/(const BUILD *= *\")b[0-9a-z]+(\")/\1$STAMP\2/" index.html

echo "sync-stamp: all ?v= and index BUILD set to $STAMP"
# Show the result so the publish log carries proof.
grep -nE '\?v=|const BUILD' index.html find.html dictionary.html | grep -E '\?v=|BUILD' || true
