#!/usr/bin/env bash
# Rebuild + redeploy the embed/match service to Cloud Run.
# Safe by design: project is pinned to afd-dev so this can never touch tawq.in.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Pointing gcloud at afd-dev (never tawq-in-www)"
gcloud config set project afd-dev

echo "==> Deploying afd-embed from embed_service/ ..."
# min-instances is NOT set here on purpose: a redeploy keeps whatever
# scripts/set-warm.sh last chose (on = always warm, off = sleeps when idle).
cd "$HERE/../embed_service"
gcloud run deploy afd-embed \
  --source . \
  --project=afd-dev \
  --region=europe-west1 \
  --cpu=2 --memory=8Gi --timeout=300 \
  --allow-unauthenticated \
  --update-env-vars=EMBED_LAYER=12,EMBED_AUDIENCE=https://afd-embed-454829954488.europe-west1.run.app,EMBED_CALLERS=454829954488-compute@developer.gserviceaccount.com
# --update-env-vars (not --set-env-vars) keeps ADMIN_TOKEN, which only
# `bash scripts/reindex.sh --setup` sets. EMBED_CALLERS is the account the embed
# trigger runs as (the project's default compute account); /embed refuses
# everyone else. /search stays public — the browser calls it.

echo "==> Done. Verify with the 'Health check the service' task."
