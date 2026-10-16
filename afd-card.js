/* afd-card.js — the shared entry card + its audio/waveform/identity primitives.
   Single source of truth for how a dictionary entry is displayed and played,
   used by find.html (browse / search / deep-link) and the recorder.
   SDK-agnostic: the host injects db, storage, live getters for the signed-in
   user and display mode, the recorder URL, and a banner() via initCard().
   AFDCore is read from the global (afd-core.js must load before this module). */
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, collectionGroup, query, where, limit, getDocs, serverTimestamp, deleteField }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

let CFG = { db:null, store:null, recorderUrl:"index.html",
            mode:()=>"auto", user:()=>null, banner:()=>{} };
export function initCard(cfg){ CFG = Object.assign(CFG, cfg); }

let audioEl = new Audio();


const _envCache = new Map();


const FAUNA = {
  camel:'<path d="M4 17c1-4 2-4 3-6 1 3 4 3 6 3l2-3 1 3c2 0 3 1 3 3v2h-2v-1h-2v1h-2v-1H9v1H6v-1c-1 0-2-.5-2-2z"/>',
  ibex:'<path d="M8 6c-2-3-5-3-5-3 3 1 3 3 4 4-2 1-3 3-3 6 0 3 2 5 5 5s5-2 5-5c0-3-1-5-3-6 1-1 1-3 4-4 0 0-3 0-5 3z"/>',
  bird:'<path d="M4 14c3 0 6-2 8-6 1 3 3 4 6 4-1 2-3 4-7 4-3 0-6-1-7-2z"/>',
  fish:'<path d="M3 12c3-4 8-5 12-3 1-1 3-2 5-2-1 2-1 3 0 5-2 0-4-1-5-2-4 2-9 1-12-3z" transform="translate(0,2)"/>',
  gecko:'<path d="M12 3c-2 0-3 2-3 4 0 1 .5 2 1 3-2 1-4 3-4 6 0 2 2 4 4 4l1-2-1-2c-1 0-2-1-2-2 0-2 3-3 4-3s4 1 4 3c0 1-1 2-2 2l-1 2 1 2c2 0 4-2 4-4 0-3-2-5-4-6 .5-1 1-2 1-3 0-2-1-4-3-4z"/>',
  frog:'<path d="M5 9c0-2 1-3 2-3 0 1 0 2 1 2h8c1 0 1-1 1-2 1 0 2 1 2 3 0 1-1 2-2 2 1 1 2 3 2 5H5c0-2 1-4 2-5-1 0-2-1-2-2z"/>'
};


const FAUNA_KEYS = Object.keys(FAUNA);


function hashInt(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }

function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
// A word's photo in its box (10-16). Lazy: the list has a box per word, and
// without it opening the dictionary downloads every photo, down the page too.
// Escaped even though the rules pin the URL: it lands in innerHTML.
function thumbImg(url){ return `<img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async">`; }

function downsampleEnv(frames, n){
  n=n||48; if(!frames||!frames.length) return [];
  const mx=Math.max.apply(null,frames)||1e-9, out=[];
  if(frames.length<=n){ for(const f of frames) out.push(+(f/mx).toFixed(2)); return out; }
  const bin=frames.length/n;
  for(let i=0;i<n;i++){ let pk=0; const s=Math.floor(i*bin),e=Math.floor((i+1)*bin);
    for(let j=s;j<e;j++) if(frames[j]>pk) pk=frames[j]; out.push(+(pk/mx).toFixed(2)); }
  return out;
}

function boxBars(env, n){
  n=n||26; const src=env||[], step=src.length? src.length/n : 0; let bars="";
  for(let i=0;i<n;i++){
    const v = src.length ? src[Math.min(src.length-1, Math.floor(i*step))] : 0;
    const h=Math.max(9, v*100), slot=100/n, w=(slot*0.62).toFixed(2),
          x=(i*slot + slot*0.19).toFixed(2), y=((100-h)/2).toFixed(2);
    bars+=`<rect x="${x}" y="${y}" width="${w}" height="${h.toFixed(2)}"/>`;
  }
  return bars;
}

function domainColor(seed){ const h=hashInt(String(seed)); return `hsl(${h%360} 34% 34%)`; }

function faunaAvatar(seed){
  const h = hashInt(String(seed));
  const hue = h % 360;
  const key = FAUNA_KEYS[h % FAUNA_KEYS.length];
  const bg = `hsl(${hue} 42% 46%)`;
  return { bg, svg:`<svg viewBox="0 0 24 24" fill="rgba(255,255,255,.92)" aria-hidden="true">${FAUNA[key]}</svg>` };
}

function paintBox(thumbEl, env){
  if(!thumbEl) return;
  if(env && env.length){
    thumbEl.innerHTML =
      `<svg class="thumb-wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${boxBars(env)}</svg>`;
  }else{
    thumbEl.textContent = thumbEl.getAttribute("data-letter") || "•";
  }
}

async function envelopeFor(rec){
  if(rec && rec.envelope && rec.envelope.length) return rec.envelope;
  if(!rec || !rec.url) return null;
  if(_envCache.has(rec.url)) return _envCache.get(rec.url);
  try{
    const ab = await (await fetch(rec.url)).arrayBuffer();
    const ac = new (window.AudioContext||window.webkitAudioContext)();
    const buf = await ac.decodeAudioData(ab); ac.close();
    const ch=buf.getChannelData(0), fr=Math.floor(buf.sampleRate*0.02), frames=[];
    for(let i=0;i<ch.length;i+=fr){ let e=0,n=0;
      for(let j=i;j<Math.min(i+fr,ch.length);j++){ e+=ch[j]*ch[j]; n++; }
      frames.push(Math.sqrt(e/Math.max(n,1))); }
    const env=downsampleEnv(frames,48); _envCache.set(rec.url, env); return env;
  }catch(_){ return null; }
}

let _wordById=null;
function localWord(entryId){
  if(!_wordById){
    _wordById=new Map();
    try{ (window.AFDWords||[]).forEach(w=>_wordById.set(AFDCore.entryIdFor(w.id), w)); }catch(_){}
  }
  return _wordById.get(entryId) || null;
}

async function applyBox(thumbEl, mode, recs){
  if(!thumbEl) return;
  const d = thumbEl.dataset;
  const asText = t => { thumbEl.textContent = t || (d.letter || "•"); };
  const asWave = async () => paintBox(thumbEl, recs && recs[0] ? await envelopeFor(recs[0]) : null);
  const asIcon = () => { thumbEl.innerHTML = AFDCore.identicon(d.entry || d.script || d.letter); };
  // Sound tier (10-15): the box keeps the word's PICTURE, as in the other tiers.
  // It used to swap to a voice's shape once the card opened — so the same word
  // looked different by tier and by open/closed, and a word with no voice of
  // its own borrowed the shape of a sentence. The picture is the non-reader's
  // anchor; the voices' shapes stay in their own rows below.
  if(mode==="sound"){
    if(d.img){ thumbEl.innerHTML = thumbImg(d.img); return; }
    return d.pic ? asText(d.pic) : asIcon();
  }
  // Script tier: the Arabic word already sits beside the box, so the box keeps
  // the PICTURE (the constant visual anchor across all tiers). With no picture,
  // the identicon, as in the other tiers (10-14: the script word used to stand
  // in here, overflowing on long words and repeating the text beside it).
  if(mode==="script"){
    if(d.img){ thumbEl.innerHTML = thumbImg(d.img); return; }
    return d.pic ? asText(d.pic) : asIcon();
  }
  // auto
  if(d.img){ thumbEl.innerHTML = thumbImg(d.img); return; }
  if(d.pic){ return asText(d.pic); }
  return asIcon();
}

/* Waiting, made visible (10-14): three bouncing dots in place of the play
   triangle while a voice is on its way, and under an opening card while its
   voices load. Only after a short beat, so a fast answer never flickers. */
const DOTS = '<span class="ldots" aria-hidden="true"><span></span><span></span><span></span></span>';
function busyBtn(btn){
  if(!btn) return ()=>{};
  let on=false; const t=setTimeout(()=>{ on=true; btn.classList.add("loading"); btn.setAttribute("aria-busy","true"); }, 250);
  const safety=setTimeout(()=>done(), 15000);
  function done(){ clearTimeout(t); clearTimeout(safety); if(on){ btn.classList.remove("loading"); btn.removeAttribute("aria-busy"); } }
  return done;
}
function playInto(btn, url, done){
  try{ audioEl.pause(); }catch(_){}
  done = done || busyBtn(btn);
  audioEl = new Audio(url);
  ["playing","error","abort"].forEach(ev=> audioEl.addEventListener(ev, done, { once:true }));
  audioEl.play().catch(done);
}

// Briefly memoised: the dictionary asks for the same word's counts several
// times in one render (which words to list, the card header, the views), and
// each ask is a Firestore query. 15 s keeps one render to one read per word
// while a new or withdrawn voice still shows on the next look.
const _countsCache = new Map();   // entryId -> { at, p }
// A word card whose doc carries `voices` (kept by the afd-voice-counts function,
// 10-15) needs no query at all: the list primes the cache from the one read of
// afd_entries. Primed counts hold for the same 15 s as a fetched answer.
function primeCounts(entryId, voices){
  if(!voices || typeof voices !== "object") return false;
  const c = { word: +voices.word || 0, context: +voices.context || 0, definition: +voices.definition || 0 };
  _countsCache.set(entryId, { at: Date.now(), p: Promise.resolve(c) });
  return true;
}
function entryCounts(entryId){
  const hit = _countsCache.get(entryId);
  if(hit && Date.now() - hit.at < 15000) return hit.p;
  const p = loadCounts(entryId);
  _countsCache.set(entryId, { at: Date.now(), p });
  return p;
}
async function loadCounts(entryId){
  const c={word:0,context:0,definition:0};
  try{
    const snap=await getDocs(query(collection(CFG.db,"afd_entries",entryId,"recordings"),
                                   where("allowPlayback","==",true), limit(50)));
    snap.forEach(d=>{ const v=d.data(); const t=v.type||v.phase||"word"; if(t in c) c[t]++; });
  }catch(_){}
  return c;
}

// ---- contributor identity ------------------------------------------------
// A steward who chose "known" shows their name + (optional) photo on their OWN
// voices. Obscure stewards, and any voice recorded by proxy (viaAgent), keep
// the deterministic fauna avatar — a known steward never reveals the elders
// they recorded. Public reads (afd_stewards + afd_avatars), cached per owner.
const _stewardCache = new Map();   // uid -> Promise<{ known, displayName, avatarUrl } | null>
function stewardProfile(uid){
  if(!uid || !CFG.db) return Promise.resolve(null);
  // Cache the in-flight lookup, not just the answer, so voices loading in
  // parallel share one read per contributor.
  if(!_stewardCache.has(uid)) _stewardCache.set(uid, (async ()=>{
    let prof = null;
    try{
      const sn = await getDoc(doc(CFG.db,"afd_stewards",uid));
      if(sn.exists()){
        const d = sn.data() || {};
        if(d.visibility === "known"){
          prof = { known:true, displayName:String(d.displayName||"").slice(0,80), avatarUrl:null };
          // Only reach for the picture when the profile says one exists — otherwise
          // getDownloadURL 404s in the console even though we catch the rejection.
          if(d.hasAvatar===true){ try{ prof.avatarUrl = await getDownloadURL(ref(CFG.store,"afd_avatars/"+uid+"/avatar")); }catch(_){} }
        }
      }
    }catch(_){}
    return prof;
  })());
  return _stewardCache.get(uid);
}
// ---- speaker's town (opt-in public, tier 3 of origin visibility) ----------
// Shown under a voice only when its speaker chose it (grant.publicOrigin); the
// rules refuse the read otherwise, which we take as "no town". One read per
// speaker, cached. The town is stored as entered (English); its label comes
// from the instance's speaker form when it's one of the suggested towns.
const _townCache = new Map();      // speakerId -> Promise<string|null>
function publicTown(speakerId){
  if(!speakerId || !CFG.db) return Promise.resolve(null);
  if(!_townCache.has(speakerId)) _townCache.set(speakerId, (async ()=>{
    try{
      const sn = await getDoc(doc(CFG.db,"afd_speakers",speakerId,"public","origin"));
      return sn.exists() ? (String((sn.data()||{}).town||"").trim() || null) : null;
    }catch(_){ return null; }
  })());
  return _townCache.get(speakerId);
}
function townLabel(town, mode){
  const f = ((window.AFDInstance && window.AFDInstance.speaker && window.AFDInstance.speaker.fields) || [])
              .find(x => x.slot === "origin.town");
  const o = f && (f.options || []).find(x => x.value === town && x.label);
  return o ? AFDCore.t(o.label, mode) : town;
}
// the caption under a voice's avatar: a known contributor's name, the town, or both
function avCaption(rec){
  return [rec.displayName, rec.town ? townLabel(rec.town, CFG.mode()) : ""].filter(Boolean);
}

function photoAvatar(bg, url){
  return { bg, svg:`<img src="${url}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit">` };
}
function monogramAvatar(bg, name){
  const initials = String(name||"").trim().split(/\s+/).slice(0,2).map(w=>w[0]||"").join("").toUpperCase() || "\u2022";
  return { bg, svg:`<svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="12" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-weight="600" font-size="10" fill="rgba(255,255,255,.95)">${escapeHtml(initials)}</text></svg>` };
}

async function listPlayable(entryId){
  // Everything here runs in parallel: the two queries, then one audio link per
  // voice, then the contributor profiles. One at a time, a word with a few
  // voices took several seconds to open — each link is a network round-trip,
  // and under the consent-gated Storage rules each also costs a Firestore read.
  const recsCol=collection(CFG.db,"afd_entries",entryId,"recordings");
  let docs=[];
  try{
    const [pub, mine] = await Promise.all([
      getDocs(query(recsCol, where("allowPlayback","==",true), limit(12))),
      // the signed-in viewer's own voices for this word — including withdrawn ones,
      // so they can restore. Dev + deployed rules both let an author read their own.
      CFG.user() ? getDocs(query(recsCol, where("uid","==",CFG.user().uid), limit(12)))
                 : Promise.resolve({ docs: [] })
    ]);
    const seen=new Set();
    for(const d of [...pub.docs, ...mine.docs]){ if(!seen.has(d.id)){ seen.add(d.id); docs.push(d); } }
  }catch(_){}
  const rows = await Promise.all(docs.map(async d=>{
    const v=d.data(); if(!v.storagePath) return null;
    if(v.consent==="deleted") return null;   // erased: awaiting server purge, shown to no one — not even its owner
    let url; try{ url=await getDownloadURL(ref(CFG.store,v.storagePath)); }catch(_){ return null; }
    return { url, recordingId:d.id, entryId, uid:v.uid, speakerId:v.speakerId||null, viaAgent: v.viaAgent===true,
             type: v.type || v.phase || "word",
             // What the viewer can act on is whether others can HEAR it. A take
             // labelled public but uploaded hidden (its speaker card was withdrawn)
             // must offer Restore, not Withdraw — Restore reopens the card.
             consent: (v.consent && v.consent!=="public") ? v.consent : (v.allowPlayback ? "public" : "withdrawn"),
             // Hidden but never withdrawn: uploaded private (the "let other people
             // listen" box was unticked, or the speaker card was closed). Its owner
             // is told plainly that only they can hear it, and offered Share — not
             // "Restore", which reads as undoing something they never did.
             neverShared: v.consent==="public" && v.allowPlayback!==true,
             mine: !!(CFG.user() && v.uid===CFG.user().uid),
             envelope:(Array.isArray(v.envelope)&&v.envelope.length)?v.envelope:null,
             avatar: faunaAvatar(v.uid ? (v.uid+"|"+(v.speakerId||"")) : (v.speakerId||d.id)) };
  }));
  const out = rows.filter(Boolean);           // same order as before: public first, then the viewer's own
  // Overlay contributor identity: a "known" steward's own (non-proxied) voices
  // get their photo, or a name monogram if they set no picture. Cache dedupes
  // repeated owners, so this is at most one read per distinct contributor.
  // Towns and contributor profiles are independent, so they're fetched in the
  // same round (10-16) — one network wait fewer each time a card opens.
  await Promise.all(out.map(async rec=>{
    const [town, p] = await Promise.all([
      publicTown(rec.speakerId),
      (rec.viaAgent || !rec.uid) ? null : stewardProfile(rec.uid)   // proxied voices stay pseudonymous
    ]);
    rec.town = town;
    if(p && p.known){
      rec.displayName = p.displayName;
      rec.avatar = p.avatarUrl ? photoAvatar(rec.avatar.bg, p.avatarUrl)
                               : monogramAvatar(rec.avatar.bg, p.displayName);
    }
  }));
  return out;
}

function playVoiceInto(rec, thumbEl, playBtn, setUrl){
  setUrl(rec.url);
  if(thumbEl && thumbEl.querySelector(".thumb-wave")) envelopeFor(rec).then(env=> paintBox(thumbEl, env));
  playInto(playBtn, rec.url);
}

/* Withdraw (or restore) every recording made by ONE speaker — the (uid,
   speakerId) pair, since a single steward account may record several speakers.
   Scoped tight: it never touches another speaker's takes, and never an already-
   erased one. Recoverable — "withdrawn" only hides from public listening; the
   bytes stay until a separate Erase. Index-free: two equality filters per entry
   subcollection ride Firestore's auto single-field indexes, so there's nothing
   extra to configure. */
async function withdrawSpeaker(uid, speakerId, state, withdrawal){
  // "deleted" is honoured only when passed explicitly (agent-erase); any other
  // non-public value safe-defaults to "withdrawn" so a bulk erase can never
  // happen by accident. Both hidden states need the spoken proof for an agent.
  state = (state==="public" || state==="deleted") ? state : "withdrawn";
  if(!uid || !speakerId) return 0;
  // One spoken act of withdrawal authorises the whole bulk: the SAME proof is
  // stamped on every affected take. The Firestore rule (withdrawalArtifactOK)
  // demands withdrawal.audioPath for an agent's withdrawal; a restore to public
  // needs none, and never over-writes the historical proof already on a take.
  const proof = (state!=="public" && withdrawal && typeof withdrawal.audioPath==="string")
    ? withdrawal : null;
  const patch = proof
    ? { consent: state, allowPlayback: false, withdrawal: proof }
    : { consent: state, allowPlayback: state==="public" };
  const entryIds = new Set((window.AFDWords||[]).map(w=>AFDCore.entryIdFor(w.id)));
  try{
    const snap = await getDocs(query(collection(CFG.db,"afd_entries"), where("source","==","user")));
    snap.docs.forEach(d=>entryIds.add(d.id));
  }catch(e){ console.warn("[AFD] withdrawSpeaker: user entries", e); }
  // Keep the (speakerId-keyed) speaker card's bulk state in step with its takes,
  // so the roster can read one field instead of scanning every recording.
  // ORDER MATTERS, and is opposite for the two directions: the rules let a take
  // become playable only while its card is public, so a restore flips the card
  // FIRST; a withdrawal hides the takes first and the card last, so a failure
  // part-way never leaves a public card over hidden-but-claimed-public takes.
  const setCard = async () => {
    try{ await updateDoc(doc(CFG.db,"afd_speakers",speakerId), { consent: state }); }
    catch(e){ /* no card yet (nothing uploaded) — harmless */ }
  };
  if(state==="public") await setCard();
  let n=0;
  for(const eid of entryIds){
    try{
      const rs = await getDocs(query(collection(CFG.db,"afd_entries",eid,"recordings"),
                    where("uid","==",uid), where("speakerId","==",speakerId)));
      for(const r of rs.docs){
        if((r.data()||{}).consent === "deleted") continue;   // never touch an erased take
        await updateDoc(r.ref, patch);
        n++;
      }
    }catch(e){ console.warn("[AFD] withdrawSpeaker", eid, e); }
  }
  if(state!=="public") await setCard();
  console.log("[AFD] withdrawSpeaker", speakerId, "\u2192", state, "count", n, proof?"(with proof)":"");
  return n;
}

/* ---- word tools: tags, and "remove my word" ------------------------------
   Under the open card, for the people the rules allow (afd-firestore.rules,
   afd_entries update):
     • Tags — free labels ("Mehri", "eastern dialect", "loanword"…): the word's
       creator, or a steward on any word. Labels, not a verdict: a tagged word
       stays in the dictionary.
     • Remove my word — the creator of a contributed word, while every voice on
       it is theirs. Erases their voices (the same Erase as a single voice) and
       marks the word removed, so it leaves the dictionary at once; the daily
       purge deletes it, and its photo, once the audio is gone. If anyone else
       has recorded it, it isn't one person's to remove. */
const _stewardMe = new Map();     // uid -> Promise<bool>
function amSteward(){
  const u = CFG.user(); if(!u || !CFG.db) return Promise.resolve(false);
  if(!_stewardMe.has(u.uid)) _stewardMe.set(u.uid,
    getDoc(doc(CFG.db,"afd_admins",u.uid)).then(sn=>sn.exists()).catch(()=>false));
  return _stewardMe.get(u.uid);
}
function parseTags(str){
  const out=[];
  for(const raw of String(str||"").split(/[,\u060C;]/)){
    const t=raw.trim().replace(/\s+/g," ").slice(0,40);
    if(t && !out.some(x=>x.toLowerCase()===t.toLowerCase())) out.push(t);
  }
  return out.slice(0,6);
}
/* ---- emoji picker for Edit word (10-14) ----------------------------------
   Built on data/concept-emoji.json: one suggested emoji per concept on the
   comparison lists (Leipzig-Jakarta first), grouped by Concepticon's semantic
   fields, plus the dictionary's own Dhofar group. On top: this word's own
   suggestion — from its linked concept, else by matching its English to a
   concept — and a "not in the dictionary yet" row: list concepts no word card
   covers, a nudge for what to collect next. The text box stays for anything
   else; picking only fills it. */
let _emojiData = null;
function emojiData(){
  return _emojiData || (_emojiData = fetch(new URL("data/concept-emoji.json", document.baseURI))
    .then(r => r.ok ? r.json() : null).catch(() => null));
}
const normGloss = (g) => String(g||"").toLowerCase().replace(/\(.*?\)/g," ").replace(/[^a-z ]+/g," ").replace(/\s+/g," ").trim();
function glossKeys(g){                         // "STONE OR ROCK" → ["stone","rock"]; "rocks" also tries "rock"
  const out = new Set();
  for(const part of normGloss(g).split(/ or /)){ const p = part.trim(); if(p){ out.add(p); if(p.endsWith("s")) out.add(p.slice(0,-1)); } }
  return out;
}
function conceptsFor(data, meta){
  const ids = new Set((meta.concepts||[]).map(c => String(c).replace(/^concepticon:/,"")).filter(id => data.concepts[id]));
  if(!ids.size){
    const mine = glossKeys(meta.gloss || (meta.glosses && meta.glosses.en) || "");
    for(const [id, c] of Object.entries(data.concepts)) for(const k of glossKeys(c.gloss)) if(mine.has(k)) ids.add(id);
  }
  return [...ids];
}
async function stillNeeded(data){
  // list concepts (lead list) that no word card links to or names in English
  const covered = new Set(), names = new Set();
  const take = (d)=>{ (d.concepts||[]).forEach(c => covered.add(String(c).replace(/^concepticon:/,"")));
                      glossKeys(d.gloss || (d.glosses && d.glosses.en) || "").forEach(k => names.add(k)); };
  (window.AFDWords||[]).forEach(w => take({ gloss:w.en }));
  try{ (await getDocs(collection(CFG.db,"afd_entries"))).forEach(sn => { const d=sn.data()||{}; if(!d.removedAt && !d.hiddenAt) take(d); }); }catch(_){}
  return Object.entries(data.concepts).filter(([id, c]) => c.lj && c.emoji && !covered.has(id)
    && ![...glossKeys(c.gloss)].some(k => names.has(k)));
}
function emojiPicker(host, entryId, meta, m){
  const ar = m !== "auto";
  host.innerHTML =
    `<div class="ep-now"><span class="ep-cur" aria-live="polite"></span>`+
    `<input type="text" data-f="pic" maxlength="32" autocomplete="off" aria-label="${escapeHtml(AFDCore.t("card.edit.pic", m))}" placeholder="${escapeHtml(AFDCore.t("ep.other", m))}">`+
    `<button type="button" class="ep-none">${AFDCore.tHTML("ep.none", m)}</button></div>`+
    `<div class="ep-sug" hidden></div><div class="ep-tabs" role="tablist"></div><div class="ep-grid"></div>`;
  const inp = host.querySelector("input"), cur = host.querySelector(".ep-cur");
  const sug = host.querySelector(".ep-sug"), tabs = host.querySelector(".ep-tabs"), grid = host.querySelector(".ep-grid");
  const show = ()=>{ cur.textContent = inp.value || "—"; host.querySelectorAll(".ep-e").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.e === inp.value))); };
  const set = (e)=>{ inp.value = e; show(); };
  inp.addEventListener("input", show);
  host.querySelector(".ep-none").onclick = ()=> set("");
  const btn = (e, title)=>`<button type="button" class="ep-e" data-e="${escapeHtml(e)}" title="${escapeHtml(title||"")}" aria-label="${escapeHtml(title||e)}">${escapeHtml(e)}</button>`;
  host.addEventListener("click", (ev)=>{ const b = ev.target.closest(".ep-e"); if(b) set(b.dataset.e); });
  const fieldName = (data, f)=> ar ? ((data.fields[f]||{}).ar || f) : f;
  let built = false;
  async function open(){
    if(built) return; built = true;
    const data = await emojiData(); if(!data){ grid.innerHTML = ""; return; }
    // this word's own suggestion(s)
    const mineIds = conceptsFor(data, meta).filter(id => data.concepts[id].emoji);
    if(mineIds.length){
      sug.hidden = false;
      sug.innerHTML = `<span class="ep-lab">${AFDCore.tHTML("ep.suggested", m)}</span>` +
        [...new Set(mineIds.map(id => data.concepts[id].emoji))].map(e => btn(e, mineIds.find(id => data.concepts[id].emoji===e) && data.concepts[mineIds.find(id => data.concepts[id].emoji===e)].gloss.toLowerCase())).join("");
    }
    // groups: still needed · Dhofar · each field that has a picture
    const groups = [];
    const needed = await stillNeeded(data);
    if(needed.length) groups.push({ key:"needed", label:AFDCore.tHTML("ep.needed", m), items: needed.map(([id,c]) => [c.emoji, c.gloss.toLowerCase()]) });
    if((data.custom||[]).length) groups.push({ key:"custom", label:AFDCore.tHTML("ep.custom", m), items: data.custom.map(c => [c.emoji, c.label]) });
    // fields in the order the lead list first meets them (data.fields keeps it),
    // concepts in list order — object keys alone would sort by Concepticon ID
    const byField = new Map(Object.keys(data.fields||{}).map(f => [f, []]));
    for(const id of (data.order || Object.keys(data.concepts))){ const c = data.concepts[id]; if(!c || !c.emoji) continue;
      if(!byField.has(c.field)) byField.set(c.field, []); byField.get(c.field).push([c.emoji, c.gloss.toLowerCase()]); }
    for(const [f, items] of byField) if(items.length) groups.push({ key:f, label:escapeHtml(fieldName(data, f)), items });
    tabs.innerHTML = groups.map((g,i) => `<button type="button" class="ep-tab" role="tab" data-i="${i}" aria-selected="${i===0}">${g.label}</button>`).join("");
    const paint = (i)=>{
      const seen = new Set();
      grid.innerHTML = groups[i].items.filter(([e]) => !seen.has(e) && seen.add(e)).map(([e,t]) => btn(e,t)).join("");
      tabs.querySelectorAll(".ep-tab").forEach(t => { const on = +t.dataset.i === i; t.setAttribute("aria-selected", String(on));
        if(on && t.scrollIntoView) try{ t.scrollIntoView({ inline:"nearest", block:"nearest" }); }catch(_){} });
      show();
    };
    tabs.addEventListener("click", (ev)=>{ const t = ev.target.closest(".ep-tab"); if(t) paint(+t.dataset.i); });
    if(groups.length) paint(0);
  }
  return { set, open };
}

async function wordTools(entryId, meta, recs, cardEl, detail, paintTags, paintFace){
  const u = CFG.user(); if(!u) return;
  const creator = meta.source==="user" && meta.createdBy===u.uid;
  const canTag = creator || await amSteward();
  if(!creator && !canTag) return;
  const m = CFG.mode();
  const box=document.createElement("div"); box.className="word-tools";
  detail.appendChild(box);

  if(canTag){
    const tb=document.createElement("button"); tb.type="button"; tb.className="wt-btn";
    tb.innerHTML="\u{1F3F7}\uFE0F "+AFDCore.tHTML("card.tags", m);
    const ed=document.createElement("div"); ed.className="wt-tags"; ed.hidden=true;
    ed.innerHTML=`<input type="text" maxlength="260" autocomplete="off"><p class="wt-note">${AFDCore.tHTML("card.tags.hint", m)}</p>`+
      `<button type="button" class="wt-btn wt-save">${AFDCore.tHTML("card.tags.save", m)}</button>`;
    const inp=ed.querySelector("input"); inp.value=(meta.tags||[]).join(", ");
    tb.onclick=()=>{ ed.hidden=!ed.hidden; if(!ed.hidden) inp.focus(); };
    ed.querySelector(".wt-save").onclick=async ()=>{
      const tags=parseTags(inp.value);
      try{
        await updateDoc(doc(CFG.db,"afd_entries",entryId), { tags });
        meta.tags=tags; paintTags(tags); inp.value=tags.join(", "); ed.hidden=true;
      }catch(e){ console.warn("[AFD] tags", e); CFG.banner(AFDCore.t("card.failed", m)); }
    };
    box.appendChild(tb); box.appendChild(ed);

    /* Edit the word's face — English, Arabic, emoji (10-14). Same people as
       tags: a steward on any word, the creator on their own (the rules check
       the same, plus editedAt/editedBy). A photo, if the word has one, still
       shows in place of the emoji. */
    const eb=document.createElement("button"); eb.type="button"; eb.className="wt-btn";
    eb.innerHTML="\u270F\uFE0F "+AFDCore.tHTML("card.edit", m);
    const fe=document.createElement("div"); fe.className="wt-tags wt-edit"; fe.hidden=true;
    const fld=(key, f, dir, max)=>`<label class="wt-field"><span>${AFDCore.tHTML(key, m)}</span>`+
      `<input type="text" data-f="${f}" dir="${dir}" maxlength="${max}" autocomplete="off"></label>`;
    fe.innerHTML=fld("card.edit.en","en","ltr",80)+fld("card.edit.ar","ar","rtl",80)+
      `<div class="wt-field ep-host"><span>${AFDCore.tHTML("card.edit.pic", m)}</span><div class="ep"></div></div>`+
      (meta.image ? `<p class="wt-note">${AFDCore.tHTML("card.edit.photo", m)}</p>` : "")+
      `<button type="button" class="wt-btn wt-save">${AFDCore.tHTML("card.edit.save", m)}</button>`;
    const inF=(f)=>fe.querySelector(`[data-f="${f}"]`);
    const picker=emojiPicker(fe.querySelector(".ep"), entryId, meta, m);
    const fill=()=>{ inF("en").value=meta.gloss||""; inF("ar").value=meta.glossAr||""; picker.set(meta.pic||""); };
    eb.onclick=()=>{ fe.hidden=!fe.hidden; if(!fe.hidden){ fill(); picker.open(); inF("en").focus(); } };
    fe.querySelector(".wt-save").onclick=async ()=>{
      const en=inF("en").value.trim().replace(/\s+/g," ").slice(0,80);
      const ar=inF("ar").value.trim().replace(/\s+/g," ").slice(0,80);
      const pic=inF("pic").value.trim().slice(0,32);
      const glosses={}; if(en) glosses.en=en; if(ar) glosses.ar=ar;
      const sv=fe.querySelector(".wt-save"); sv.disabled=true;
      try{
        await updateDoc(doc(CFG.db,"afd_entries",entryId), {
          gloss:en, glossAr:ar,
          glosses: Object.keys(glosses).length ? glosses : deleteField(),
          pic: pic || deleteField(),
          editedAt: serverTimestamp(), editedBy: u.uid });
        meta.gloss=en; meta.glossAr=ar; meta.glosses=glosses; if(pic) meta.pic=pic; else delete meta.pic;
        if(typeof paintFace==="function") paintFace(meta);
        fe.hidden=true;
      }catch(e){ console.warn("[AFD] edit word", e); CFG.banner(AFDCore.t("card.failed", m)); }
      finally{ sv.disabled=false; }
    };
    box.appendChild(eb); box.appendChild(fe);
  }

  if(creator){
    const others = recs.some(r=>!r.mine);
    const proxied = recs.some(r=>r.mine && r.viaAgent);   // recorded FOR someone else: theirs to withdraw, not ours
    const rb=document.createElement("button"); rb.type="button"; rb.className="wt-btn wt-remove";
    rb.innerHTML=AFDCore.tHTML("card.remove", m);
    box.appendChild(rb);
    if(others || proxied){
      rb.disabled=true;
      const n=document.createElement("p"); n.className="wt-note";
      n.innerHTML=AFDCore.tHTML("card.remove.others", m);
      box.appendChild(n);
      return;
    }
    rb.onclick=async ()=>{
      const gone=()=>{ cardEl.remove(); CFG.banner(AFDCore.t("card.removed", m)); };
      // Removed already (e.g. from another device while this page sat open)?
      // Then there's nothing left to do — say so, rather than fail on the
      // rules' "only once".
      try{ const sn=await getDoc(doc(CFG.db,"afd_entries",entryId));
           if(!sn.exists() || (sn.data()||{}).removedAt){ gone(); return; } }catch(_){}
      if(!confirm(AFDCore.t("card.remove.confirm", m))) return;
      rb.disabled=true;
      try{
        // all of MY takes on it, hidden ones included (the list above only has what loaded)
        const mine = await getDocs(query(collection(CFG.db,"afd_entries",entryId,"recordings"),
                                         where("uid","==",u.uid)));
        for(const r of mine.docs){
          if((r.data()||{}).consent==="deleted") continue;
          await updateDoc(r.ref, { consent:"deleted", allowPlayback:false });
        }
        await updateDoc(doc(CFG.db,"afd_entries",entryId), { removedAt: serverTimestamp() });
        gone();
      }catch(e){
        console.warn("[AFD] remove word", e);
        rb.disabled=false;
        CFG.banner(AFDCore.t("card.failed", m));
      }
    };
  }
}

async function setConsent(rec, state){
  try{
    // The rules only let a take become playable while its speaker card is
    // public. Restoring one take of a withdrawn speaker is the steward choosing
    // to share again, so reopen the card first — the same act as the roster's
    // "share again", just started from a single voice. (A card whose speaker
    // never ticked public playback also reads "withdrawn".)
    if(state==="public" && rec.speakerId && CFG.user()){
      try{
        const sref=doc(CFG.db,"afd_speakers",rec.speakerId), sn=await getDoc(sref);
        const card=sn.exists() ? (sn.data()||{}) : null;
        if(card && card.consent!=="public" && card.stewardUid===CFG.user().uid)
          await updateDoc(sref, { consent:"public" });
      }catch(e){ console.warn("[AFD] reopen speaker card", e); }
    }
    await updateDoc(doc(CFG.db,"afd_entries",rec.entryId,"recordings",rec.recordingId),
      { consent: state, allowPlayback: state==="public" });
    rec.consent = state; return true;
  }catch(e){ console.warn("[AFD] consent change failed", e); CFG.banner(AFDCore.t("voice.change.failed", CFG.mode())); return false; }
}

// "Play <name>" for a known contributor, else "Play this voice" (screen readers)
function playLabel(rec){
  return rec.displayName ? AFDCore.tf("voice.play.name", CFG.mode(), { name: rec.displayName })
                         : AFDCore.t("voice.play", CFG.mode());
}
// A button label in the card's style: English + small Arabic in auto, else the
// display mode's own text (as AFDCore.t gives it).
function biLabel(key){
  const m=CFG.mode(), s=(AFDCore.STRINGS||{})[key];
  if(m==="auto" && s && s.ar) return escapeHtml(s.en)+' <span class="ar">'+escapeHtml(s.ar)+'</span>';
  return escapeHtml(AFDCore.t(key, m));
}

function voiceAvatarBtn(rec, thumbEl, playBtn, setUrl){
  const b=document.createElement("button");
  b.className="av"; b.style.background=rec.avatar.bg;
  b.setAttribute("aria-label", playLabel(rec));
  if(rec.displayName) b.title=rec.displayName;
  b.innerHTML=rec.avatar.svg;
  b.addEventListener("click",()=>{ b.setAttribute("aria-pressed","true");
    playVoiceInto(rec, thumbEl, playBtn, setUrl); });
  const cap = avCaption(rec);
  if(cap.length){                            // a "known" contributor's name and/or the speaker's town
    const wrap=document.createElement("span"); wrap.className="av-wrap";
    wrap.appendChild(b);
    cap.forEach((t,i)=>{ const nm=document.createElement("span"); nm.className = i===0 && rec.displayName ? "av-name" : "av-name av-town"; nm.textContent=t; wrap.appendChild(nm); });
    return wrap;
  }
  return b;
}

function buildVoiceRow(rec, thumbEl, playBtn, setUrl, onErased){
  const row=document.createElement("div");
  row.className="voice-row"; row.setAttribute("aria-pressed","false");
  const play=document.createElement("button");
  play.className="vr-play"; play.setAttribute("aria-label", playLabel(rec));
  if(rec.displayName) play.title=rec.displayName;
  const vrWave = (rec.envelope && rec.envelope.length)
    ? `<span class="vr-wave"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${boxBars(rec.envelope, 40)}</svg></span>`
    : `<span class="vr-wave"></span>`;
  const avSm=`<span class="av-sm" style="background:${rec.avatar.bg}">${rec.avatar.svg}</span>`;
  const cap = avCaption(rec);
  const avBlock = cap.length
    ? `<span class="av-wrap">${avSm}${cap.map((t,i)=>`<span class="av-name${i===0 && rec.displayName ? "" : " av-town"}">${escapeHtml(t)}</span>`).join("")}</span>`
    : avSm;
  play.innerHTML=avBlock+
    vrWave+
    `<svg class="pl" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  play.addEventListener("click",()=>{
    const parent=row.parentElement;
    if(parent) parent.querySelectorAll(".voice-row").forEach(x=>x.setAttribute("aria-pressed","false"));
    row.setAttribute("aria-pressed","true");
    playVoiceInto(rec, thumbEl, playBtn, setUrl);
  });
  row.appendChild(play);

  if(rec.mine && rec.consent!=="deleted"){
    const controls=document.createElement("div");
    controls.className="vr-controls";

    /* Withdraw / Restore — the consent lever, AFTER the recording is saved and
       public. "My brother won't let me publish that" → hide it from the shared
       pool, kept safe and restorable. Reversible, so no confirm.
       (Try again — the quality redo — is not here; it lives at recording time in
       the recorder's review card as "Record again", before anything is saved.) */
    const ctl=document.createElement("button");
    ctl.className="voice-ctl";
    // Who can hear this take, said in words, only while the answer is "just you".
    const status=document.createElement("span");
    status.className="vr-status";
    const paint=()=>{
      const withdrawn = rec.consent==="withdrawn";
      const fresh = withdrawn && rec.neverShared===true;     // private from the start
      row.classList.toggle("withdrawn", withdrawn);
      ctl.classList.toggle("restore", withdrawn);
      status.hidden = !withdrawn;
      status.textContent = withdrawn ? "\u{1F512} " + AFDCore.t("voice.private", CFG.mode()) : "";
      ctl.textContent = !withdrawn ? AFDCore.t("voice.takeback", CFG.mode())
                      : fresh ? AFDCore.t("voice.share", CFG.mode())
                      : AFDCore.t("voice.shareagain", CFG.mode());
      ctl.setAttribute("aria-label", AFDCore.t(!withdrawn ? "voice.withdraw.label"
                      : fresh ? "voice.share.label" : "voice.restore.label", CFG.mode()));
    };
    paint();
    ctl.addEventListener("click", async ()=>{
      ctl.disabled=true;
      const ok=await setConsent(rec, rec.consent==="public" ? "withdrawn" : "public");
      ctl.disabled=false;
      if(ok){ if(rec.consent==="public") rec.neverShared=false; paint(); }
    });
    controls.appendChild(ctl);

    /* Erase — right to erasure. There is NO client hard-delete: Firestore and
       Storage both deny it by rule. The atom is destroyed server-side by a purge
       Function that acts on consent=="deleted"; the client's job is only to set
       that state (same write path as Withdraw — a self-speaker needs no artifact).
       Two-tap to arm so a stray touch can't trigger it; irreversible once set,
       so no undo lever is offered. */
    const erase=document.createElement("button");
    erase.className="voice-ctl erase";
    erase.textContent=AFDCore.t("voice.erase", CFG.mode());
    erase.setAttribute("aria-label", AFDCore.t("voice.erase.label", CFG.mode()));
    let armed=false, armTimer=null;
    const disarm=()=>{ armed=false; erase.classList.remove("armed"); erase.textContent=AFDCore.t("voice.erase", CFG.mode());
      erase.setAttribute("aria-label", AFDCore.t("voice.erase.label", CFG.mode()));
      if(armTimer){ clearTimeout(armTimer); armTimer=null; } };
    erase.addEventListener("click", async ()=>{
      if(!armed){
        armed=true; erase.classList.add("armed"); erase.textContent=AFDCore.t("voice.erase.confirm", CFG.mode());
        erase.setAttribute("aria-label", AFDCore.t("withdraw.proof.erase.confirm", CFG.mode()));
        armTimer=setTimeout(disarm, 4000);
        return;
      }
      if(armTimer){ clearTimeout(armTimer); armTimer=null; }
      erase.disabled=true;
      const ok=await setConsent(rec,"deleted");
      if(ok){
        if(typeof onErased==="function") onErased();   // drop the voices count by one
        row.style.transition="opacity .25s ease"; row.style.opacity="0";
        setTimeout(()=>row.remove(), 250);
      } else { erase.disabled=false; disarm(); }
    });
    controls.appendChild(erase);

    row.appendChild(controls);
    row.appendChild(status);                 // own line under the voice, never squeezing the play button
  }
  return row;
}

function buildVoices(container, recs, thumbEl, playBtn, setUrl){
  container.innerHTML="";
  if(!recs.length) return;

  // reveal the slot's "none yet" once the last take in this slot is erased
  const showEmpty = ()=>{ const e=container.closest(".slot")?.querySelector(".slot-empty"); if(e) e.removeAttribute("hidden"); };

  if(recs.length===1 && !recs[0].mine){
    container.appendChild(voiceAvatarBtn(recs[0], thumbEl, playBtn, setUrl)); return;
  }
  if(recs.length===1){                       // a single voice, but it's yours → show the row to manage it
    const solo=document.createElement("div"); solo.className="voices-list";
    solo.appendChild(buildVoiceRow(recs[0], thumbEl, playBtn, setUrl, showEmpty));
    container.appendChild(solo); return;
  }

  const live = recs.slice();                 // mutable working copy → chip stays truthful after erases
  const chip=document.createElement("button");
  chip.className="voices-chip"; chip.setAttribute("aria-expanded","false");
  chip.innerHTML=`<span class="peeks"></span><span class="count"></span>`+
    `<svg class="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
  const peeksEl=chip.querySelector(".peeks"), countEl=chip.querySelector(".count");

  const list=document.createElement("div");
  list.className="voices-list hidden";

  const paintChip = ()=>{
    countEl.textContent = live.length;
    chip.setAttribute("aria-label", live.length+" voices");
    // peeks follow the live set, so erasing one of the first three refreshes the faces
    peeksEl.innerHTML = live.slice(0,3).map(r=>`<span class="peek" style="background:${r.avatar.bg}">${r.avatar.svg}</span>`).join("");
  };
  const eraseRec = (rec)=>{
    const i=live.indexOf(rec); if(i>=0) live.splice(i,1);
    if(live.length===0){ chip.remove(); list.remove(); showEmpty(); return; }
    paintChip();
  };

  recs.forEach(rec=> list.appendChild(buildVoiceRow(rec, thumbEl, playBtn, setUrl, ()=>eraseRec(rec))));
  paintChip();

  chip.addEventListener("click",()=>{
    const open = list.classList.toggle("hidden")===false;
    chip.setAttribute("aria-expanded", String(open));
    chip.classList.toggle("open", open);
  });

  container.appendChild(chip);
  container.appendChild(list);
}

/* ---- spellings: the word written in letters (10-15) ----------------------
   afd_entries/{entryId}/spellings/{writerUid}: any number per card, one per
   writer, each attributed, none canonical (no ranking, no "approved"). The
   instance says which script (AFDInstance.spelling); with no such block the
   whole feature stays out of sight. Never shown in sound mode: that tier is
   for people who don't read.
   The dictionary list primes every card's spellings with ONE collection-group
   read (primeAllSpellings); a card shown anywhere else reads its own. */
const _spellCache = new Map();          // entryId -> Promise<Array<spelling>>
let _allSpellsP = null, _allSpellsAt = 0;
function spellingsOn(){ return !!(window.AFDInstance && window.AFDInstance.spelling); }
function spellRow(sn){
  const d = sn.data() || {};
  return { by: d.by || sn.id, text: String(d.text || ""), lang: d.lang || "",
           at: d.at && d.at.toMillis ? d.at.toMillis() : 0, hidden: !!d.hiddenAt };
}
// oldest first: an order, not a ranking — the first writer isn't "right"
const byWritten = (a, b) => (a.at || Infinity) - (b.at || Infinity);
function primeAllSpellings(){
  if(!spellingsOn() || !CFG.db) return Promise.resolve(null);
  // a list redrawn within a minute (a display-mode change, Home) reuses the read
  if(!_allSpellsP || Date.now() - _allSpellsAt > 60000){
    _allSpellsAt = Date.now(); _spellCache.clear();
    _allSpellsP = getDocs(collectionGroup(CFG.db, "spellings")).then(snap => {
      const by = new Map();
      for(const s of snap.docs){
        const e = s.ref.parent && s.ref.parent.parent; if(!e) continue;
        if(!by.has(e.id)) by.set(e.id, []);
        by.get(e.id).push(spellRow(s));
      }
      for(const l of by.values()) l.sort(byWritten);
      return by;
    }).catch(e => { console.warn("[AFD] spellings", e); return null; });
  }
  return _allSpellsP;
}
function spellingsFor(entryId){
  if(!spellingsOn() || !CFG.db) return Promise.resolve([]);
  if(!_spellCache.has(entryId)) _spellCache.set(entryId, (async () => {
    if(_allSpellsP){ const all = await _allSpellsP; if(all) return all.get(entryId) || []; }
    try{
      const snap = await getDocs(collection(CFG.db, "afd_entries", entryId, "spellings"));
      return snap.docs.map(spellRow).sort(byWritten);
    }catch(e){ console.warn("[AFD] spellings", e); return []; }
  })());
  return _spellCache.get(entryId);
}
// The card header's headword: the spellings people wrote, distinct ones only,
// two at most then "+n". Empty when there are none (or in sound mode).
function paintHeadSpelling(gc, list){
  if(!gc) return;
  let sp = gc.querySelector(".spell");
  const shown = [...new Set((list || []).filter(x => !x.hidden).map(x => x.text))];
  gc.classList.toggle("has-spell", shown.length > 0 && CFG.mode() !== "sound");
  if(!shown.length || CFG.mode() === "sound"){ if(sp) sp.remove(); return; }
  if(!sp){
    sp = document.createElement("span"); sp.className = "spell";
    sp.setAttribute("dir", AFDCore.spellingDir()); sp.setAttribute("lang", AFDCore.spellingLang());
  }
  sp.textContent = shown.slice(0, 2).join(" · ") + (shown.length > 2 ? "  +" + (shown.length - 2) : "");
  gc.prepend(sp);
}
function spellingSection(entryId, gc){
  const m = CFG.mode();
  const sec = document.createElement("div");
  sec.className = "slot slot-spell";
  if(!spellingsOn() || m === "sound"){ sec.hidden = true; return sec; }
  const L = (AFDCore.STRINGS || {})["card.spell.label"] || { en:"", ar:"" };
  sec.innerHTML =
    `<div class="slot-head"><span class="slot-label">${m==="auto" ? escapeHtml(L.en)+' <span class="ar">'+escapeHtml(L.ar)+'</span>' : '<span class="ar solo">'+escapeHtml(L.ar)+'</span>'}</span>` +
    `<span class="slot-empty" hidden>${escapeHtml(AFDCore.t("slot.none", m))}</span></div>` +
    `<div class="spell-list"></div><div class="spell-tools"></div>`;
  const listEl = sec.querySelector(".spell-list"), toolsEl = sec.querySelector(".spell-tools"),
        emptyEl = sec.querySelector(".slot-empty");
  const dir = AFDCore.spellingDir(), lang = AFDCore.spellingLang();

  async function paint(){
    const list = await spellingsFor(entryId);
    const u = CFG.user(), me = u && !u.isAnonymous ? u.uid : null;
    const steward = me ? await amSteward() : false;
    // others see what isn't hidden; a writer always sees their own; a steward sees all
    const visible = list.filter(x => !x.hidden || x.by === me || steward);
    listEl.innerHTML = "";
    for(const x of visible){
      const row = document.createElement("div"); row.className = "spell-row" + (x.hidden ? " is-hidden" : "");
      const w = document.createElement("span"); w.className = "spell-text";
      w.setAttribute("dir", dir); w.setAttribute("lang", x.lang || lang); w.textContent = x.text;
      const cap = document.createElement("span"); cap.className = "spell-by";
      row.appendChild(w); row.appendChild(cap);
      if(x.by === me) cap.textContent = AFDCore.t("card.spell.mine", m);
      else stewardProfile(x.by).then(p => { if(p && p.known && p.displayName) cap.textContent = AFDCore.tf("card.spell.by", m, { name: p.displayName }); });
      if(x.hidden){ const h = document.createElement("span"); h.className = "spell-flag"; h.textContent = AFDCore.t("card.spell.hidden", m); row.appendChild(h); }
      if(steward){
        const b = document.createElement("button"); b.type = "button"; b.className = "wt-btn spell-hide";
        b.textContent = AFDCore.t(x.hidden ? "card.spell.show" : "card.spell.hide", m);
        b.onclick = async (e) => {
          e.stopPropagation(); b.disabled = true;
          try{
            await updateDoc(doc(CFG.db, "afd_entries", entryId, "spellings", x.by),
                            { hiddenAt: x.hidden ? deleteField() : serverTimestamp() });
            x.hidden = !x.hidden; paint(); paintHeadSpelling(gc, list);
          }catch(err){ console.warn("[AFD] hide spelling", err); CFG.banner(AFDCore.t("card.failed", m)); b.disabled = false; }
        };
        row.appendChild(b);
      }
      listEl.appendChild(row);
    }
    emptyEl.hidden = visible.length > 0 || !me;
    // nothing written and nobody signed in to write it: no section at all
    sec.hidden = !visible.length && !me;
    paintTools(list, me);
  }

  function paintTools(list, me){
    toolsEl.innerHTML = "";
    if(!me) return;
    const mine = list.find(x => x.by === me);
    const open = document.createElement("button"); open.type = "button"; open.className = "wt-btn";
    open.innerHTML = "✍️ " + AFDCore.tHTML(mine ? "card.spell.edit" : "card.spell.add", m);
    const ed = document.createElement("div"); ed.className = "wt-tags spell-edit"; ed.hidden = true;
    ed.innerHTML =
      `<input type="text" maxlength="60" autocomplete="off" spellcheck="false" dir="${escapeHtml(dir)}" lang="${escapeHtml(lang)}">` +
      `<p class="wt-note">${AFDCore.tHTML("card.spell.hint", m)}</p>` +
      `<div class="spell-btns"><button type="button" class="wt-btn wt-save">${AFDCore.tHTML("card.spell.save", m)}</button>` +
      (mine ? `<button type="button" class="wt-btn wt-remove">${AFDCore.tHTML("card.spell.remove", m)}</button>` : "") + `</div>`;
    const inp = ed.querySelector("input");
    open.onclick = (e) => { e.stopPropagation(); ed.hidden = !ed.hidden; if(!ed.hidden){ inp.value = mine ? mine.text : ""; inp.focus(); } };
    ed.querySelector(".wt-save").onclick = async (e) => {
      e.stopPropagation();
      const text = AFDCore.spellingText(inp.value).slice(0, 60);
      if(!text) return;
      const sv = e.currentTarget; sv.disabled = true;
      const data = { text, searchKey: AFDCore.spellingKey(text).slice(0, 60), lang: AFDCore.spellingLang() };
      const ref_ = doc(CFG.db, "afd_entries", entryId, "spellings", me);
      try{
        // an edit only touches the words (a steward's "hidden" stays put);
        // a first spelling creates the doc, attributed to its writer
        if(mine) await updateDoc(ref_, { ...data, at: serverTimestamp() });
        else     await setDoc(ref_, { ...data, by: me, at: serverTimestamp() });
        if(mine) Object.assign(mine, data);
        else list.push({ by: me, text, lang: data.lang, at: Date.now(), hidden: false });
        paint(); paintHeadSpelling(gc, list);
      }catch(err){ console.warn("[AFD] save spelling", err); CFG.banner(AFDCore.t("card.failed", m)); sv.disabled = false; }
    };
    const rm = ed.querySelector(".wt-remove");
    if(rm) rm.onclick = async (e) => {
      e.stopPropagation(); rm.disabled = true;
      try{
        await deleteDoc(doc(CFG.db, "afd_entries", entryId, "spellings", me));
        const i = list.indexOf(mine); if(i >= 0) list.splice(i, 1);
        paint(); paintHeadSpelling(gc, list);
      }catch(err){ console.warn("[AFD] remove spelling", err); CFG.banner(AFDCore.t("card.failed", m)); rm.disabled = false; }
    };
    toolsEl.appendChild(open); toolsEl.appendChild(ed);
  }

  paint();
  return sec;
}

function slotSection(labelKey, type, entryId, recs, thumbEl, playBtn, setUrl){
  const L=(AFDCore.STRINGS||{})[labelKey] || { en:labelKey, ar:labelKey };
  const labelEn=escapeHtml(L.en), labelAr=L.ar;
  const s=document.createElement("div");
  s.className="slot slot-"+type;
  const has = recs && recs.length;
  // Every slot carries its own "+ add" right under it (10-14: the word's own used
  // to be only the "Say it yourself" button at the foot of the card, which people
  // didn't find). The word goes to the recorder on that word (#entryId — the
  // recorder's default tab is Word); sentence/meaning add the type to the hash.
  const addKey = { word:"slot.add.word", context:"slot.add.sentence", definition:"slot.add.meaning" }[type] || "slot.add.meaning";
  const addHash = encodeURIComponent(entryId) + (type==="word" ? "" : "|" + type);
  const addLink =
    `<a class="slot-add" href="${CFG.recorderUrl}#${addHash}">` +
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg> ${escapeHtml(AFDCore.t(addKey, CFG.mode()))}</a>`;
  s.innerHTML =
    `<div class="slot-head"><span class="slot-label">${CFG.mode()==="auto" ? labelEn+' <span class="ar">'+escapeHtml(labelAr)+'</span>' : '<span class="ar solo">'+escapeHtml(labelAr)+'</span>'}</span>` +
    `<span class="slot-empty"${has?" hidden":""}>${escapeHtml(AFDCore.t("slot.none", CFG.mode()))}</span></div>` +
    `<div class="slot-body"></div>` + addLink;
  if(has) buildVoices(s.querySelector(".slot-body"), recs, thumbEl, playBtn, setUrl);
  return s;
}

/* ---- share a word (to recruit speakers) ----------------------------------
   A word is already a link (index.html#ent_…), so sharing is just a message
   around it: the phone's share sheet where there is one (WhatsApp, SMS…),
   else straight to WhatsApp — the same pattern as add.html's "Invite a
   friend". The words of the message follow the reader's tier: auto sends
   Arabic then English, script and sound send Arabic. A word nobody can hear
   yet asks for a first voice instead. (The link preview is the site's own
   og image: static hosting never sees the #ent_ part, so it can't be per-word.) */
async function shareEntry(entryId, meta, heard, mode, voice){
  const url = new URL("index.html#" + encodeURIComponent(entryId), location.href).href;
  const pic = meta.pic ? meta.pic + " " : "";
  const line = (lang) => {
    const w = lang === "ar" ? (meta.glossAr || meta.gloss) : (meta.gloss || meta.glossAr);
    const key = !w ? "card.share.heard0" : heard ? "card.share.heard" : "card.share.unheard";
    return AFDCore.STRINGS[key][lang].split("{w}").join(w || "");
  };
  const text = pic + (mode === "auto" ? line("ar") + "\n" + line("en") : line("ar"));
  try{
    // The voice itself, as a playable file, where the phone can share files:
    // it lands in WhatsApp as audio that plays in the chat — no link to open
    // first. The link rides in the text (some apps drop `url` beside files).
    if(voice && navigator.canShare && navigator.canShare({ files:[voice] })){
      await navigator.share({ files:[voice], text: text + "\n" + url }); return "file";
    }
    if(navigator.share){ await navigator.share({ text, url }); return "link"; }
  }catch(e){ if(e && e.name === "AbortError") return null; }
  window.open("https://wa.me/?text=" + encodeURIComponent(text + "\n" + url), "_blank", "noopener");
  return "link";
}
/* WhatsApp keeps no caption on an audio file, so the text and link sent with
   the voice are dropped there. After a voice goes out, the button offers the
   link as a second, optional tap ("Now send the link too") for two minutes —
   a fresh tap, because a share sheet needs one. `paint(next)` relabels the
   caller's button; returns the click handler. */
function shareFlow(entryId, meta, heard, mode, getVoice, paint){
  let next = "voice", timer = null;
  const reset = () => { next = "voice"; clearTimeout(timer); paint("voice"); };
  return async () => {
    const how = await shareEntry(entryId, meta, heard, mode, next === "voice" ? getVoice() : null);
    if(next === "link"){ if(how) reset(); return; }
    if(how === "file"){ next = "link"; paint("link"); clearTimeout(timer); timer = setTimeout(reset, 120000); }
  };
}

/* A voice as a file WhatsApp will take. WhatsApp plays AAC (.m4a), MP3, AMR and
   Ogg/Opus — its own voice-note format — but NOT .wav or .webm ("Couldn't process
   audio"). So:
     • an iPhone take is already .m4a (AAC): shared as it is, untouched;
     • anything else (Android .webm, imported voice-note .wav) is decoded and
       re-encoded on the phone as Ogg/Opus (WebCodecs' Opus encoder, packed into
       Ogg pages below), 48 kHz mono ~32 kbps — a few KB a second;
     • where the browser has no Opus encoder, null → the caller shares the link.
   `src` is a URL (a public take; the bucket's CORS must allow this site —
   cors.json) or a Blob (add.html's own just-recorded take). Built AHEAD of the
   tap: Safari only shares in direct answer to a tap, and a download or encode in
   between would spend that permission. */
function canShareFiles(){
  try{ return !!(navigator.canShare && navigator.canShare({ files:[new File([""], "x.m4a", { type:"audio/mp4" })] })); }
  catch(_){ return false; }
}
async function voiceFile(src, name){
  if(!canShareFiles()) return null;
  const slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const base = "hakli" + (slug ? "-" + slug : "");
  try{
    const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
    if(/mp4|m4a|aac/i.test(blob.type || "")){
      return new File([blob], base + ".m4a", { type:"audio/mp4" });
    }
    const ogg = await toOggOpus(await blob.arrayBuffer());
    return ogg ? new File([ogg], base + ".ogg", { type:"audio/ogg" }) : null;
  }catch(e){ console.warn("[AFD] voice file", e); return null; }
}

// Decode anything the browser can read → 48 kHz mono → Opus (WebCodecs) → Ogg.
async function toOggOpus(bytes){
  if(typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return null;
  const RATE = 48000;
  const cfg = { codec:"opus", sampleRate:RATE, numberOfChannels:1, bitrate:32000 };
  try{ if(!(await AudioEncoder.isConfigSupported(cfg)).supported) return null; }catch(_){ return null; }
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  let buf; try{ buf = await ac.decodeAudioData(bytes); } finally { try{ ac.close(); }catch(_){} }
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * RATE)), RATE);
  const node = off.createBufferSource(); node.buffer = buf; node.connect(off.destination); node.start();
  const pcm = (await off.startRendering()).getChannelData(0);

  const packets = [];
  let failed = null;
  const enc = new AudioEncoder({
    output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b);
                         packets.push({ b, n: Math.round((chunk.duration || 20000) * RATE / 1e6) }); },
    error: (e) => { failed = e; }
  });
  enc.configure(cfg);
  enc.encode(new AudioData({ format:"f32-planar", sampleRate:RATE, numberOfFrames:pcm.length,
                             numberOfChannels:1, timestamp:0, data:pcm }));
  await enc.flush(); enc.close();
  if(failed || !packets.length) return null;
  return oggOpus(packets, pcm.length);
}

/* Ogg/Opus container (RFC 7845): page 0 = OpusHead, page 1 = OpusTags, then the
   audio packets, one per page, granule = 48 kHz samples decoded so far (pre-skip
   included, from each packet's own duration); the last page carries EOS and
   the true end. */
const OGG_CRC = (() => {
  const t = new Uint32Array(256);
  for(let i = 0; i < 256; i++){ let r = i << 24; for(let j = 0; j < 8; j++) r = (r & 0x80000000) ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; }
  return t;
})();
function oggOpus(packets, samples){
  const PRESKIP = 312, serial = (Math.random() * 0xffffffff) >>> 0;
  const head = new Uint8Array(19), hv = new DataView(head.buffer);
  head.set([79,112,117,115,72,101,97,100]);                     // "OpusHead"
  head[8] = 1; head[9] = 1; hv.setUint16(10, PRESKIP, true); hv.setUint32(12, 48000, true);
  const vendor = new TextEncoder().encode("hakli");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4), tv = new DataView(tags.buffer);
  tags.set([79,112,117,115,84,97,103,115]); tv.setUint32(8, vendor.length, true); tags.set(vendor, 12);
  const pages = []; let seq = 0;
  const page = (data, granule, flags) => {
    const lace = []; let n = data.length;
    while(n >= 255){ lace.push(255); n -= 255; } lace.push(n);
    const p = new Uint8Array(27 + lace.length + data.length), v = new DataView(p.buffer);
    p.set([79,103,103,83]); p[5] = flags;                        // "OggS", version 0
    v.setUint32(6, granule % 0x100000000, true); v.setUint32(10, Math.floor(granule / 0x100000000), true);
    v.setUint32(14, serial, true); v.setUint32(18, seq++, true);
    p[26] = lace.length; p.set(lace, 27); p.set(data, 27 + lace.length);
    let crc = 0; for(let i = 0; i < p.length; i++) crc = ((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ p[i]) & 0xff]) >>> 0;
    v.setUint32(22, crc, true);
    pages.push(p);
  };
  page(head, 0, 0x02);                                           // beginning of stream
  page(tags, 0, 0);
  const end = PRESKIP + samples;
  let at = PRESKIP;
  packets.forEach((pk, i) => {
    const last = i === packets.length - 1;
    at += pk.n;
    page(pk.b, last ? end : Math.min(end, at), last ? 0x04 : 0);
  });
  return new Blob(pages, { type:"audio/ogg" });
}

/* ---- "your voice mattered" — in-app, nothing tracked --------------------------
   On a word the viewer has a voice on, a quiet line at the top of the open card:
   how many OTHER people (distinct speakers) have said it too, or — on their own
   word that nobody else has said yet — a nudge to share it. Then the count of
   public voices is remembered on THIS phone (localStorage, nowhere else), so the
   collapsed card can show "+n" when more voices arrive. Uses only what the
   card already loaded; no listen counting, no messages sent. */
function seenCount(entryId){
  try{ const v = localStorage.getItem("afd.seen." + entryId); return v == null ? null : +v; }catch(_){ return null; }
}
function feedback(entryId, meta, recs, detail, hc){
  const mine = recs.filter(r => r.mine);
  if(!mine.length) return;
  const others = new Set(recs.filter(r => !r.mine && r.consent==="public")
                             .map(r => (r.uid||"") + "|" + (r.speakerId||"")));
  const creator = meta.source==="user" && CFG.user() && meta.createdBy===CFG.user().uid;
  const m = CFG.mode();
  // in the reader's tier, like the rest of the card (tHTML: auto = Arabic over English)
  let html = null;
  if(others.size === 1) html = AFDCore.tHTML("card.fb.others1", m);
  else if(others.size > 1){
    const x = AFDCore.STRINGS["card.fb.othersN"], n = String(others.size);
    const ar = `<span class="bi-ar" dir="rtl">${escapeHtml(x.ar.split("{n}").join(n))}</span>`;
    html = m==="auto" ? ar + `<small class="sub">${escapeHtml(x.en.split("{n}").join(n))}</small>` : ar;
  }
  else if(creator && mine.some(r => r.consent==="public")) html = AFDCore.tHTML("card.fb.first", m);
  if(html){
    const n=document.createElement("div"); n.className="fb-note"; n.setAttribute("role","status");
    n.innerHTML = html;
    detail.insertBefore(n, detail.firstChild);
  }
  entryCounts(entryId).then(c => {
    try{ localStorage.setItem("afd.seen." + entryId, String(c.word + c.context + c.definition)); }catch(_){}
    hc && hc.querySelector(".fb-new")?.remove();
  });
}

async function entryCard(res, lead){
  const el = document.createElement("div");
  el.className = "card" + (lead ? " lead open" : "");
  // A lead card opens at once, so start fetching its voices now, alongside the
  // entry doc, instead of after it.
  let playable = lead ? listPlayable(res.entryId) : null;

  // entry metadata (public). Fall back gracefully if absent.
  let meta={}, known=null;      // known: true/false once Firestore has answered; null if it couldn't
  // The list hands over the doc it already read (res.meta, 10-15) — one read of
  // afd_entries for every card instead of one getDoc each.
  if(res.meta){ known=true; meta={ ...res.meta }; }
  else{ try{ const sn = await getDoc(doc(CFG.db,"afd_entries",res.entryId)); known=sn.exists(); if(known) meta=sn.data(); }catch(_){} }
  primeCounts(res.entryId, meta.voices);
  // No signal (or a slow one) → the entry doc can't load, and every card used to
  // collapse into an anonymous identicon. The 40 seeded words ship with the app
  // (afd-words.js), so fill picture / gloss / domain from there. Firestore still
  // wins whenever it answered.
  if(!meta.pic || !meta.gloss){
    const w = localWord(res.entryId);
    if(w) meta = { ...meta, pic: meta.pic || w.pic, gloss: meta.gloss || w.en,
                   glossAr: meta.glossAr || w.ar, domain: meta.domain || w.dom };
  }
  const glossEn = meta.gloss || res.gloss || "";
  const glossAr = meta.glossAr || meta.ar || "";
  const tile = domainColor(meta.domain || res.entryId);
  const letterFallback = glossEn ? glossEn.trim()[0].toUpperCase() : "\u2022";
  const scriptLabel = glossAr || meta.ref || "";

  const thumbHtml =
    `<div class="thumb" style="--tile:${tile}" data-img="${escapeHtml(meta.image||"")}" ` +
    `data-pic="${escapeHtml(meta.pic||"")}" data-script="${escapeHtml(scriptLabel)}" ` +
    `data-letter="${escapeHtml(letterFallback)}" data-entry="${escapeHtml(res.entryId)}"></div>`;
  let glossHtml;
  if(CFG.mode()==="sound"){
    glossHtml = `<div class="gloss" aria-hidden="true"></div>`;
  }else if(CFG.mode()==="script"){
    const ar = glossAr || meta.ref || "";
    glossHtml = `<div class="gloss">${ar?`<span class="glossar solo">${escapeHtml(ar)}</span>`:""}</div>`;
  }else{
    glossHtml = `<div class="gloss">${escapeHtml(glossEn)}${glossAr?`<span class="glossar">${escapeHtml(glossAr)}</span>`:""}</div>`;
  }
  const playHtml  = `<button class="play" aria-label="Play pronunciation"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>${DOTS}</button>`;
  const chevHtml  = lead ? "" : `<span class="card-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>`;

  el.innerHTML =
    `<div class="head">${thumbHtml}${glossHtml}${playHtml}${chevHtml}</div>` +
    `<div class="detail"></div>`;

  const playBtn = el.querySelector(".play");
  const thumbEl = el.querySelector(".thumb");
  const detail  = el.querySelector(".detail");

  // Collapsed header shows the entry's IDENTITY (emoji / identicon / script word).
  // The sound-shape (waveform, in sound tier) is painted when the detail loads.
  // A contributor's photo (add.html "show it") outranks the emoji.
  if(meta.image) thumbEl.innerHTML = thumbImg(meta.image);
  else if(meta.pic) thumbEl.textContent = meta.pic;   // picture first in every tier
  // No picture → the identicon, in every tier (10-14: the Arabic-only tier used to
  // put the word itself here, which overflowed on long words and repeated the
  // text right beside it — and made the same card look different by tier).
  else thumbEl.innerHTML = AFDCore.identicon(res.entryId);
  // compact voice counts on the collapsed header (wordless icons, tier-safe)
  const gc=el.querySelector(".gloss");
  const tagsEl=document.createElement("div"); tagsEl.className="tags";
  const paintTags=(ts)=>{ tagsEl.innerHTML=(CFG.mode()==="sound"?[]:(ts||[])).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join(""); };
  paintTags(meta.tags);
  if(gc) gc.appendChild(tagsEl);
  // the word as people wrote it, ahead of the translations (filled in when the
  // spellings arrive; the list primes them all at once)
  if(gc && spellingsOn() && CFG.mode()!=="sound")
    spellingsFor(res.entryId).then(l => paintHeadSpelling(gc, l));
  // Repaint the picture and the text after an in-place edit (word tools), the
  // same way the header was first drawn; tags and voice counts stay put.
  const paintFace=(mt)=>{
    if(mt.image) thumbEl.innerHTML = thumbImg(mt.image);
    else if(mt.pic) thumbEl.textContent = mt.pic;
    else thumbEl.innerHTML = AFDCore.identicon(res.entryId);
    thumbEl.dataset.pic = mt.pic || "";
    if(!gc || CFG.mode()==="sound") return;
    [...gc.childNodes].forEach(n=>{ if(n.nodeType===3 || (n.classList && n.classList.contains("glossar"))) n.remove(); });
    const ar = mt.glossAr || mt.ref || "";
    const parts = CFG.mode()==="script"
      ? (ar ? [Object.assign(document.createElement("span"), { className:"glossar solo", textContent:ar })] : [])
      : [document.createTextNode(mt.gloss||""), ...(mt.glossAr ? [Object.assign(document.createElement("span"), { className:"glossar", textContent:mt.glossAr })] : [])];
    gc.prepend(...parts);
    const sp = gc.querySelector(".spell"); if(sp) gc.prepend(sp);   // the spelling stays the headword
  };
  let hc=null;
  if(gc){ hc=document.createElement("div"); hc.className="head-counts"; gc.appendChild(hc);
    entryCounts(res.entryId).then(c=>{ hc.innerHTML=`<span>\u{1F50A} ${c.word}</span><span>\u{1F4AC} ${c.context}</span><span>\u{1F4D6} ${c.definition}</span>`;
      // a word this phone has a voice on, with voices added since it was last
      // opened here: a small "+n" so the contributor sees they were answered
      const was = seenCount(res.entryId), now = c.word + c.context + c.definition;
      if(was != null && now > was){
        const nb=document.createElement("span"); nb.className="fb-new";
        nb.textContent="+"+(now-was)+" \u{1F50A}"; nb.title=AFDCore.t("card.fb.new", CFG.mode());
        nb.setAttribute("aria-label", nb.title); hc.appendChild(nb);
      }
    }); }

  let currentUrl=null, firstPlayable=null, detailP=null;
  const setUrl = (u)=>{ currentUrl = u; };

  // Detail (voices, slots, playback) is EXPENSIVE — listPlayable resolves a Storage
  // URL per recording — so it loads lazily, only when the card opens. This is what
  // lets the dictionary render 40 cards without hundreds of Storage calls up front.
  // Every caller shares the ONE load: a play tap that lands while the open-tap's
  // load is still in flight must wait for it, not read "no voice yet" from a
  // half-loaded card (seen on a slow phone: the note, then the voice under it).
  function loadDetail(){ return detailP || (detailP = buildDetail()); }
  async function buildDetail(){
    let dots=null;
    const dotsT=setTimeout(()=>{ dots=document.createElement("div"); dots.className="ldots-row"; dots.setAttribute("role","status");
      dots.setAttribute("aria-label", AFDCore.t("tools.loading", CFG.mode())); dots.innerHTML=DOTS; detail.prepend(dots); }, 250);
    let recs;
    try{ recs = await (playable || listPlayable(res.entryId)); }
    finally{ clearTimeout(dotsT); if(dots) dots.remove(); }
    const wordRecs    = recs.filter(r => (r.type||"word")==="word");
    const contextRecs = recs.filter(r => r.type==="context");
    const defRecs     = recs.filter(r => r.type==="definition");
    firstPlayable = (wordRecs[0]||recs[0])?.url || null;
    if(currentUrl==null) currentUrl = firstPlayable;
    applyBox(thumbEl, CFG.mode(), wordRecs.length?wordRecs:recs);   // now paint the sound-shape in sound tier
    feedback(res.entryId, meta, recs, detail, hc);
    detail.appendChild(slotSection("slot.word","word",res.entryId, wordRecs, thumbEl, playBtn, setUrl));
    detail.appendChild(spellingSection(res.entryId, gc));
    detail.appendChild(slotSection("slot.sentence","context",res.entryId, contextRecs, null, playBtn, ()=>{}));
    detail.appendChild(slotSection("slot.meaning","definition",res.entryId, defRecs, null, playBtn, ()=>{}));
    // (10-14) No separate "Say it yourself" button any more: the word slot's own
    // "+ Add a recording" above does the same thing, right where the voice goes.
    // Share — any word, any reader: a heard word invites "say it your way",
    // an unheard one asks for the first voice.
    const share=document.createElement("button");
    share.type="button"; share.className="sayit shareit";
    share.innerHTML=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>
    ${biLabel("card.share")}`;
    // Get the first public voice ready as a file now (see voiceFile), so a
    // tap can hand it straight to the share sheet.
    const pubVoice = wordRecs.find(r => r.consent==="public");
    let voiceReady = null;
    if(pubVoice) voiceFile(pubVoice.url, meta.gloss).then(f => { voiceReady = f; });
    const shareLabel = share.innerHTML;
    const onShare = shareFlow(res.entryId, meta, recs.some(r => r.consent==="public"), CFG.mode(),
      () => voiceReady,
      (state) => { share.classList.toggle("next-link", state==="link");
                   share.innerHTML = state==="link" ? AFDCore.tHTML("card.share.link", CFG.mode()) : shareLabel; });
    share.addEventListener("click", (e)=>{ e.stopPropagation(); onShare(); });
    detail.appendChild(share);
    wordTools(res.entryId, meta, recs, el, detail, paintTags, paintFace);
    return firstPlayable;
  }

  // A word with no voice used to swallow the tap silently, which reads as
  // "broken". Instead: open the card, say (in the reader's tier) that nobody has
  // recorded it yet, and draw the eye to the word's "+ Add a recording" — the
  // one thing to do. The note sits just above THE WORD, so the add is under it.
  function noVoice(){
    el.classList.add("open");
    const say = detail.querySelector(".slot-word .slot-add");
    const wordSlot = detail.querySelector(".slot-word");
    let n = detail.querySelector(".novoice");
    if(!n){
      n = document.createElement("div"); n.className = "novoice"; n.setAttribute("role","status");
      n.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>` +
                    `<span>${AFDCore.tHTML("card.novoice", CFG.mode())}</span>`;
      if(wordSlot) detail.insertBefore(n, wordSlot); else detail.appendChild(n);
    }
    playBtn.classList.remove("afd-novoice-shake"); void playBtn.offsetWidth; playBtn.classList.add("afd-novoice-shake");
    if(say){ say.classList.remove("afd-novoice-pulse"); void say.offsetWidth; say.classList.add("afd-novoice-pulse"); }
    try{ n.scrollIntoView({ block:"nearest", behavior:"smooth" }); }catch(_){}
  }
  playBtn.addEventListener("click", (e)=>{ e.stopPropagation();
    if(currentUrl){ playInto(playBtn, currentUrl); return; }
    const done = busyBtn(playBtn);             // dots from the tap, through the load, until it sounds
    loadDetail().then(()=>{ if(currentUrl) playInto(playBtn, currentUrl, done); else { done(); noVoice(); } }, done);
  });
  el.querySelector(".head").addEventListener("click", (e)=>{
    if(e.target.closest(".play")) return;
    const opening = !el.classList.contains("open");
    el.classList.toggle("open", opening);
    if(opening) loadDetail().then(()=>{ if(currentUrl) playInto(playBtn, currentUrl); });
  });

  if(lead) await loadDetail();          // lead opens on render → load now (keeps autoplay + firstPlayable)
  // removed by its creator, or hidden by a steward (steward.html): either way it
  // stays out of the dictionary, search and old links
  // missing: Firestore answered "no such entry" and it isn't a seeded word either —
  // a mistyped or cut-off link. (No answer at all, e.g. offline, is NOT missing.)
  return { el, playBtn, removed: !!(meta.removedAt || meta.hiddenAt),
           missing: known===false && !localWord(res.entryId), get firstPlayable(){ return firstPlayable; } };
}

export { primeCounts, primeAllSpellings, spellingsFor, entryCard, shareEntry, shareFlow, voiceFile, slotSection, playVoiceInto, setConsent, withdrawSpeaker, voiceAvatarBtn, buildVoiceRow, buildVoices, entryCounts, listPlayable, envelopeFor, downsampleEnv, boxBars, paintBox, applyBox, faunaAvatar, domainColor, playInto, hashInt, escapeHtml };
