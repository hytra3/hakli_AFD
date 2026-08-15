#!/usr/bin/env bash
# Confirm the matcher is alive. NOTE: /healthz is a reserved path that the
# platform intercepts, so we don't use it. /docs and a POST /search are the
# honest liveness checks.
URL="https://afd-embed-454829954488.europe-west1.run.app"

echo "==> docs page (expect 200):"
curl -s -o /dev/null -w "    %{http_code}\n" "$URL/docs"

echo "==> routes the app is serving:"
curl -s "$URL/openapi.json" | grep -o '"/[a-z]*"' | sed 's/^/    /' || echo "    (could not read routes)"

echo "==> /search smoke test (expect a JSON 'could not decode audio' error = app alive):"
curl -s -X POST "$URL/search" -F "file=@/dev/null" | sed 's/^/    /'
echo
