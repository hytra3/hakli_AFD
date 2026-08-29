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

## Making a backup (a "cairn")

A quick way to snapshot the whole project into one dated file you can stash in
Google Drive. Open a terminal and run:

```bash
cd ~
tar --exclude='afd/node_modules' -czf "afd-$(date +%Y%m%d-%H%M).tar.gz" afd
```

That drops a file like `afd-20260829-1349.tar.gz` in your home folder
(`/home/m-heaton/`), right next to the `afd` folder. It keeps `.git` (so the
full history travels with the snapshot) and skips `node_modules` (regenerable
from `package.json`).

To park it in Drive: drag that `.tar.gz` onto **drive.google.com**, or drop it
in your synced Drive folder. One file, syncs cleanly.

Notes:
- This snapshots your **local** working copy — including anything not yet
  committed or pushed. That's usually what you want for a checkpoint.
- To un-tar it later: `tar -xzf afd-YYYYMMDD-HHMM.tar.gz`
- Want a plain browsable folder copy instead of a tarball?
  `cp -a ~/afd ~/afd-snapshot-$(date +%Y%m%d)`

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
