#!/usr/bin/env bash
# Deploy afd-watch (watch/main.py): the 30-minute watchdog, the morning digest
# and the public counter on Help. Safe to re-run: it only creates what's missing
# and keeps the function's mail settings.
#
# FIRST TIME — mail. Alerts and the digest are sent by SMTP. With a Gmail
# account: turn on 2-step verification, make an app password
# (myaccount.google.com/apppasswords), then:
#     printf '%s' 'the-16-letter-app-password' | \
#       gcloud secrets create afd-mail-password --data-file=- --project=afd-dev
#     MAIL_USER=you@gmail.com MAIL_TO=marty@heaton.biz bash scripts/deploy-watch.sh
# Later runs need no variables (the settings stay). To change one, pass it again.
# Without the secret it still deploys and logs what it would have mailed.
#
# Also run once: bash scripts/setup-alerts.sh  (Cloud Monitoring: the watcher
# itself failing, matcher errors, a billing budget).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
P=afd-dev
R=europe-west1
TOPIC=afd-watch-tick

gcloud config set project "$P" >/dev/null

echo "==> Pub/Sub topic $TOPIC"
gcloud pubsub topics describe "$TOPIC" --project="$P" >/dev/null 2>&1 \
  || gcloud pubsub topics create "$TOPIC" --project="$P"

echo "==> Usage counts expire after 90 days (Firestore TTL on afd_events.expireAt)"
gcloud firestore fields ttls update expireAt --collection-group=afd_events --enable-ttl \
  --project="$P" --quiet >/dev/null 2>&1 || echo "    (TTL already on, or still being set up — check: gcloud firestore fields ttls list)"

ENV_FLAGS=()
if [[ -n "${MAIL_USER:-}" || -n "${MAIL_TO:-}" ]]; then
  ENV_FLAGS+=(--update-env-vars="MAIL_USER=${MAIL_USER:-},MAIL_TO=${MAIL_TO:-}")
fi
SECRET_FLAGS=()
if gcloud secrets describe afd-mail-password --project="$P" >/dev/null 2>&1; then
  NUM="$(gcloud projects describe "$P" --format='value(projectNumber)')"
  gcloud secrets add-iam-policy-binding afd-mail-password --project="$P" \
    --member="serviceAccount:${NUM}-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor >/dev/null
  SECRET_FLAGS+=(--set-secrets=MAIL_PASSWORD=afd-mail-password:latest)
else
  echo "    No afd-mail-password secret yet: alerts and digests will only be logged."
fi

echo "==> Deploying afd-watch from watch/ ..."
cd "$HERE/../watch"
gcloud functions deploy afd-watch \
  --gen2 --runtime=python312 \
  --project="$P" --region="$R" \
  --trigger-topic="$TOPIC" \
  --entry-point=watch --memory=256Mi --timeout=300s \
  ${ENV_FLAGS[@]+"${ENV_FLAGS[@]}"} ${SECRET_FLAGS[@]+"${SECRET_FLAGS[@]}"}

job(){   # name schedule message
  if gcloud scheduler jobs describe "$1" --location="$R" --project="$P" >/dev/null 2>&1; then
    gcloud scheduler jobs update pubsub "$1" --location="$R" --project="$P" \
      --schedule="$2" --time-zone="America/Denver" --topic="$TOPIC" --message-body="$3" >/dev/null
  else
    gcloud scheduler jobs create pubsub "$1" --location="$R" --project="$P" \
      --schedule="$2" --time-zone="America/Denver" --topic="$TOPIC" --message-body="$3" >/dev/null
  fi
  echo "    $1: $2 (Utah time) → $3"
}
echo "==> Schedules"
job afd-watch-check  "*/30 * * * *" check
job afd-watch-digest "0 7 * * *"    digest

echo "==> Settings now:"
gcloud functions describe afd-watch --project="$P" --region="$R" \
  --format="value(serviceConfig.environmentVariables,serviceConfig.secretEnvironmentVariables)"
echo "==> Done. Fill the Help counter and send a digest now:"
echo "    gcloud pubsub topics publish $TOPIC --message=public --project=$P"
echo "    gcloud pubsub topics publish $TOPIC --message=digest --project=$P"
