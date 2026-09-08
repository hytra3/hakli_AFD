"""
Audio First Dictionary — embedding & match service
===================================================

One warm service that turns Hakli audio into a vector, exposed two ways:

  POST /embed    audio bytes  -> { embedding, vectors, n_reps, rep_distance, rep_offsets, dim, layer }
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

Rep-splitting (09-2026)
-----------------------
Corpus atoms are "say it twice" clips: word, pause, word. Mean pooling
averages MMS frames WITHIN a clip, and silence frames carry a consistent
"silence" vector, so a whole-clip pool is roughly (word + word + pause)/3
and the pause length becomes a confound. Pooling is order-invariant, so
once silence is dropped, word+word ≈ word. Hence:

  - a cheap energy VAD finds the voiced bursts ("reps") in the clip;
  - the model runs ONCE over the whole clip (context intact), and each
    rep is mean-pooled over its own frames only  -> `vectors` (one/rep);
  - `embedding` is the pool over ALL voiced frames (silence dropped) —
    the single-vector view, used for queries and as the compat field;
  - `n_reps`, `rep_distance` (cosine between reps; max pairwise if >2)
    and `rep_offsets` ([start,end] seconds per rep) let the recorder run
    a soft QC gate ("we couldn't quite catch it twice — listen back?")
    and give us the within-speaker calibration pairs for free.

Search compares the query's `embedding` against every stored rep vector
and takes the nearest rep per entry — same policy as nearest-recording-
per-entry, one level down. The atom in Storage is untouched.
"""

import io
import os
import subprocess
import threading
from typing import Any, Dict, List, Optional, Tuple

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

# Energy VAD for rep-splitting. All tunable; defaults chosen for citation-form
# single words with a deliberate pause between reps. Revisit once we have the
# Hakli misfire rate (see ROADMAP "Rep-splitting", step 4).
VAD_FRAME_MS   = 20                                            # analysis window
VAD_HOP_MS     = 10
VAD_ABOVE_FLOOR_DB = float(os.environ.get("VAD_ABOVE_FLOOR_DB", "12"))  # speech >= floor + this
VAD_BELOW_PEAK_DB  = float(os.environ.get("VAD_BELOW_PEAK_DB", "35"))   # ... and >= peak - this
VAD_MIN_GAP_MS     = int(os.environ.get("VAD_MIN_GAP_MS", "180"))       # shorter gaps merge (stop closures, hesitations)
VAD_MIN_SEG_MS     = int(os.environ.get("VAD_MIN_SEG_MS", "120"))       # shorter bursts drop (clicks, breaths)
VAD_PAD_MS         = int(os.environ.get("VAD_PAD_MS", "60"))            # grow each rep to protect weak onsets/offsets

# wav2vec2/MMS feature encoder: one hidden-state frame per 320 samples (20 ms)
# at 16 kHz, first frame centred ~12.5 ms in.
FRAME_STRIDE_S = 320 / TARGET_SR
FRAME_OFFSET_S = 200 / TARGET_SR

if TORCH_THREADS:
    torch.set_num_threads(TORCH_THREADS)

app = FastAPI(title="AFD embed & match")

# The consumer page (speak-to-find) calls /search straight from the browser,
# which is cross-origin to run.app. Allow the hosting origins. Search takes
# audio and returns matches — no secrets — so this is safe to open.
_default_origins = ("https://hakli.app,https://www.hakli.app,"
                    "https://hytra3.github.io,https://afd-dev.web.app,"
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


# ------------------------------------------------------------------ VAD (rep split)
def find_reps(audio: np.ndarray, sr: int = TARGET_SR) -> List[Tuple[float, float]]:
    """Energy VAD -> [(start_s, end_s), ...] voiced bursts, in order.

    Pure numpy, no model. Frame RMS in dB; a frame is speech if it clears BOTH
    an adaptive noise floor (10th percentile + VAD_ABOVE_FLOOR_DB) and a
    peak-relative gate (peak - VAD_BELOW_PEAK_DB). Adjacent bursts closer than
    VAD_MIN_GAP_MS merge (so a stop closure inside a word doesn't split it);
    bursts shorter than VAD_MIN_SEG_MS drop; survivors grow by VAD_PAD_MS so a
    weak glottal onset or trailing fricative isn't shaved off.

    Returns [] for an all-silent clip. Known misfire modes (see ROADMAP): lost
    breathy onsets, reps merging when the pause is very short, long internal
    closures splitting a word — the recorder's soft gate catches these.
    """
    frame = int(sr * VAD_FRAME_MS / 1000)
    hop   = int(sr * VAD_HOP_MS / 1000)
    if audio.size < frame:
        return []
    n = 1 + (audio.size - frame) // hop
    idx = np.arange(frame)[None, :] + hop * np.arange(n)[:, None]
    rms = np.sqrt((audio[idx] ** 2).mean(axis=1) + 1e-12)
    db  = 20.0 * np.log10(rms)

    floor = float(np.percentile(db, 10))
    peak  = float(db.max())
    thr   = max(floor + VAD_ABOVE_FLOOR_DB, peak - VAD_BELOW_PEAK_DB)
    voiced = db >= thr
    if not voiced.any():
        return []

    # runs of voiced frames -> (start_frame, end_frame_exclusive)
    edges = np.diff(np.concatenate(([0], voiced.astype(np.int8), [0])))
    starts = np.flatnonzero(edges == 1)
    ends   = np.flatnonzero(edges == -1)

    # merge across short gaps
    min_gap = VAD_MIN_GAP_MS / VAD_HOP_MS
    merged: List[List[int]] = []
    for s, e in zip(starts, ends):
        if merged and s - merged[-1][1] < min_gap:
            merged[-1][1] = int(e)
        else:
            merged.append([int(s), int(e)])

    # drop shorties, pad, convert to seconds
    min_seg = VAD_MIN_SEG_MS / VAD_HOP_MS
    pad_s   = VAD_PAD_MS / 1000.0
    total_s = audio.size / sr
    reps: List[Tuple[float, float]] = []
    for s, e in merged:
        if e - s < min_seg:
            continue
        start = max(0.0, s * hop / sr - pad_s)
        end   = min(total_s, (e * hop + frame) / sr + pad_s)
        if reps and start <= reps[-1][1]:            # padding made them touch
            reps[-1] = (reps[-1][0], end)
        else:
            reps.append((start, end))
    return reps


def _pool(hs: torch.Tensor, mask: np.ndarray) -> np.ndarray:
    """mean over the frames selected by mask, L2-normalised -> float32[H]."""
    sel = hs[torch.from_numpy(mask)]
    vec = sel.mean(dim=0)
    vec = vec / (vec.norm() + 1e-7)                 # unit length -> cosine == dot
    return vec.numpy().astype(np.float32)


def embed_waveform(audio: np.ndarray) -> Dict[str, Any]:
    """Run the model once over the clip; pool per rep and over all voiced frames.

    Returns {
      embedding:    float32[H]   pool over ALL voiced frames (silence dropped)
      vectors:      [float32[H]] one per rep, in clip order
      n_reps:       int
      rep_distance: float|None  cosine between reps (max pairwise if >2)
      rep_offsets:  [[start_s, end_s], ...]
    }
    If VAD finds nothing (n_reps == 0) we fall back to pooling the whole clip so
    the caller still gets a vector, and the zero count is the flag.
    """
    reps = find_reps(audio)

    # wav2vec2-large normalisation: zero mean, unit variance over the clip
    norm = (audio - audio.mean()) / (audio.std() + 1e-7)
    x = torch.from_numpy(norm).unsqueeze(0)         # [1, T]
    model = get_model()
    with torch.no_grad():
        out = model(x, output_hidden_states=True)
    hs = out.hidden_states[EMBED_LAYER][0]          # [T', H]
    n_frames = hs.shape[0]
    t = FRAME_OFFSET_S + FRAME_STRIDE_S * np.arange(n_frames)   # frame centre times

    vectors: List[np.ndarray] = []
    voiced_any = np.zeros(n_frames, dtype=bool)
    for start, end in reps:
        m = (t >= start) & (t < end)
        if not m.any():                              # rep shorter than one frame stride
            continue
        vectors.append(_pool(hs, m))
        voiced_any |= m

    if not voiced_any.any():                         # nothing voiced -> whole clip
        voiced_any[:] = True
    embedding = _pool(hs, voiced_any)

    rep_distance: Optional[float] = None
    if len(vectors) >= 2:
        d = [1.0 - float(vectors[i] @ vectors[j])
             for i in range(len(vectors)) for j in range(i + 1, len(vectors))]
        rep_distance = round(max(d), 4)

    return {
        "embedding": embedding,
        "vectors": vectors,
        "n_reps": len(vectors),
        "rep_distance": rep_distance,
        "rep_offsets": [[round(s, 3), round(e, 3)] for s, e in reps],
    }


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
            # one row per rep vector (nearest-rep-per-entry); legacy docs that
            # only carry the whole-clip `embedding` still count as one row
            rows = d.get("vectors") or ([d["embedding"]] if d.get("embedding") else [])
            eid = d.get("entryId", snap.reference.parent.parent.id)
            for emb in rows:
                vecs.append(np.asarray(emb, dtype=np.float32))
                entry_ids.append(eid)
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
    r = embed_waveform(decode_to_16k_mono(raw))
    return {"embedding": r["embedding"].tolist(),
            "vectors": [v.tolist() for v in r["vectors"]],
            "n_reps": r["n_reps"],
            "rep_distance": r["rep_distance"],
            "rep_offsets": r["rep_offsets"],
            "dim": int(r["embedding"].shape[0]), "layer": EMBED_LAYER}


@app.post("/search")
async def search(file: UploadFile = File(...), top_k: int = 5):
    if not _corpus.loaded:
        _corpus.load_from_firestore()
    # query = disposable single utterance; if the searcher repeats anyway, the
    # voiced-only pool still ≈ one word (order-invariant), so no split needed
    r = embed_waveform(decode_to_16k_mono(await file.read()))
    return {"results": _corpus.search(r["embedding"], top_k=top_k),
            "corpus_n": len(_corpus.entry_ids),
            "n_reps": r["n_reps"]}


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
