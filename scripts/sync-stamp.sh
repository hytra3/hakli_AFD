#!/usr/bin/env bash
# sync-stamp.sh — generate a fresh cache-bust stamp each publish, then propagate
# it so it can never drift or go stale.
#
# The stamp is  b<MMDD><serial>  (e.g. b0910a). Each run:
#   - if index.html's current stamp is already today's, the serial is bumped
#     (a->b->...); otherwise it resets to 'a' for the new day;
#   - the new stamp is written to index.html's BUILD const (the canonical
#     surface) and recorder.html's BUILD, and to every ?v=... query on the
#     shared files + favicon across the pages.
#
# Override: AFD_STAMP=bXXXX forces a specific stamp (skips the auto-bump).
#
# publish-site.sh calls this automatically, so every publish busts cache without
# anyone remembering to hand-bump a version.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."

CUR="$(grep -oE 'const BUILD *= *"[^"]+"' index.html | grep -oE 'b[0-9a-z]+' | head -1 || true)"
TODAY="b$(date +%m%d)"

if [ -n "${AFD_STAMP:-}" ]; then
  STAMP="$AFD_STAMP"                                        # explicit override
elif [ "${CUR:0:5}" = "$TODAY" ]; then
  SUF="${CUR#$TODAY}"                                       # today's serial, e.g. "a"
  if printf '%s' "$SUF" | grep -qE '^[a-y]$'; then
    STAMP="$TODAY$(printf '%s' "$SUF" | tr 'a-y' 'b-z')"    # a->b ... y->z
  else
    STAMP="${TODAY}${SUF}a"                                 # z or unexpected -> stay unique
  fi
else
  STAMP="${TODAY}a"                                         # first publish of the day
fi
echo "sync-stamp: stamp = $STAMP  (was ${CUR:-none})"

# --- write the canonical BUILD in index.html, and recorder.html's in lockstep ---
sed -i -E "s/(const BUILD *= *\")b[0-9a-z]+(\")/\1$STAMP\2/" index.html
sed -i -E "s/(const BUILD *= *\")b[0-9a-z]+(\")/\1$STAMP\2/" recorder.html

# --- propagate to every ?v= across the pages ---
for f in recorder.html index.html dictionary.html; do
  [ -f "$f" ] || continue
  sed -i -E "s/(\?v=)b[0-9a-z]+/\1$STAMP/g" "$f"
done

echo "sync-stamp: all ?v= and BUILD set to $STAMP"
grep -nE '\?v=|const BUILD' recorder.html index.html dictionary.html | grep -E '\?v=|BUILD' || true
