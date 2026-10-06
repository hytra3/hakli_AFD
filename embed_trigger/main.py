"""
AFD embed trigger  (2nd-gen Cloud Function, Storage 'finalize')
================================================================

Fires when the recorder uploads a clip to afd/{uid}/...  Reads the
entryId + recordingId the recorder stamped into the object's custom
metadata, asks the warm embed service for the vector, and writes it
onto the matching recording doc. Model lives ONLY in the Cloud Run
service; this function is pure plumbing.

Deploy (from this folder):

  gcloud functions deploy afd-embed-trigger \
    --gen2 --runtime=python312 --region=<REGION> \
    --trigger-event-filters="type=google.cloud.storage.object.v1.finalized" \
    --trigger-event-filters="bucket=<YOUR_BUCKET>" \
    --set-env-vars=EMBED_URL=https://<cloud-run-url>/embed \
    --entry-point=on_finalize --memory=256Mi --retry

--retry matters: an upload whose recording doc hasn't been written yet (the
recorder writes it just after the bytes, and on patchy signal that can lag)
raises, and is redelivered with backoff for up to 24h until the doc exists.

The function runs as the project default service account; it needs
Firestore write and permission to invoke the Cloud Run service.
"""

import os
import functions_framework
import requests
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.cloud import firestore, storage
from google.oauth2 import id_token

EMBED_URL = os.environ["EMBED_URL"]          # e.g. https://afd-embed-xxx.run.app/embed
# /embed only accepts a Google ID token minted for the service's own URL.
EMBED_AUDIENCE = os.environ.get("EMBED_AUDIENCE") or EMBED_URL.rsplit("/embed", 1)[0]
_db = firestore.Client()
_gcs = storage.Client()


class RecordingDocNotYet(Exception):
    """The bytes landed but the recorder hasn't written the Firestore doc yet."""


@functions_framework.cloud_event
def on_finalize(cloud_event):
    data = cloud_event.data
    bucket_name = data["bucket"]
    name = data["name"]

    # only corpus audio, afd/{uid}/{file} — ignore anything else
    parts = name.split("/")
    if len(parts) != 3 or parts[0] != "afd":
        return
    uploader = parts[1]

    blob = _gcs.bucket(bucket_name).get_blob(name)
    if blob is None:
        print("blob vanished:", name)
        return

    meta = blob.metadata or {}
    entry_id = meta.get("entryId")
    recording_id = meta.get("recordingId")
    if not entry_id or not recording_id:
        # older clips predate the recordingId breadcrumb — skip, backfill separately
        print("no entryId/recordingId in metadata for", name)
        return

    # The metadata is client-written, so check it against the recording doc
    # before touching it: the doc must exist, belong to this uploader, and name
    # this very file. Otherwise anyone could upload into their own folder with
    # metadata pointing at someone else's recording and overwrite its vector.
    ref = _db.document(f"afd_entries/{entry_id}/recordings/{recording_id}")
    snap = ref.get()
    if not snap.exists:
        # The recorder uploads the bytes FIRST and writes the doc right after;
        # on patchy signal that second step can lag by minutes or hours. Never
        # create the doc here (a doc created by this function has no uid, so the
        # recorder's own write would then be refused forever). Raise instead, so
        # the event is redelivered (deploy with --retry) once the doc exists.
        raise RecordingDocNotYet(f"{ref.path} not written yet for {name}")
    doc = snap.to_dict() or {}
    if doc.get("uid") != uploader or doc.get("storagePath") != name:
        print(f"REFUSING {name}: doc {ref.path} has uid={doc.get('uid')!r} "
              f"storagePath={doc.get('storagePath')!r}")
        return

    audio = blob.download_as_bytes()
    token = id_token.fetch_id_token(GoogleAuthRequest(), EMBED_AUDIENCE)
    resp = requests.post(EMBED_URL, files={"file": (name, audio)},
                         headers={"Authorization": f"Bearer {token}"}, timeout=120)
    if resp.status_code == 400:
        # undecodable / empty audio — retrying won't help
        print(f"embed service rejected {name}: {resp.text[:200]}")
        return
    resp.raise_for_status()                  # 5xx / cold service / auth -> retried
    r = resp.json()
    embedding = r["embedding"]

    # Firestore forbids nested arrays, so per-rep data is a list of maps:
    #   reps: [ {start, end, vector:[...]}, ... ]   (search matches nearest rep)
    # `embedding` = pool over all voiced frames (single-vector view / compat).
    # nReps / repDistance feed the recorder's soft QC gate and the threshold
    # calibration — stored raw, no flag decided here.
    vectors = r.get("vectors") or [embedding]
    offsets = r.get("rep_offsets") or [[None, None]] * len(vectors)
    reps = [{"start": s, "end": e, "vector": v} for (s, e), v in zip(offsets, vectors)]

    # update(), never set(): it only ever adds to a doc the recorder created.
    ref.update(
        {"embedding": embedding,
         "reps": reps,
         "nReps": r.get("n_reps"),
         "repDistance": r.get("rep_distance"),
         "embedModel": "mms-300m", "embedLayer": 12, "embedPooling": "voiced-per-rep"},
    )
    print(f"embedded {entry_id}/{recording_id}  dim={len(embedding)} "
          f"n_reps={r.get('n_reps')} rep_distance={r.get('rep_distance')}")
