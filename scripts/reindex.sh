#!/usr/bin/env bash
# Reload the corpus into the matcher's memory right now.
# (Rarely needed: the service also reloads on a cold start, and by itself every
# few minutes — CORPUS_MAX_AGE_S.)
#
#   bash scripts/reindex.sh           # reindex (needs ADMIN_TOKEN on the service)
#   bash scripts/reindex.sh --setup   # one-time: give the service a random ADMIN_TOKEN
#
# /reindex is refused unless the request carries the service's ADMIN_TOKEN. This
# script reads it from the service's own config, so it never lives in git.
set -euo pipefail
PROJECT=afd-dev
REGION=europe-west1
SERVICE=afd-embed
URL="https://afd-embed-454829954488.europe-west1.run.app"

if [ "${1:-}" = "--setup" ]; then
  echo "==> Setting a new random ADMIN_TOKEN on $SERVICE (creates a new revision) ..."
  gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --update-env-vars="ADMIN_TOKEN=$(openssl rand -hex 24)"
  echo "==> Done. Now: bash scripts/reindex.sh"
  exit 0
fi

TOKEN="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json \
  | python3 -c 'import json,sys; env=json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0].get("env",[]); print(next((e.get("value","") for e in env if e.get("name")=="ADMIN_TOKEN"),""))')"
if [ -z "$TOKEN" ]; then
  echo "No ADMIN_TOKEN on $SERVICE yet — run once: bash scripts/reindex.sh --setup"
  exit 1
fi

echo "==> Reindexing search cache ..."
curl -s -X POST "$URL/reindex" -H "X-Admin-Token: $TOKEN"; echo
