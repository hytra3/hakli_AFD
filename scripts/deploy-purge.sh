#!/usr/bin/env bash
# Redeploy afd-purge: the daily sweep that deletes erased voices, then
# contributed words left with no voices, and their photos (see purge/main.py).
#
# No --set-env-vars on purpose: a redeploy keeps the function's current
# settings, so it can't silently flip PURGE_DRY_RUN (log-only vs. really
# delete). The settings are printed at the end so you can see which it is.
# To change one:  add  --update-env-vars=PURGE_DRY_RUN=0  (or =1) below, once.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Pointing gcloud at afd-dev"
gcloud config set project afd-dev

echo "==> Deploying afd-purge from purge/ ..."
cd "$HERE/../purge"
gcloud functions deploy afd-purge \
  --gen2 --runtime=python312 \
  --project=afd-dev \
  --region=europe-west1 \
  --trigger-topic=afd-purge-tick \
  --entry-point=purge --memory=256Mi

echo "==> Current settings (PURGE_DRY_RUN 0 = really deletes, 1 = only logs):"
gcloud functions describe afd-purge --project=afd-dev --region=europe-west1 \
  --format="value(serviceConfig.environmentVariables)"
echo "==> Done. It runs nightly at 03:00; to run it now:"
echo "    gcloud pubsub topics publish afd-purge-tick --message=run --project=afd-dev"
