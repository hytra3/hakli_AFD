#!/usr/bin/env bash
# Deploy afd-revoke: rotates a take's download token the moment it stops being
# public, so links handed out earlier stop working (see revoke/main.py).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Pointing gcloud at afd-dev"
gcloud config set project afd-dev

# A Firestore trigger must live in the database's own location.
FS_LOCATION="$(gcloud firestore databases describe --database='(default)' --format='value(locationId)')"
echo "==> Firestore location: $FS_LOCATION"

echo "==> Deploying afd-revoke from revoke/ ..."
cd "$HERE/../revoke"
gcloud functions deploy afd-revoke \
  --gen2 --runtime=python312 \
  --project=afd-dev \
  --region=europe-west1 \
  --trigger-location="$FS_LOCATION" \
  --trigger-event-filters="type=google.cloud.firestore.document.v1.written" \
  --trigger-event-filters="database=(default)" \
  --trigger-event-filters-path-pattern="document=afd_entries/{entryId}/recordings/{recordingId}" \
  --set-env-vars=STORAGE_BUCKET=afd-dev.firebasestorage.app \
  --entry-point=revoke --memory=256Mi

echo "==> Done."
