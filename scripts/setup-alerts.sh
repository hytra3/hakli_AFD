#!/usr/bin/env bash
# One-time (safe to re-run) Cloud Monitoring alerts for hakli.app. These are
# Google Cloud's own checks: no code in the app, nothing for speakers to load.
# Each emails ALERT_EMAIL.
#
#   1. The watcher fails     — afd-watch logged AFD_WATCH_FAILED (it crashed,
#                              or couldn't send mail). So the watcher is watched.
#   2. The matcher errors    — afd-embed (Cloud Run) answered 5+ requests with a
#                              5xx in 10 minutes. Doesn't wake it: it reads the
#                              request counts Cloud Run already keeps. (No uptime
#                              ping on the matcher on purpose: a ping every few
#                              minutes would keep an 8 GiB service awake, and a
#                              60–80 s cold start would fail it anyway.)
#   3. The site is down      — an uptime check on https://hakli.app every 15 min
#                              (GitHub Pages; costs nothing to ping).
#   4. A billing budget      — emails at 50%, 90% and 100% of BUDGET_USD a month.
#                              Needs the billing account id (gcloud billing accounts list).
#
#   ALERT_EMAIL=marty@heaton.biz BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX bash scripts/setup-alerts.sh
#   (BUDGET_USD defaults to 50; leave BILLING_ACCOUNT out to skip the budget.)
set -euo pipefail
P=afd-dev
EMAIL="${ALERT_EMAIL:?set ALERT_EMAIL=you@example.com}"
BUDGET="${BUDGET_USD:-50}"
gcloud config set project "$P" >/dev/null
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "==> Email channel for $EMAIL"
CH="$(gcloud beta monitoring channels list --project="$P" \
        --filter="type=\"email\" AND labels.email_address=\"$EMAIL\"" --format='value(name)' | head -1)"
if [[ -z "$CH" ]]; then
  CH="$(gcloud beta monitoring channels create --project="$P" --type=email \
          --display-name="hakli.app alerts ($EMAIL)" --channel-labels="email_address=$EMAIL" \
          --format='value(name)')"
fi
echo "    $CH"

have_policy(){ gcloud alpha monitoring policies list --project="$P" --filter="displayName=\"$1\"" --format='value(name)' | grep -q .; }
make_policy(){   # display name, json file
  if have_policy "$1"; then echo "    exists: $1"; else
    gcloud alpha monitoring policies create --project="$P" --policy-from-file="$2" >/dev/null; echo "    made:   $1"; fi
}

echo "==> Alert policies"
cat > "$TMP/watch.json" <<JSON
{ "displayName": "AFD watch failed",
  "documentation": { "content": "afd-watch (watch/main.py) logged AFD_WATCH_FAILED — it crashed or could not send mail. Logs: gcloud functions logs read afd-watch --region=europe-west1 --project=afd-dev --limit=30", "mimeType": "text/markdown" },
  "combiner": "OR",
  "conditions": [{ "displayName": "AFD_WATCH_FAILED in the logs",
    "conditionMatchedLog": { "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"afd-watch\" AND (jsonPayload.message:\"AFD_WATCH_FAILED\" OR textPayload:\"AFD_WATCH_FAILED\")" } }],
  "alertStrategy": { "notificationRateLimit": { "period": "3600s" }, "autoClose": "86400s" },
  "notificationChannels": ["$CH"] }
JSON
make_policy "AFD watch failed" "$TMP/watch.json"

cat > "$TMP/matcher.json" <<JSON
{ "displayName": "AFD matcher 5xx",
  "documentation": { "content": "afd-embed answered 5+ requests with a server error in 10 minutes. Check: bash scripts/healthcheck.sh", "mimeType": "text/markdown" },
  "combiner": "OR",
  "conditions": [{ "displayName": "afd-embed 5xx > 5 in 10 min",
    "conditionThreshold": {
      "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"afd-embed\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\"",
      "aggregations": [{ "alignmentPeriod": "600s", "perSeriesAligner": "ALIGN_SUM", "crossSeriesReducer": "REDUCE_SUM" }],
      "comparison": "COMPARISON_GT", "thresholdValue": 5, "duration": "0s" } }],
  "alertStrategy": { "autoClose": "86400s" },
  "notificationChannels": ["$CH"] }
JSON
make_policy "AFD matcher 5xx" "$TMP/matcher.json"

echo "==> Uptime check on https://hakli.app"
UP="$(gcloud monitoring uptime list-configs --project="$P" --filter='displayName="hakli.app"' --format='value(name)' | head -1)"
if [[ -z "$UP" ]]; then
  gcloud monitoring uptime create "hakli.app" --project="$P" \
    --resource-type=uptime-url --resource-labels=host=hakli.app,project_id="$P" \
    --protocol=https --path=/ --period=15 --timeout=10 >/dev/null
  UP="$(gcloud monitoring uptime list-configs --project="$P" --filter='displayName="hakli.app"' --format='value(name)' | head -1)"
fi
UPID="${UP##*/}"
cat > "$TMP/site.json" <<JSON
{ "displayName": "AFD site down",
  "documentation": { "content": "https://hakli.app failed its uptime check from 2+ places. GitHub Pages, or DNS at Porkbun.", "mimeType": "text/markdown" },
  "combiner": "OR",
  "conditions": [{ "displayName": "hakli.app uptime",
    "conditionThreshold": {
      "filter": "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"$UPID\"",
      "aggregations": [{ "alignmentPeriod": "1200s", "perSeriesAligner": "ALIGN_NEXT_OLDER", "crossSeriesReducer": "REDUCE_COUNT_FALSE", "groupByFields": ["resource.label.*"] }],
      "comparison": "COMPARISON_GT", "thresholdValue": 1, "duration": "0s" } }],
  "alertStrategy": { "autoClose": "86400s" },
  "notificationChannels": ["$CH"] }
JSON
make_policy "AFD site down" "$TMP/site.json"

if [[ -n "${BILLING_ACCOUNT:-}" ]]; then
  echo "==> Budget: \$$BUDGET a month on $P"
  if gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" --format='value(displayName)' | grep -qx "afd-dev monthly"; then
    echo "    exists: afd-dev monthly"
  else
    gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
      --display-name="afd-dev monthly" --budget-amount="${BUDGET}USD" \
      --filter-projects="projects/$P" \
      --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
      --notifications-rule-monitoring-notification-channels="$CH" >/dev/null
    echo "    made:   afd-dev monthly"
  fi
else
  echo "==> Budget skipped (no BILLING_ACCOUNT). gcloud billing accounts list  shows it."
fi
echo "==> Done."
