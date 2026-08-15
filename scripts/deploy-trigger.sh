#!/usr/bin/env bash
# Redeploy the storage-finalize trigger that auto-embeds new recordings.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Pointing gcloud at afd-dev"
gcloud config set project afd-dev

echo "==> Deploying afd-embed-trigger from embed_trigger/ ..."
cd "$HERE/../embed_trigger"
gcloud functions deploy afd-embed-trigger \
  --gen2 --runtime=python312 \
  --project=afd-dev \
  --region=europe-west1 \
  --trigger-event-filters="type=google.cloud.storage.object.v1.finalized" \
  --trigger-event-filters="bucket=afd-dev.firebasestorage.app" \
  --trigger-location=us-east1 \
  --set-env-vars=EMBED_URL=https://afd-embed-454829954488.europe-west1.run.app/embed \
  --entry-point=on_finalize --memory=256Mi

echo "==> Done."
