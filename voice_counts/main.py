"""
AFD voice counts  (2nd-gen Cloud Function, Firestore 'document.written')
=======================================================================
Keeps each word card's public-voice counts on the card itself, so the
dictionary can list every word, with its 🔊💬📖 counts, in ONE read of
afd_entries instead of a recordings query per word (91 round-trips per page
load before this, 10-15).

Fires on any create / update / delete under
    afd_entries/{entryId}/recordings/{recordingId}
— an upload, a withdraw, a restore, an erase, the purge removing a take — and
RECOUNTS that one word from scratch:

    afd_entries/{entryId}.voices = { word, context, definition }   (allowPlayback == true only)
    afd_entries/{entryId}.voicesAt = server time

Recounting (not +1/-1) means it can't drift: a retried or out-of-order event
just writes the right answer again. Same definition as the app's own count
(afd-card.js loadCounts): only takes others can hear; type falls back to
phase, then "word".

It writes the ENTRY doc only, never a recording, so it can't trigger itself.
A word that no longer exists (the purge reaped it) is left alone — update()
fails on a missing doc instead of recreating it.

`voices` is server-only: the entry update rules list exactly which fields a
client may change, and this isn't one of them; the Admin client here bypasses
rules. Readers fall back to counting themselves when the field is missing
(a word nobody has recorded since before this deployed, until the backfill:
`node scripts/backfill-voice-counts.mjs`).

Deploy: bash scripts/deploy-voice-counts.sh
"""

import functions_framework
from google.api_core.exceptions import NotFound
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

_db = firestore.Client()
TYPES = ("word", "context", "definition")


def count_voices(entry_ref):
    counts = {t: 0 for t in TYPES}
    q = entry_ref.collection("recordings").where(filter=FieldFilter("allowPlayback", "==", True))
    for snap in q.stream():
        d = snap.to_dict() or {}
        t = d.get("type") or d.get("phase") or "word"
        if t in counts:
            counts[t] += 1
    return counts


def entry_id_from(cloud_event):
    # The 'document' attribute is "afd_entries/{entryId}/recordings/{recordingId}";
    # the subject carries the same path after "documents/".
    path = cloud_event.get("document") or ""
    if not path:
        subject = cloud_event.get("subject") or ""
        path = subject.split("documents/", 1)[-1]
    parts = path.split("/")
    if len(parts) >= 4 and parts[0] == "afd_entries" and parts[2] == "recordings":
        return parts[1]
    return None


@functions_framework.cloud_event
def on_recording_write(cloud_event):
    entry_id = entry_id_from(cloud_event)
    if not entry_id:
        print(f"[voice-counts] ignored event, no entry in path: {cloud_event.get('subject')}")
        return
    ref = _db.collection("afd_entries").document(entry_id)
    counts = count_voices(ref)
    try:
        ref.update({"voices": counts, "voicesAt": firestore.SERVER_TIMESTAMP})
    except NotFound:
        print(f"[voice-counts] {entry_id}: entry gone, nothing to update")
        return
    print(f"[voice-counts] {entry_id}: {counts}")
