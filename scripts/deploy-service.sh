#!/usr/bin/env bash
# Rebuild + redeploy the embed/match service to Cloud Run.
# Safe by design: project is pinned to afd-dev so this can never touch tawq.in.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Pointing gcloud at afd-dev (never tawq-in-www)"
gcloud config set project afd-dev

echo "==> Deploying afd-embed from embed_service/ ..."
cd "$HERE/../embed_service"
gcloud run deploy afd-embed \
  --source . \
  --project=afd-dev \
  --region=europe-west1 \
  --min-instances=1 --cpu=2 --memory=8Gi --timeout=300 \
  --allow-unauthenticated \
  --set-env-vars=EMBED_LAYER=12

echo "==> Done. Verify with the 'Health check the service' task."
