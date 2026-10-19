/* ============================================================================
   afd-voices.js — voices already heard, kept on the phone (10-19).

   A voice someone has played is saved on the phone, so it plays again with no
   signal (the jebel, Khor Kharfot). Offline, a word's audio link can't even be
   fetched, so the card asks here: "is this recording on the phone?"

   Where: the browser's Cache Storage ("afd-voices-v1"; sw.js leaves it alone),
   each voice under a made-up address /__voice/<recordingId>, plus a small index
   in localStorage: id → { entry, bytes, at (last played) }.

   Never a burden on the phone:
     · at most MAX_VOICES voices and MAX_BYTES in all — the voices played longest
       ago go first;
     · nothing unplayed for KEEP_DAYS;
     · when the phone is low on space (the browser's own estimate: less than
       LOW_FREE left for this site, or over 90 % of what it may use), most of it
       is let go at once (down to LOW_KEEP);
     · Help shows how many are kept and has "Remove them".
   Consent: a voice is only saved while it's playable. When a card is opened
   with signal and a saved voice is no longer in its public list (withdrawn,
   erased) and isn't the viewer's own, it is dropped from the phone (forgetGone).
   Every call is best-effort: if storage is blocked, nothing is saved and
   nothing breaks.
   ============================================================================ */
const CACHE = "afd-voices-v1";
const INDEX = "afd.voices";
const MAX_VOICES = 300, MAX_BYTES = 30 * 1024 * 1024;   // ~30 MB; a voice is usually 10–40 KB
const KEEP_DAYS = 60;
const LOW_FREE = 300 * 1024 * 1024, LOW_KEEP = 40;      // phone nearly full → keep only the last 40

const can = () => { try{ return typeof caches !== "undefined" && !!window.localStorage; }catch(_){ return false; } };
const keyFor = (id) => new URL("__voice/" + encodeURIComponent(id), document.baseURI).href;
function readIndex(){ try{ return JSON.parse(localStorage.getItem(INDEX) || "{}") || {}; }catch(_){ return {}; } }
function writeIndex(ix){ try{ localStorage.setItem(INDEX, JSON.stringify(ix)); }catch(_){} }

const _objUrls = new Map();     // id → blob: URL handed out this page load

/* The saved copy of a recording, as a URL an <audio> can play; null if none. */
export async function savedUrl(id){
  if(!can() || !id) return null;
  if(_objUrls.has(id)) return _objUrls.get(id);
  try{
    const c = await caches.open(CACHE), r = await c.match(keyFor(id));
    if(!r) return null;
    const u = URL.createObjectURL(await r.blob());
    _objUrls.set(id, u);
    const ix = readIndex(); if(ix[id]){ ix[id].at = Date.now(); writeIndex(ix); }
    return u;
  }catch(_){ return null; }
}

/* A voice just played (from its online link): keep a copy. Quietly; once. */
const _saving = new Set();
export async function remember(id, entryId, url){
  if(!can() || !id || !url || !/^https?:/.test(url) || _saving.has(id)) return;
  const ix = readIndex();
  if(ix[id]){ ix[id].at = Date.now(); writeIndex(ix); return; }
  _saving.add(id);
  try{
    const r = await fetch(url, { mode: "cors", credentials: "omit" });
    if(!r.ok) return;
    const blob = await r.blob();
    if(!blob.size || blob.size > 2 * 1024 * 1024) return;          // not a voice
    const c = await caches.open(CACHE);
    await c.put(keyFor(id), new Response(blob, { headers: { "content-type": blob.type || "audio/webm" } }));
    const now = readIndex(); now[id] = { entry: entryId || "", bytes: blob.size, at: Date.now() }; writeIndex(now);
    await trim();
  }catch(_){ /* blocked storage, no CORS, quota — never mind */ }
  finally{ _saving.delete(id); }
}

async function drop(ids){
  if(!ids.length) return;
  const ix = readIndex();
  try{ const c = await caches.open(CACHE); await Promise.all(ids.map(id => c.delete(keyFor(id)))); }catch(_){}
  ids.forEach(id => { delete ix[id]; const u = _objUrls.get(id); if(u){ try{ URL.revokeObjectURL(u); }catch(_){} _objUrls.delete(id); } });
  writeIndex(ix);
}

/* Keep within the limits, and let go of most of it when the phone is low on space. */
export async function trim(){
  if(!can()) return;
  const ix = readIndex(), now = Date.now();
  let ids = Object.keys(ix).sort((a, b) => (ix[b].at || 0) - (ix[a].at || 0));   // newest-played first
  const out = ids.filter(id => now - (ix[id].at || 0) > KEEP_DAYS * 864e5);
  ids = ids.filter(id => !out.includes(id));
  let keep = MAX_VOICES;
  try{
    if(navigator.storage && navigator.storage.estimate){
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      if(quota && (quota - usage < LOW_FREE || usage / quota > 0.9)) keep = LOW_KEEP;
    }
  }catch(_){}
  let bytes = 0;
  ids.forEach((id, i) => { bytes += ix[id].bytes || 0; if(i >= keep || bytes > MAX_BYTES) out.push(id); });
  await drop(out);
}

/* A card opened with signal: drop saved voices of this word that are no longer
   in its public list (withdrawn or erased) — unless they're the viewer's own.
   complete: the list given is the whole public list (no "More voices" pending). */
export async function forgetGone(entryId, listedIds, complete){
  if(!can() || !complete) return;
  const ix = readIndex(), keep = new Set(listedIds);
  await drop(Object.keys(ix).filter(id => ix[id].entry === entryId && !keep.has(id)));
}

export function stats(){
  const ix = readIndex(), ids = Object.keys(ix);
  return { n: ids.length, bytes: ids.reduce((s, id) => s + (ix[id].bytes || 0), 0) };
}
export async function clearAll(){
  try{ await caches.delete(CACHE); }catch(_){}
  _objUrls.forEach(u => { try{ URL.revokeObjectURL(u); }catch(_){} }); _objUrls.clear();
  writeIndex({});
}
