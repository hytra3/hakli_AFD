# AFD embed & match service

One warm Cloud Run service that turns Hakli audio into a vector, plus a thin
Storage trigger that embeds every new recording automatically. This is the
engine behind **both** speak-to-find and duplicate detection — same operation,
different input.

## What runs where

- `embed_service/`  — the model (MMS-300m, layer 12), kept warm on Cloud Run.
  `/embed`, `/search`, `/reindex`, `/healthz`.
- `embed_trigger/`  — a 2nd-gen Cloud Function on Storage *finalize* that reads
  the `entryId` + `recordingId` off each uploaded clip and writes its vector to
  the recording doc. Pure plumbing; no model.

## 1. Deploy the service

```bash
cd embed_service
gcloud run deploy afd-embed \
  --source . \
  --region=europe-west1 \
  --min-instances=1 \          # keep the model warm; ~$15–25/mo, don't skip
  --cpu=2 --memory=4Gi \
  --timeout=120 \
  --allow-unauthenticated \    # or lock down + let only the trigger call it
  --set-env-vars=EMBED_LAYER=12
```

First build is slow — it bakes the ~1 GB model into the image. Note the
service URL it prints (e.g. `https://afd-embed-xxxx.run.app`).

Check it: `curl https://<url>/healthz` → `model_warm: true`.

The service reads Firestore for `/search`. The default Cloud Run service
account needs **Cloud Datastore User** (Firestore read) on the project.

## 2. Deploy the trigger

```bash
cd ../embed_trigger
gcloud functions deploy afd-embed-trigger \
  --gen2 --runtime=python312 --region=europe-west1 \
  --trigger-event-filters="type=google.cloud.storage.object.v1.finalized" \
  --trigger-event-filters="bucket=<YOUR_STORAGE_BUCKET>" \
  --set-env-vars=EMBED_URL=https://<url>/embed \
  --entry-point=on_finalize --memory=256Mi
```

The function's service account needs **Firestore write** and permission to
**invoke** the Cloud Run service (`roles/run.invoker`).

## 3. One recorder change

In `index.html`, the upload already stamps `entryId` and `gloss` into custom
metadata. Add `recordingId` so the trigger can find the exact doc:

```js
customMetadata: { entryId: rec.entryId, gloss: rec.gloss, recordingId: rec.recordingId }
```

That's the whole recorder side. From then on, every clip that lands in Storage
gets a vector written to its recording doc within a second or two.

## 4. Try it

Record a couple of words in the app. In Firestore, confirm each
`afd_entries/{id}/recordings/{id}` now has an `embedding` array. Then:

```bash
# speak-to-find, from a wav/webm of a word you recorded:
curl -F file=@query.webm "https://<url>/search?top_k=5"
```

The right entry should come back at the top with a small distance
(within-speaker self-repeats landed at 0.14–0.25 in testing).

## Notes

- MMS wants 16 kHz; the service resamples from your 48 kHz capture with ffmpeg.
- `/search` caches corpus vectors in memory. New recordings appear after the
  cache refreshes — call `POST /reindex` (or it reloads on cold start). For a
  live corpus we'll wire the trigger to also bump the cache; fine to do by hand
  while the corpus is small.
- Layer is env-configurable (`EMBED_LAYER`) if a re-sweep on clean 48 kHz data
  moves the optimum off 12.
