"""
Audio First Dictionary — embedding & match service
===================================================

One warm service that turns Hakli audio into a vector, exposed two ways:

  POST /embed    audio bytes  -> { embedding: [...], dim, layer }
  POST /search   audio bytes  -> { results: [ {entryId, gloss, distance}, ... ] }
  POST /reindex  (admin)      -> reloads the corpus embedding cache from Firestore
  GET  /healthz               -> readiness (also reports whether the model is warm)

Why this shape
--------------
The heavy model (MMS-300m) is loaded ONCE at startup and kept warm
(deploy with --min-instances=1). Every corpus recording is embedded a
single time, at upload, and its vector is stored on the recording doc.
So the only heavy work per *search* is embedding the one query clip;
the match itself is cheap vector math over the cached corpus.

This same /embed call powers BOTH:
  - speak-to-find  (query audio -> nearest entries)
  - duplicate detection (a new recording -> does it sound like an entry already?)
They are the same operation pointed at different inputs.

Model / preprocessing match the notebook findings:
  facebook/mms-300m, hidden state layer 12 (env EMBED_LAYER),
  mean-pooled over time, L2-normalised. Input resampled to 16 kHz mono.
  Distance is cosine (1 - dot on unit vectors) — the same scale where
  within-speaker self-repeats landed at 0.14–0.25.
"""

import io
import os
import subprocess
import threading
from typing import List, Optional

import numpy as np
import torch
from fastapi import FastAPI, UploadFile, File, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from transformers import Wav2Vec2Model

# ------------------------------------------------------------------ config
MODEL_ID      = os.environ.get("EMBED_MODEL", "facebook/mms-300m")
EMBED_LAYER   = int(os.environ.get("EMBED_LAYER", "12"))   # notebook's best-ish, flat curve
TARGET_SR     = 16000                                       # wav2vec2 / MMS expects 16 kHz
ADMIN_TOKEN   = os.environ.get("ADMIN_TOKEN", "")           # gate /reindex if set
TORCH_THREADS = int(os.environ.get("TORCH_THREADS", "0"))   # 0 = leave default

if TORCH_THREADS:
    torch.set_num_threads(TORCH_THREADS)

app = FastAPI(title="AFD embed & match")

# The consumer page (speak-to-find) calls /search straight from the browser,
# which is cross-origin to run.app. Allow the hosting origins. Search takes
# audio and returns matches — no secrets — so this is safe to open.
_default_origins = ("https://hytra3.github.io,https://afd-dev.web.app,"
                    "https://afd-dev.firebaseapp.com,http://localhost:5000,"
                    "http://localhost:8000")
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", _default_origins).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------ model (warm)
_model: Optional[Wav2Vec2Model] = None
_model_lock = threading.Lock()


def get_model() -> Wav2Vec2Model:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                m = Wav2Vec2Model.from_pretrained(MODEL_ID)
                m.eval()
                _model = m
    return _model


# ------------------------------------------------------------------ audio in
def decode_to_16k_mono(raw: bytes) -> np.ndarray:
    """Any container ffmpeg understands (webm/opus, wav, m4a, amr...) -> float32 mono @16k."""
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0",
         "-ac", "1", "-ar", str(TARGET_SR), "-f", "f32le", "pipe:1"],
        input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=400,
                            detail=f"could not decode audio: {proc.stderr.decode()[:200]}")
    audio = np.frombuffer(proc.stdout, dtype=np.float32).copy()
    if audio.size == 0:
        raise HTTPException(status_code=400, detail="empty audio after decode")
    return audio


def embed_waveform(audio: np.ndarray) -> np.ndarray:
    """mean-pooled, L2-normalised hidden state at EMBED_LAYER. Returns float32[dim]."""
    # wav2vec2-large normalisation: zero mean, unit variance over the clip
    audio = (audio - audio.mean()) / (audio.std() + 1e-7)
    x = torch.from_numpy(audio).unsqueeze(0)  # [1, T]
    model = get_model()
    with torch.no_grad():
        out = model(x, output_hidden_states=True)
    hs = out.hidden_states[EMBED_LAYER][0]     # [T', H]
    vec = hs.mean(dim=0)                        # [H]
    vec = vec / (vec.norm() + 1e-7)             # unit length -> cosine == dot
    return vec.numpy().astype(np.float32)


# ------------------------------------------------------------------ corpus cache
class Corpus:
    """In-memory nearest-neighbour over recording embeddings, grouped by entry.

    Small by design: hundreds–low thousands of recordings. Brute force is fine
    and needs no vector DB. An entry matches if the query is near ANY of its
    recordings, so pronunciation variants under one entry all count."""

    def __init__(self):
        self.vecs: np.ndarray = np.zeros((0, 0), dtype=np.float32)   # [N, H]
        self.entry_ids: List[str] = []
        self.glosses: List[str] = []
        self.loaded = False

    def load_from_firestore(self):
        from google.cloud import firestore
        db = firestore.Client()
        vecs, entry_ids, glosses = [], [], []
        # collection-group over every entry's recordings; only playable + embedded
        for snap in db.collection_group("recordings").stream():
            d = snap.to_dict() or {}
            emb = d.get("embedding")
            if not emb:
                continue
            vecs.append(np.asarray(emb, dtype=np.float32))
            entry_ids.append(d.get("entryId", snap.reference.parent.parent.id))
            glosses.append(d.get("gloss", ""))
        self.vecs = np.vstack(vecs) if vecs else np.zeros((0, 0), dtype=np.float32)
        self.entry_ids = entry_ids
        self.glosses = glosses
        self.loaded = True
        return len(entry_ids)

    def search(self, q: np.ndarray, top_k: int = 5):
        if self.vecs.shape[0] == 0:
            return []
        # cosine distance on unit vectors = 1 - dot
        sims = self.vecs @ q                      # [N]
        dists = 1.0 - sims
        # best (smallest) distance per entry
        best = {}
        for i, eid in enumerate(self.entry_ids):
            di = float(dists[i])
            if eid not in best or di < best[eid][0]:
                best[eid] = (di, self.glosses[i])
        ranked = sorted(best.items(), key=lambda kv: kv[1][0])[:top_k]
        return [{"entryId": eid, "gloss": g, "distance": round(d, 4)}
                for eid, (d, g) in ranked]


_corpus = Corpus()


# ------------------------------------------------------------------ routes
@app.get("/healthz")
def healthz():
    return {"ok": True, "model_warm": _model is not None,
            "model": MODEL_ID, "layer": EMBED_LAYER,
            "corpus_loaded": _corpus.loaded, "corpus_n": len(_corpus.entry_ids)}


@app.post("/embed")
async def embed(file: UploadFile = File(...)):
    raw = await file.read()
    vec = embed_waveform(decode_to_16k_mono(raw))
    return {"embedding": vec.tolist(), "dim": int(vec.shape[0]), "layer": EMBED_LAYER}


@app.post("/search")
async def search(file: UploadFile = File(...), top_k: int = 5):
    if not _corpus.loaded:
        _corpus.load_from_firestore()
    vec = embed_waveform(decode_to_16k_mono(await file.read()))
    return {"results": _corpus.search(vec, top_k=top_k),
            "corpus_n": len(_corpus.entry_ids)}


@app.post("/reindex")
def reindex(x_admin_token: str = Header(default="")):
    if ADMIN_TOKEN and x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="bad admin token")
    n = _corpus.load_from_firestore()
    return {"reindexed": True, "corpus_n": n}


@app.on_event("startup")
def _warm():
    # Warm the model in a BACKGROUND thread so the container reports healthy
    # immediately. If we loaded the ~1 GB model here synchronously, startup
    # would block long enough for Cloud Run to recycle the container — a
    # cold-start loop where every request hits the frontend 404. Instead:
    # /healthz answers at once, and the model loads without gating startup.
    # get_model()'s lock means the first real /embed waits for this to finish.
    def _bg():
        try:
            get_model()
            print("model warmed")
        except Exception as e:
            print("model warm failed:", e)
    threading.Thread(target=_bg, daemon=True).start()
