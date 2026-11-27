#!/usr/bin/env bash
# Deploy the steward "warm the matcher" feature:
#   * afd-warm            HTTP function the steward page (warm.html) calls
#   * afd-warm-reconcile  scheduled sweep that cools afd-embed back down
#
# Both live in warm/ (one folder, two entry points — like purge/). Pinned to
# afd-dev so this can never touch tawq.in.
#
# Run the one-time IAM + schedule setup once with:   bash scripts/deploy-warm.sh --setup
# Routine redeploys of just the code:                bash scripts/deploy-warm.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT=afd-dev
REGION=europe-west1
SERVICE=afd-embed                 # the Cloud Run service being warmed
TOPIC=afd-warm-tick
# gen2 functions run as the project default compute SA unless told otherwise.
SA="454829954488-compute@developer.gserviceaccount.com"
ALLOW_ORIGIN="https://hakli.app"

echo "==> Pointing gcloud at $PROJECT"
gcloud config set project "$PROJECT"

if [ "${1:-}" = "--setup" ]; then
  echo "==> One-time IAM so afd-warm can change afd-embed's min-instances"
  # Read + update ONLY afd-embed (scoped to the service, not the whole project).
  gcloud run services add-iam-policy-binding "$SERVICE" \
    --project="$PROJECT" --region="$REGION" \
    --member="serviceAccount:$SA" --role="roles/run.admin"
  # Updating a Run service that deploys-as a SA needs actAs on that SA. afd-embed
  # runs as the default compute SA, which is also what afd-warm runs as — so the
  # SA needs serviceAccountUser on itself.
  gcloud iam service-accounts add-iam-policy-binding "$SA" \
    --project="$PROJECT" \
    --member="serviceAccount:$SA" --role="roles/iam.serviceAccountUser"
  # (Firestore read/write comes with the default compute SA's Editor role. If
  #  that has been removed, also grant: roles/datastore.user.)

  echo "==> Pub/Sub topic + Scheduler tick (every 10 min) for the cool-down sweep"
  gcloud pubsub topics create "$TOPIC" 2>/dev/null || echo "   topic $TOPIC already exists"
  gcloud scheduler jobs create pubsub afd-warm-reconcile-tick \
    --project="$PROJECT" --location="$REGION" \
    --schedule="*/10 * * * *" --topic="$TOPIC" --message-body="tick" \
    2>/dev/null || echo "   scheduler job already exists"
fi

echo "==> Deploying afd-warm (HTTP) from warm/ ..."
cd "$HERE/../warm"
gcloud functions deploy afd-warm \
  --gen2 --runtime=python312 \
  --project="$PROJECT" --region="$REGION" \
  --trigger-http --allow-unauthenticated \
  --entry-point=warm --memory=256Mi --timeout=240s \
  --set-env-vars="WARM_PROJECT=$PROJECT,WARM_REGION=$REGION,WARM_SERVICE=$SERVICE,WARM_ALLOW_ORIGIN=$ALLOW_ORIGIN,WARM_MAX_MINUTES=240,WARM_ADMIN_COLLECTION=afd_admins"
# --allow-unauthenticated is safe here: the function itself refuses anyone who
# doesn't present a steward's Firebase ID token (afd_admins/{uid}).

echo "==> Deploying afd-warm-reconcile (Pub/Sub) from warm/ ..."
gcloud functions deploy afd-warm-reconcile \
  --gen2 --runtime=python312 \
  --project="$PROJECT" --region="$REGION" \
  --trigger-topic="$TOPIC" \
  --entry-point=reconcile --memory=256Mi --timeout=240s \
  --set-env-vars="WARM_PROJECT=$PROJECT,WARM_REGION=$REGION,WARM_SERVICE=$SERVICE"

echo "==> Done. Function URL:"
gcloud functions describe afd-warm --gen2 --region="$REGION" --format='value(serviceConfig.uri)'
echo "   (afd-instance.js warmUrl uses the cloudfunctions.net alias, which also works.)"
echo "==> Verify: open warm.html signed in as a steward, tap 30 min, then check 'set-warm.sh status'."
