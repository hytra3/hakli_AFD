#!/usr/bin/env bash
# Deploy the function that keeps each word card's public-voice counts on the
# card (voice_counts/main.py). Safe to re-run. After the FIRST deploy, run the
# backfill once so words recorded before it get their counts:
#     node scripts/backfill-voice-counts.mjs
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

gcloud config set project afd-dev >/dev/null

# A Firestore trigger must live in the database's own location — look it up
# rather than hard-code it.
LOC="$(gcloud firestore databases describe --database='(default)' --format='value(locationId)')"
echo "==> Firestore (default) is in: $LOC"

echo "==> Deploying afd-voice-counts from voice_counts/ ..."
cd "$HERE/../voice_counts"
gcloud functions deploy afd-voice-counts \
  --gen2 --runtime=python312 \
  --project=afd-dev \
  --region=europe-west1 \
  --trigger-location="$LOC" \
  --trigger-event-filters="type=google.cloud.firestore.document.v1.written" \
  --trigger-event-filters="database=(default)" \
  --trigger-event-filters-path-pattern="document=afd_entries/{entryId}/recordings/{recordingId}" \
  --entry-point=on_recording_write --memory=256Mi \
  --retry

echo "==> Done. First time? Now run:  node scripts/backfill-voice-counts.mjs"
