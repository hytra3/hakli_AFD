"""
AFD watch  (2nd-gen Cloud Function, scheduled — Cloud Scheduler -> Pub/Sub)
==========================================================================
Three jobs, one function, told apart by the Pub/Sub message:

  "check"   every 30 minutes — the watchdog. Reads the last hour of the field
            error log (afd_client_errors) and the usage counts (afd_events) and
            emails the steward when something looks broken:
              * the same failure (where + code) 5+ times in an hour
                (3+ for sign-in: an SMS or Google problem locks everyone out)
              * searches failing: 3+ errors in an hour AND at least half of them
              * nothing at all for 24 hours while a field week is on
                (afd_ui_config/watch.openUntil in the future — set it from the
                steward page's Stats tab, or scripts/stats.mjs --field 14)
            Each alert waits 6 hours before it can repeat (silence: 24 hours),
            so one bad afternoon is one email, not twelve.
            Every 3 hours it also recounts the public totals (below).

  "digest"  once a day (07:00 Utah) — the morning email: the last 24 hours in
            plain numbers (searches and how they came out, voices played, takes
            kept, words added, sign-ins, which display mode people use, what
            failed), the totals and how they moved. It also writes the day's
            totals to afd_stats/day_YYYY-MM-DD, which stay after the raw events
            expire (90 days), so the Stats tab can show the long view.

  "public"  recount afd_stats/public now (also done by check, every 3 hours):
              words    — word cards anyone can hear (≥1 public voice)
              voices   — public voices, summed from each card's own counts
              speakers — distinct speakers with at least one public voice
            Readable by anyone (Help shows it). Only totals, never names.

Nothing here identifies anyone: the events it reads hold no uid and no words
(see afd-core.js track()).

Mail: plain SMTP over SSL (a Gmail account with an app password works).
  MAIL_USER      the sending account           (env)
  MAIL_PASSWORD  its app password              (Secret Manager: afd-mail-password)
  MAIL_TO        where alerts and digests go   (env; comma-separated)
  MAIL_HOST / MAIL_PORT   default smtp.gmail.com / 465
With no mail settings it still runs and logs what it would have sent.
If the function itself fails, or can't send, it logs AFD_WATCH_FAILED at
severity ERROR — a Cloud Monitoring log alert (scripts/setup-alerts.sh)
emails you about that, so the watcher is watched too.

Deploy: bash scripts/deploy-watch.sh   (function + both scheduler jobs)
Run now: gcloud pubsub topics publish afd-watch-tick --message=digest --project=afd-dev
"""

import base64
import datetime as dt
import json
import os
import smtplib
import statistics
from collections import Counter, defaultdict
from email.message import EmailMessage

import functions_framework
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

UTC = dt.timezone.utc
HOUR = dt.timedelta(hours=1)
DAY = dt.timedelta(days=1)

ERROR_MIN = 5            # same where+code within the hour
SIGNIN_ERROR_MIN = 3     # …for sign-in
SEARCH_ERR_MIN = 3       # failed searches within the hour (and ≥ half of them)
COOLDOWN = {"silence": dt.timedelta(hours=24)}
COOLDOWN_DEFAULT = dt.timedelta(hours=6)
PUBLIC_EVERY = dt.timedelta(hours=3)

_db = None


def db():
    global _db
    if _db is None:
        _db = firestore.Client()
    return _db


def log(severity, message, **fields):
    print(json.dumps({"severity": severity, "message": message, **fields}, default=str))


# ---------------------------------------------------------------- reading

def since(collection, start):
    q = db().collection(collection).where(filter=FieldFilter("at", ">=", start))
    return [s.to_dict() or {} for s in q.stream()]


def visible(entry):
    return not (entry.get("hiddenAt") or entry.get("removedAt") or entry.get("joinedInto"))


def public_totals():
    """Words anyone can hear, public voices, distinct speakers. Built from each
    card's own voice counts (voice_counts keeps them) plus one pass over the
    recordings for speakers."""
    words = words_all = voices = 0
    live = set()
    for snap in db().collection("afd_entries").stream():
        e = snap.to_dict() or {}
        if not visible(e):
            continue
        words_all += 1
        v = e.get("voices") or {}
        n = sum(int(v.get(k) or 0) for k in ("word", "context", "definition"))
        if n > 0:
            words += 1
            voices += n
            live.add(snap.id)
    speakers = set()
    for snap in db().collection_group("recordings").stream():
        r = snap.to_dict() or {}
        parent = snap.reference.parent.parent
        if r.get("allowPlayback") is True and parent is not None and parent.id in live and r.get("speakerId"):
            speakers.add(r["speakerId"])
    return {"words": words, "voices": voices, "speakers": len(speakers), "wordsAll": words_all}


# ---------------------------------------------------------------- the checks (pure)

def find_alerts(errors, events, now, field_until, last_event_at):
    """What looks broken. errors/events: the last hour's records (dicts).
    field_until: datetime or None. last_event_at: the newest event's time or
    None. Returns [(key, subject, body)]."""
    out = []
    groups = Counter((e.get("where") or "?", e.get("code") or "?") for e in errors)
    for (where, code), n in groups.most_common():
        need = SIGNIN_ERROR_MIN if str(where).startswith("signin") else ERROR_MIN
        if n >= need:
            pages = sorted({e.get("page") or "?" for e in errors if e.get("where") == where and e.get("code") == code})
            out.append((f"err:{where}|{code}",
                        f"{n}× {where} failing ({code})",
                        f"{n} times in the last hour: {where} · {code}\nPages: {', '.join(pages)}\n"
                        f"Details: node scripts/client-errors.mjs --days 1 --where {where}"))
    searches = [e for e in events if e.get("ev") == "search"]
    bad = [e for e in searches if str(e.get("v") or "").startswith("err.")]
    if len(bad) >= SEARCH_ERR_MIN and len(bad) * 2 >= len(searches):
        kinds = Counter(str(e.get("v"))[4:] for e in bad)
        out.append(("search",
                    f"Search failing: {len(bad)} of {len(searches)} in the last hour",
                    "Errors by kind: " + ", ".join(f"{k} {n}" for k, n in kinds.most_common()) +
                    "\nCheck the matcher: bash scripts/healthcheck.sh"))
    if field_until and field_until > now and (last_event_at is None or now - last_event_at >= DAY):
        out.append(("silence", "Field week: nothing used in 24 hours",
                    "No searches, plays or recordings in the last 24 hours while a field week is on.\n"
                    "That usually means something is broken (the site, sign-in, the matcher) — "
                    "or that nobody has been using it. Worth a quick look on a phone."))
    return out


def due(key, sent, now):
    last = sent.get(key)
    return last is None or now - last >= COOLDOWN.get(key, COOLDOWN_DEFAULT)


# ---------------------------------------------------------------- the digest (pure)

def tally(events):
    c = Counter()
    for e in events:
        c[f"{e.get('ev') or '?'}|{e.get('v') or ''}"] += 1
    return c


def pct(n, d):
    return f"{round(100 * n / d)}%" if d else "–"


def digest_text(events, errors, totals, prev_totals, alerts_sent, window_end):
    c = tally(events)
    get = lambda ev, v="": c.get(f"{ev}|{v}", 0)
    lines = []
    when = window_end.astimezone(UTC).strftime("%a %d %b %Y, %H:%M UTC")
    lines.append(f"Hakli dictionary — the 24 hours to {when}")
    lines.append("")

    def moved(k):
        if not prev_totals or k not in prev_totals:
            return ""
        d = totals.get(k, 0) - prev_totals.get(k, 0)
        return f" ({'+' if d >= 0 else ''}{d})" if d else ""
    lines.append(f"Totals: {totals.get('words', 0)} words with a voice{moved('words')} · "
                 f"{totals.get('voices', 0)} voices{moved('voices')} · "
                 f"{totals.get('speakers', 0)} speakers{moved('speakers')}")
    lines.append("")

    if not events and not errors:
        lines.append("A quiet day: nobody used the dictionary.")
    else:
        views = [e for e in events if e.get("ev") == "view"]
        pages = Counter(e.get("page") or "?" for e in views)
        lines.append(f"Visits: {len(views)}" + (" — " + ", ".join(f"{p} {n}" for p, n in pages.most_common()) if views else ""))
        if views:
            modes = Counter(e.get("v") or "unset" for e in views)
            names = {"auto": "picture", "sound": "sound (no text)", "script": "script", "unset": "not chosen yet"}
            quiet = sum(1 for e in views if e.get("x") == "quiet")
            lines.append("  View: " + ", ".join(f"{names.get(m, m)} {pct(n, len(views))}" for m, n in modes.most_common())
                         + (f" · quiet mode {pct(quiet, len(views))}" if quiet else ""))
        searches = [e for e in events if e.get("ev") == "search"]
        if searches:
            ms = [e.get("n") for e in searches if isinstance(e.get("n"), int) and not str(e.get("v")).startswith("err.")]
            errs = sum(1 for e in searches if str(e.get("v")).startswith("err."))
            lines.append(f"Spoken searches: {len(searches)} — found {pct(get('search', 'here'), len(searches))}, "
                         f"'is it one of these?' {pct(get('search', 'pick'), len(searches))}, "
                         f"no match {pct(get('search', 'none'), len(searches))}, failed {pct(errs, len(searches))}"
                         + (f" · median {statistics.median(ms) / 1000:.1f} s" if ms else ""))
        typed = get("typed", "hits") + get("typed", "none")
        if typed:
            lines.append(f"Typed searches: {typed} — {get('typed', 'none')} found nothing")
        plays = sum(n for k, n in c.items() if k.startswith("play|") and k != "play|novoice")
        if plays or get("play", "novoice"):
            lines.append(f"Voices played: {plays}" + (f" · taps on a word with no voice yet: {get('play', 'novoice')}" if get("play", "novoice") else ""))
        if get("open", "link"):
            lines.append(f"Arrived on a shared word's link: {get('open', 'link')}")
        keeps = [e for e in events if e.get("ev") == "rec" and e.get("v") == "keep"]
        if keeps or get("rec", "skip") or get("rec", "listen"):
            proxy = sum(1 for e in keeps if ".proxy" in str(e.get("x") or ""))
            slots = Counter(str(e.get("x") or "word").split(".")[0] for e in keeps)
            lines.append(f"Recorder: {len(keeps)} takes kept" +
                         (" (" + ", ".join(f"{s} {n}" for s, n in slots.most_common()) + ")" if keeps else "") +
                         (f", {proxy} for someone else" if proxy else "") +
                         f" · {get('rec', 'redo')} redone · {get('rec', 'skip')} 'doesn't know this word'"
                         f" · {get('rec', 'upload')} uploaded" +
                         (f" · {get('rec', 'listen')} listen-only" if get("rec", "listen") else ""))
        if get("add", "say") or get("add", "done") or get("add", "parked"):
            lines.append(f"Add a word: {get('add', 'show')} said a word → {get('add', 'share')} reached share → "
                         f"{get('add', 'done')} shared · {get('add', 'dup.join')} joined an existing card · "
                         f"{get('add', 'parked')} kept on the phone, {sum(e.get('n') or 0 for e in events if e.get('ev') == 'add' and e.get('v') == 'flushed')} sent later")
        signins = Counter(e.get("v") for e in events if e.get("ev") == "signin")
        if signins:
            lines.append("Sign-ins: " + ", ".join(f"{m} {n}" for m, n in signins.most_common()))
        if get("help", "open"):
            clips = sum(n for k, n in c.items() if k.startswith("help|clip."))
            lines.append(f"Help opened: {get('help', 'open')} · clips {clips} · tour {get('help', 'tour')}")
        offline = sum(1 for e in events if e.get("online") is False)
        if offline:
            lines.append(f"Counted while offline (sent later): {offline}")
    lines.append("")
    if errors:
        g = Counter((e.get("where") or "?", e.get("code") or "?") for e in errors)
        lines.append(f"What failed ({len(errors)}):")
        for (w, code), n in g.most_common(6):
            lines.append(f"  {n:>3}  {w} · {code}")
        lines.append("  more: node scripts/client-errors.mjs --days 1")
    else:
        lines.append("Nothing failed.")
    if alerts_sent:
        lines.append("")
        lines.append("Alerts sent: " + "; ".join(alerts_sent))
    lines.append("")
    lines.append("Steward page → Stats: https://hakli.app/steward.html#stats")
    return "\n".join(lines)


def day_doc(events, errors, totals, window_start, window_end):
    c = tally(events)
    ms = [e.get("n") for e in events if e.get("ev") == "search" and isinstance(e.get("n"), int)
          and not str(e.get("v")).startswith("err.")]
    return {
        "windowStart": window_start, "windowEnd": window_end,
        "totals": totals,
        "counts": dict(c),
        "events": len(events),
        "searchMsMedian": int(statistics.median(ms)) if ms else None,
        "errors": len(errors),
        "errorTop": [f"{n} {w} · {code}" for (w, code), n in
                     Counter((e.get("where") or "?", e.get("code") or "?") for e in errors).most_common(5)],
    }


# ---------------------------------------------------------------- mail

def send_mail(subject, body):
    user, pw, to = os.environ.get("MAIL_USER"), os.environ.get("MAIL_PASSWORD"), os.environ.get("MAIL_TO")
    if not (user and pw and to):
        log("WARNING", "AFD_WATCH_MAIL_OFF — would have sent", subject=subject, body=body)
        return False
    msg = EmailMessage()
    msg["Subject"] = f"[hakli.app] {subject}"
    msg["From"] = user
    msg["To"] = to
    msg.set_content(body)
    try:
        with smtplib.SMTP_SSL(os.environ.get("MAIL_HOST", "smtp.gmail.com"),
                              int(os.environ.get("MAIL_PORT", "465")), timeout=30) as s:
            s.login(user, pw)
            s.send_message(msg)
        log("INFO", "mail sent", subject=subject)
        return True
    except Exception as e:  # noqa: BLE001 — never let mail take the run down; the log alert catches it
        log("ERROR", "AFD_WATCH_FAILED mail", subject=subject, error=repr(e), body=body)
        return False


# ---------------------------------------------------------------- the jobs

def state_ref():
    return db().collection("afd_stats").document("watch")


def refresh_public(now):
    t = public_totals()
    db().collection("afd_stats").document("public").set(
        {"words": t["words"], "voices": t["voices"], "speakers": t["speakers"], "at": now})
    state_ref().set({"publicAt": now, "totals": t}, merge=True)
    log("INFO", "public totals", **t)
    return t


def run_check(now):
    st = (state_ref().get().to_dict() or {})
    sent = {k: v for k, v in (st.get("sent") or {}).items()}
    errors = since("afd_client_errors", now - HOUR)
    events = since("afd_events", now - HOUR)
    cfg = db().collection("afd_ui_config").document("watch").get().to_dict() or {}
    field_until = cfg.get("openUntil")
    last_event_at = None
    if field_until and field_until > now:
        q = (db().collection("afd_events").order_by("at", direction=firestore.Query.DESCENDING).limit(1))
        for s in q.stream():
            last_event_at = (s.to_dict() or {}).get("at")
    fired = []
    for key, subject, body in find_alerts(errors, events, now, field_until, last_event_at):
        if not due(key, sent, now):
            continue
        send_mail(subject, body)
        sent[key] = now
        fired.append(subject)
        log("WARNING", "AFD_ALERT " + subject, key=key)
    patch = {"checkedAt": now}
    if fired:
        patch["sent"] = sent
        patch["recent"] = ((st.get("recent") or []) + [{"at": now, "subject": s} for s in fired])[-30:]
    state_ref().set(patch, merge=True)
    if not st.get("publicAt") or now - st["publicAt"] >= PUBLIC_EVERY:
        refresh_public(now)
    return fired


def run_digest(now):
    start = now - DAY
    events = since("afd_events", start)
    errors = since("afd_client_errors", start)
    st = state_ref().get().to_dict() or {}
    prev = st.get("digestTotals")
    totals = refresh_public(now)
    recent = [r.get("subject") for r in (st.get("recent") or []) if r.get("at") and r["at"] >= start]
    body = digest_text(events, errors, totals, prev, recent, now)
    day_id = "day_" + now.astimezone(UTC).strftime("%Y-%m-%d")
    db().collection("afd_stats").document(day_id).set(day_doc(events, errors, totals, start, now))
    state_ref().set({"digestAt": now, "digestTotals": totals}, merge=True)
    searches = sum(1 for e in events if e.get("ev") == "search")
    subject = (f"Daily: {searches} searches · {totals['voices']} voices · "
               f"{len(errors)} error{'s' if len(errors) != 1 else ''}")
    send_mail(subject, body)
    return body


def job_of(cloud_event):
    try:
        data = (cloud_event.data or {}).get("message", {}).get("data")
        return base64.b64decode(data).decode().strip().lower() if data else "check"
    except Exception:  # noqa: BLE001
        return "check"


@functions_framework.cloud_event
def watch(cloud_event):
    job = job_of(cloud_event)
    now = dt.datetime.now(UTC)
    try:
        if job == "digest":
            run_digest(now)
        elif job == "public":
            refresh_public(now)
        else:
            run_check(now)
    except Exception as e:  # noqa: BLE001
        log("ERROR", f"AFD_WATCH_FAILED {job}", error=repr(e))
        raise
