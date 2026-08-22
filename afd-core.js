/* ============================================================================
   afd-core.js — the shared core for every AFD surface (dictionary / find / add)

   Loaded as a plain classic script BEFORE each page's own scripts, so it is
   available synchronously as window.AFDCore to both the classic recorder logic
   and the find.html module. This is step 1 of collapsing the app to one
   dictionary surface + two verbs (find, add): the pieces that were copy-pasted
   across pages now live here once.

   Bump the ?v= query on the <script src> when this file changes, so GitHub Pages
   serves the new copy instead of a cached one.
   ============================================================================ */
window.AFDCore = (function(){
  "use strict";

  /* ---- entry identity -------------------------------------------------------
     The canonical word-id → entryId mapping. MUST stay byte-for-byte in sync
     with seed-entries.mjs, which computes the same slug in Node and therefore
     can't read this browser global. If you change one, change both. */
  function entrySlug(id){
    return String(id)
      .normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g,"_")
      .replace(/^_+|_+$/g,"");
  }
  function entryIdFor(id){ return "ent_" + entrySlug(id); }

  /* ---- display tier ---------------------------------------------------------
     One setting shared by every surface, persisted under a single key so a
     speaker sets it once and the whole app obeys.
       auto   = picture + English + Arabic
       sound  = picture only (no text) — the non-reader view
       script = picture + Arabic */
  const DISP_MODES = ["auto", "sound", "script"];
  const DISP_KEY   = "afd_display_mode";
  function getDisplayMode(fallback){
    try{
      const m = localStorage.getItem(DISP_KEY);
      if(m && DISP_MODES.includes(m)) return m;
    }catch(_){}
    return DISP_MODES.includes(fallback) ? fallback : "auto";
  }
  function setDisplayMode(m){
    if(!DISP_MODES.includes(m)) return;
    try{ localStorage.setItem(DISP_KEY, m); }catch(_){}
  }

  /* ---- microphone capture — the single recording protocol -------------------
     Processing is OFF so the corpus and the speak-to-find query are captured in
     the SAME acoustic space. This is the one place the mic opens; routing both
     surfaces through it is what makes the old find/corpus processing mismatch
     impossible to reintroduce. */
  const MIC_CONSTRAINTS = { audio: {
    echoCancellation: false,   // smears fricatives
    noiseSuppression: false,   // eats quiet consonants
    autoGainControl:  false,   // distorts relative amplitude
    sampleRate: 48000,
    channelCount: 1
  }};

  // Open a stream and report what the device actually gave us.
  // Returns { stream, track, settings, bluetooth, sampleRate, ok }.
  async function openStream(){
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    const track  = stream.getAudioTracks()[0];
    const settings = (track && track.getSettings) ? track.getSettings() : {};
    const label = ((track && track.label) || "").toLowerCase();
    // Bluetooth hands-free profile runs at 8-16 kHz and is invisible to the user.
    const bluetooth = /bluetooth|headset|airpod|hands-free|hfp|sco/.test(label);
    const sampleRate = settings.sampleRate || 0;
    return { stream, track, settings, bluetooth, sampleRate, ok: sampleRate >= 44100 && !bluetooth };
  }

  /* ---- i18n chrome strings -------------------------------------------------
     One keyed table drives every non-gloss UI string. t(key, mode) returns:
       auto   → English
       script → Arabic (falls back to English if a string is missing)
       sound  → the icon if one is defined, else Arabic (Marty's call: fall back
                to Arabic text until a good wordless icon exists)
     Keys use the dotted convention of the spoken-prompt list so the two can be
     reconciled into a single inventory later.

     ⚠ ARABIC NEEDS A NATIVE/DHOFARI REVIEW. These are reasonable MSA defaults so
     the mechanism works end to end; treat the wording as a draft, not authority. */
  const STRINGS = {
    "slot.word":            { en:"THE WORD",           ar:"الكلمة" },
    "slot.sentence":        { en:"USED IN A SENTENCE", ar:"مثال في جملة" },
    "slot.meaning":         { en:"WHAT IT MEANS",      ar:"المعنى" },
    "group.word":           { en:"word",               ar:"كلمة" },
    "group.sentence":       { en:"sentence",           ar:"جملة" },
    "group.meaning":        { en:"meaning",            ar:"معنى" },
    "slot.none":            { en:"none yet",           ar:"لا شيء بعد" },
    "slot.add.sentence":    { en:"Add a sentence",     ar:"أضف جملة" },
    "slot.add.meaning":     { en:"Add a meaning",      ar:"أضف معنى" },
    "voice.takeback":       { en:"Withdraw",           ar:"اسحب" },
    "voice.shareagain":     { en:"Restore",            ar:"استرجع" },
    "voice.erase":          { en:"Erase",              ar:"احذف" },
    "voice.erase.confirm":  { en:"Erase for good?",    ar:"حذف نهائي؟" },
    "result.here":          { en:"Here it is",         ar:"ها هو" },
    "result.pick":          { en:"Did you mean…",      ar:"هل تقصد…" },
    "result.sayityourself": { en:"Say it yourself",    ar:"سجّل صوتك" },
    "action.hear.word":     { en:"Hear the word in English",       ar:"استمع بالإنجليزية" },
    "action.hear.others":   { en:"Hear how others said it in Hakli", ar:"استمع بالحكلية" },
    "record.hold":          { en:"Hold to record",     ar:"اضغط باستمرار للتسجيل" },
    "record.holding":       { en:"Release when finished", ar:"أفلت عند الانتهاء" },
    "record.skip":          { en:"Speaker doesn't know this word", ar:"المتحدّث لا يعرف هذه الكلمة" },
    "review.howsound":      { en:"How did it sound?",   ar:"كيف كان الصوت؟" },
    "review.redo":          { en:"Record again",        ar:"سجّل مرّة أخرى" },
    "review.keep":          { en:"Keep it",             ar:"احتفظ به" },
    "nav.next":             { en:"Next word",           ar:"الكلمة التالية" },
    "speaker.switch":       { en:"Switch speaker",      ar:"بدّل المتحدّث" },
    "session.title":        { en:"THIS SESSION",        ar:"هذه الجلسة" },
    "session.upload":       { en:"Upload to the dictionary",  ar:"ارفع إلى القاموس" },
    "session.export":       { en:"Export everything (.zip)",  ar:"صدّر كل شيء (‎.zip‎)" },
    "session.fieldnotes":   { en:"Show my field notes", ar:"أظهر ملاحظاتي الميدانية" },
    "session.fieldnotes.hide":{ en:"Hide my field notes", ar:"أخفِ ملاحظاتي الميدانية" },
    "session.clear":        { en:"Clear this device",   ar:"امسح هذا الجهاز" }
  };
  function t(key, mode){
    const s = STRINGS[key];
    if(!s) return key;                       // missing key shows itself → easy to spot
    if(mode === "sound"  && s.icon) return s.icon;
    if(mode === "script" || mode === "sound") return s.ar || s.en;
    return s.en;                             // auto
  }

  return {
    entrySlug, entryIdFor,
    DISP_MODES, DISP_KEY, getDisplayMode, setDisplayMode,
    MIC_CONSTRAINTS, openStream,
    STRINGS, t
  };
})();
