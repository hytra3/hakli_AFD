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
    --entry-point=on_finalize --memory=256Mi

The function runs as the project default service account; it needs
Firestore write and permission to invoke the Cloud Run service.
"""

import os
import functions_framework
import requests
from google.cloud import firestore, storage

EMBED_URL = os.environ["EMBED_URL"]          # e.g. https://afd-embed-xxx.run.app/embed
_db = firestore.Client()
_gcs = storage.Client()


@functions_framework.cloud_event
def on_finalize(cloud_event):
    data = cloud_event.data
    bucket_name = data["bucket"]
    name = data["name"]

    # only corpus audio under afd/, ignore anything else
    if not name.startswith("afd/"):
        return

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

    audio = blob.download_as_bytes()
    resp = requests.post(EMBED_URL, files={"file": (name, audio)}, timeout=120)
    resp.raise_for_status()
    embedding = resp.json()["embedding"]

    _db.document(f"afd_entries/{entry_id}/recordings/{recording_id}").set(
        {"embedding": embedding, "embedModel": "mms-300m", "embedLayer": 12},
        merge=True,
    )
    print(f"embedded {entry_id}/{recording_id}  dim={len(embedding)}")
