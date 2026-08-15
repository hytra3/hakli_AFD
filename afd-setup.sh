#!/usr/bin/env bash
# One-time installer: writes the VS Code tasks, helper scripts, and
# DEPLOY.md into this AFD repo. Run it from the repo root:
#     cd ~/tawq.in/afd && bash afd-setup.sh
set -euo pipefail

if [ ! -f index.html ] || [ ! -d embed_service ]; then
  echo "!! Run this from the AFD repo root. Try:"
  echo "     cd ~/tawq.in/afd && bash afd-setup.sh"
  exit 1
fi

mkdir -p .vscode scripts

cat > ".vscode/tasks.json" <<'AFD_INSTALL_EOF_7c3f9'
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "AFD: Publish site to GitHub (recorder + find)",
      "detail": "Commit all local changes and push. Updates the live site after ~1 min.",
      "type": "shell",
      "command": "bash ${workspaceFolder}/scripts/publish-site.sh \"${input:commitMessage}\"",
      "problemMatcher": [],
      "presentation": { "reveal": "always", "panel": "shared", "clear": true }
    },
    {
      "label": "AFD: Deploy embed service (Cloud Run)",
      "detail": "Rebuild + redeploy the matcher after editing embed_service/app.py.",
      "type": "shell",
      "command": "bash ${workspaceFolder}/scripts/deploy-service.sh",
      "problemMatcher": [],
      "presentation": { "reveal": "always", "panel": "shared", "clear": true }
    },
    {
      "label": "AFD: Deploy trigger (Cloud Function)",
      "detail": "Redeploy the auto-embed trigger after editing embed_trigger/main.py.",
      "type": "shell",
      "command": "bash ${workspaceFolder}/scripts/deploy-trigger.sh",
      "problemMatcher": [],
      "presentation": { "reveal": "always", "panel": "shared", "clear": true }
    },
    {
      "label": "AFD: Health check the service",
      "detail": "Confirm the matcher is alive and see its routes + corpus size.",
      "type": "shell",
      "command": "bash ${workspaceFolder}/scripts/healthcheck.sh",
      "problemMatcher": [],
      "presentation": { "reveal": "always", "panel": "shared", "clear": true }
    },
    {
      "label": "AFD: Reindex search cache",
      "detail": "Reload the corpus into the matcher after new recordings (or wait for a cold start).",
      "type": "shell",
      "command": "bash ${workspaceFolder}/scripts/reindex.sh",
      "problemMatcher": [],
      "presentation": { "reveal": "always", "panel": "shared", "clear": true }
    }
  ],
  "inputs": [
    {
      "id": "commitMessage",
      "type": "promptString",
      "description": "What did you change? (commit message)",
      "default": "Update AFD"
    }
  ]
}
AFD_INSTALL_EOF_7c3f9

cat > "scripts/deploy-service.sh" <<'AFD_INSTALL_EOF_7c3f9'
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
AFD_INSTALL_EOF_7c3f9

cat > "scripts/deploy-trigger.sh" <<'AFD_INSTALL_EOF_7c3f9'
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
AFD_INSTALL_EOF_7c3f9

cat > "scripts/publish-site.sh" <<'AFD_INSTALL_EOF_7c3f9'
#!/usr/bin/env bash
# Commit all local changes and push to GitHub. GitHub Pages rebuilds the
# live site (recorder + find) automatically within ~1 minute.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."

MSG="${1:-Update AFD}"

if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
  echo "Nothing to publish — no changes since the last push."
  exit 0
fi

echo "==> Staging all changes"
git add -A
echo "==> Committing: $MSG"
git commit -m "$MSG"
echo "==> Pushing to GitHub"
git push origin main
echo "==> Pushed. The live site updates in about a minute."
echo "    Then hard-refresh the page:  Ctrl+Shift+R"
AFD_INSTALL_EOF_7c3f9

cat > "scripts/healthcheck.sh" <<'AFD_INSTALL_EOF_7c3f9'
#!/usr/bin/env bash
# Confirm the matcher is alive. NOTE: /healthz is a reserved path that the
# platform intercepts, so we don't use it. /docs and a POST /search are the
# honest liveness checks.
URL="https://afd-embed-454829954488.europe-west1.run.app"

echo "==> docs page (expect 200):"
curl -s -o /dev/null -w "    %{http_code}\n" "$URL/docs"

echo "==> routes the app is serving:"
curl -s "$URL/openapi.json" | grep -o '"/[a-z]*"' | sed 's/^/    /' || echo "    (could not read routes)"

echo "==> /search smoke test (expect a JSON 'could not decode audio' error = app alive):"
curl -s -X POST "$URL/search" -F "file=@/dev/null" | sed 's/^/    /'
echo
AFD_INSTALL_EOF_7c3f9

cat > "scripts/reindex.sh" <<'AFD_INSTALL_EOF_7c3f9'
#!/usr/bin/env bash
# Reload the corpus into the matcher's memory after new recordings.
# (The service also reloads on a cold start.)
URL="https://afd-embed-454829954488.europe-west1.run.app"
echo "==> Reindexing search cache ..."
curl -s -X POST "$URL/reindex"; echo
AFD_INSTALL_EOF_7c3f9

cat > "DEPLOY.md" <<'AFD_INSTALL_EOF_7c3f9'
# Audio First Dictionary — how to run it

Open this folder in VS Code. Everything is a **Task**, so you never have to
remember commands:

> **Terminal → Run Task…**  (or `Ctrl+Shift+P` → "Run Task")

Then pick one:

| Task | When to use it |
|------|----------------|
| **AFD: Publish site to GitHub** | After editing `find.html` or `index.html`. Commits + pushes; the live site updates in ~1 min. It asks for a short "what changed" message. |
| **AFD: Deploy embed service** | After editing `embed_service/app.py`. Rebuilds the matcher on Cloud Run (slow — bakes in the model). |
| **AFD: Deploy trigger** | After editing `embed_trigger/main.py`. Redeploys the auto-embed function. |
| **AFD: Health check the service** | Any time, to confirm the matcher is alive. |
| **AFD: Reindex search cache** | After new recordings, if search doesn't find them yet. |

After publishing, **hard-refresh** the page in the browser: `Ctrl+Shift+R`
(the plain refresh keeps the old cached copy).

---

## The pieces, and where they live

- **Recorder** (`index.html`) and **Speak-to-find** (`find.html`) — served by
  GitHub Pages at `hytra3.github.io/hakli_AFD/` and `/find`. Updated by the
  **Publish** task.
- **Embed/match service** (`embed_service/`) — the matcher, on Cloud Run.
  Updated by the **Deploy embed service** task.
- **Auto-embed trigger** (`embed_trigger/`) — a Cloud Function that vectorises
  every new recording. Updated by the **Deploy trigger** task.

## Key facts (baked into the scripts — you don't need to type these)

- Google project: **afd-dev** (every deploy pins this, so it can never touch tawq.in)
- Service region: **europe-west1**  ·  Storage bucket: **afd-dev.firebasestorage.app** (US-EAST1)
- Service URL: `https://afd-embed-454829954488.europe-west1.run.app`
- Model: MMS-300m, layer 12, mean-pooled, L2-normalised

## One gotcha worth remembering

`/healthz` returns a 404 even though the service is fine — that path is reserved
by the platform and never reaches the app. The real liveness checks are `/docs`
(returns 200) and `POST /search` (returns a JSON error for bad audio). The
Health-check task uses those, not `/healthz`.

---

## Open notes (things to pick up next)

1. **One query returns two utterances.** Playback plays both reps of the
   "say it twice" protocol. Decide whether the find screen should trim to a
   single clean token for listeners while keeping both in the archive.

2. **Silhouette barely visible.** Two issues under one word: (a) on *find*, the
   stacked voice-count strips are too faint to read; (b) on the *recorder*, the
   live waveform in the silhouette well doesn't animate while recording — likely
   the meter isn't wired to the canvas. The recorder one is probably a real bug.

3. **Row avatar is the English first letter, not a personal profile.** The
   *square* row tiles are word-entry thumbnails (falling back to the gloss's
   first letter — no picture yet). The *round fauna* token in the lead card is
   the speaker identity, derived automatically from speaker ID (pseudonymous by
   design, nothing to choose). Decide whether to add an optional speaker-chosen
   profile, or keep the frictionless auto one.

4. **Calibrate the confidence thresholds** (`AUTOPLAY_MAX`, `MAYBE_MAX` in
   `find.html`) once there's real cross-speaker data. Tip: tap the "Hakli"
   wordmark three times to reveal the raw distance readout for tuning.

5. **Build the merge/editor surface** for duplicates — once the corpus is dense
   enough that words start colliding.

6. **Seed vocabulary from the legacy corpus** (private reference only).
AFD_INSTALL_EOF_7c3f9

chmod +x scripts/*.sh
echo ""
echo "Installed. Open this folder in VS Code, then:"
echo "   Terminal -> Run Task...  ->  pick an AFD task"
echo ""
echo "Tip: commit these so they are saved -> run the \"AFD: Publish site\" task,"
echo "     or: git add -A && git commit -m \"Add VS Code tasks\" && git push"
