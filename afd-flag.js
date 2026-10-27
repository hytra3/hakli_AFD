/* afd-flag.js — reporting a voice or a word card, and a steward's note back
   to the person who recorded it (10-26).

   Trust by default, hold after a report. Anyone signed in may report a voice
   or a contributed word once: a pictogram reason, and the reason SPOKEN if
   they like. The report and the hold go to Firestore in one batch — the rules
   only allow the hold when the report exists (afd-firestore.rules,
   afd_flags). A held voice leaves public listening at once (allowPlayback
   false); a held word leaves the dictionary. A steward then clears it or
   keeps it hidden (steward.html → Reports), and may send the person who
   recorded it a note, which they see the next time they open the dictionary
   (checkNotices).

   Moderation is not consent: nothing here touches a take's consent or
   withdrawal, which stay the speaker's own.

   SDK-agnostic like afd-card.js: callers pass db / store / user / mode.
   AFDCore is read from the global (afd-core.js loads first). */
import { doc, getDoc, getDocs, writeBatch, updateDoc, collection, query, where, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const C = () => window.AFDCore;
export const REASONS = ["rude", "wrong", "notme", "other"];
export function reasonIcon(r){
  const s = (C().STRINGS || {})["flag.r." + r];
  return (s && s.icon) || "❓";
}
// a report's id: one per person per thing (the rules check this exact shape)
export function flagIdFor(entryId, recordingId, uid){ return entryId + "~" + (recordingId || "card") + "~" + uid; }
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

/* ---- look --------------------------------------------------------------------
   The same bottom sheet as AFDCore.ask(), so it feels like the rest of the app:
   big pictogram tiles to pick from (word under each, Arabic first), then the
   optional spoken reason, then Send. */
const CSS = `
.afd-flag{position:fixed;inset:0;z-index:90;display:flex;align-items:flex-end;justify-content:center;
  background:rgba(23,36,31,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.afd-flag .fl-panel{position:relative;width:100%;max-width:460px;box-sizing:border-box;max-height:92vh;overflow:auto;
  background:var(--cloud,#fff);color:var(--ink,#17241F);border-radius:22px 22px 0 0;padding:22px 18px 20px;
  box-shadow:0 -10px 40px rgba(0,0,0,.18);text-align:center}
@media (min-width:600px){.afd-flag{align-items:center}.afd-flag .fl-panel{border-radius:22px}}
.afd-flag .fl-face{width:72px;height:72px;margin:4px auto 10px;border-radius:18px;overflow:hidden;
  display:flex;align-items:center;justify-content:center;font-size:40px;background:var(--fog,#EAF0EE)}
.afd-flag .fl-face img,.afd-flag .fl-face svg{width:100%;height:100%;display:block;object-fit:cover}
.afd-flag h2{margin:0;font-size:19px;line-height:1.45}
.afd-flag .sub{display:block;font-size:12px;font-weight:400;opacity:.72;margin-top:2px}
.afd-flag .fl-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.afd-flag .fl-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:104px;
  padding:10px 8px;border-radius:18px;border:2px solid var(--mist-2,#D5DEDA);background:var(--cloud,#fff);
  color:inherit;font:inherit;font-size:14px;line-height:1.3;cursor:pointer;-webkit-tap-highlight-color:transparent}
.afd-flag .fl-tile .ic{font-size:38px;line-height:1}
.afd-flag .fl-tile[aria-pressed="true"]{border-color:var(--resin,#C6873F);background:var(--fog,#EAF0EE);
  box-shadow:0 0 0 2px var(--resin,#C6873F) inset}
.afd-flag .fl-say{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:14px}
.afd-flag .fl-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:52px;padding:8px 16px;
  border-radius:16px;border:1.5px solid var(--mountain,#1F3A34);background:var(--cloud,#fff);color:var(--mountain,#1F3A34);
  font:inherit;font-size:15px;font-weight:600;cursor:pointer}
.afd-flag .fl-btn.rec{background:var(--danger,var(--alert,#9E4433));border-color:transparent;color:#fff}
.afd-flag .fl-btn .sub{color:inherit;opacity:.85}
.afd-flag .fl-btn[hidden]{display:none}
.afd-flag .fl-secs{font-variant-numeric:tabular-nums;font-weight:600;margin-inline-start:4px}
.afd-flag .fl-status{flex-basis:100%;font-size:14px;line-height:1.4;min-height:0}
.afd-flag .fl-status:empty{display:none}
.afd-flag .fl-status.ok{color:var(--monsoon,#2F6B4F);font-weight:600}
.afd-flag .fl-status.warn{color:var(--danger,#9E4433)}
.afd-flag .fl-note{margin:14px 0 0;font-size:13px;line-height:1.45;color:var(--ink-soft,#5B6E66)}
.afd-flag .fl-btns{display:flex;flex-direction:column;gap:10px;margin-top:16px}
.afd-flag .fl-go{min-height:60px;border:0;border-radius:18px;background:var(--mountain,#1F3A34);color:#fff;
  font:inherit;font-size:17px;font-weight:600;cursor:pointer}
.afd-flag .fl-go:disabled{opacity:.4;cursor:default}
.afd-flag .fl-go .sub{color:inherit;opacity:.85}
.afd-flag .fl-no{min-height:52px;border:0;border-radius:18px;background:transparent;color:var(--mountain,#1F3A34);
  box-shadow:inset 0 0 0 1.5px var(--mountain,#1F3A34);font:inherit;font-size:15px;font-weight:600;cursor:pointer}
.afd-flag .fl-x{position:absolute;top:10px;inset-inline-end:10px;width:44px;height:44px;border-radius:50%;border:0;
  background:transparent;color:var(--ink-soft,#5B6E66);font-size:22px;cursor:pointer}
.afd-flag .fl-text{margin:12px 0 0;font-size:16px;line-height:1.5;white-space:pre-wrap;text-align:start}
.afd-flag .fl-reason{display:inline-flex;align-items:center;gap:8px;margin-top:12px;padding:6px 12px;border-radius:14px;
  background:var(--fog,#EAF0EE);font-size:15px}
.afd-flag .fl-reason .ic{font-size:24px}`;
function addCss(){
  if(document.getElementById("afd-flag-css")) return;
  const st = document.createElement("style"); st.id = "afd-flag-css"; st.textContent = CSS;
  document.head.appendChild(st);
}
// a label in the display mode: the pictogram alone in sound mode, Arabic
// (English beneath in auto) otherwise
function lab(key, mode, withIcon, vars){
  const s = (C().STRINGS || {})[key] || {};
  const fill = (t) => String(t).replace(/\{(\w+)\}/g, (m0, k) => (vars && k in vars) ? String(vars[k]) : m0);
  if(mode === "sound") return esc(s.icon || fill(s.ar || key));
  const ic = withIcon && s.icon ? esc(s.icon) + " " : "";
  let h = `<span dir="rtl">${ic}${esc(fill(s.ar || s.en || key))}</span>`;
  if(mode === "auto" && s.en && s.en !== s.ar) h += `<small class="sub">${esc(fill(s.en))}</small>`;
  return h;
}

/* ---- a short spoken note: tap to start, tap to stop, hear it, again --------
   Used by the report sheet here and by the steward's note in steward.html.
   label(key, vars) → HTML for a button. Stops by itself after maxMs.
   While recording the button counts the seconds; once stopped, a line says
   "✓ recorded (Ns)" beside ▶, so it's plain the note is kept. onChange(hasNote)
   lets the sheet enable Send. stop() resolves once the note is ready. */
export function voiceNote(host, label, keys, maxMs, onChange){
  keys = Object.assign({ say:"flag.say", stop:"flag.say.stop", again:"flag.say.again", nomic:"flag.say.nomic",
                         done:"flag.say.done", empty:"flag.say.empty" }, keys || {});
  maxMs = maxMs || 60000;
  let blob = null, rec = null, stream = null, timer = null, tick = null, url = null, audio = null;
  let t0 = 0, secs = 0, empty = false, stopped = null;
  host.innerHTML = "";
  const go = document.createElement("button"); go.type = "button"; go.className = "fl-btn";
  const play = document.createElement("button"); play.type = "button"; play.className = "fl-btn fl-play"; play.hidden = true;
  play.innerHTML = "\u25B6"; play.setAttribute("aria-label", "\u25B6");
  const status = document.createElement("span"); status.className = "fl-status"; status.setAttribute("role", "status");
  host.appendChild(go); host.appendChild(play); host.appendChild(status);
  const paint = () => {
    const recording = !!(rec && rec.state === "recording");
    go.classList.toggle("rec", recording);
    go.innerHTML = label(recording ? keys.stop : blob ? keys.again : keys.say) +
      (recording ? ` <span class="fl-secs">${Math.floor((Date.now() - t0) / 1000)}s</span>` : "");
    play.hidden = !blob || recording;
    status.className = "fl-status" + (blob && !recording ? " ok" : empty && !recording ? " warn" : "");
    status.innerHTML = recording ? "" : blob ? label(keys.done, { s: secs }) : empty ? label(keys.empty) : "";
  };
  const release = () => { try{ stream && stream.getTracks().forEach(t => t.stop()); }catch(_){} stream = null; };
  // resolves when the recording (if any) has finished turning into a note
  const stop = () => {
    clearTimeout(timer); clearInterval(tick);
    if(rec && rec.state === "recording"){ rec.stop(); return stopped || Promise.resolve(); }
    return stopped || Promise.resolve();
  };
  go.onclick = async () => {
    if(rec && rec.state === "recording"){ stop(); return; }
    try{
      try{ audio && audio.pause(); }catch(_){}
      stream = C().openStream ? (await C().openStream()).stream : await navigator.mediaDevices.getUserMedia({ audio:true });
      const chunks = [];
      rec = new MediaRecorder(stream);
      let done; stopped = new Promise(r => { done = r; });
      rec.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        release();
        secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
        const b = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || rec.mimeType || "audio/webm" });
        if(b.size > 0){ blob = b; empty = false; }
        else { blob = null; empty = true; console.warn("[AFD] spoken note: no audio came through", rec.mimeType, chunks.length); }
        if(url){ URL.revokeObjectURL(url); url = null; }
        paint(); if(onChange) onChange(!!blob); done();
      };
      rec.onerror = (e) => { console.warn("[AFD] spoken note", e && e.error); };
      blob = null; empty = false; if(onChange) onChange(false);
      t0 = Date.now();
      rec.start(250);
      timer = setTimeout(stop, maxMs);
      tick = setInterval(paint, 500);
      paint();
    }catch(e){
      console.warn("[AFD] spoken note: no microphone", e);
      release(); rec = null;
      const n = document.createElement("p"); n.className = "fl-note"; n.innerHTML = label(keys.nomic);
      host.replaceChildren(n);
    }
  };
  play.onclick = () => {
    if(!blob) return;
    try{ audio && audio.pause(); }catch(_){}
    if(!url) url = URL.createObjectURL(blob);
    audio = new Audio(url); audio.play().catch(() => {});
  };
  paint();
  return {
    blob: () => blob,
    stop,
    close(){ stop(); release(); try{ audio && audio.pause(); }catch(_){} if(url) URL.revokeObjectURL(url); }
  };
}
export function audioExt(b){ return /mp4|aac|m4a/.test((b && b.type) || "") ? "m4a" : "webm"; }

/* ---- report a voice or a word ----------------------------------------------
   o = { db, store, user(), mode, kind:"voice"|"card", entryId, recordingId?,
         face (HTML), holdable }
   holdable: the caller's view of whether this report can put the hold on (not
   the reporter's own, not already held, cleared or hidden). If the hold is
   refused anyway — someone else got there first, a steward cleared it a moment
   ago — the report still goes, queued without a hold.
   Resolves "held" | "queued" | "already" | null (closed, or not signed in). */
export async function reportSheet(o){
  const m = o.mode || "auto";
  const u = o.user && o.user();
  if(!u || u.isAnonymous){ C().notice("flag.signin", { mode:m }); return null; }
  const flagId = flagIdFor(o.entryId, o.kind === "voice" ? o.recordingId : null, u.uid);
  try{
    if((await getDoc(doc(o.db, "afd_flags", flagId))).exists()){ C().notice("flag.already", { mode:m }); return "already"; }
  }catch(_){ /* offline or not allowed: the write below will say */ }
  addCss();
  return new Promise((resolve) => {
    const w = document.createElement("div");
    w.className = "afd-flag"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true");
    w.innerHTML = `<div class="fl-panel">
      <button class="fl-x" type="button" aria-label="${esc(C().t("flag.cancel", "auto"))}">✕</button>
      ${o.face ? `<div class="fl-face">${o.face}</div>` : ""}
      <h2>${lab(o.kind === "voice" ? "flag.title.voice" : "flag.title.card", m)}</h2>
      <div class="fl-grid">${REASONS.map(r => `<button class="fl-tile" type="button" data-r="${r}" aria-pressed="false">
        <span class="ic" aria-hidden="true">${esc(reasonIcon(r))}</span>${m === "sound" ? "" : `<span>${lab("flag.r." + r, m)}</span>`}</button>`).join("")}</div>
      <div class="fl-say"></div>
      <p class="fl-note">${lab(o.holdable ? "flag.note" : "flag.note.queued", m)}</p>
      <div class="fl-btns">
        <button class="fl-go" type="button" disabled>${lab("flag.send", m, true)}</button>
        <button class="fl-no" type="button">${lab("flag.cancel", m, true)}</button>
      </div></div>`;
    if(m === "sound") w.querySelectorAll(".fl-tile").forEach(b => b.setAttribute("aria-label", C().t("flag.r." + b.dataset.r, "auto")));
    let reason = null, done = false, hasNote = false;
    const go = w.querySelector(".fl-go");
    // Send opens with a picture picked or a reason spoken (a spoken reason on
    // its own goes as "something else")
    const ready = () => { go.disabled = !(reason || hasNote); };
    const note = voiceNote(w.querySelector(".fl-say"), (k, v) => lab(k, m, true, v), null, 60000,
                           (has) => { hasNote = has; ready(); });
    const end = (v) => {
      if(done) return; done = true;
      note.close(); document.removeEventListener("keydown", onKey, true); w.remove(); resolve(v);
    };
    const onKey = (e) => { if(e.key === "Escape"){ e.stopPropagation(); end(null); } };
    document.addEventListener("keydown", onKey, true);
    w.addEventListener("click", (e) => { if(e.target === w) end(null); });
    w.querySelector(".fl-x").onclick = () => end(null);
    w.querySelector(".fl-no").onclick = () => end(null);
    w.querySelectorAll(".fl-tile").forEach(b => b.onclick = () => {
      reason = b.dataset.r;
      w.querySelectorAll(".fl-tile").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      ready();
    });
    go.onclick = async () => {
      if(!reason && !hasNote) return;
      go.disabled = true; go.innerHTML = C().dotsHTML ? C().dotsHTML() : "…";
      await note.stop();                               // a note still recording is finished first, not lost
      try{
        const held = await sendReport(o, u.uid, flagId, reason || "other", note.blob());
        C().notice("flag.sent", { mode:m, kind:"ok" });
        try{ C().track("flag", o.kind, { x: held ? "held" : "queued" }); }catch(_){}
        end(held ? "held" : "queued");
      }catch(e){
        console.warn("[AFD] report", e);
        try{ C().report("flag.send", e); }catch(_){}
        C().notice("flag.failed", { mode:m, kind:"err", detail: e && (e.code || e.message) });
        go.disabled = false; go.innerHTML = lab("flag.send", m, true);
      }
    };
    document.body.appendChild(w);
    w.querySelector(".fl-tile").focus();
  });
}

// The report (and, when it can, the hold) in ONE batch. Returns whether it held.
async function sendReport(o, uid, flagId, reason, blob){
  const voice = o.kind === "voice";
  const data = { kind: o.kind, entryId: o.entryId, reason, by: uid, at: serverTimestamp() };
  if(voice) data.recordingId = o.recordingId;
  if(blob){
    const path = "afd_flags/" + uid + "/" + flagId + "." + audioExt(blob);
    await uploadBytes(ref(o.store, path), blob, { contentType: blob.type || "audio/webm",
      customMetadata: { entryId: o.entryId, recordingId: o.recordingId || "", kind: "flag" } });
    data.audioPath = path;
  }
  const target = voice ? doc(o.db, "afd_entries", o.entryId, "recordings", o.recordingId)
                       : doc(o.db, "afd_entries", o.entryId);
  const commit = (hold) => {
    const b = writeBatch(o.db);
    b.set(doc(o.db, "afd_flags", flagId), { ...data, held: hold });
    if(hold) b.update(target, voice ? { heldAt: serverTimestamp(), allowPlayback: false } : { heldAt: serverTimestamp() });
    return b.commit();
  };
  if(o.holdable){
    try{ await commit(true); return true; }
    catch(e){ if(!(e && e.code === "permission-denied")) throw e; }   // can't hold any more → just report
  }
  await commit(false);
  return false;
}

/* ---- notes from a steward ----------------------------------------------------
   Called when someone signs in (index.html). Shows each unseen note, one at a
   time: the reason pictogram, the word it's about, the steward's spoken note
   and/or text. OK marks it seen. Once per account per page load. */
const _checked = new Set();
export async function checkNotices(o){
  const u = o.user && o.user();
  if(!u || u.isAnonymous || _checked.has(u.uid)) return;
  _checked.add(u.uid);
  let notes = [];
  try{
    const snap = await getDocs(query(collection(o.db, "afd_notices"), where("to", "==", u.uid)));
    notes = snap.docs.map(s => ({ id: s.id, d: s.data() || {} })).filter(n => !n.d.seenAt)
                .sort((a, b) => ((a.d.at && a.d.at.toMillis) ? a.d.at.toMillis() : 0) - ((b.d.at && b.d.at.toMillis) ? b.d.at.toMillis() : 0));
  }catch(e){ console.warn("[AFD] notices", e); return; }
  for(const n of notes){
    if(!o.user() || o.user().uid !== u.uid) return;     // signed out / switched meanwhile
    await showNotice(o, n);
  }
}
async function showNotice(o, n){
  const m = (o.mode && o.mode()) || "auto", d = n.d;
  addCss();
  // the word it's about: its picture, else the identicon
  let face = C().identicon ? C().identicon(d.entryId || "") : "";
  try{
    const sn = await getDoc(doc(o.db, "afd_entries", d.entryId));
    const e = sn.exists() ? (sn.data() || {}) : {};
    if(e.image) face = `<img src="${esc(e.image)}" alt="">`;
    else if(e.pic) face = esc(e.pic);
  }catch(_){}
  let url = null;
  if(d.audioPath){ try{ url = await getDownloadURL(ref(o.store, d.audioPath)); }catch(e){ console.warn("[AFD] notice audio", e); } }
  await new Promise((resolve) => {
    const w = document.createElement("div");
    w.className = "afd-flag"; w.setAttribute("role", "alertdialog"); w.setAttribute("aria-modal", "true");
    w.innerHTML = `<div class="fl-panel">
      <div class="fl-face">${face}</div>
      <h2>${lab("notice.title", m)}</h2>
      <p class="fl-note">${lab(d.recordingId ? "notice.voice" : "notice.about", m)}</p>
      <div class="fl-reason"><span class="ic" aria-hidden="true">${esc(reasonIcon(d.reason))}</span>${m === "sound" ? "" : `<span>${lab("flag.r." + d.reason, m)}</span>`}</div>
      ${url ? `<div class="fl-say"><button class="fl-btn fl-hear" type="button">${lab("notice.hear", m, true)}</button></div>` : ""}
      ${d.text && m !== "sound" ? `<p class="fl-text" dir="auto">${esc(d.text)}</p>` : ""}
      <div class="fl-btns"><button class="fl-go" type="button">${lab("notice.ok", m, true)}</button></div></div>`;
    let audio = null;
    const hear = w.querySelector(".fl-hear");
    if(hear) hear.onclick = () => { try{ audio && audio.pause(); }catch(_){} audio = new Audio(url); audio.play().catch(() => {}); };
    w.querySelector(".fl-go").onclick = async () => {
      try{ audio && audio.pause(); }catch(_){}
      try{ await updateDoc(doc(o.db, "afd_notices", n.id), { seenAt: serverTimestamp() }); }
      catch(e){ console.warn("[AFD] notice seen", e); }
      w.remove(); resolve();
    };
    document.body.appendChild(w);
    if(hear) hear.click();          // the spoken note is the message: play it at once
    w.querySelector(".fl-go").focus();
  });
}
