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
| **AFD: Deploy revoke** | After editing `revoke/main.py`. Redeploys the function that kills old playback links when a take is withdrawn. |
| **AFD: Deploy purge** | After editing `purge/main.py`. Redeploys the nightly clean-up (erased voices, then removed or empty contributed words and their photos). Keeps its settings and prints them, so you can see whether it really deletes (`PURGE_DRY_RUN=0`). |
| **AFD: Health check the service** | Any time, to confirm the matcher is alive. |
| **AFD: Reindex search cache** | Rarely needed — search reloads itself every 5 minutes. Use it to pick up new recordings immediately. First time only: `bash scripts/reindex.sh --setup` gives the service its admin token. |

After publishing, **hard-refresh** the page in the browser: `Ctrl+Shift+R`
(the plain refresh keeps the old cached copy).

---

## The pieces, and where they live

- **The site** — GitHub Pages at **hakli.app**, updated by the **Publish** task
  (`scripts/publish-site.sh`, which also bumps the build stamp shown at the foot
  of each page):
  - `index.html` — the dictionary: browse every word, speak to find, open a word.
  - `add.html` — "add a word": say it, show it, share it (the page WhatsApp
    invitations open). Sign-in only at the end: Google, phone number, email.
  - `recorder.html` — the full recorder (sessions, speaker details, spoken
    consent, recording for someone else, importing a WhatsApp voice note).
  - `welcome.html` — the outward-facing intro to hand out; not linked in-app.
  - `hakli-intro.html`, `hakli-intro-ar.html` — the printable introduction
    (bilingual / Arabic only); not linked in-app, ends with a link in.
  - `find.html`, `dictionary.html` — old names; they just forward to `index.html`.
  - `404.html` — what GitHub Pages shows for an address that doesn't exist;
    points back into the app.
- **Steward pages** — not linked from the app; open them directly and sign in
  with the steward account (email + password):
  - `hakli.app/steward.html` — review words people add: *To review / Hidden /
    All*; listen; **Looks fine**, **Hide word / Show again**, **Take down
    photo**, **Remove emoji**. Never touches anyone's voice.
  - `hakli.app/prompts/admin.html` — open/close the UI-prompt recording and
    Arabic-edit windows, and read the edit suggestions.
  - `hakli.app/prompts/index.html` — the tool speakers use to record the
    spoken prompts and suggest Arabic wording (open while a window is open).
  - Who counts as a steward: `node scripts/grant-steward.mjs <email>` (add),
    `--revoke <email>`, `--list`. Rules check `afd_admins/{uid}`, which only that
    script can write.
- **Embed/match service** (`embed_service/`) — the matcher, on Cloud Run.
  Updated by the **Deploy embed service** task.
- **Auto-embed trigger** (`embed_trigger/`) — a Cloud Function that vectorises
  every new recording. Updated by the **Deploy trigger** task.
- **Link revoker** (`revoke/`) — a Cloud Function that rotates a take's
  download token the moment it's withdrawn or erased, so links people already
  have stop working. Updated by the **Deploy revoke** task.
- **Embedding backfill** — if a take uploaded its audio but its phone stayed
  offline more than a day before saving the take, it never got an embedding
  (speak-to-find can't match it). `node scripts/backfill-embeddings.mjs` lists
  them; `--apply` re-runs the embed trigger for each.
- **Tests** run on every pull request (GitHub → the PR's "Checks"): the
  Firestore/Storage rules in the emulators, the Python services, and the
  **browser tests** — the real pages opened in headless Chromium at phone size
  and walked like a person would (hold the mic, press Back, tap a slot), with
  Firebase and the matcher replaced by stand-ins so nothing live is touched.
  - On the laptop: `cd ~/afd/test && npm install && npx playwright-core install chromium`
    once, then `npm run test:browser` (about four minutes). One file:
    `node browser/run.mjs recorder`. Screenshots: `AFD_SHOTS=/tmp/shots npm run test:browser`.
  - They check behaviour, not appearance, and not a real phone: the installed
    app, iOS and a real microphone still need a hand test.
  - **After adding on-screen strings on purpose**, refresh the review list's
    number record: `AFD_UPDATE_NUMBERS=1 node browser/run.mjs extras`, and commit
    `test/browser/prompt-numbers.json`. The test fails if any existing number
    comes to mean a different line.
- **Storage rules** (`afd-storage.rules`) — corpus audio is playable only
  while its recording is public. Before deploying them, run
  `node scripts/audit-recording-paths.mjs` (add `--fix` to repair missing
  metadata) so no older take goes silent.
- **Bucket CORS** (`cors.json`) — which sites may download audio bytes (sharing a
  voice as a file needs it; plain playback doesn't). After editing it:
  `gsutil cors set cors.json gs://afd-dev.firebasestorage.app`
- **Sign-in methods** (Firebase console → Authentication → Sign-in method) — Google,
  Email/Password **with "Email link (passwordless sign-in)" on**, and **Phone**. Phone
  needs the Blaze plan and Settings → SMS region policy allowing Oman (+968) and any
  other countries speakers live in. `hakli.app` must be under Authorized domains.

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
