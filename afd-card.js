/* afd-card.js — the shared entry card + its audio/waveform/identity primitives.
   Single source of truth for how a dictionary entry is displayed and played,
   used by find.html (browse / search / deep-link) and the recorder.
   SDK-agnostic: the host injects db, storage, live getters for the signed-in
   user and display mode, the recorder URL, and a banner() via initCard().
   AFDCore is read from the global (afd-core.js must load before this module). */
import { doc, getDoc, updateDoc, collection, query, where, limit, getDocs }
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

async function applyBox(thumbEl, mode, recs){
  if(!thumbEl) return;
  const d = thumbEl.dataset;
  const asText = t => { thumbEl.textContent = t || (d.letter || "•"); };
  const asWave = async () => paintBox(thumbEl, recs && recs[0] ? await envelopeFor(recs[0]) : null);
  const asIcon = () => { thumbEl.innerHTML = AFDCore.identicon(d.entry || d.script || d.letter); };
  if(mode==="sound")  return asWave();
  if(mode==="script") return d.script ? asText(d.script) : (d.pic ? asText(d.pic) : asIcon());
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

async function entryCounts(entryId){
  const c={word:0,context:0,definition:0};
  try{
    const snap=await getDocs(query(collection(CFG.db,"afd_entries",entryId,"recordings"),
                                   where("allowPlayback","==",true), limit(50)));
    snap.forEach(d=>{ const v=d.data(); const t=v.type||v.phase||"word"; if(t in c) c[t]++; });
  }catch(_){}
  return c;
}

async function listPlayable(entryId){
  const out=[], seen=new Set();
  const add=async(d)=>{
    if(seen.has(d.id)) return; const v=d.data(); if(!v.storagePath) return;
    if(v.consent==="deleted") return;   // erased: awaiting server purge, shown to no one — not even its owner
    let url; try{ url=await getDownloadURL(ref(CFG.store,v.storagePath)); }catch(_){ return; }
    seen.add(d.id);
    out.push({ url, recordingId:d.id, entryId, uid:v.uid,
               type: v.type || v.phase || "word",
               consent: v.consent || (v.allowPlayback ? "public" : "withdrawn"),
               mine: !!(CFG.user() && v.uid===CFG.user().uid),
               envelope:(Array.isArray(v.envelope)&&v.envelope.length)?v.envelope:null,
               avatar: faunaAvatar(v.speakerId||v.uid||d.id) });
  };
  try{
    const pub=await getDocs(query(collection(CFG.db,"afd_entries",entryId,"recordings"),
                                  where("allowPlayback","==",true), limit(12)));
    for(const d of pub.docs) await add(d);
    // the signed-in viewer's own voices for this word — including withdrawn ones,
    // so they can restore. Dev + deployed rules both let an author read their own.
    if(CFG.user()){
      const mineQ=await getDocs(query(collection(CFG.db,"afd_entries",entryId,"recordings"),
                                      where("uid","==",CFG.user().uid), limit(12)));
      for(const d of mineQ.docs) await add(d);
    }
  }catch(_){}
  return out;
}

function playVoiceInto(rec, thumbEl, playBtn, setUrl){
  setUrl(rec.url);
  if(thumbEl && thumbEl.querySelector("svg")) envelopeFor(rec).then(env=> paintBox(thumbEl, env));
  playInto(playBtn, rec.url);
}

async function setConsent(rec, state){
  try{
    await updateDoc(doc(CFG.db,"afd_entries",rec.entryId,"recordings",rec.recordingId),
      { consent: state, allowPlayback: state==="public" });
    rec.consent = state; return true;
  }catch(e){ console.warn("[AFD] consent change failed", e); CFG.banner("Couldn't change that just now — try again"); return false; }
}

function voiceAvatarBtn(rec, thumbEl, playBtn, setUrl){
  const b=document.createElement("button");
  b.className="av"; b.style.background=rec.avatar.bg;
  b.setAttribute("aria-label","Play this voice");
  b.innerHTML=rec.avatar.svg;
  b.addEventListener("click",()=>{ b.setAttribute("aria-pressed","true");
    playVoiceInto(rec, thumbEl, playBtn, setUrl); });
  return b;
}

function buildVoiceRow(rec, thumbEl, playBtn, setUrl, onErased){
  const row=document.createElement("div");
  row.className="voice-row"; row.setAttribute("aria-pressed","false");
  const play=document.createElement("button");
  play.className="vr-play"; play.setAttribute("aria-label","Play this voice");
  const vrWave = (rec.envelope && rec.envelope.length)
    ? `<span class="vr-wave"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${boxBars(rec.envelope, 40)}</svg></span>`
    : `<span class="vr-wave"></span>`;
  play.innerHTML=`<span class="av-sm" style="background:${rec.avatar.bg}">${rec.avatar.svg}</span>`+
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

async function entryCard(res, lead){
  const el = document.createElement("div");
  el.className = "card" + (lead ? " lead open" : "");

  // entry metadata (public). Fall back gracefully if absent.
  let meta={};
  try{ const sn = await getDoc(doc(CFG.db,"afd_entries",res.entryId)); if(sn.exists()) meta=sn.data(); }catch(_){}
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
  if(meta.pic) thumbEl.textContent = meta.pic;
  else if(CFG.mode()==="script" && scriptLabel) thumbEl.textContent = scriptLabel;
  else thumbEl.innerHTML = AFDCore.identicon(res.entryId);
  // compact voice counts on the collapsed header (wordless icons, tier-safe)
  const gc=el.querySelector(".gloss");
  if(gc){ const hc=document.createElement("div"); hc.className="head-counts"; gc.appendChild(hc);
    entryCounts(res.entryId).then(c=>{ hc.innerHTML=`<span>\u{1F50A} ${c.word}</span><span>\u{1F4AC} ${c.context}</span><span>\u{1F4D6} ${c.definition}</span>`; }); }

  let currentUrl=null, firstPlayable=null, loaded=false;
  const setUrl = (u)=>{ currentUrl = u; };

  // Detail (voices, slots, playback) is EXPENSIVE — listPlayable resolves a Storage
  // URL per recording — so it loads lazily, only when the card opens. This is what
  // lets the dictionary render 40 cards without hundreds of Storage calls up front.
  async function loadDetail(){
    if(loaded) return firstPlayable; loaded=true;
    const recs = await listPlayable(res.entryId);
    const wordRecs    = recs.filter(r => (r.type||"word")==="word");
    const contextRecs = recs.filter(r => r.type==="context");
    const defRecs     = recs.filter(r => r.type==="definition");
    firstPlayable = (wordRecs[0]||recs[0])?.url || null;
    if(currentUrl==null) currentUrl = firstPlayable;
    applyBox(thumbEl, CFG.mode(), wordRecs.length?wordRecs:recs);   // now paint the sound-shape in sound tier
    detail.appendChild(slotSection("the word","\u0627\u0644\u0643\u0644\u0645\u0629","word",res.entryId, wordRecs, thumbEl, playBtn, setUrl));
    detail.appendChild(slotSection("used in a sentence","\u0645\u062b\u0627\u0644 \u0641\u064a \u062c\u0645\u0644\u0629","context",res.entryId, contextRecs, null, playBtn, ()=>{}));
    detail.appendChild(slotSection("what it means","\u0627\u0644\u0645\u0639\u0646\u0649","definition",res.entryId, defRecs, null, playBtn, ()=>{}));
    const say=document.createElement("a");
    say.className="sayit"; say.href=`${CFG.recorderUrl}#${encodeURIComponent(res.entryId)}`;
    say.innerHTML=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>
    ${CFG.mode()==="auto" ? 'Say it yourself <span class="ar">\u0633\u062c\u0651\u0644 \u0635\u0648\u062a\u0643</span>' : escapeHtml(AFDCore.t("result.sayityourself", CFG.mode()))}`;
    detail.appendChild(say);
    return firstPlayable;
  }

  playBtn.addEventListener("click", (e)=>{ e.stopPropagation();
    if(currentUrl){ playInto(playBtn, currentUrl); }
    else loadDetail().then(()=>{ if(currentUrl) playInto(playBtn, currentUrl); });
  });
  el.querySelector(".head").addEventListener("click", (e)=>{
    if(e.target.closest(".play")) return;
    const opening = !el.classList.contains("open");
    el.classList.toggle("open", opening);
    if(opening) loadDetail().then(()=>{ if(currentUrl) playInto(playBtn, currentUrl); });
  });

  if(lead) await loadDetail();          // lead opens on render → load now (keeps autoplay + firstPlayable)
  return { el, playBtn, get firstPlayable(){ return firstPlayable; } };
}

export { entryCard, slotSection, playVoiceInto, setConsent, voiceAvatarBtn, buildVoiceRow, buildVoices, entryCounts, listPlayable, envelopeFor, downsampleEnv, boxBars, paintBox, applyBox, faunaAvatar, domainColor, playInto, hashInt, escapeHtml };
