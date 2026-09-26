#!/usr/bin/env bash
# Keep the matcher (afd-embed) warm — or let it sleep.
#
#   bash scripts/set-warm.sh status   # what is it set to right now?
#   bash scripts/set-warm.sh on       # min-instances=1: no cold start, ever (field weeks)
#   bash scripts/set-warm.sh off      # min-instances=0: free while idle (the default)
#
# Why two modes:
#   off — Cloud Run scales to zero when nobody is searching, so it costs nothing
#         idle. The first search after a quiet spell pays a cold start (container
#         boot + ~1 GB MMS model + corpus load). The finder hides most of that by
#         firing one throwaway /search the moment the page opens (index.html,
#         prewarmMatcher), so it's usually warm by the time someone speaks.
#   on  — one instance stays up around the clock. Every search is fast, including
#         the very first one in a village with a slow connection — but an always-on
#         2 CPU / 8 GiB instance is billed even when idle. Check the Billing page
#         after a day or two to see what it actually costs before leaving it on.
#
# This only flips the scaling setting on the running service — no rebuild, no
# new revision of the code, takes a few seconds. deploy-service.sh deliberately
# leaves min-instances alone, so a redeploy keeps whatever you set here.
# Pinned to afd-dev so it can never touch tawq.in.
set -euo pipefail
PROJECT=afd-dev
REGION=europe-west1
SERVICE=afd-embed

current(){
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.metadata.annotations."autoscaling.knative.dev/minScale")'
}

case "${1:-status}" in
  on)
    gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" --min-instances=1
    echo "==> afd-embed stays warm (min-instances=1). Turn off after the field session: bash scripts/set-warm.sh off"
    ;;
  off)
    gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" --min-instances=0
    echo "==> afd-embed may sleep when idle (min-instances=0). The finder's page-open warm-up covers most cold starts."
    ;;
  status)
    m="$(current)"; m="${m:-0}"
    if [ "$m" -ge 1 ] 2>/dev/null; then echo "afd-embed: WARM (min-instances=$m) — billed while idle"
    else echo "afd-embed: sleeps when idle (min-instances=0)"; fi
    ;;
  *)
    echo "usage: bash scripts/set-warm.sh [status|on|off]"; exit 2 ;;
esac
