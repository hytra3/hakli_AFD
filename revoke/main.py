"""
AFD revoke  (2nd-gen Cloud Function, Firestore 'written' on a recording)
=======================================================================
Makes a withdrawal reach links that were ALREADY handed out.

Playback uses getDownloadURL(), which returns a URL carrying the object's
download token. Storage rules decide who may GET that URL, but the URL itself
bypasses rules and works for as long as the token does. So when a take stops
being public (withdrawn, or erased and awaiting purge), every listener who
ever played it still holds a working link.

This function fires on every write to a recording doc. If the doc is not
playable (allowPlayback != true), it ROTATES the object's download token:
old links die at once. Restore needs nothing — the next getDownloadURL by an
allowed reader returns the new token. (The token is rotated, never removed:
an object with no token makes getDownloadURL fail outright.)

It is idempotent and cheap: a playable doc (the common case, including the
embed trigger's own writes) costs one doc read and nothing else.

Deploy: scripts/deploy-revoke.sh   (no --retry: a missed rotation is caught by
the next write, and the Storage rule already refuses NEW links.)

The function runs as the project default service account; it needs Firestore
read and Storage object metadata update on the corpus bucket.
"""

import os
import re
import uuid
import functions_framework
from google.cloud import firestore, storage

BUCKET_NAME = os.environ.get("STORAGE_BUCKET", "")       # e.g. afd-dev.firebasestorage.app

_db  = firestore.Client()
_gcs = storage.Client()

_DOC_RE = re.compile(r"(?:^|/)documents/(afd_entries/[^/]+/recordings/[^/]+)$")


def doc_path(cloud_event):
    """afd_entries/{e}/recordings/{r} from the event (subject or 'document')."""
    for key in ("document", "subject"):
        try:
            v = cloud_event[key]
        except (KeyError, TypeError):
            v = None
        if not v:
            continue
        m = _DOC_RE.search(v if "documents/" in v else "documents/" + v)
        if m:
            return m.group(1)
    return None


def owned_storage_path(data, recording_id):
    """storagePath only if it is this recording's own file (same check as purge)."""
    path, uid = data.get("storagePath"), data.get("uid")
    if (isinstance(uid, str) and uid and isinstance(path, str)
            and re.fullmatch(rf"afd/{re.escape(uid)}/{re.escape(recording_id)}\.(webm|m4a)", path)):
        return path
    return None


@functions_framework.cloud_event
def revoke(cloud_event):
    if not BUCKET_NAME:
        print("REVOKE: STORAGE_BUCKET env var not set — refusing to run.")
        return
    path = doc_path(cloud_event)
    if not path:
        return
    snap = _db.document(path).get()
    if not snap.exists:
        return                                   # purged — bytes are gone too
    data = snap.to_dict() or {}
    if data.get("allowPlayback") is True:
        return                                   # public: links should work

    storage_path = owned_storage_path(data, snap.id)
    if not storage_path:
        if data.get("storagePath"):
            print(f"REFUSING {path}: storagePath {data.get('storagePath')!r} isn't its own file")
        return
    blob = _gcs.bucket(BUCKET_NAME).get_blob(storage_path)
    if blob is None:
        return
    meta = dict(blob.metadata or {})
    if not meta.get("firebaseStorageDownloadTokens"):
        return                                   # never had a link to revoke
    meta["firebaseStorageDownloadTokens"] = str(uuid.uuid4())
    blob.metadata = meta
    blob.patch()
    print(f"revoked links to {storage_path} ({path} consent={data.get('consent')!r})")
