"""
Server-side safety tests — purge, embed trigger, search corpus, revoke
==============================================================
Unit tests for the Python services that act with admin rights, so the rules
can't protect them: each must check client-written fields itself.

The Google Cloud clients, google-auth, functions_framework, requests and torch
are stubbed, so this needs only numpy + fastapi (+ httpx for its TestClient)
and ffmpeg on the PATH:

    pip install numpy fastapi python-multipart httpx
    python3 -m unittest discover -s test -p "test_*.py"
"""
import hashlib
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
    cloud.firestore = mod("google.cloud.firestore", Client=mock.MagicMock, SERVER_TIMESTAMP="<server-time>")
    cloud.storage = mod("google.cloud.storage", Client=mock.MagicMock)
    mod("google.cloud.firestore_v1")
    mod("google.cloud.firestore_v1.base_query", FieldFilter=lambda *a: a)
    class NotFound(Exception):
        pass
    api_core = mod("google.api_core")
    api_core.exceptions = mod("google.api_core.exceptions", NotFound=NotFound)
    auth = mod("google.auth")
    auth.transport = mod("google.auth.transport")
    auth.transport.requests = mod("google.auth.transport.requests", Request=mock.MagicMock)
    oauth2 = mod("google.oauth2")
    oauth2.id_token = mod("google.oauth2.id_token",
                          fetch_id_token=mock.MagicMock(return_value="id-tok"),
                          verify_oauth2_token=mock.MagicMock())
    google.api_core, google.auth, google.oauth2 = api_core, auth, oauth2
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
        d = {"uid": "uA", "storagePath": "afd/uA/rec1.wav"}      # imported voice note
        self.assertEqual(purge.owned_storage_path(d, "rec1"), "afd/uA/rec1.wav")

    def test_no_path_means_no_bytes(self):
        self.assertIsNone(purge.owned_storage_path({"uid": "uA"}, "rec1"))

    def test_foreign_paths_are_refused(self):
        bad = [
            "afd/uVictim/rec1.webm",       # someone else's folder
            "afd/uA/recOther.webm",        # another recording of mine
            "afd_ui/find_hint.webm",       # outside the corpus
            "afd/uA/rec1.webm/../x",       # traversal-ish suffix
            "afd/uA/rec1.mp3",             # unexpected extension
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

    def _run(self, snaps, bucket=None):
        entry = mock.MagicMock()
        entry.to_dict.return_value = {}                      # seed entry
        recs = entry.reference.collection.return_value
        recs.where.return_value.stream.return_value = snaps
        bucket = bucket or mock.MagicMock()
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

    def test_failed_byte_delete_keeps_the_doc(self):
        snap = self._snap("rec1", {"uid": "uA", "consent": "deleted",
                                   "storagePath": "afd/uA/rec1.webm"})
        bucket = mock.MagicMock()
        bucket.blob.return_value.delete.side_effect = RuntimeError("503 backend error")
        self._run([snap], bucket)
        snap.reference.delete.assert_not_called()

    def test_already_gone_bytes_still_purge_the_doc(self):
        snap = self._snap("rec1", {"uid": "uA", "consent": "deleted",
                                   "storagePath": "afd/uA/rec1.webm"})
        bucket = mock.MagicMock()
        bucket.blob.return_value.delete.side_effect = sys.modules["google.api_core.exceptions"].NotFound()
        self._run([snap], bucket)
        snap.reference.delete.assert_called_once()

    def test_own_path_is_purged(self):
        ok = self._snap("rec1", {"uid": "uA", "consent": "deleted",
                                 "storagePath": "afd/uA/rec1.webm"})
        bucket = self._run([ok])
        bucket.blob.assert_called_once_with("afd/uA/rec1.webm")
        bucket.blob.return_value.delete.assert_called_once()
        ok.reference.delete.assert_called_once()


class PurgeEmptyUserEntry(unittest.TestCase):
    """A contributor's word with no recordings left is reaped — with its photo."""

    OLD = purge.datetime.datetime(2000, 1, 1, tzinfo=purge.datetime.timezone.utc)

    def _run(self, edata, entry_id="ent_u_0123456789ab", bucket=None):
        entry = mock.MagicMock()
        entry.id = entry_id
        entry.to_dict.return_value = {"source": "user", "createdAt": self.OLD, **edata}
        recs = entry.reference.collection.return_value
        recs.limit.return_value.stream.return_value = []          # no recordings at all
        recs.where.return_value.stream.return_value = []
        bucket = bucket or mock.MagicMock()
        with mock.patch.object(purge, "_db") as db, \
             mock.patch.object(purge, "_gcs") as gcs, \
             mock.patch.object(purge, "DRY_RUN", False), \
             mock.patch.object(purge, "BUCKET_NAME", "b"):
            db.collection.return_value.stream.return_value = [entry]
            gcs.bucket.return_value = bucket
            purge.purge(None)
        return entry, bucket

    def test_photo_then_entry(self):
        entry, bucket = self._run({"createdBy": "uA", "image": "https://x"})
        bucket.blob.assert_called_once_with("afd_pics/uA/ent_u_0123456789ab.jpg")
        bucket.blob.return_value.delete.assert_called_once()
        entry.reference.delete.assert_called_once()

    def test_no_photo_on_storage_still_reaps(self):
        bucket = mock.MagicMock()
        bucket.blob.return_value.delete.side_effect = sys.modules["google.api_core.exceptions"].NotFound()
        entry, _ = self._run({"createdBy": "uA"}, bucket=bucket)
        entry.reference.delete.assert_called_once()

    def test_a_joined_word_is_kept_with_its_photo(self):
        # joined into another word by a steward: empty on purpose, never reaped
        entry, bucket = self._run({"createdBy": "uA", "image": "https://x", "joinedInto": "ent_water"})
        bucket.blob.assert_not_called()
        entry.reference.delete.assert_not_called()

    def test_failed_photo_delete_keeps_the_entry(self):
        bucket = mock.MagicMock()
        bucket.blob.return_value.delete.side_effect = RuntimeError("503 backend error")
        entry, _ = self._run({"createdBy": "uA"}, bucket=bucket)
        entry.reference.delete.assert_not_called()

    def test_photo_path_comes_from_the_entry_not_its_image_url(self):
        self.assertEqual(purge.owned_photo_path({"createdBy": "uA", "image": "afd/uB/x"}, "ent_u_ab12"),
                         "afd_pics/uA/ent_u_ab12.jpg")
        for edata, eid in [({}, "ent_u_ab12"), ({"createdBy": "uA"}, "ent_sun"),
                           ({"createdBy": "../uB"}, "ent_u_ab12"), ({"createdBy": "uA"}, "ent_u_../x")]:
            self.assertIsNone(purge.owned_photo_path(edata, eid))


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
        # fixity for the export manifest: sha256 of the stored bytes
        self.assertEqual(ref.update.call_args[0][0]["sha256"],
                         hashlib.sha256(b"audio").hexdigest())

    def test_sends_an_id_token_for_the_service_url(self):
        fetch = sys.modules["google.oauth2.id_token"].fetch_id_token
        fetch.reset_mock()
        _, post = self._run({"uid": "uA", "storagePath": self.NAME})
        self.assertEqual(fetch.call_args[0][1], "https://embed.invalid")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer id-tok")

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
        # returned quietly, no raise — and only the checksum was written, so the
        # take can still be verified on export even with no embedding
        ref.update.assert_called_once_with({"sha256": hashlib.sha256(b"audio").hexdigest()})


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

    # --- a reload that fails must not take search down with it
    def _loaded_stale(self, age_s):
        """A corpus that loaded fine `age_s` ago and is now due a reload."""
        c = service.Corpus()
        c._snap = (service.np.array([[1.0, 0.0]], dtype=service.np.float32), ["ent_old"], ["old"])
        c.loaded, c.loaded_at = True, service.time.monotonic() - age_s
        return c

    def test_failed_reload_serves_the_last_good_copy(self):
        c = self._loaded_stale(service.CORPUS_MAX_AGE_S + 1)
        with mock.patch.object(c, "load_from_firestore", side_effect=RuntimeError("firestore down")):
            c.ensure_fresh()                                   # no exception
        hits = c.search(service.np.array([1.0, 0.0], dtype=service.np.float32))
        self.assertEqual([h["entryId"] for h in hits], ["ent_old"])

    def test_failed_reload_with_nothing_cached_is_a_503(self):
        c = service.Corpus()
        with mock.patch.object(c, "load_from_firestore", side_effect=RuntimeError("firestore down")):
            with self.assertRaises(service.HTTPException) as cm:
                c.ensure_fresh()
        self.assertEqual(cm.exception.status_code, 503)

    def test_a_copy_past_the_stale_limit_is_refused(self):
        # the reload is what carries a withdrawal into search, so the old copy
        # is only trusted for a bounded time
        c = self._loaded_stale(service.CORPUS_STALE_OK_S + 1)
        with mock.patch.object(c, "load_from_firestore", side_effect=RuntimeError("firestore down")):
            with self.assertRaises(service.HTTPException) as cm:
                c.ensure_fresh()
        self.assertEqual(cm.exception.status_code, 503)

    def test_failed_reload_backs_off_then_recovers(self):
        c = self._loaded_stale(service.CORPUS_MAX_AGE_S + 1)
        with mock.patch.object(c, "load_from_firestore", side_effect=RuntimeError("firestore down")) as load:
            c.ensure_fresh(); c.ensure_fresh(); c.ensure_fresh()
        self.assertEqual(load.call_count, 1)                   # not once per search
        c._retry_at = 0.0                                      # the back-off has passed
        def good_load():
            c.loaded, c.loaded_at = True, service.time.monotonic()
        with mock.patch.object(c, "load_from_firestore", side_effect=good_load) as load:
            c.ensure_fresh()
        self.assertEqual(load.call_count, 1)
        self.assertFalse(c.stale())

    def test_a_reload_that_dies_midway_keeps_the_old_rows(self):
        c = self._loaded_stale(service.CORPUS_MAX_AGE_S + 1)
        def stream():
            s = mock.MagicMock()
            s.to_dict.return_value = {"entryId": "ent_new", "gloss": "new", "consent": "public",
                                      "allowPlayback": True, "reps": [{"vector": [0.0, 1.0]}]}
            yield s
            raise RuntimeError("stream broke")
        firestore = sys.modules["google.cloud.firestore"]
        with mock.patch.object(firestore, "Client") as client:
            client.return_value.collection_group.return_value.stream.side_effect = stream
            c.ensure_fresh()
        self.assertEqual(c.entry_ids, ["ent_old"])             # never a half-loaded corpus


# ------------------------------------------------------- embed service limits
class EmbedServiceGuards(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        self.client = TestClient(service.app)
        self.verify = sys.modules["google.oauth2.id_token"].verify_oauth2_token
        self.verify.reset_mock(side_effect=True, return_value=True)

    def _caller_env(self, audience="https://svc", callers=("trigger@sa",)):
        return mock.patch.multiple(service, EMBED_AUDIENCE=audience, EMBED_CALLERS=set(callers))

    def test_embed_refused_when_unconfigured(self):
        with self._caller_env(audience="", callers=()):
            r = self.client.post("/embed", files={"file": ("a.webm", b"x")})
        self.assertEqual(r.status_code, 503)

    def test_embed_needs_a_valid_token_from_an_allowed_caller(self):
        with self._caller_env():
            self.assertEqual(self.client.post("/embed", files={"file": ("a", b"x")}).status_code, 401)
            self.verify.side_effect = ValueError("bad signature")
            r = self.client.post("/embed", files={"file": ("a", b"x")}, headers={"Authorization": "Bearer t"})
            self.assertEqual(r.status_code, 401)
            self.verify.side_effect = None
            self.verify.return_value = {"email": "someone@else"}
            r = self.client.post("/embed", files={"file": ("a", b"x")}, headers={"Authorization": "Bearer t"})
            self.assertEqual(r.status_code, 403)
            self.verify.return_value = {"email": "trigger@sa"}
            service.require_embed_caller("Bearer t")          # allowed: no exception
            self.assertEqual(self.verify.call_args.kwargs["audience"], "https://svc")

    def test_reindex_fails_closed(self):
        with mock.patch.object(service, "ADMIN_TOKEN", ""):
            self.assertEqual(self.client.post("/reindex").status_code, 403)
        with mock.patch.object(service, "ADMIN_TOKEN", "s3cret"), \
             mock.patch.object(service._corpus, "load_from_firestore", return_value=0) as load:
            self.assertEqual(self.client.post("/reindex", headers={"X-Admin-Token": "nope"}).status_code, 403)
            load.assert_not_called()
            self.assertEqual(self.client.post("/reindex", headers={"X-Admin-Token": "s3cret"}).status_code, 200)

    def test_oversize_upload_is_refused_before_any_work(self):
        with mock.patch.object(service, "MAX_UPLOAD_BYTES", 10), \
             mock.patch.object(service._corpus, "ensure_fresh") as fresh:
            r = self.client.post("/search", files={"file": ("a.webm", b"x" * 11)})
        self.assertEqual(r.status_code, 413)
        fresh.assert_not_called()

    def test_long_audio_is_refused(self):
        import subprocess
        wav = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
                              "-t", "3", "-f", "wav", "pipe:1"], stdout=subprocess.PIPE, check=True).stdout
        with mock.patch.object(service, "MAX_AUDIO_S", 2.0):
            with self.assertRaises(service.HTTPException) as cm:
                service.decode_to_16k_mono(wav)
            self.assertEqual(cm.exception.status_code, 413)
        with mock.patch.object(service, "MAX_AUDIO_S", 5.0):
            self.assertEqual(service.decode_to_16k_mono(wav).size, 3 * 16000)

    def test_handlers_run_in_the_threadpool(self):
        import inspect
        for f in (service.embed, service.search, service.reindex):
            self.assertFalse(inspect.iscoroutinefunction(f), f.__name__)

    def test_top_k_is_capped(self):
        with mock.patch.object(service, "embed_waveform", return_value={"embedding": None, "n_reps": 1}), \
             mock.patch.object(service, "decode_to_16k_mono"), \
             mock.patch.object(service._corpus, "ensure_fresh"), \
             mock.patch.object(service._corpus, "search", return_value=[]) as search:
            self.client.post("/search?top_k=100000", files={"file": ("a", b"x")})
        self.assertEqual(search.call_args.kwargs["top_k"], service.MAX_TOP_K)

    def test_search_answers_from_the_old_copy_and_says_how_old(self):
        c = service._corpus
        saved = (c._snap, c.loaded, c.loaded_at, c._retry_at)
        try:
            c._snap = (service.np.array([[1.0, 0.0]], dtype=service.np.float32), ["ent_old"], ["old"])
            c.loaded, c.loaded_at, c._retry_at = True, service.time.monotonic() - 400, 0.0
            q = {"embedding": service.np.array([1.0, 0.0], dtype=service.np.float32), "n_reps": 1}
            with mock.patch.object(service, "embed_waveform", return_value=q), \
                 mock.patch.object(service, "decode_to_16k_mono"), \
                 mock.patch.object(c, "load_from_firestore", side_effect=RuntimeError("firestore down")):
                r = self.client.post("/search", files={"file": ("a", b"x")})
            self.assertEqual(r.status_code, 200)
            self.assertEqual([h["entryId"] for h in r.json()["results"]], ["ent_old"])
            self.assertGreaterEqual(r.json()["corpus_age_s"], 400)
        finally:
            c._snap, c.loaded, c.loaded_at, c._retry_at = saved

    def test_search_with_no_corpus_at_all_is_a_503_the_browser_can_read(self):
        c = service._corpus
        saved = (c._snap, c.loaded, c.loaded_at, c._retry_at)
        try:
            c.loaded, c.loaded_at, c._retry_at = False, 0.0, 0.0
            with mock.patch.object(c, "load_from_firestore", side_effect=RuntimeError("firestore down")):
                r = self.client.post("/search", files={"file": ("a", b"x")},
                                     headers={"Origin": "https://hakli.app"})
            self.assertEqual(r.status_code, 503)
            # CORS headers must ride on the error too, or the page only sees "network error"
            self.assertEqual(r.headers.get("access-control-allow-origin"), "https://hakli.app")
        finally:
            c._snap, c.loaded, c.loaded_at, c._retry_at = saved

    def test_concurrent_stale_searches_reload_once(self):
        import threading
        c = service.Corpus()
        calls = []
        def slow_load():
            calls.append(1)
            service.time.sleep(0.05)
            c.loaded, c.loaded_at = True, service.time.monotonic()
        with mock.patch.object(c, "load_from_firestore", side_effect=slow_load):
            ts = [threading.Thread(target=c.ensure_fresh) for _ in range(8)]
            for t in ts: t.start()
            for t in ts: t.join()
        self.assertEqual(len(calls), 1)


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


class VoiceCounts(unittest.TestCase):
    """voice_counts/main.py — recounts a word's public voices onto its card."""

    def setUp(self):
        self.m = _load("voice_counts_main", "voice_counts/main.py")

    def _snap(self, d):
        s = mock.MagicMock(); s.to_dict.return_value = d; return s

    def _entry(self, recs):
        ref = mock.MagicMock()
        ref.collection.return_value.where.return_value.stream.return_value = [self._snap(d) for d in recs]
        self.m._db.collection.return_value.document.return_value = ref
        return ref

    def test_recounts_public_voices_by_type(self):
        ref = self._entry([{"type": "word"}, {"type": "word"}, {"phase": "context"}, {}, {"type": "definition"}, {"type": "odd"}])
        self.m.on_recording_write({"document": "afd_entries/ent_sun/recordings/r1"})
        self.m._db.collection.return_value.document.assert_called_with("ent_sun")
        args = ref.update.call_args[0][0]
        self.assertEqual(args["voices"], {"word": 3, "context": 1, "definition": 1})
        # only voices others can hear are queried
        self.assertEqual(ref.collection.return_value.where.call_args.kwargs["filter"], ("allowPlayback", "==", True))

    def test_entry_from_subject_when_no_document_attribute(self):
        ref = self._entry([])
        self.m.on_recording_write({"subject": "documents/afd_entries/ent_u_x/recordings/r9"})
        self.m._db.collection.return_value.document.assert_called_with("ent_u_x")
        self.assertEqual(ref.update.call_args[0][0]["voices"], {"word": 0, "context": 0, "definition": 0})

    def test_a_reaped_word_is_not_recreated(self):
        ref = self._entry([])
        ref.update.side_effect = sys.modules["google.api_core.exceptions"].NotFound()
        self.m.on_recording_write({"document": "afd_entries/ent_gone/recordings/r1"})   # no raise
        ref.set.assert_not_called()

    def test_other_paths_are_ignored(self):
        ref = self._entry([])
        self.m.on_recording_write({"document": "afd_speakers/spk_x/private/profile"})
        ref.update.assert_not_called()


class Watch(unittest.TestCase):
    """watch/main.py — the watchdog's rules and the digest's wording (pure parts)."""

    def setUp(self):
        self.m = _load("afd_watch", "watch/main.py")
        import datetime as dt
        self.dt = dt
        self.now = dt.datetime(2026, 10, 18, 13, 0, tzinfo=dt.timezone.utc)

    def err(self, where, code, n, page="index.html"):
        return [{"where": where, "code": code, "page": page}] * n

    def keys(self, alerts):
        return [k for k, _, _ in alerts]

    def test_a_few_errors_are_not_an_alert(self):
        self.assertEqual(self.m.find_alerts(self.err("recorder.upload", "unavailable", 4), [], self.now, None, None), [])

    def test_five_of_one_failure_in_an_hour_is(self):
        a = self.m.find_alerts(self.err("recorder.upload", "unavailable", 5), [], self.now, None, None)
        self.assertEqual(self.keys(a), ["err:recorder.upload|unavailable"])
        self.assertIn("client-errors.mjs", a[0][2])

    def test_sign_in_alerts_sooner(self):
        a = self.m.find_alerts(self.err("signin.phone", "auth/operation-not-allowed", 3), [], self.now, None, None)
        self.assertEqual(self.keys(a), ["err:signin.phone|auth/operation-not-allowed"])

    def test_search_failing_needs_three_and_half(self):
        ev = lambda v: {"ev": "search", "v": v}
        many_ok = [ev("err.timeout")] * 3 + [ev("here")] * 10
        self.assertEqual(self.m.find_alerts([], many_ok, self.now, None, None), [])
        bad = [ev("err.timeout")] * 2 + [ev("err.server")] + [ev("here")] * 2
        a = self.m.find_alerts([], bad, self.now, None, None)
        self.assertEqual(self.keys(a), ["search"])
        self.assertIn("timeout 2", a[0][2])

    def test_silence_only_during_a_field_week(self):
        week = self.now + self.dt.timedelta(days=5)
        old = self.now - self.dt.timedelta(hours=30)
        recent = self.now - self.dt.timedelta(hours=2)
        self.assertEqual(self.keys(self.m.find_alerts([], [], self.now, week, old)), ["silence"])
        self.assertEqual(self.keys(self.m.find_alerts([], [], self.now, week, None)), ["silence"])
        self.assertEqual(self.m.find_alerts([], [], self.now, week, recent), [])
        self.assertEqual(self.m.find_alerts([], [], self.now, None, old), [])
        self.assertEqual(self.m.find_alerts([], [], self.now, self.now - self.dt.timedelta(days=1), old), [])

    def test_an_alert_waits_before_repeating(self):
        h = lambda n: self.now - self.dt.timedelta(hours=n)
        self.assertTrue(self.m.due("search", {}, self.now))
        self.assertFalse(self.m.due("search", {"search": h(2)}, self.now))
        self.assertTrue(self.m.due("search", {"search": h(7)}, self.now))
        self.assertFalse(self.m.due("silence", {"silence": h(7)}, self.now))
        self.assertTrue(self.m.due("silence", {"silence": h(25)}, self.now))

    def test_digest_reads_plainly(self):
        events = ([{"ev": "view", "page": "index.html", "v": "sound"}] * 3 +
                  [{"ev": "view", "page": "add.html", "v": "auto", "x": "quiet"}] +
                  [{"ev": "search", "v": "here", "n": 2000}, {"ev": "search", "v": "pick", "n": 4000},
                   {"ev": "search", "v": "err.timeout", "n": 120000}, {"ev": "search", "v": "none", "n": 3000}] +
                  [{"ev": "play", "v": "word"}] * 5 + [{"ev": "play", "v": "novoice"}] +
                  [{"ev": "rec", "v": "keep", "x": "word.proxy"}, {"ev": "rec", "v": "keep", "x": "context"},
                   {"ev": "rec", "v": "skip"}] +
                  [{"ev": "add", "v": "show"}, {"ev": "add", "v": "done"}, {"ev": "signin", "v": "phone"}])
        errors = self.err("search", "http 503", 2)
        t = self.m.digest_text(events, errors, {"words": 40, "voices": 120, "speakers": 9},
                               {"words": 38, "voices": 110, "speakers": 9}, ["Search failing"], self.now)
        self.assertIn("40 words with a voice (+2)", t)
        self.assertIn("120 voices (+10)", t)
        self.assertIn("9 speakers", t)
        self.assertNotIn("9 speakers (", t)
        self.assertIn("Spoken searches: 4 — found 25%", t)
        self.assertIn("median 3.0 s", t)              # failed searches don't count toward speed
        self.assertIn("sound (no text) 75%", t)
        self.assertIn("quiet mode 25%", t)
        self.assertIn("Voices played: 5", t)
        self.assertIn("no voice yet: 1", t)
        self.assertIn("2 takes kept (word 1, context 1), 1 for someone else", t)
        self.assertIn("Sign-ins: phone 1", t)
        self.assertIn("2  search · http 503", t)
        self.assertIn("Alerts sent: Search failing", t)

    def test_a_quiet_day_says_so(self):
        t = self.m.digest_text([], [], {"words": 1, "voices": 2, "speakers": 1}, None, [], self.now)
        self.assertIn("quiet day", t)
        self.assertIn("Nothing failed.", t)

    def test_the_day_doc_keeps_totals_not_people(self):
        d = self.m.day_doc([{"ev": "search", "v": "here", "n": 1000}, {"ev": "play", "v": "word"}],
                           self.err("x", "y", 1), {"words": 1}, self.now, self.now)
        self.assertEqual(d["counts"], {"search|here": 1, "play|word": 1})
        self.assertEqual(d["searchMsMedian"], 1000)
        self.assertEqual(d["errorTop"], ["1 x · y"])

    def test_the_job_comes_from_the_message(self):
        import base64
        ce = lambda b: types.SimpleNamespace(data={"message": {"data": base64.b64encode(b).decode()}})
        self.assertEqual(self.m.job_of(ce(b"digest")), "digest")
        self.assertEqual(self.m.job_of(ce(b"public\n")), "public")
        self.assertEqual(self.m.job_of(types.SimpleNamespace(data={})), "check")

    def test_no_mail_settings_only_logs(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(self.m.send_mail("s", "b"))


if __name__ == "__main__":
    unittest.main()
