"""
Server-side safety tests — purge, embed trigger, search corpus, revoke
==============================================================
Unit tests for the Python services that act with admin rights, so the rules
can't protect them: each must check client-written fields itself.

The Google Cloud clients, functions_framework, requests and torch are stubbed,
so this needs only numpy + fastapi (for the embed service import):

    pip install numpy fastapi python-multipart
    python3 -m unittest discover -s test -p "test_*.py"
"""
import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent


def _stub_modules():
    """Install fake google.cloud / functions_framework / requests / torch."""
    def mod(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        sys.modules[name] = m
        return m

    google = mod("google")
    cloud = mod("google.cloud")
    google.cloud = cloud
    cloud.firestore = mod("google.cloud.firestore", Client=mock.MagicMock)
    cloud.storage = mod("google.cloud.storage", Client=mock.MagicMock)
    mod("google.cloud.firestore_v1")
    mod("google.cloud.firestore_v1.base_query", FieldFilter=lambda *a: a)
    mod("functions_framework", cloud_event=lambda f: f)
    mod("requests", post=mock.MagicMock())

    class _Tensor:  # only used in annotations at import time
        pass
    mod("torch", Tensor=_Tensor, set_num_threads=lambda n: None)
    mod("transformers", Wav2Vec2Model=type("Wav2Vec2Model", (), {}))


def _load(name, relpath):
    spec = importlib.util.spec_from_file_location(name, ROOT / relpath)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


_stub_modules()
os.environ.setdefault("EMBED_URL", "https://embed.invalid/embed")
purge = _load("afd_purge", "purge/main.py")
trigger = _load("afd_embed_trigger", "embed_trigger/main.py")
service = _load("afd_embed_service", "embed_service/app.py")
revoke = _load("afd_revoke", "revoke/main.py")


# ------------------------------------------------------------------- purge
class OwnedStoragePath(unittest.TestCase):
    def test_own_file_is_accepted(self):
        d = {"uid": "uA", "storagePath": "afd/uA/rec1.webm"}
        self.assertEqual(purge.owned_storage_path(d, "rec1"), "afd/uA/rec1.webm")
        d = {"uid": "uA", "storagePath": "afd/uA/rec1.m4a"}
        self.assertEqual(purge.owned_storage_path(d, "rec1"), "afd/uA/rec1.m4a")

    def test_no_path_means_no_bytes(self):
        self.assertIsNone(purge.owned_storage_path({"uid": "uA"}, "rec1"))

    def test_foreign_paths_are_refused(self):
        bad = [
            "afd/uVictim/rec1.webm",       # someone else's folder
            "afd/uA/recOther.webm",        # another recording of mine
            "afd_ui/find_hint.webm",       # outside the corpus
            "afd/uA/rec1.webm/../x",       # traversal-ish suffix
            "afd/uA/rec1.wav",             # unexpected extension
        ]
        for p in bad:
            with self.subTest(p=p), self.assertRaises(ValueError):
                purge.owned_storage_path({"uid": "uA", "storagePath": p}, "rec1")

    def test_missing_uid_is_refused(self):
        with self.assertRaises(ValueError):
            purge.owned_storage_path({"storagePath": "afd//rec1.webm"}, "rec1")

    def test_regex_metacharacters_in_ids_are_literal(self):
        with self.assertRaises(ValueError):
            purge.owned_storage_path({"uid": "u.", "storagePath": "afd/uX/rec1.webm"}, "rec1")


class PurgeRun(unittest.TestCase):
    """Drive purge() end to end with fake Firestore / Storage."""

    def _snap(self, doc_id, data):
        s = mock.MagicMock()
        s.id = doc_id
        s.to_dict.return_value = data
        s.update_time = purge.datetime.datetime(2000, 1, 1, tzinfo=purge.datetime.timezone.utc)
        s.reference.path = f"afd_entries/ent_sun/recordings/{doc_id}"
        return s

    def _run(self, snaps):
        entry = mock.MagicMock()
        entry.to_dict.return_value = {}                      # seed entry
        recs = entry.reference.collection.return_value
        recs.where.return_value.stream.return_value = snaps
        bucket = mock.MagicMock()
        with mock.patch.object(purge, "_db") as db, \
             mock.patch.object(purge, "_gcs") as gcs, \
             mock.patch.object(purge, "DRY_RUN", False), \
             mock.patch.object(purge, "BUCKET_NAME", "b"):
            db.collection.return_value.stream.return_value = [entry]
            gcs.bucket.return_value = bucket
            purge.purge(None)
        return bucket

    def test_forged_path_deletes_nothing(self):
        evil = self._snap("recEvil", {"uid": "uAttacker", "consent": "deleted",
                                      "storagePath": "afd/uVictim/recV.webm"})
        bucket = self._run([evil])
        bucket.blob.assert_not_called()
        evil.reference.delete.assert_not_called()

    def test_own_path_is_purged(self):
        ok = self._snap("rec1", {"uid": "uA", "consent": "deleted",
                                 "storagePath": "afd/uA/rec1.webm"})
        bucket = self._run([ok])
        bucket.blob.assert_called_once_with("afd/uA/rec1.webm")
        bucket.blob.return_value.delete.assert_called_once()
        ok.reference.delete.assert_called_once()


# ----------------------------------------------------------- embed trigger
class EmbedTrigger(unittest.TestCase):
    NAME = "afd/uA/rec1.webm"

    def _event(self, name=NAME):
        return types.SimpleNamespace(data={"bucket": "b", "name": name})

    def _run(self, doc, name=NAME, meta=None, status=200):
        blob = mock.MagicMock()
        blob.metadata = meta or {"entryId": "ent_sun", "recordingId": "rec1"}
        blob.download_as_bytes.return_value = b"audio"
        snap = mock.MagicMock()
        snap.exists = doc is not None
        snap.to_dict.return_value = doc
        resp = mock.MagicMock(status_code=status, text="")
        resp.json.return_value = {"embedding": [1.0, 0.0], "vectors": [[1.0, 0.0]],
                                  "rep_offsets": [[0.1, 0.5]], "n_reps": 1}
        with mock.patch.object(trigger, "_db") as db, \
             mock.patch.object(trigger, "_gcs") as gcs, \
             mock.patch.object(trigger.requests, "post", return_value=resp) as post:
            gcs.bucket.return_value.get_blob.return_value = blob
            ref = db.document.return_value
            ref.get.return_value = snap
            trigger.on_finalize(self._event(name))
        return ref, post

    def test_writes_embedding_onto_own_doc_with_update(self):
        ref, post = self._run({"uid": "uA", "storagePath": self.NAME})
        post.assert_called_once()
        ref.update.assert_called_once()
        ref.set.assert_not_called()
        self.assertEqual(ref.update.call_args[0][0]["embedding"], [1.0, 0.0])

    def test_missing_doc_raises_for_retry_and_never_creates(self):
        with mock.patch.object(trigger, "_db") as db, \
             mock.patch.object(trigger, "_gcs") as gcs:
            blob = gcs.bucket.return_value.get_blob.return_value
            blob.metadata = {"entryId": "ent_sun", "recordingId": "rec1"}
            ref = db.document.return_value
            ref.get.return_value.exists = False
            with self.assertRaises(trigger.RecordingDocNotYet):
                trigger.on_finalize(self._event())
            ref.set.assert_not_called()
            ref.update.assert_not_called()

    def test_metadata_pointing_at_someone_elses_doc_is_refused(self):
        ref, post = self._run({"uid": "uVictim", "storagePath": "afd/uVictim/rec1.webm"})
        post.assert_not_called()
        ref.update.assert_not_called()

    def test_doc_naming_a_different_file_is_refused(self):
        ref, post = self._run({"uid": "uA", "storagePath": "afd/uA/other.webm"})
        post.assert_not_called()
        ref.update.assert_not_called()

    def test_non_corpus_paths_are_ignored(self):
        for name in ["afd_ui/find_hint.webm", "afd/uA/sub/rec1.webm", "afd_avatars/uA/a.png"]:
            with self.subTest(name=name):
                ref, post = self._run({"uid": "uA", "storagePath": name}, name=name)
                post.assert_not_called()
                ref.update.assert_not_called()

    def test_undecodable_audio_is_not_retried(self):
        ref, _ = self._run({"uid": "uA", "storagePath": self.NAME}, status=400)
        ref.update.assert_not_called()          # returned quietly, no raise


# ------------------------------------------------------------ search corpus
class SearchCorpus(unittest.TestCase):
    def _docs(self, *docs):
        snaps = []
        for d in docs:
            s = mock.MagicMock()
            s.to_dict.return_value = d
            snaps.append(s)
        return snaps

    def test_only_currently_public_voices_are_searchable(self):
        rec = lambda eid, **kw: {"entryId": eid, "gloss": eid, "reps": [{"vector": [1.0, 0.0]}], **kw}
        snaps = self._docs(
            rec("ent_public", consent="public", allowPlayback=True),
            rec("ent_withdrawn", consent="withdrawn", allowPlayback=False),
            rec("ent_deleted", consent="deleted", allowPlayback=False),
            rec("ent_private_take", consent="public", allowPlayback=False),
            rec("ent_legacy_no_flags"),
        )
        firestore = sys.modules["google.cloud.firestore"]
        with mock.patch.object(firestore, "Client") as client:
            client.return_value.collection_group.return_value.stream.return_value = snaps
            c = service.Corpus()
            c.load_from_firestore()
        self.assertEqual(c.entry_ids, ["ent_public"])
        hits = c.search(service.np.array([1.0, 0.0], dtype=service.np.float32))
        self.assertEqual([h["entryId"] for h in hits], ["ent_public"])

    def test_cache_goes_stale(self):
        c = service.Corpus()
        self.assertTrue(c.stale())
        c.loaded, c.loaded_at = True, service.time.monotonic()
        self.assertFalse(c.stale())
        c.loaded_at -= service.CORPUS_MAX_AGE_S + 1
        self.assertTrue(c.stale())


# ------------------------------------------------------------------ revoke
class Revoke(unittest.TestCase):
    PATH = "afd_entries/ent_sun/recordings/rec1"

    def _run(self, doc, token="tok-old", subject=None):
        event = {"subject": subject or f"documents/{self.PATH}"}
        snap = mock.MagicMock(exists=doc is not None, id="rec1")
        snap.to_dict.return_value = doc
        blob = mock.MagicMock()
        blob.metadata = {"entryId": "ent_sun", "recordingId": "rec1",
                         **({"firebaseStorageDownloadTokens": token} if token else {})}
        with mock.patch.object(revoke, "_db") as db, \
             mock.patch.object(revoke, "_gcs") as gcs, \
             mock.patch.object(revoke, "BUCKET_NAME", "b"):
            db.document.return_value.get.return_value = snap
            gcs.bucket.return_value.get_blob.return_value = blob
            revoke.revoke(event)
            return db, blob

    def test_withdrawn_take_gets_a_new_token(self):
        db, blob = self._run({"uid": "uA", "storagePath": "afd/uA/rec1.webm",
                              "allowPlayback": False, "consent": "withdrawn"})
        db.document.assert_called_once_with(self.PATH)
        blob.patch.assert_called_once()
        self.assertNotEqual(blob.metadata["firebaseStorageDownloadTokens"], "tok-old")
        self.assertTrue(blob.metadata["firebaseStorageDownloadTokens"])   # rotated, not removed
        self.assertEqual(blob.metadata["entryId"], "ent_sun")              # other metadata kept

    def test_public_take_is_left_alone(self):
        _, blob = self._run({"uid": "uA", "storagePath": "afd/uA/rec1.webm",
                             "allowPlayback": True, "consent": "public"})
        blob.patch.assert_not_called()

    def test_foreign_storage_path_is_not_touched(self):
        _, blob = self._run({"uid": "uA", "storagePath": "afd/uVictim/x.webm",
                             "allowPlayback": False})
        blob.patch.assert_not_called()

    def test_no_token_means_nothing_to_revoke(self):
        _, blob = self._run({"uid": "uA", "storagePath": "afd/uA/rec1.webm",
                             "allowPlayback": False}, token=None)
        blob.patch.assert_not_called()

    def test_doc_path_parsing(self):
        ok = "afd_entries/e/recordings/r"
        self.assertEqual(revoke.doc_path({"subject": f"documents/{ok}"}), ok)
        self.assertEqual(revoke.doc_path({"document": ok}), ok)
        self.assertIsNone(revoke.doc_path({"subject": "documents/afd_speakers/s"}))
        self.assertIsNone(revoke.doc_path({}))


if __name__ == "__main__":
    unittest.main()
