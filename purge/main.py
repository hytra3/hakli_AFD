"""
AFD purge  (2nd-gen Cloud Function, scheduled sweep)
====================================================
Right-to-erasure enforcer. Recordings are immutable atoms and the client can
NEVER hard-delete — Firestore and Storage both refuse by rule. Erase (and any
future hard withdrawal) instead sets the recording doc's  consent = "deleted".
THIS function is the only thing that actually removes the bytes.

It sweeps for recordings marked  consent == "deleted"  and, once they've sat
past a grace window, deletes the Storage object and then the Firestore doc.
Withdrawn (recoverable) takes are left untouched — you cannot destroy the bytes
of something a speaker can still Restore. Only "deleted" is permanent.

SAFETY RAILS (this deletes an irreplaceable corpus of elders' voices):
  * PURGE_DRY_RUN defaults to "1" — it LOGS what it would delete and deletes
    nothing. Deploy dry-run first, read the logs, confirm they're right, THEN
    redeploy with PURGE_DRY_RUN=0 to arm it.
  * PURGE_GRACE_HOURS (default 24) — a doc must have been marked deleted at
    least this long ago before its bytes go, leaving a recovery window against
    an accidental tap or a buggy write.
    (Testing tip: for your FIRST dry-run set PURGE_GRACE_HOURS=0 so it considers
    just-erased takes immediately and you can see them in the log; put it back to
    24 when you arm it for real.)
  * Grace is measured from the doc's own update_time — no client field needed,
    and the Firestore rules don't have to change.
  * Bytes are deleted BEFORE the doc, so a crash mid-way leaves a doc still
    marked deleted (swept again next run) rather than an orphaned blob — and
    so does a failed delete: the doc is kept until its bytes are really gone.
  * Only ever deletes the recording's OWN file (afd/{uid}/{recordingId}.*). A
    doc whose storagePath names anything else is refused and logged, never
    purged — see owned_storage_path().
  * Idempotent — safe to run on a schedule and safe to re-run.

Deploy (from this folder):

  gcloud functions deploy afd-purge \
    --gen2 --runtime=python312 --region=<REGION> \
    --trigger-topic=afd-purge-tick \
    --set-env-vars=STORAGE_BUCKET=afd-dev.firebasestorage.app,PURGE_DRY_RUN=1,PURGE_GRACE_HOURS=24 \
    --entry-point=purge --memory=256Mi

  # drive it daily at 03:00 via Cloud Scheduler -> Pub/Sub:
  gcloud pubsub topics create afd-purge-tick
  gcloud scheduler jobs create pubsub afd-purge-daily \
    --schedule="0 3 * * *" --topic=afd-purge-tick --message-body="run"

  # to run it once by hand (e.g. to watch a dry-run):
  gcloud pubsub topics publish afd-purge-tick --message="run"

The function runs as the project default service account; it needs Firestore
read/delete and Storage object delete on the corpus bucket.
"""

import os
import re
import datetime
import functions_framework
from google.api_core.exceptions import NotFound
from google.cloud import firestore, storage
from google.cloud.firestore_v1.base_query import FieldFilter

DRY_RUN     = os.environ.get("PURGE_DRY_RUN", "1") != "0"      # default: dry run
GRACE_HOURS = float(os.environ.get("PURGE_GRACE_HOURS", "24"))
BUCKET_NAME = os.environ.get("STORAGE_BUCKET", "")            # e.g. afd-dev.firebasestorage.app

_db  = firestore.Client()
_gcs = storage.Client()


def owned_storage_path(data, recording_id):
    """The doc's storagePath, but ONLY if it is this recording's own corpus file:
    afd/{doc uid}/{recording id}.webm|.m4a — exactly what the recorder writes and
    the Firestore rules allow. Returns None when the doc has no path, and raises
    ValueError for any other path: storagePath is client-written, and the purge
    runs with admin rights, so trusting it blindly would let a doc point at
    someone else's audio and have it deleted here."""
    path = data.get("storagePath")
    if not path:
        return None
    uid = data.get("uid")
    if (isinstance(uid, str) and uid and isinstance(path, str)
            and re.fullmatch(rf"afd/{re.escape(uid)}/{re.escape(recording_id)}\.(webm|m4a)", path)):
        return path
    raise ValueError(f"storagePath {path!r} is not afd/{uid}/{recording_id}.*")


@functions_framework.cloud_event
def purge(cloud_event):
    if not BUCKET_NAME:
        print("PURGE: STORAGE_BUCKET env var not set — refusing to run.")
        return

    bucket = _gcs.bucket(BUCKET_NAME)
    now    = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(hours=GRACE_HOURS)

    swept = purged = within_grace = errors = 0
    e_swept = e_purged = e_within_grace = 0

    # No collection-group index needed: walk entries, then each entry's
    # "deleted" recordings (a single-field where on a subcollection is
    # auto-indexed, so this deploys with nothing extra to configure).
    for entry in _db.collection("afd_entries").stream():
        entry_ref = entry.reference
        edata = entry.to_dict() or {}
        is_user_entry = edata.get("source") == "user"
        # Snapshot whether this entry has ANY recording BEFORE we purge the
        # deleted ones below, so an all-erased contributor entry keeps its doc
        # this pass and is only reaped on a later sweep, once the recordings are
        # actually gone — never both in the same run.
        had_recording = (any(True for _ in
            entry_ref.collection("recordings").limit(1).stream())
            if is_user_entry else True)

        recs = entry_ref.collection("recordings").where(
            filter=FieldFilter("consent", "==", "deleted")
        )
        for snap in recs.stream():
            swept += 1
            marked = snap.update_time            # ~when consent became "deleted"
            if marked is None or marked > cutoff:
                within_grace += 1                # too new (or unknown age) — leave it
                continue

            data = snap.to_dict() or {}
            ref  = snap.reference
            try:
                path = owned_storage_path(data, snap.id)
            except ValueError as e:
                # Never delete bytes we can't prove belong to this doc, and keep
                # the doc too, so it stays visible for a human to look at.
                errors += 1
                print(f"REFUSING to purge {ref.path}: {e}")
                continue

            if DRY_RUN:
                print(f"DRY-RUN would purge {ref.path}  storage={path}")
                purged += 1
                continue

            # bytes first, then the doc — and the doc ONLY once the bytes are
            # gone. If the delete fails for any other reason, keep the doc so
            # the next sweep tries again; deleting it anyway would leave audio
            # in Storage that nothing points at and nothing will ever erase.
            if path:
                try:
                    bucket.blob(path).delete()
                except NotFound:
                    pass                          # already gone (e.g. a re-run) — fine
                except Exception as e:
                    errors += 1
                    print(f"storage delete failed {path}: {e} — keeping {ref.path} for the next sweep")
                    continue
            try:
                ref.delete()
                purged += 1
                print(f"purged {ref.path}  storage={path}")
            except Exception as e:
                errors += 1
                print(f"doc delete failed {ref.path}: {e}")

        # (2) reap an abandoned contributor entry: source=="user", zero
        #     recordings, created longer ago than the grace window. Seed entries
        #     are never touched; a just-created entry still mid-recording is
        #     inside grace and safe. Grace is measured from createdAt (the field
        #     set on creation), falling back to the doc's own create_time.
        if is_user_entry and not had_recording:
            e_swept += 1
            created = edata.get("createdAt") or entry.create_time
            if created is None or created > cutoff:
                e_within_grace += 1
            elif DRY_RUN:
                print(f"DRY-RUN would purge empty entry {entry_ref.path}  created={created}")
                e_purged += 1
            else:
                try:
                    entry_ref.delete()
                    e_purged += 1
                    print(f"purged empty entry {entry_ref.path}")
                except Exception as ex:
                    errors += 1
                    print(f"entry delete failed {entry_ref.path}: {ex}")

    tag = "(dry-run) " if DRY_RUN else ""
    print(f"PURGE {tag}done: recordings swept={swept} purged={purged} "
          f"within-grace={within_grace} errors={errors} | "
          f"empty-entries swept={e_swept} purged={e_purged} within-grace={e_within_grace}")
