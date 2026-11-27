"""
AFD warm  (2nd-gen Cloud Functions)
===================================
Let a steward pin the matcher (afd-embed, Cloud Run) warm from their phone for a
set stretch — a demo, a field session — and have it cool itself back down when
the timer runs out, with no laptop and no gcloud.

Two entry points live in this one file (deployed as two functions from the same
folder, the way purge/ is one):

  warm       (HTTP)        the steward page (warm.html) calls this.
                           GET  -> { min_instances, off_at, now }   current state
                           POST { minutes: N }  -> warm for N minutes (min=1)
                           POST { minutes: 0 }  -> sleep now (min=0)
                           Caller must send a Firebase ID token (Authorization:
                           Bearer <token>) for an account that has an
                           afd_admins/{uid} doc — the same gate steward.html uses.

  reconcile  (Pub/Sub)     Cloud Scheduler pokes topic afd-warm-tick every few
                           minutes. If the warm timer has passed, drop the
                           service back to min-instances=0. Idempotent.

The schedule (off_at) and an audit trail live in Firestore at
afd_ui_config/warm. The real source of truth for min-instances is Cloud Run
itself; Firestore only says *until when* it should stay warm. This function runs
with admin rights (Firestore read/write, Cloud Run read/update) so the browser
never touches either directly — the page only ever talks to this endpoint.

Billing safety: WARM is an always-on 2 CPU / 8 GiB instance while pinned. The
reconcile sweep is the backstop that makes sure a forgotten "on" turns itself
off; MAX_WARM_MINUTES caps how long any single request can ask for.

Deploy: see scripts/deploy-warm.sh (includes the one-time IAM grants).
"""

import os
import json
import time
import datetime

import functions_framework
import firebase_admin
from firebase_admin import auth as fb_auth
from google.cloud import firestore
from google.cloud import run_v2

# ------------------------------------------------------------------ config
PROJECT = os.environ.get("WARM_PROJECT", "afd-dev")
REGION  = os.environ.get("WARM_REGION", "europe-west1")
SERVICE = os.environ.get("WARM_SERVICE", "afd-embed")
ADMIN_COLLECTION = os.environ.get("WARM_ADMIN_COLLECTION", "afd_admins")
# A single request can ask for at most this many minutes of warm. The reconcile
# sweep enforces it even if a request slips a bigger number past the client.
MAX_WARM_MINUTES = int(os.environ.get("WARM_MAX_MINUTES", "240"))   # 4 hours
# Only this origin may call the browser endpoint (the page is served here).
ALLOW_ORIGIN = os.environ.get("WARM_ALLOW_ORIGIN", "https://hakli.app")
CONFIG_DOC = ("afd_ui_config", "warm")

# Lazily built so a cold reconcile tick doesn't pay for clients it won't use.
_db = None
_run = None


def _firestore():
    global _db
    if _db is None:
        _db = firestore.Client(project=PROJECT)
    return _db


def _run_client():
    global _run
    if _run is None:
        _run = run_v2.ServicesClient()
    return _run


def _ensure_fb():
    if not firebase_admin._apps:
        firebase_admin.initialize_app()


# ------------------------------------------------------------------ Cloud Run
def _service_name():
    return _run_client().service_path(PROJECT, REGION, SERVICE)


def get_min_instances():
    svc = _run_client().get_service(name=_service_name())
    return int(svc.template.scaling.min_instance_count or 0)


def set_min_instances(n):
    """Set afd-embed's min-instances to n. No-op (no new revision) if it is
    already there, so repeated 'warm' taps only extend the timer, they don't
    churn revisions. Preserves the image, env vars and max-instances by reading
    the live service and changing only the one field."""
    client = _run_client()
    svc = client.get_service(name=_service_name())
    current = int(svc.template.scaling.min_instance_count or 0)
    if current == n:
        return n
    svc.template.scaling.min_instance_count = n
    # Clear the revision name so Cloud Run mints a fresh one; carrying the old
    # name over would be rejected as "already exists".
    svc.template.revision = ""
    op = client.update_service(service=svc)
    op.result(timeout=200)   # must stay under the function's own --timeout
    return n


# ------------------------------------------------------------------ state
def _now_ms():
    return int(time.time() * 1000)


def _read_schedule():
    snap = _firestore().collection(CONFIG_DOC[0]).document(CONFIG_DOC[1]).get()
    return snap.to_dict() or {} if snap.exists else {}


def _write_schedule(off_at_ms, by_uid, minutes):
    _firestore().collection(CONFIG_DOC[0]).document(CONFIG_DOC[1]).set({
        "off_at": off_at_ms,            # epoch ms; 0 means "asleep / no timer"
        "set_by": by_uid,
        "set_at": _now_ms(),
        "minutes": minutes,
    })


def _state_payload():
    sched = _read_schedule()
    return {
        "min_instances": get_min_instances(),
        "off_at": int(sched.get("off_at") or 0),
        "now": _now_ms(),
        "max_minutes": MAX_WARM_MINUTES,
    }


# ------------------------------------------------------------------ auth
def _verify_admin(request):
    """Return the uid of a signed-in steward, or None. Gate = an afd_admins/{uid}
    doc exists, exactly as steward.html checks."""
    hdr = request.headers.get("Authorization", "")
    if not hdr.startswith("Bearer "):
        return None
    token = hdr[len("Bearer "):].strip()
    if not token:
        return None
    _ensure_fb()
    try:
        decoded = fb_auth.verify_id_token(token)
    except Exception:
        return None
    uid = decoded.get("uid")
    if not uid:
        return None
    try:
        if not _firestore().collection(ADMIN_COLLECTION).document(uid).get().exists:
            return None
    except Exception:
        return None
    return uid


def _cors(resp_body, status=200):
    headers = {
        "Access-Control-Allow-Origin": ALLOW_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "3600",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
    }
    return (json.dumps(resp_body), status, headers)


# ------------------------------------------------------------------ HTTP entry
@functions_framework.http
def warm(request):
    if request.method == "OPTIONS":
        return _cors("", 204)

    if request.method == "GET":
        # Status is still steward-gated: it reveals infra state and costs a Run read.
        if not _verify_admin(request):
            return _cors({"error": "unauthorized"}, 401)
        try:
            return _cors(_state_payload())
        except Exception as e:
            return _cors({"error": "run_read_failed", "detail": str(e)}, 502)

    if request.method != "POST":
        return _cors({"error": "method_not_allowed"}, 405)

    uid = _verify_admin(request)
    if not uid:
        return _cors({"error": "unauthorized"}, 401)

    try:
        body = request.get_json(silent=True) or {}
    except Exception:
        body = {}
    try:
        minutes = int(body.get("minutes", 0))
    except (TypeError, ValueError):
        return _cors({"error": "bad_minutes"}, 400)

    if minutes < 0:
        return _cors({"error": "bad_minutes"}, 400)
    if minutes > MAX_WARM_MINUTES:
        minutes = MAX_WARM_MINUTES

    try:
        if minutes == 0:
            set_min_instances(0)
            _write_schedule(0, uid, 0)
        else:
            set_min_instances(1)
            off_at = _now_ms() + minutes * 60 * 1000
            _write_schedule(off_at, uid, minutes)
        return _cors(_state_payload())
    except Exception as e:
        return _cors({"error": "update_failed", "detail": str(e)}, 502)


# ------------------------------------------------------------------ Pub/Sub entry
@functions_framework.cloud_event
def reconcile(cloud_event):
    """Scheduled sweep: if an ACTIVE phone timer has passed and the service is
    still pinned warm, let it sleep. Safe to run on any cadence.

    It acts only when off_at > 0 — an active timer set from warm.html. A manual
    `set-warm.sh on` leaves no timer (off_at == 0), so this never fights it: that
    switch is the deliberate indefinite warm, turned off the same way it went on.
    Use one mechanism or the other for a given warm, not both."""
    sched = _read_schedule()
    off_at = int(sched.get("off_at") or 0)
    now = _now_ms()
    if off_at <= 0:
        return   # no managed timer; leave the service (and set-warm.sh) alone
    if now < off_at:
        print(f"[warm-reconcile] {(off_at - now)//1000}s left on timer", flush=True)
        return
    try:
        current = get_min_instances()
    except Exception as e:
        print(f"[warm-reconcile] could not read service: {e!r}", flush=True)
        return
    try:
        if current >= 1:
            set_min_instances(0)
            print(f"[warm-reconcile] cooled down (off_at={off_at}, now={now})", flush=True)
        # Clear the expired timer either way so a stale off_at can't haunt a
        # later set-warm.sh on.
        _firestore().collection(CONFIG_DOC[0]).document(CONFIG_DOC[1]).set(
            {"off_at": 0}, merge=True)
    except Exception as e:
        print(f"[warm-reconcile] cool-down failed: {e!r}", flush=True)
