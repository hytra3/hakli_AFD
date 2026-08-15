#!/usr/bin/env bash
# Reload the corpus into the matcher's memory after new recordings.
# (The service also reloads on a cold start.)
URL="https://afd-embed-454829954488.europe-west1.run.app"
echo "==> Reindexing search cache ..."
curl -s -X POST "$URL/reindex"; echo
