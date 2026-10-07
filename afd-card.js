/* afd-card.js — the shared entry card + its audio/waveform/identity primitives.
   Single source of truth for how a dictionary entry is displayed and played,
   used by find.html (browse / search / deep-link) and the recorder.
   SDK-agnostic: the host injects db, storage, live getters for the signed-in
   user and display mode, the recorder URL, and a banner() via initCard().
   AFDCore is read from the global (afd-core.js must load before this module). */
import { doc, getDoc, updateDoc, collection, query, where, limit, getDocs, serverTimestamp }
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
  // Sound tier paints the voice's shape — but a word with NO voice yet has no
  // shape. Fall back to its picture (the non-reader anchor), never to the
  // English initial in data-letter, which means nothing to a non-reader.
  if(mode==="sound"){
    const env = recs && recs[0] ? await envelopeFor(recs[0]) : null;
    if(env && env.length) return paintBox(thumbEl, env);
    if(d.img){ thumbEl.innerHTML = `<img src="${d.img}" alt="">`; return; }
    return d.pic ? asText(d.pic) : asIcon();
  }
  // Script tier: the Arabic word already sits beside the box, so the box keeps
  // the PICTURE (the constant visual anchor across all tiers). The script word
  // stands in only when there's no picture at all.
  if(mode==="script"){
    if(d.img){ thumbEl.innerHTML = `<img src="${d.img}" alt="">`; return; }
    return d.pic ? asText(d.pic) : (d.script ? asText(d.script) : asIcon());
  }
  // auto
  if(d.img){ thumbEl.innerHTML = `<img src="${d.img}" alt="">`; return; }
  if(d.pic){ return asText(d.pic); }
  return asIcon();
}

function playInto(btn, url){
  try{ audioEl.pause(); }catch(_){}
  audioEl = new Audio(url);
  audioEl.play().catch(()=>{});
}

// Briefly memoised: the dictionary asks for the same word's counts several
// times in one render (which words to list, the card header, the views), and
// each ask is a Firestore query. 15 s keeps one render to one read per word
// while a new or withdrawn voice still shows on the next look.
const _countsCache = new Map();   // entryId -> { at, p }
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
             mine: !!(CFG.user() && v.uid===CFG.user().uid),
             envelope:(Array.isArray(v.envelope)&&v.envelope.length)?v.envelope:null,
             avatar: faunaAvatar(v.uid ? (v.uid+"|"+(v.speakerId||"")) : (v.speakerId||d.id)) };
  }));
  const out = rows.filter(Boolean);           // same order as before: public first, then the viewer's own
  // Overlay contributor identity: a "known" steward's own (non-proxied) voices
  // get their photo, or a name monogram if they set no picture. Cache dedupes
  // repeated owners, so this is at most one read per distinct contributor.
  await Promise.all(out.map(async rec=>{
    if(rec.viaAgent || !rec.uid) return;         // proxied voices stay pseudonymous
    const p = await stewardProfile(rec.uid);
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
  if(thumbEl && thumbEl.querySelector("svg")) envelopeFor(rec).then(env=> paintBox(thumbEl, env));
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
async function wordTools(entryId, meta, recs, cardEl, detail, paintTags){
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
  }catch(e){ console.warn("[AFD] consent change failed", e); CFG.banner("Couldn't change that just now — try again"); return false; }
}

function voiceAvatarBtn(rec, thumbEl, playBtn, setUrl){
  const b=document.createElement("button");
  b.className="av"; b.style.background=rec.avatar.bg;
  b.setAttribute("aria-label", rec.displayName ? ("Play "+rec.displayName) : "Play this voice");
  if(rec.displayName) b.title=rec.displayName;
  b.innerHTML=rec.avatar.svg;
  b.addEventListener("click",()=>{ b.setAttribute("aria-pressed","true");
    playVoiceInto(rec, thumbEl, playBtn, setUrl); });
  if(rec.displayName){                       // "known" contributor — caption the avatar with the name
    const wrap=document.createElement("span"); wrap.className="av-wrap";
    const nm=document.createElement("span"); nm.className="av-name"; nm.textContent=rec.displayName;
    wrap.appendChild(b); wrap.appendChild(nm);
    return wrap;
  }
  return b;
}

function buildVoiceRow(rec, thumbEl, playBtn, setUrl, onErased){
  const row=document.createElement("div");
  row.className="voice-row"; row.setAttribute("aria-pressed","false");
  const play=document.createElement("button");
  play.className="vr-play"; play.setAttribute("aria-label", rec.displayName ? ("Play "+rec.displayName) : "Play this voice");
  if(rec.displayName) play.title=rec.displayName;
  const vrWave = (rec.envelope && rec.envelope.length)
    ? `<span class="vr-wave"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${boxBars(rec.envelope, 40)}</svg></span>`
    : `<span class="vr-wave"></span>`;
  const avSm=`<span class="av-sm" style="background:${rec.avatar.bg}">${rec.avatar.svg}</span>`;
  const avBlock = rec.displayName
    ? `<span class="av-wrap">${avSm}<span class="av-name">${escapeHtml(rec.displayName)}</span></span>`
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
    const paint=()=>{
      const withdrawn = rec.consent==="withdrawn";
      row.classList.toggle("withdrawn", withdrawn);
      ctl.classList.toggle("restore", withdrawn);
      ctl.textContent = withdrawn ? AFDCore.t("voice.shareagain", CFG.mode()) : AFDCore.t("voice.takeback", CFG.mode());
      ctl.setAttribute("aria-label", withdrawn ? "Restore your voice" : "Withdraw your voice");
    };
    paint();
    ctl.addEventListener("click", async ()=>{
      ctl.disabled=true;
      const ok=await setConsent(rec, rec.consent==="public" ? "withdrawn" : "public");
      ctl.disabled=false;
      if(ok) paint();
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
    erase.setAttribute("aria-label","Erase this recording");
    let armed=false, armTimer=null;
    const disarm=()=>{ armed=false; erase.classList.remove("armed"); erase.textContent=AFDCore.t("voice.erase", CFG.mode());
      erase.setAttribute("aria-label","Erase this recording");
      if(armTimer){ clearTimeout(armTimer); armTimer=null; } };
    erase.addEventListener("click", async ()=>{
      if(!armed){
        armed=true; erase.classList.add("armed"); erase.textContent=AFDCore.t("voice.erase.confirm", CFG.mode());
        erase.setAttribute("aria-label","Tap again to erase for good");
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

function slotSection(labelEn, labelAr, type, entryId, recs, thumbEl, playBtn, setUrl){
  const s=document.createElement("div");
  s.className="slot slot-"+type;
  const has = recs && recs.length;
  // the word slot's "add" is the detail-level "Say it yourself"; context/meaning
  // carry their own add links, with the type in the hash for the recorder.
  const addLink = type==="word" ? "" :
    `<a class="slot-add" href="${CFG.recorderUrl}#${encodeURIComponent(entryId)}|${type}">` +
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg> ${escapeHtml(AFDCore.t(type==="context"?"slot.add.sentence":"slot.add.meaning", CFG.mode()))}</a>`;
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
      await navigator.share({ files:[voice], text: text + "\n" + url }); return;
    }
    if(navigator.share){ await navigator.share({ text, url }); return; }
  }catch(e){ if(e && e.name === "AbortError") return; }
  window.open("https://wa.me/?text=" + encodeURIComponent(text + "\n" + url), "_blank", "noopener");
}

/* A voice as a file anyone's phone can play. Takes are .webm (Android) or .m4a
   (iPhone), and an iPhone can't play webm — so decode it here and re-encode as
   a small mono WAV (22.05 kHz, 16-bit: ~45 KB a second), which every phone and
   WhatsApp plays. `src` is a URL (a public take; the bucket's CORS must allow
   this site — cors.json) or a Blob (add.html's own just-recorded take).
   Resolves null when the phone can't share files, so callers fall back to the
   link. Built AHEAD of the tap: Safari only shares in direct answer to a tap,
   and a download in between would spend that permission. */
function canShareFiles(){
  try{ return !!(navigator.canShare && navigator.canShare({ files:[new File([""], "x.wav", { type:"audio/wav" })] })); }
  catch(_){ return false; }
}
async function voiceFile(src, name){
  if(!canShareFiles()) return null;
  try{
    const bytes = typeof src === "string" ? await (await fetch(src)).arrayBuffer() : await src.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    let buf; try{ buf = await ac.decodeAudioData(bytes); } finally { try{ ac.close(); }catch(_){} }
    const RATE = 22050, n = Math.max(1, Math.ceil(buf.duration * RATE));
    const off = new OfflineAudioContext(1, n, RATE);
    const node = off.createBufferSource(); node.buffer = buf; node.connect(off.destination); node.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const wav = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o, t) => { for(let i = 0; i < t.length; i++) wav.setUint8(o + i, t.charCodeAt(i)); };
    str(0, "RIFF"); wav.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE");
    str(12, "fmt "); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
    wav.setUint32(24, RATE, true); wav.setUint32(28, RATE * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
    str(36, "data"); wav.setUint32(40, pcm.length * 2, true);
    for(let i = 0; i < pcm.length; i++){
      const v = Math.max(-1, Math.min(1, pcm[i]));
      wav.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    const slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return new File([wav.buffer], "hakli" + (slug ? "-" + slug : "") + ".wav", { type:"audio/wav" });
  }catch(e){ console.warn("[AFD] voice file", e); return null; }
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
  let meta={};
  try{ const sn = await getDoc(doc(CFG.db,"afd_entries",res.entryId)); if(sn.exists()) meta=sn.data(); }catch(_){}
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
  const playHtml  = `<button class="play" aria-label="Play pronunciation"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>`;
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
  if(meta.image) thumbEl.innerHTML = `<img src="${escapeHtml(meta.image)}" alt="">`;
  else if(meta.pic) thumbEl.textContent = meta.pic;   // picture first in every tier
  else if(CFG.mode()==="script" && scriptLabel) thumbEl.textContent = scriptLabel;
  else thumbEl.innerHTML = AFDCore.identicon(res.entryId);
  // compact voice counts on the collapsed header (wordless icons, tier-safe)
  const gc=el.querySelector(".gloss");
  const tagsEl=document.createElement("div"); tagsEl.className="tags";
  const paintTags=(ts)=>{ tagsEl.innerHTML=(CFG.mode()==="sound"?[]:(ts||[])).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join(""); };
  paintTags(meta.tags);
  if(gc) gc.appendChild(tagsEl);
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
    const recs = await (playable || listPlayable(res.entryId));
    const wordRecs    = recs.filter(r => (r.type||"word")==="word");
    const contextRecs = recs.filter(r => r.type==="context");
    const defRecs     = recs.filter(r => r.type==="definition");
    firstPlayable = (wordRecs[0]||recs[0])?.url || null;
    if(currentUrl==null) currentUrl = firstPlayable;
    applyBox(thumbEl, CFG.mode(), wordRecs.length?wordRecs:recs);   // now paint the sound-shape in sound tier
    feedback(res.entryId, meta, recs, detail, hc);
    detail.appendChild(slotSection("the word","\u0627\u0644\u0643\u0644\u0645\u0629","word",res.entryId, wordRecs, thumbEl, playBtn, setUrl));
    detail.appendChild(slotSection("used in a sentence","\u0645\u062b\u0627\u0644 \u0641\u064a \u062c\u0645\u0644\u0629","context",res.entryId, contextRecs, null, playBtn, ()=>{}));
    detail.appendChild(slotSection("what it means","\u0627\u0644\u0645\u0639\u0646\u0649","definition",res.entryId, defRecs, null, playBtn, ()=>{}));
    const say=document.createElement("a");
    say.className="sayit"; say.href=`${CFG.recorderUrl}#${encodeURIComponent(res.entryId)}`;
    say.innerHTML=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>
    ${CFG.mode()==="auto" ? 'Say it yourself <span class="ar">\u0633\u062c\u0651\u0644 \u0635\u0648\u062a\u0643</span>' : escapeHtml(AFDCore.t("result.sayityourself", CFG.mode()))}`;
    detail.appendChild(say);
    // Share — any word, any reader: a heard word invites "say it your way",
    // an unheard one asks for the first voice.
    const share=document.createElement("button");
    share.type="button"; share.className="sayit shareit";
    share.innerHTML=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>
    ${CFG.mode()==="auto" ? 'Share this word <span class="ar">\u0634\u0627\u0631\u0643 \u0647\u0630\u0647 \u0627\u0644\u0643\u0644\u0645\u0629</span>' : escapeHtml(AFDCore.t("card.share", CFG.mode()))}`;
    // Get the first public voice ready as a file now (see voiceFile), so a
    // tap can hand it straight to the share sheet.
    const pubVoice = wordRecs.find(r => r.consent==="public");
    let voiceReady = null;
    if(pubVoice) voiceFile(pubVoice.url, meta.gloss).then(f => { voiceReady = f; });
    share.addEventListener("click", (e)=>{ e.stopPropagation();
      shareEntry(res.entryId, meta, recs.some(r => r.consent==="public"), CFG.mode(), voiceReady); });
    detail.appendChild(share);
    wordTools(res.entryId, meta, recs, el, detail, paintTags);
    return firstPlayable;
  }

  // A word with no voice used to swallow the tap silently, which reads as
  // "broken". Instead: open the card, say (in the reader's tier) that nobody has
  // recorded it yet, and draw the eye to "Say it yourself" — the one thing to do.
  function noVoice(){
    el.classList.add("open");
    const say = detail.querySelector(".sayit");
    let n = detail.querySelector(".novoice");
    if(!n){
      n = document.createElement("div"); n.className = "novoice"; n.setAttribute("role","status");
      n.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>` +
                    `<span>${AFDCore.tHTML("card.novoice", CFG.mode())}</span>`;
      if(say) detail.insertBefore(n, say); else detail.appendChild(n);
    }
    playBtn.classList.remove("afd-novoice-shake"); void playBtn.offsetWidth; playBtn.classList.add("afd-novoice-shake");
    if(say){ say.classList.remove("afd-novoice-pulse"); void say.offsetWidth; say.classList.add("afd-novoice-pulse"); }
    try{ n.scrollIntoView({ block:"nearest", behavior:"smooth" }); }catch(_){}
  }
  playBtn.addEventListener("click", (e)=>{ e.stopPropagation();
    if(currentUrl){ playInto(playBtn, currentUrl); }
    else loadDetail().then(()=>{ if(currentUrl) playInto(playBtn, currentUrl); else noVoice(); });
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
  return { el, playBtn, removed: !!(meta.removedAt || meta.hiddenAt), get firstPlayable(){ return firstPlayable; } };
}

export { entryCard, shareEntry, voiceFile, slotSection, playVoiceInto, setConsent, withdrawSpeaker, voiceAvatarBtn, buildVoiceRow, buildVoices, entryCounts, listPlayable, envelopeFor, downsampleEnv, boxBars, paintBox, applyBox, faunaAvatar, domainColor, playInto, hashInt, escapeHtml };
