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

  /* A brand-new, contributor-created entry. Audio-first: no text is required, so
     the id can't be slugged from a gloss — we mint a random, collision-free id in
     the SAME "ent_" space as seeded words. The "u_" segment marks it as user-made
     at a glance in logs / Firestore; the authoritative provenance is the doc's
     source:"user" field. identicon(seed) keys off this id, so the entry has a
     stable visual identity the instant it exists, with no picture assigned. */
  function mintEntryId(){
    let rand;
    try{ rand = crypto.randomUUID().replace(/-/g,""); }
    catch(_){ rand = Date.now().toString(36) + Math.random().toString(36).slice(2); }
    return "ent_u_" + rand.slice(0,12);
  }

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

  /* ---- quiet mode — does the app speak TO you? ------------------------------
     A separate axis from the display tier (tier = how words are SHOWN; quiet =
     whether the app NARRATES). Three kinds of sound, and quiet touches only one:
       content   — the Hakli recordings. Always plays.
       asked     — sound the person just asked for: a long-pressed button's
                   label, a tapped ▶ / "hear in English". Always plays — they
                   asked for it.
       narration — sound the app volunteers: spoken hints on arrival, guidance
                   between steps. The scaffolding a speaker outgrows. Quiet
                   silences this, and only this.
     Every volunteered interface sound must go through playUI(url, "narration")
     (or check mayPlayUI) so quiet is honoured everywhere from day one.
     Persisted shared, like the display mode. See ROADMAP "Mute / quiet mode". */
  const QUIET_KEY = "afd_quiet";
  const quietSubs = new Set();
  let uiNarration = null;                        // the narration clip playing now, if any
  function getQuiet(){
    try{ return localStorage.getItem(QUIET_KEY) === "1"; }catch(_){ return false; }
  }
  function setQuiet(on){
    on = !!on;
    try{ localStorage.setItem(QUIET_KEY, on ? "1" : "0"); }catch(_){}
    if(on && uiNarration){ try{ uiNarration.pause(); }catch(_){} uiNarration = null; }  // hush mid-sentence
    quietSubs.forEach(fn => { try{ fn(on); }catch(_){} });
  }
  function onQuietChange(fn){ quietSubs.add(fn); return () => quietSubs.delete(fn); }
  function mayPlayUI(kind){ return kind !== "narration" || !getQuiet(); }
  // Play an interface sound; returns the Audio element, or null if quiet held it back.
  function playUI(url, kind){
    kind = kind || "narration";
    if(!url || !mayPlayUI(kind)) return null;
    const a = new Audio(url);
    if(kind === "narration"){
      if(uiNarration){ try{ uiNarration.pause(); }catch(_){} }
      uiNarration = a;
      a.addEventListener("ended", () => { if(uiNarration === a) uiNarration = null; });
    }
    a.play().catch(()=>{});                      // autoplay may be blocked; that's fine
    return a;
  }
  // Another tab flipped it → follow along.
  try{ window.addEventListener("storage", e => {
    if(e.key === QUIET_KEY) quietSubs.forEach(fn => { try{ fn(getQuiet()); }catch(_){} });
  }); }catch(_){}

  /* attachQuietToggle(btn) — long-press the display-tier button to toggle quiet.
     Marty's design: the gesture lives on the tier control (wordless, no new
     button), and a small mute bubble rides on that circle while quiet is on —
     on every tier, so a quiet app never looks like a talking one. A plain tap
     still cycles the tier; the click that follows a long-press is swallowed.
     Feedback: the bubble, a short buzz where supported, and (when the tier shows
     text) a one-line toast. Keyboard: Shift+Enter / Shift+Space toggles. */
  const QUIET_HOLD_MS = 550;
  function injectQuietCSS(){
    if(document.getElementById("afdQuietCSS")) return;
    const st = document.createElement("style"); st.id = "afdQuietCSS";
    st.textContent =
      '[data-quiet-btn]{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation}'+
      '[data-quiet-btn][data-quiet="1"]::before{content:"";position:absolute;top:-3px;inset-inline-end:-3px;'+
        'width:17px;height:17px;border-radius:50%;background:#1F3A34 no-repeat center/11px 11px;'+
        'background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23EAF1ED%27 stroke-width=%272.4%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M11 5 6 9H3v6h3l5 4z%27/%3E%3Cpath d=%27M22 9l-6 6M16 9l6 6%27/%3E%3C/svg%3E");'+
        'box-shadow:0 0 0 2px #FBFCFB;pointer-events:none;animation:afdQuietPop .18s ease-out}'+
      '@keyframes afdQuietPop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}'+
      '@media (prefers-reduced-motion:reduce){[data-quiet-btn][data-quiet="1"]::before{animation:none}}'+
      '.afd-quiet-toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translateX(-50%);'+
        'background:#1F3A34;color:#EAF1ED;padding:9px 16px;border-radius:20px;font:500 14px/1.3 system-ui,sans-serif;'+
        'z-index:9999;max-width:calc(100vw - 32px);text-align:center;pointer-events:none;opacity:0;transition:opacity .2s}'+
      '.afd-quiet-toast.show{opacity:1}'+
      '.afd-quiet-toast small{display:block;opacity:.75;font-size:12px;margin-top:2px}';
    document.head.appendChild(st);
  }
  /* ---- waiting dots (10-15) -----------------------------------------------
     The resin bouncing dots, on every page: dotsHTML() for any wait on the
     network — a save, an upload, a sign-in, a list or card loading — so a wait
     is visible to someone who can't read "Saving…". Inline by default (beside
     or instead of a status line); dotsHTML(true) is the larger, centred block. */
  function injectDotsCSS(){
    if(document.getElementById("afdDotsCSS")) return;
    const st = document.createElement("style"); st.id = "afdDotsCSS";
    st.textContent =
      '.afd-dots{display:inline-flex;gap:4px;align-items:center;vertical-align:middle;color:#C6873F;margin-inline:6px}'+
      '.afd-dots span{width:6px;height:6px;border-radius:50%;background:currentColor;animation:afdDots 1s ease-in-out infinite}'+
      '.afd-dots span:nth-child(2){animation-delay:.15s}.afd-dots span:nth-child(3){animation-delay:.3s}'+
      '.afd-dots.big{display:flex;justify-content:center;gap:9px;padding:28px 0;margin:0}'+
      '.afd-dots.big span{width:11px;height:11px}'+
      '@keyframes afdDots{0%,100%{opacity:.35;transform:translateY(0)}50%{opacity:1;transform:translateY(-5px)}}'+
      '@media (prefers-reduced-motion:reduce){.afd-dots span{animation:none;opacity:.8}}';
    (document.head || document.documentElement).appendChild(st);
  }
  function dotsHTML(big){
    injectDotsCSS();
    return '<span class="afd-dots'+(big?' big':'')+'" role="status" aria-label="…"><span></span><span></span><span></span></span>';
  }

  function quietToast(on){
    const mode = getDisplayMode("auto");
    if(mode === "sound") return;                 // wordless tier: the bubble says it
    let el = document.querySelector(".afd-quiet-toast");
    if(!el){ el = document.createElement("div"); el.className = "afd-quiet-toast";
      el.setAttribute("role","status"); el.setAttribute("aria-live","polite"); document.body.appendChild(el); }
    el.innerHTML = tHTML(on ? "hdr.quiet.on" : "hdr.quiet.off", mode);
    el.classList.add("show");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2200);
  }
  function attachQuietToggle(btn){
    if(!btn || btn._afdQuiet) return; btn._afdQuiet = true;
    injectQuietCSS();
    btn.setAttribute("data-quiet-btn", "");
    if(getComputedStyle(btn).position === "static") btn.style.position = "relative";
    const baseTitle = btn.getAttribute("title") || "";
    const paint = on => {
      btn.setAttribute("data-quiet", on ? "1" : "0");
      btn.setAttribute("title", baseTitle + (on ? " · quiet (long-press to hear narration)" : " · long-press for quiet"));
    };
    paint(getQuiet());
    onQuietChange(paint);
    const flip = () => {
      const on = !getQuiet(); setQuiet(on);
      try{ navigator.vibrate && navigator.vibrate(on ? [18,40,18] : 30); }catch(_){}
      quietToast(on);
    };
    let timer = null, fired = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    btn.addEventListener("pointerdown", e => {
      if(e.button && e.button !== 0) return;
      fired = false; cancel();
      timer = setTimeout(() => { timer = null; fired = true; flip(); }, QUIET_HOLD_MS);
    });
    ["pointerup","pointercancel","pointerleave"].forEach(ev => btn.addEventListener(ev, cancel));
    btn.addEventListener("contextmenu", e => e.preventDefault());   // mobile long-press menu
    // Capture phase: at the target, capture listeners run first, so this can
    // swallow the click before the page's own tier-cycling handler sees it.
    btn.addEventListener("click", e => {
      if(fired){ fired = false; e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    btn.addEventListener("keydown", e => {
      if(e.shiftKey && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); e.stopImmediatePropagation(); flip(); }
    }, true);
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
     the mechanism works end to end; treat the wording as a draft, not authority.

     ⚠ ADD NEW STRINGS AT THE END. The prompts tool numbers its review list by
     position here (A11.1, A11.2, …), so a string inserted mid-list renumbers
     every line after it. test/browser/prompt-numbers.json snapshots the numbers;
     check that its diff only adds lines. */
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
    "roster.erased":        { en:"Erased",             ar:"محذوف" },
    "roster.restore.confirm": { en:"Make {spk}'s recordings public again?", ar:"إعادة نشر تسجيلات {spk}؟" },
    // Sharing status on the recording screen: will these takes be heard by others?
    "share.public":   { en:"Public · other people can listen to these takes", ar:"عام · يمكن للآخرين الاستماع إلى هذه التسجيلات", icon:"\u{1F50A}" },
    "share.private":  { en:"Private · only you can hear these takes — tap to change", ar:"خاص · أنت فقط تسمع هذه التسجيلات — اضغط للتغيير", icon:"\u{1F512}" },
    "share.closed":   { en:"Not shared · tap to share this speaker's takes", ar:"غير منشور · اضغط لنشر تسجيلات هذا المتحدّث", icon:"\u{1F512}" },
    "share.erased":   { en:"Not shared · this speaker's recordings were erased", ar:"غير منشور · حُذفت تسجيلات هذا المتحدّث", icon:"\u{1F512}" },
    "share.confirm":  { en:"Share {spk}'s recordings now? Other people will be able to listen to them in the app.", ar:"نشر تسجيلات {spk} الآن؟ سيتمكّن الآخرون من الاستماع إليها في التطبيق." },
    "voice.erase":          { en:"Erase",              ar:"احذف" },
    "voice.erase.confirm":  { en:"Erase for good?",    ar:"حذف نهائي؟" },
    "result.here":          { en:"Here it is",         ar:"ها هو" },
    "result.pick":          { en:"Did you mean…",      ar:"هل تقصد…" },
    "result.sayityourself": { en:"Say it yourself",    ar:"سجّل صوتك" },
    "hdr.display":          { en:"Display",  ar:"العرض" },
    "hdr.signin":           { en:"Sign in",  ar:"دخول" },
    "hdr.account":          { en:"Account",  ar:"حسابي" },
    "hdr.find":             { en:"Find",     ar:"ابحث" },
    "card.novoice":         { en:"No voice yet — be the first to say it", ar:"لا صوت بعد — كن أوّل من يقولها" },
    "entry.addnew":         { en:"Add it to the dictionary", ar:"أضِفها إلى القاموس" },
    "entry.notthese":       { en:"None of these — add a new word", ar:"غير موجودة؟ أضف كلمة جديدة" },
    "action.hear.word":     { en:"Hear the word in English",       ar:"استمع بالإنجليزية" },
    "action.hear.others":   { en:"Hear how others said it in Hakli", ar:"استمع بالحكلية" },
    "record.hold":          { en:"Hold to record",     ar:"اضغط باستمرار للتسجيل" },
    "record.holding":       { en:"Release when finished", ar:"أفلت عند الانتهاء" },
    "record.skip":          { en:"Speaker doesn't know this word", ar:"المتحدّث لا يعرف هذه الكلمة" },
    "review.howsound":      { en:"How did it sound?",   ar:"كيف كان الصوت؟" },
    "review.redo":          { en:"Record again",        ar:"سجّل مرّة أخرى" },
    "review.keep":          { en:"Keep it",             ar:"احتفظ به" },
    "nav.next":             { en:"Next word",           ar:"الكلمة التالية" },
    "nav.prev":             { en:"Previous word",       ar:"الكلمة السابقة" },
    "listen.instruction":   { en:"Hear how other speakers say this word.", ar:"استمع إلى المتحدّثين الآخرين يقولون هذه الكلمة." },
    "compare.title":        { en:"How others said it",  ar:"كيف قالها الآخرون" },
    "compare.looking":      { en:"Looking…",            ar:"جارٍ البحث…" },
    "speaker.switch":       { en:"Switch speaker",      ar:"بدّل المتحدّث" },
    "session.title":        { en:"THIS SESSION",        ar:"هذه الجلسة" },
    "session.upload":       { en:"Upload to the dictionary",  ar:"ارفع إلى القاموس" },
    "session.export":       { en:"Export everything (.zip)",  ar:"صدّر كل شيء (‎.zip‎)" },
    "session.more":         { en:"More", ar:"المزيد" },
    // recorder steps 1–2 — sign-in, profile, speaker, permission, microphone (recorder.html data-str)
    "setup.step": { en:"STEP 1 / 3 · SPEAKER", ar:"الخطوة ١ / ٣ · المتحدِّث" },
    "setup.title": { en:"Hakli Word Recorder", ar:"مُسجِّل كلمات الحَكلي" },
    "setup.signin.title": { en:"Sign in to record", ar:"سجِّل الدخول للتسجيل" },
    "setup.signin.note": { en:"Anyone can listen. Signing in is only needed to add a recording, so each word can be credited.", ar:"يمكن لأيِّ أحدٍ أن يستمع. تسجيل الدخول مطلوبٌ فقط لإضافة تسجيل، حتى يُنسَب كلُّ صوتٍ إلى صاحبه." },
    "setup.google": { en:"Continue with Google", ar:"متابعة عبر Google" },
    "setup.oremail": { en:"or use an email address", ar:"أو استخدم بريدًا إلكترونيًّا" },
    "setup.email": { en:"Email", ar:"البريد الإلكتروني" },
    "setup.password": { en:"Password", ar:"كلمة المرور" },
    "setup.signup": { en:"Create account", ar:"أنشئ حسابًا" },
    "setup.signin": { en:"Sign in", ar:"سجِّل الدخول" },
    "setup.signedin": { en:"Signed in", ar:"تمّ تسجيل الدخول" },
    "setup.listenonly": { en:"Just listen — no account, no microphone", ar:"الاستماع فقط — دون حساب أو ميكروفون" },
    "profile.title": { en:"How you appear", ar:"كيف تظهر" },
    "profile.note": { en:"By default you appear as a nature avatar, no name. You may choose to appear by name — on your own voices only.", ar:"افتراضيًّا تظهر برمزٍ من الطبيعة دون اسم. يمكنك اختيار الظهور باسمك على تسجيلاتك أنت فقط." },
    "profile.obscure": { en:"Obscure — a nature avatar, no name", ar:"مستتر — رمزٌ من الطبيعة، دون اسم" },
    "profile.known": { en:"Known — my name shows on my own voices", ar:"معروف — يظهر اسمي على تسجيلاتي أنا" },
    "profile.name": { en:"Display name", ar:"الاسم كما يظهر" },
    "profile.picture": { en:"Picture (optional)", ar:"صورة (اختياري)" },
    "profile.picture.note": { en:"Your own picture only — don't upload photos of other people.", ar:"صورتك أنت فقط — لا تَرفع صور أشخاصٍ آخرين." },
    "profile.save": { en:"Save how I appear", ar:"حفظ الظهور" },
    "speaker.title": { en:"About the speaker", ar:"عن المتحدِّث" },
    "speaker.about.self": { en:"These details describe your own voice.", ar:"هذه التفاصيل تصف صوتك." },
    "speaker.agent": { en:"I'm recording someone else's voice (I'm not the speaker)", ar:"أُسجِّل صوت شخصٍ آخر (لستُ المتحدِّث)" },
    "speaker.code": { en:"Speaker code", ar:"رمز المتحدِّث" },
    "speaker.town": { en:"Town", ar:"البلدة" },
    "speaker.tribe": { en:"Tribe", ar:"القبيلة" },
    "speaker.age": { en:"Age band", ar:"الفئة العُمرية" },
    "speaker.gender": { en:"Gender", ar:"الجنس" },
    "speaker.nodialect": { en:"No dialect field by design — locality is recorded, variety derived later.", ar:"لا حقلَ للهجة عن قصد — تُسجَّل البلدة وتُشتَقّ اللهجة لاحقًا." },
    "consent.title": { en:"Permission", ar:"الإذن" },
    "consent.separate": { en:"Each permission is separate. The speaker may agree to some and not others.", ar:"كلُّ إذنٍ منفصل. قد يوافق المتحدِّث على بعضها دون بعض." },
    "consent.archive": { en:"Keep these recordings in a language archive", ar:"حفظ هذه التسجيلات في أرشيفٍ لغوي" },
    "consent.ml": { en:"Use these recordings to teach a computer to understand Hakli", ar:"استخدام هذه التسجيلات لتعليم الحاسوب فهم الحَكلي" },
    "consent.play": { en:"Let other people listen to these recordings in the app", ar:"السماح للآخرين بالاستماع إلى هذه التسجيلات في التطبيق" },
    "consent.attr": { en:"How should the speaker be credited?", ar:"كيف يُنسَب التسجيل إلى المتحدِّث؟" },
    "consent.record": { en:"Record the speaker's spoken consent", ar:"سجّل موافقة المتحدِّث المنطوقة" },
    "mic.step": { en:"STEP 2 / 3 · MICROPHONE", ar:"الخطوة ٢ / ٣ · الميكروفون" },
    "mic.title": { en:"Check the microphone", ar:"افحص الميكروفون" },
    "mic.note": { en:"This confirms your phone is capturing enough detail. Recordings below 44,100 Hz can't be used.", ar:"يؤكّد هذا أنّ هاتفك يلتقط تفاصيل كافية. لا يمكن استخدام تسجيلات دون ٤٤٬١٠٠ هرتز." },
    "mic.start": { en:"Turn on the microphone", ar:"شغِّل الميكروفون" },
    "mic.torecord": { en:"Start recording words", ar:"ابدأ تسجيل الكلمات" },
    "mic.retry": { en:"Check again", ar:"افحص مرّة أخرى" },
    "mic.listenonly": { en:"No microphone? Listen to other speakers instead", ar:"لا ميكروفون؟ استمع إلى متحدّثين آخرين بدلًا من ذلك" },
    "speaker.title.agent": { en:"About the person you are recording", ar:"عن الشخص الذي تُسجِّله" },
    "speaker.about.agent": { en:"These details describe the speaker, not you. Town is what the dialect is derived from.", ar:"هذه التفاصيل تصف المتحدِّث، لا أنت. ومن البلدة تُشتَقّ اللهجة." },
    "speaker.recordfor": { en:"Record for this speaker", ar:"سجِّل لهذا المتحدِّث" },
    "mic.err.title": { en:"The microphone didn't open", ar:"لم يُفتَح الميكروفون" },
    "mic.err.body": { en:"Allow microphone access in your browser, then check again.", ar:"اسمح للمتصفّح باستخدام الميكروفون، ثم افحص مرّة أخرى." },
    "mic.ok.title": { en:"Good to record", ar:"جاهز للتسجيل" },
    "mic.ok.body": { en:"This microphone is capturing enough detail.", ar:"هذا الميكروفون يلتقط تفاصيل كافية." },
    "mic.bt.title": { en:"Disconnect the headset", ar:"افصل السمّاعة" },
    "mic.bt.body": { en:"Bluetooth headsets record at telephone quality. Turn Bluetooth off and use the phone's own microphone, then check again.", ar:"سمّاعات البلوتوث تسجّل بجودة الهاتف العادي. أطفئ البلوتوث واستخدم ميكروفون الهاتف نفسه، ثم افحص مرّة أخرى." },
    "mic.level.btn":         { en:"Test the level — say a word", ar:"اختبر مستوى الصوت — قل كلمة" },
    "mic.level.listening":   { en:"Listening… say a word twice", ar:"أستمع… قل كلمة مرّتين" },
    "mic.level.ok.title":    { en:"The level is good", ar:"مستوى الصوت جيّد" },
    "mic.level.ok.body":     { en:"Your voice comes through clearly, without distortion.", ar:"صوتك واضح دون تشويش." },
    "mic.level.loud.title":  { en:"Too loud — the sound distorts", ar:"الصوت مرتفع جدًّا ويتشوّه" },
    "mic.level.loud.body":   { en:"On a computer, lower the input volume (Settings → Sound → Input). On a phone, hold it a little further away.", ar:"على الحاسوب: اخفض مستوى الإدخال (الإعدادات ← الصوت ← الإدخال). على الهاتف: أبعده قليلًا." },
    "mic.level.quiet.title": { en:"Too quiet", ar:"الصوت منخفض جدًّا" },
    "mic.level.quiet.body":  { en:"Move closer to the microphone, or raise the input volume.", ar:"اقترب من الميكروفون أو ارفع مستوى الإدخال." },
    "mic.level.noisy.title": { en:"A lot of background noise", ar:"ضجيج كثير في الخلفية" },
    "mic.level.noisy.body":  { en:"Try a quieter spot, or lower the input volume if it is set high.", ar:"جرّب مكانًا أهدأ، أو اخفض مستوى الإدخال إن كان مرتفعًا." },
    "mic.low.title": { en:"Not enough detail", ar:"التفاصيل غير كافية" },
    "mic.low.body": { en:"This microphone is capturing at {sr} Hz. Recordings need 44,100 Hz or more.", ar:"هذا الميكروفون يلتقط بتردّد {srAr} هرتز. تحتاج التسجيلات إلى ٤٤٬١٠٠ هرتز أو أكثر." },
    // recorder step 1 — restore banner, form placeholders and options (recorder.html data-str)
    "form.town.eg": { en:"Mirbat", ar:"مرباط" },
    "form.tribe.eg": { en:"self-identified", ar:"كما يُعرِّف المتحدِّث نفسه" },
    "form.age.20s": { en:"20s", ar:"العشرينات" },
    "form.age.30s": { en:"30s", ar:"الثلاثينات" },
    "form.age.40s": { en:"40s", ar:"الأربعينات" },
    "form.age.50s": { en:"50s", ar:"الخمسينات" },
    "form.age.60s": { en:"60s", ar:"الستينات" },
    "form.age.70s": { en:"70s", ar:"السبعينات" },
    "form.age.80s": { en:"80s+", ar:"الثمانينات فأكثر" },
    "form.gender.optional": { en:"optional —", ar:"— اختياري" },
    "form.gender.f": { en:"Female", ar:"أنثى" },
    "form.gender.m": { en:"Male", ar:"ذكر" },
    "form.attr.pseudonymous": { en:"By a code name only", ar:"بالاسم الرمزي فقط" },
    "form.attr.named": { en:"By name", ar:"بالاسم" },
    "form.attr.anonymous": { en:"Not at all", ar:"دون نسبة" },
    "town.salalah": { en:"Salalah", ar:"صلالة" },
    "town.mirbat": { en:"Mirbat", ar:"مرباط" },
    "town.taqah": { en:"Taqah", ar:"طاقة" },
    "town.sadah": { en:"Sadah", ar:"سدح" },
    "town.rakhyut": { en:"Rakhyut", ar:"رخيوت" },
    "town.dhalkut": { en:"Dhalkut", ar:"ضلكوت" },
    "restore.count": { en:"Recordings already on this phone: {n}", ar:"التسجيلات المحفوظة على هذا الهاتف: {n}" },
    "restore.hint": { en:"Carry on where you left off, or export them from the bottom of the recording screen.", ar:"تابِع من حيث توقّفت، أو صدِّرها من أسفل شاشة التسجيل." },
    "session.clear":        { en:"Clear this device",   ar:"امسح هذا الجهاز" },
    "session.savednote":    { en:"Recordings are saved on this phone first, then uploaded. Nothing is lost if you go offline — upload again when you have signal.", ar:"تُحفَظ التسجيلات على هذا الهاتف أولًا ثم تُرفَع. لا يضيع شيء إن انقطع الاتصال — أعد الرفع عند توفّر الشبكة." },
    "session.about":        { en:"Part of the Audio First Dictionary. Recordings are saved on this phone and uploaded when you're signed in.", ar:"جزء من قاموس الصوت أولًا. تُحفَظ التسجيلات على هذا الهاتف وتُرفَع عند تسجيل الدخول." },
    "session.norecordings": { en:"No recordings kept yet.", ar:"لا تسجيلات محفوظة بعد." },
    "session.otheracct":    { en:"({n} on this device belong to another account.)", ar:"({n} على هذا الجهاز تخصّ حسابًا آخر.)" },
    "session.summary":      { en:"{n} kept · {up} uploaded.", ar:"{n} محفوظ · {up} مرفوع." },
    "session.othermore":    { en:"{n} more belong to another account on this device.", ar:"و{n} أخرى تخصّ حسابًا آخر على هذا الجهاز." },
    "session.signinupload": { en:"Sign in first to upload.", ar:"سجّل الدخول أولًا للرفع." },
    "clip.skipped":         { en:"skipped", ar:"مُتخطّى" },
    "clip.play":            { en:"Play", ar:"شغّل" },
    "clip.uploaded":        { en:"UPLOADED", ar:"مرفوع" },
    "clip.onphone":         { en:"ON PHONE", ar:"على الهاتف" },
    "clip.mine":            { en:"YOURS", ar:"لك" },
    "sync.busy":            { en:"Already uploading — one moment.", ar:"الرفع جارٍ — لحظة من فضلك." },
    "sync.none":            { en:"Everything is already uploaded.", ar:"كل التسجيلات مرفوعة." },
    "sync.progress":        { en:"Uploading {i} of {n}…", ar:"جارٍ رفع {i} من {n}…" },
    "sync.result":          { en:"{ok} of {n} uploaded.", ar:"رُفع {ok} من {n}." },
    "sync.rest":            { en:"The rest are still saved on this phone.", ar:"البقية محفوظة على هذا الهاتف." },
    "sync.orphan":          { en:"{n} older take(s) belong to a speaker who isn't in the form now. Put that speaker's code back in the form to upload them.", ar:"{n} من التسجيلات الأقدم تخصّ متحدّثًا غير موجود في النموذج الآن. أعد رمز ذلك المتحدّث إلى النموذج لرفعها." },
    "save.failed":          { en:"Could not save to this device:", ar:"تعذّر الحفظ على هذا الجهاز:" },
    "list.end":             { en:"That's the whole list. Download the session data before closing.", ar:"انتهت القائمة. نزّل بيانات الجلسة قبل الإغلاق." },
    "export.none":          { en:"Nothing recorded yet for this account.", ar:"لا تسجيلات بعد لهذا الحساب." },
    "export.packaging":     { en:"Packaging…", ar:"جارٍ التجهيز…" },
    "export.failed":        { en:"Export failed:", ar:"فشل التصدير:" },
    "clear.confirm":        { en:"Delete all {n} recording(s) from this device?", ar:"حذف كل التسجيلات ({n}) من هذا الجهاز؟" },
    "clear.unsent":         { en:"{n} of them have NOT been uploaded yet and exist only on this phone.", ar:"{n} منها لم تُرفَع بعد وموجودة على هذا الهاتف فقط." },
    "clear.warn":           { en:"Export first if you have not already — this cannot be undone.", ar:"صدّرها أولًا إن لم تفعل — لا يمكن التراجع عن هذا." },
    "auth.continue":        { en:"Continue", ar:"متابعة" },
    "auth.signinfirst":     { en:"Sign in first", ar:"سجّل الدخول أولًا" },
    "speaker.withdraw":     { en:"Withdraw this speaker's recordings", ar:"اسحب تسجيلات هذا المتحدّث" },
    "speaker.withdrawing":  { en:"Withdrawing…", ar:"جارٍ السحب…" },
    "speaker.signin":       { en:"Sign in first to manage recordings.", ar:"سجّل الدخول أولًا لإدارة التسجيلات." },
    "speaker.entid":        { en:"Enter the speaker id you want to withdraw.", ar:"أدخِل معرّف المتحدّث الذي تريد سحبه." },
    "speaker.withdraw.confirm": { en:"Withdraw ALL of {spk}'s recordings from public listening? Only {spk} is affected — every other speaker is untouched. This is recoverable: the recordings can be restored.", ar:"هل تسحب كل تسجيلات {spk} من الاستماع العام؟ لن يتأثر سوى {spk} — يبقى كل متحدّث آخر كما هو. وهذا قابل للاسترجاع: يمكن استعادة التسجيلات." },
    "speaker.withdraw.done": { en:"Withdrew {n} from {spk}. Individual takes can be restored from the dictionary.", ar:"تم سحب {n} من تسجيلات {spk}. يمكن استعادة كل تسجيل من القاموس." },
    "speaker.withdraw.none": { en:"No public recordings found for {spk}.", ar:"لا توجد تسجيلات عامة لـ {spk}." },
    "speaker.withdraw.err":  { en:"Couldn't withdraw just now — please try again.", ar:"تعذّر السحب الآن — يرجى المحاولة مجددًا." },
    // -- spoken-withdrawal capture (agent acting for a speaker) --------------
    // The steward can't silently pull a speaker's voice; the speaker themselves
    // must say, in Hakli, that they want it removed. That utterance is the proof.
    "withdraw.proof.title":  { en:"{spk} asks to withdraw", ar:"يطلب {spk} السحب" },
    "withdraw.proof.ask":    { en:"Hand the phone to the speaker. Ask them to say, in their own words, that they want their voice removed.", ar:"سلّم الهاتف إلى المتحدّث. اطلب منه أن يقول بكلماته أنه يريد إزالة صوته." },
    "withdraw.proof.hold":   { en:"Hold to record their words", ar:"اضغط باستمرار لتسجيل كلماته" },
    "withdraw.proof.again":  { en:"Record again", ar:"سجّل مرّة أخرى" },
    "withdraw.proof.play":   { en:"Listen back", ar:"استمع" },
    "withdraw.proof.confirm":{ en:"That's what they said — withdraw", ar:"هذا ما قاله — اسحب" },
    "withdraw.proof.erase":  { en:"Erase permanently instead", ar:"احذف نهائيًا بدلاً من ذلك" },
    "withdraw.proof.erase.confirm":{ en:"Tap again to erase for good", ar:"اضغط مرّة أخرى للحذف نهائيًا" },
    "withdraw.proof.cancel": { en:"Cancel", ar:"إلغاء" },
    "withdraw.proof.saving": { en:"Saving their words…", ar:"جارٍ حفظ كلماته…" },
    "withdraw.proof.err":    { en:"Couldn't save that recording — please try again.", ar:"تعذّر حفظ التسجيل — يرجى المحاولة مجددًا." },
    "withdraw.proof.mic":    { en:"Microphone permission is needed to record the withdrawal.", ar:"إذن الميكروفون مطلوب لتسجيل السحب." },
    "grant.proof.title":     { en:"Record {spk}'s consent", ar:"سجّل موافقة {spk}" },
    "grant.proof.ask":       { en:"Hand the phone to the speaker. Ask them to say, in their own words, that they agree to their voice being recorded and kept.", ar:"سلّم الهاتف إلى المتحدّث. اطلب منه أن يقول بكلماته أنه يوافق على تسجيل صوته وحفظه." },
    "grant.proof.hold":      { en:"Hold to record their words", ar:"اضغط باستمرار لتسجيل كلماته" },
    "grant.proof.again":     { en:"Record again", ar:"سجّل مرّة أخرى" },
    "grant.proof.play":      { en:"Listen back", ar:"استمع" },
    "grant.proof.confirm":   { en:"That's their consent — save it", ar:"هذه موافقته — احفظها" },
    "grant.proof.cancel":    { en:"Cancel", ar:"إلغاء" },
    "grant.proof.saving":    { en:"Saving their consent…", ar:"جارٍ حفظ الموافقة…" },
    "grant.proof.err":       { en:"Couldn't save that recording — please try again.", ar:"تعذّر حفظ التسجيل — يرجى المحاولة مجددًا." },
    "grant.proof.mic":       { en:"Microphone permission is needed to record the consent.", ar:"إذن الميكروفون مطلوب لتسجيل الموافقة." },
    "grant.proof.saved":     { en:"Spoken consent recorded", ar:"تم تسجيل الموافقة المنطوقة" },
    "grant.signin":          { en:"Sign in first, then record the spoken consent.", ar:"سجّل الدخول أولاً، ثم سجّل الموافقة المنطوقة." },
    "speaker.erase.done":    { en:"Erased {n} of {spk}'s recordings for good. This cannot be undone.", ar:"تم حذف {n} من تسجيلات {spk} نهائيًا. لا يمكن التراجع عن ذلك." },
    "speaker.erase.none":    { en:"No recordings found for {spk} to erase.", ar:"لا توجد تسجيلات لحذفها لـ {spk}." },
    "qc.good":              { en:"Sounds good",         ar:"الصوت جيّد" },
    "qc.retry":             { en:"Let\u2019s try that again", ar:"لنجرّب مرّة أخرى" },
    "qc.saytwice":          { en:"Say the word twice, with a small pause between", ar:"قل الكلمة مرّتين، مع وقفة قصيرة بينهما" },
    "qc.reps.heard":        { en:"Repetitions heard",   ar:"التكرارات المسموعة" },
    "qc.reps.match":        { en:"Repetitions match",   ar:"تطابق التكرارات" },
    "qc.segments":          { en:"Speech segments",     ar:"مقاطع الكلام" },
    "status.ready":         { en:"ready",               ar:"جاهز" },
    "status.listening":     { en:"listening",           ar:"يستمع" },
    "status.checking":      { en:"checking",            ar:"يتحقّق" },
    "status.recorded":      { en:"recorded",            ar:"تم التسجيل" },
    "clip.yours":           { en:"Your recording",      ar:"تسجيلك" },
    "clip.speaker":         { en:"Speaker",             ar:"متحدّث" },
    "clip.none":            { en:"No one else has recorded this word yet. Yours is the first — check back as more speakers contribute.", ar:"لا أحد غيرك سجّل هذه الكلمة بعد. أنت الأول — عُد لاحقًا مع مساهمة متحدّثين آخرين." },
    "unit.reps":            { en:"reps",                ar:"تكرار" },
    "account.edit":         { en:"Edit how you appear", ar:"تعديل كيف تظهر" },
    "account.signout":      { en:"Sign out",            ar:"تسجيل الخروج" },
    "account.signout.confirm": { en:"Sign out? You can sign back in anytime.", ar:"تسجيل الخروج؟ يمكنك الدخول مجددًا في أي وقت." },
    // Quiet mode toast (long-press the display button). Added at the very END so
    // the prompts tool's section.item numbers don't shift (lands last in §11).
    "hdr.quiet.on":         { en:"Quiet — the app won't talk you through it. Words still play.", ar:"هدوء — لن يتكلّم التطبيق بالإرشادات. الكلمات تُسمَع كما هي." },
    "hdr.quiet.off":        { en:"Spoken guidance is on", ar:"الإرشاد الصوتيّ مُفعَّل" },
    // "Add a word" (add.html) — say it, show it, share it. Added at the END so the
    // prompts tool's section.item numbers don't shift.
    "add.title":            { en:"Add a word",          ar:"أضِف كلمة" },
    "add.step.say":         { en:"Say it",              ar:"قُلها" },
    "add.step.show":        { en:"Show it",             ar:"أَرِها" },
    "add.step.share":       { en:"Share it",            ar:"شارِكها" },
    "add.say.hint":         { en:"Hold the button and say your word twice, with a short pause between.", ar:"اضغط باستمرار على الزر وقل كلمتك مرّتين، مع وقفة قصيرة بينهما." },
    "add.say.short":        { en:"Keep holding while you speak", ar:"استمرّ بالضغط وأنت تتكلّم" },
    "add.say.again":        { en:"Say it again",        ar:"قُلها مرّة أخرى" },
    "add.next":             { en:"Next",                ar:"التالي" },
    "add.back":             { en:"Back",                ar:"رجوع" },
    "add.show.hint":        { en:"Help people know what your word means. Choose any — or skip.", ar:"ساعد الناس على معرفة معنى كلمتك. اختر ما تشاء — أو تخطَّ." },
    "add.show.photo":       { en:"Take a photo",        ar:"التقط صورة" },
    "add.show.photo.note":  { en:"Photos of things and places — not of people.", ar:"صوِّر الأشياء والأماكن — لا الأشخاص." },
    "add.show.emoji":       { en:"Choose a picture",    ar:"اختر رسمًا" },
    "add.show.emoji.type":  { en:"Or type any emoji",   ar:"أو اكتب أيّ رمز تعبيري" },
    "add.show.meaning":     { en:"Say what it means",   ar:"قُل ماذا تعني" },
    "add.show.meaning.hint":{ en:"Hold and explain the word, in Hakli or Arabic.", ar:"اضغط باستمرار واشرح الكلمة بالحَكلي أو بالعربية." },
    "add.show.write":       { en:"Write it in Arabic",  ar:"اكتبها بالعربية" },
    "add.show.remove":      { en:"Remove",              ar:"إزالة" },
    "add.skip":             { en:"Skip",                ar:"تخطَّ" },
    "add.share.hint":       { en:"Your word goes into the Hakli dictionary.", ar:"تُضاف كلمتك إلى قاموس الحَكلي." },
    "add.share.who":        { en:"This is your own voice. Recording someone else? Use the full recorder.", ar:"هذا صوتك أنت. تسجّل صوت شخصٍ آخر؟ استخدم المسجّل الكامل." },
    "add.share.signin":     { en:"Sign in once, so your word is yours — you can hide it any time.", ar:"سجّل الدخول مرّة واحدة لتبقى كلمتك لك — يمكنك إخفاؤها في أيّ وقت." },
    "add.share.go":         { en:"Share my word",       ar:"شارِك كلمتي" },
    "add.share.saving":     { en:"Sharing…",            ar:"جارٍ المشاركة…" },
    "add.share.err":        { en:"Couldn't share just now. Your word is safe on this phone — try again when you have signal.", ar:"تعذّرت المشاركة الآن. كلمتك محفوظة على هذا الهاتف — حاول مجددًا عند توفّر الشبكة." },
    "add.done.title":       { en:"Thank you!",          ar:"شكرًا لك!" },
    "add.done.public":      { en:"Your word is in the dictionary.", ar:"كلمتك الآن في القاموس." },
    "add.done.private":     { en:"Your word is in the dictionary. Only you can hear your voice until you let others listen.", ar:"كلمتك الآن في القاموس. أنت وحدك تسمع صوتك حتى تسمح للآخرين بالاستماع." },
    "add.done.another":     { en:"Add another word",    ar:"أضِف كلمة أخرى" },
    "add.done.see":         { en:"See it in the dictionary", ar:"شاهِدها في القاموس" },
    "add.done.invite":      { en:"Invite a friend",     ar:"ادعُ صديقًا" },
    "add.invite.text":      { en:"Let's strengthen Hakli together — add a word in your own voice:", ar:"لِنُقوِّ الحَكلي معًا — أضِف كلمةً بصوتك:" },
    "add.draft":            { en:"You have a word waiting to be shared.", ar:"لديك كلمة تنتظر المشاركة." },
    "add.draft.discard":    { en:"Start a new word instead", ar:"ابدأ كلمة جديدة بدلًا منها" },
    "add.say.silent":       { en:"We couldn't hear you — try again, a little closer to the phone.", ar:"لم نسمعك — حاول مجددًا واقترب قليلًا من الهاتف." },
    "add.say.loud":         { en:"Too loud — the sound broke up. Try again a little further away.", ar:"الصوت مرتفع جدًّا وتشوّه. حاول مجددًا وابتعد قليلًا." },
    "add.auth.phone":       { en:"or use your phone number — we'll text you a code", ar:"أو استخدم رقم هاتفك — نرسل لك رمزًا برسالة" },
    "add.auth.phone.send":  { en:"Text me a code", ar:"أرسل لي رمزًا" },
    "add.auth.code":        { en:"Type the 6-digit code from the text message", ar:"اكتب الرمز المكوّن من ٦ أرقام من الرسالة" },
    "add.auth.code.go":     { en:"Sign in", ar:"دخول" },
    "add.auth.phone.bad":   { en:"Check the number — start with + and the country code, e.g. +968.", ar:"تحقّق من الرقم — ابدأ بـ + ورمز الدولة، مثل +968." },
    "add.auth.code.bad":    { en:"That code didn't work — check it, or send a new one.", ar:"لم ينجح الرمز — تحقّق منه أو اطلب رمزًا جديدًا." },
    "add.auth.region":      { en:"Texts can't be sent to that country yet — please use Google or email instead.", ar:"لا يمكن إرسال الرسائل إلى هذا البلد بعد — استخدم Google أو البريد الإلكتروني بدلًا من ذلك." },
    "add.auth.toomany":     { en:"Too many tries — please wait a little and try again.", ar:"محاولات كثيرة — انتظر قليلًا ثم حاول مجددًا." },
    "add.auth.link":        { en:"Email me a sign-in link (no password)", ar:"أرسل لي رابط الدخول بالبريد (بلا كلمة مرور)" },
    "add.auth.link.sent":   { en:"Check your email and open the link on this phone. If it opens in another browser, come back here afterwards — your word is saved in this one.", ar:"افتح بريدك واضغط الرابط على هذا الهاتف. إن فُتح في متصفّح آخر فارجع إلى هنا بعدها — كلمتك محفوظة في هذا المتصفّح." },
    "add.auth.link.email":  { en:"Which email did you send the link to?", ar:"إلى أيّ بريد أُرسل الرابط؟" },
    "add.share.browser":    { en:"Google sign-in didn't open? Use your phone number instead, or open this page in Chrome or Safari (tap ⋮ or the share icon, then “Open in browser”).", ar:"لم يُفتَح الدخول عبر Google؟ استخدم رقم هاتفك بدلًا منه، أو افتح هذه الصفحة في Chrome أو Safari (اضغط ⋮ أو أيقونة المشاركة ثم «فتح في المتصفّح»)." },
    "add.acct.out":         { en:"Not signed in yet — you'll sign in at the end, when you share your word.", ar:"لم تسجّل الدخول بعد — ستسجّل الدخول في النهاية عند مشاركة كلمتك." },
    "add.acct.signout":     { en:"Sign out?", ar:"تسجيل الخروج؟" },
    "add.share.as":         { en:"Signed in as", ar:"مسجَّل الدخول باسم" },
    "add.share.notyou":     { en:"Not you?", ar:"لست أنت؟" },
    "add.share.hidden":     { en:"Your voice is hidden right now (you withdrew it earlier). Ticking this shares your recordings again.", ar:"صوتك مخفيّ الآن (سحبته سابقًا). اختيار هذا يعيد نشر تسجيلاتك." },
    "add.share.reopen":     { en:"Your voice was hidden earlier. Let people hear all your recordings again?", ar:"أخفيتَ صوتك سابقًا. هل تسمح للناس بسماع كل تسجيلاتك مجددًا؟" },
    "add.share.failed":     { en:"Couldn't share. Your word is safe on this phone. If it keeps happening, send a screenshot of this to whoever sent you the link.", ar:"تعذّرت المشاركة. كلمتك محفوظة على هذا الهاتف. إن تكرّر ذلك، أرسل لقطة شاشة لهذه الرسالة إلى من أرسل لك الرابط." },
    // Under an open dictionary card: tags + "remove my word" (afd-card.js wordTools)
    "card.tags":            { en:"Tags", ar:"وسوم" },
    "card.tags.hint":       { en:"Labels such as a dialect, Mehri, or loanword — separate with commas.", ar:"وسوم مثل اللهجة أو المهري أو كلمة دخيلة — افصل بينها بفواصل." },
    "card.tags.save":       { en:"Save tags", ar:"احفظ الوسوم" },
    "card.remove":          { en:"Remove my word", ar:"احذف كلمتي" },
    "card.remove.confirm":  { en:"Remove this word? Your voices on it are erased for good, and the word leaves the dictionary.", ar:"حذف هذه الكلمة؟ تُمحى تسجيلاتك عليها نهائيًّا، وتخرج الكلمة من القاموس." },
    "card.remove.others":   { en:"Other people have recorded this word too, so it can't be removed from here. A tag can say what it is.", ar:"سجّل آخرون هذه الكلمة أيضًا، فلا يمكن حذفها من هنا. يمكن لوسمٍ أن يوضّح ما هي." },
    "card.removed":         { en:"Word removed.", ar:"حُذفت الكلمة." },
    "card.removed.gone":    { en:"This word was removed.", ar:"حُذفت هذه الكلمة." },
    "card.share":           { en:"Share this word", ar:"شارك هذه الكلمة" },
    "card.share.link":      { en:"🔗 Now send the link too", ar:"🔗 والآن أرسل الرابط أيضًا" },
    "card.share.heard":     { en:"Listen to “{w}” in Hakli — and say it your way:", ar:"استمع إلى «{w}» بالحكلي — وقلها بطريقتك:" },
    "card.share.heard0":    { en:"Listen to this word in Hakli — and say it your way:", ar:"استمع إلى هذه الكلمة بالحكلي — وقلها بطريقتك:" },
    "card.share.unheard":   { en:"Nobody has said “{w}” in Hakli yet — be the first:", ar:"لم يقل أحدٌ «{w}» بالحكلي بعد — كن أوّل من يقولها:" },
    "needs.ask":            { en:"Ask someone for these words", ar:"اطلب هذه الكلمات من أحد" },
    "needs.ask.text":       { en:"Nobody has said these words in Hakli yet — can you say one?", ar:"لم يقل أحدٌ هذه الكلمات بالحكلي بعد — هل تقول واحدة منها؟" },
    "card.fb.others1":      { en:"Someone else has said this word too", ar:"قالها شخصٌ آخر أيضًا" },
    "card.fb.othersN":      { en:"{n} other people have said this word too", ar:"قالها {n} أشخاص آخرين أيضًا" },
    "card.fb.first":        { en:"You were the first to say this word — share it so others say it too", ar:"كنت أوّل من قالها — شاركها ليقولها غيرك" },
    "card.fb.new":          { en:"New voices since you last looked", ar:"أصوات جديدة منذ آخر مرة" },
    "import.btn":           { en:"Load a voice note instead", ar:"أو حمّل رسالة صوتية" },
    "import.loaded":        { en:"Voice note loaded — listen, then keep it", ar:"حُمّلت الرسالة الصوتية — استمع ثم احفظها" },
    "import.fail":          { en:"Couldn't read that file. In WhatsApp, share the voice note to this phone's Files, then load it from there.", ar:"تعذّرت قراءة الملف. في واتساب شارك الرسالة الصوتية إلى «الملفات» في هذا الهاتف ثم حمّلها من هناك." },
    "card.failed":          { en:"Couldn't do that just now — please try again.", ar:"تعذّر ذلك الآن — يرجى المحاولة مجددًا." },
    // the word slot's own "+ add" (added 10-14, kept last so review numbers hold)
    "slot.add.word":        { en:"Add a recording",    ar:"أضف تسجيلًا" },
    // edit a word's text and emoji (word tools; added 10-14)
    "card.edit":            { en:"Edit word",          ar:"عدّل الكلمة" },
    "card.edit.en":         { en:"English",            ar:"الإنجليزية" },
    "card.edit.ar":         { en:"Arabic",             ar:"العربية" },
    "card.edit.pic":        { en:"Emoji",              ar:"رمز تعبيري" },
    "card.edit.photo":      { en:"This word has a photo, which shows instead of the emoji.", ar:"لهذه الكلمة صورة، وهي تظهر بدل الرمز التعبيري." },
    "card.edit.save":       { en:"Save",               ar:"احفظ" },
    // Speak-to-find (index.html) — what a slow or failed search says. One line per
    // KIND of failure, so the person (and a screenshot) can tell them apart.
    // Added at the END so the prompts tool's section.item numbers don't shift.
    "find.waking":          { en:"Still looking — the first search can take a minute", ar:"ما زلت أبحث — قد يستغرق أوّل بحث دقيقة" },
    "find.retrying":        { en:"Trying once more…", ar:"أحاول مرة أخرى…" },
    "find.err.offline":     { en:"No internet connection — try again when you're online", ar:"لا يوجد اتصال بالإنترنت — حاول عند توفّر الاتصال" },
    "find.err.network":     { en:"Couldn't reach the matcher — check your connection and try again", ar:"تعذّر الوصول إلى البحث — تحقّق من الاتصال وحاول مرة أخرى" },
    "find.err.timeout":     { en:"The matcher took too long to answer — try again", ar:"تأخّر البحث في الردّ — حاول مرة أخرى" },
    "find.err.server":      { en:"The matcher is having trouble — try again in a minute", ar:"في البحث مشكلة — حاول بعد دقيقة" },
    "find.err.audio":       { en:"Couldn't make out that recording — hold and speak again", ar:"لم أتمكّن من سماع التسجيل — اضغط وتكلّم مرة أخرى" },
    "find.err.toolong":     { en:"That was too long — say just the word", ar:"التسجيل طويل — قل الكلمة فقط" },
    "find.missing":         { en:"That word isn't in the dictionary", ar:"هذه الكلمة ليست في القاموس" },
    // The dictionary page's own words (index.html). They were written into the
    // page itself, so the prompts tool could not list them for speaker review;
    // the wording is unchanged, only where it lives. Added at the END.
    "find.idle":            { en:"Hold and speak", ar:"تكلّم" },
    "find.listening":       { en:"Listening…", ar:"أستمع…" },
    "find.finding":         { en:"Finding…", ar:"أبحث…" },
    "find.short":           { en:"Hold a little longer, then speak", ar:"تكلّم أطول قليلاً" },
    "find.mic":             { en:"Let the app use the microphone", ar:"اسمح باستخدام الميكروفون" },
    "find.none":            { en:"Not in the dictionary yet", ar:"ليست في القاموس بعد — أضِفها" },
    "view.all":             { en:"All words", ar:"كل الكلمات" },
    "view.needs":           { en:"Needs a voice", ar:"يحتاج صوتًا" },
    "view.newest":          { en:"Newest", ar:"الأحدث" },
    "view.record":          { en:"Record a word", ar:"سجِّل كلمة" },
    "mast.find":            { en:"speak to find", ar:"قُل لتجد" },
    "mast.dictionary":      { en:"dictionary", ar:"القاموس" },
    // 404.html — the page for an address that doesn't exist
    "notfound.title":       { en:"This page isn't here", ar:"هذه الصفحة غير موجودة" },
    "notfound.open":        { en:"Open the dictionary", ar:"ادخل القاموس" },
    // Recorder step 3 — the lines that were written into recorder.html, so the
    // prompts tool could not list them. Wording unchanged. In the three
    // instructions, *stars* mark the one emphasised word (shown bold); drop
    // them and the line simply has no bold. Added at the END.
    "record.instr.word":       { en:"Say the Hakli word *twice*, with a short pause between.", ar:"قل الكلمة الحكلية *مرّتين*، مع وقفة قصيرة بينهما." },
    "record.instr.context":    { en:"Say a short *sentence* using this word — one time.", ar:"قل *جملة* قصيرة تستخدم هذه الكلمة — مرّة واحدة." },
    "record.instr.definition": { en:"Say what this word *means*, in Hakli — one time.", ar:"قل ما *تعنيه* هذه الكلمة، بالحكلية — مرّة واحدة." },
    "record.progress.word":      { en:"WORD {i} OF {n}", ar:"الكلمة {i} من {n}" },
    "record.progress.listening": { en:"LISTENING", ar:"استماع" },
    // View menu: the jump to add.html. A "word card" (بطاقة كلمة) is a word's
    // card — one card, many voices — so "Add a word card" (a NEW card) reads apart
    // from "Record a word" (a voice on a card that exists) right below it.
    // Arabic is an MSA draft.
    "view.add":             { en:"Add a word card", ar:"أضِف بطاقة كلمة" },
    // welcome.html — the introduction you hand out. Its numbered lines are the
    // spoken intro.tour.* prompts (prompts tool section 1); pull-suggestions.mjs
    // copies an approved edit of those into welcome.html too. These are the
    // page's other words. The arrows on the enter buttons are added in code.
    "welcome.hint.none":    { en:"This introduction will be narrated in Hakli once its people record it — until then, here is the text in Arabic.", ar:"ستُروى هذه المقدمة بالحَكلي حين يسجّلها أهلها — وحتى ذلك الحين، إليك النصّ بالعربية." },
    "welcome.hint.some":    { en:"Press play to hear each line in Hakli.", ar:"اضغط زرّ التشغيل لتسمع كل سطرٍ بالحَكلي." },
    "welcome.listen":       { en:"Listen", ar:"استمع" },
    "welcome.stop":         { en:"Stop", ar:"إيقاف" },
    "welcome.demo":         { en:"See how it works", ar:"شاهد كيف يعمل" },
    "welcome.enter":        { en:"Enter the dictionary", ar:"ادخل القاموس" },
    // hakli-welcome-walkthrough.html — the captions under the animated phone, in
    // scene order. (The words INSIDE the phone are the app's own strings, so they
    // change with the app.) Keep them short: one or two lines under the phone.
    "wt.find.1":            { en:"To find a word, hold the green circle and speak.", ar:"للعثور على كلمة، اضغط الدائرة الخضراء وتكلّم." },
    "wt.find.2":            { en:"Hold it, and say the word.", ar:"اضغط، وانطق الكلمة." },
    "wt.find.3":            { en:"Lift your finger — Hakli listens and finds it.", ar:"ارفع إصبعك — يستمع الحَكلي ويجدها." },
    "wt.find.4":            { en:"The word you said, ready to hear.", ar:"الكلمة التي قلتها، جاهزةٌ لتُسمَع." },
    "wt.record.1":          { en:"To add your voice, hold the amber button.", ar:"لتضيف صوتك، اضغط الزرّ الكهرماني." },
    "wt.record.2":          { en:"Say the word twice.", ar:"انطق الكلمة مرّتين." },
    "wt.review.1":          { en:"Hear it back — keep it, or record again.", ar:"استمع إليه — احفظه، أو أعد." },
    "wt.review.2":          { en:"Clear? Keep it.", ar:"واضح؟ احفظه." },
    "wt.review.3":          { en:"Keep it — your voice joins the word.", ar:"احفظه — فينضمّ صوتك إلى الكلمة." },
    "wt.kept":              { en:"Kept.", ar:"حُفِظ." },
    "wt.sentence.1":        { en:"You can also say it inside a sentence.", ar:"ويمكنك أن تنطقها داخل جملة." },
    "wt.sentence.tap":      { en:"Tap “Add a sentence” on the word’s card.", ar:"انقر «أضف جملة» على بطاقة الكلمة." },
    "wt.sentence.say":      { en:"Say a sentence using the word.", ar:"انطق جملةً تستعمل فيها الكلمة." },
    "wt.hearkeep":          { en:"Hear it — keep it.", ar:"استمع — احفظه." },
    "wt.sentence.kept":     { en:"Sentence kept.", ar:"حُفِظت الجملة." },
    "wt.meaning.1":         { en:"And say what it means — in Hakli.", ar:"وأن تقول معناها — بالحَكلي." },
    "wt.meaning.tap":       { en:"Tap “Add a meaning” on the card.", ar:"انقر «أضف معنى» على البطاقة." },
    "wt.meaning.say":       { en:"Say what the word means.", ar:"قل ما تعنيه الكلمة." },
    "wt.meaning.kept":      { en:"Meaning kept.", ar:"حُفِظ المعنى." },
    "wt.add.1":             { en:"Not in the dictionary yet? Add it, in your own voice.", ar:"ليست في القاموس بعد؟ أضِفها بصوتك." },
    "wt.add.tap":           { en:"Tap + beside the green circle.", ar:"انقر + بجانب الدائرة الخضراء." },
    "wt.add.say":           { en:"Say your new word twice.", ar:"قُل كلمتك الجديدة مرّتين." },
    "wt.add.show":          { en:"Show what it means — a photo, a picture, or say it.", ar:"أَرِ معناها — بصورة، أو رسم، أو قُلها." },
    "wt.add.share":         { en:"Share it — the word stays yours.", ar:"شارِكها — وتبقى الكلمة لك." },
    "wt.add.done":          { en:"A new word card, in your voice.", ar:"بطاقة كلمة جديدة، بصوتك." },
    "wt.close":             { en:"Find it. Hear it. Add your voice.", ar:"ابحث عنها. اسمعها. أضِف صوتك." },   // 10-15 welcome v2 (was "That is how you add your voice to Hakli.")
    "wt.find.hear":         { en:"Tap ▶ to hear how people say it.", ar:"انقر ▶ لتسمع كيف يقولها الناس." },
    "wt.card.say":          { en:"Tap “+ Add a recording” on the card.", ar:"انقر «+ أضف تسجيلًا» على البطاقة." },   // (10-16) was "Say it yourself", a button the card no longer has
    // the how-to page (howto.html, 10-15): one job per clip
    "wt.howto.title":       { en:"How to use it", ar:"كيف تستعمله" },
    "wt.howto.lead":        { en:"Short clips, one job each. Tap one to watch it.", ar:"مقاطع قصيرة، لكلّ عملٍ مقطع. انقر واحدًا لتشاهده." },
    "wt.howto.find":        { en:"Find a word", ar:"ابحث عن كلمة" },
    "wt.howto.hear":        { en:"Hear the voices", ar:"اسمع الأصوات" },
    "wt.howto.record":      { en:"Add your voice", ar:"أضِف صوتك" },
    "wt.howto.sentence":    { en:"Say it in a sentence", ar:"قُلها في جملة" },
    "wt.howto.meaning":     { en:"Say what it means", ar:"قُل معناها" },
    "wt.howto.add":         { en:"Add a new word", ar:"أضِف كلمة جديدة" },
    "wt.howto.link":        { en:"More short how-to clips", ar:"مقاطع قصيرة: كيف تستعمله" },
    "wt.howto.voiced":      { en:"In Hakli", ar:"بالحَكلي" },

    // Moved in from page code (piece 4 audit, Oct 2026): text that used to be
    // written in English inside index / add / recorder / afd-card, so it showed
    // in English even in the Arabic and sound modes. Arabic is provisional, as
    // everywhere here: flagged for Dhofari review on the prompts tool's list.
    // recorder — the coaching line after a take
    "qc.fail.lowrate":      { en:"This device recorded at too low a quality — try another mic", ar:"سجّل هذا الجهاز بجودةٍ منخفضة جدًّا — جرّب ميكروفونًا آخر" },
    "qc.fail.short.word":   { en:"That was very short — hold and say it twice", ar:"كان التسجيل قصيرًا جدًّا — اضغط باستمرار وقل الكلمة مرّتين" },
    "qc.fail.short":        { en:"That was very short — hold a little longer", ar:"كان التسجيل قصيرًا جدًّا — اضغط مدّةً أطول قليلًا" },
    "qc.fail.loud":         { en:"A bit too loud — hold the phone a little further away", ar:"الصوت مرتفعٌ قليلًا — أبعِد الهاتف قليلًا" },
    "qc.fail.quiet":        { en:"Mostly quiet — speak a little louder, closer to the mic", ar:"التسجيل هادئٌ في معظمه — تكلّم بصوتٍ أعلى قليلًا وأقرب إلى الميكروفون" },
    "qc.note.long":         { en:"A little long — fine to keep", ar:"طويلٌ قليلًا — لا بأس بحفظه" },
    "qc.note.extra":        { en:"Heard more than twice — extra speech was detected", ar:"سُمِع أكثر من مرّتين — رُصِد كلامٌ إضافي" },
    "qc.note.differ":       { en:"The two takes differ a little — fine to keep", ar:"المرّتان مختلفتان قليلًا — لا بأس بحفظه" },
    // dictionary list
    "list.allvoiced":       { en:"Every word here has a voice — nothing needs recording.", ar:"كل الكلمات هنا لها صوت." },
    "list.empty":           { en:"No words yet.", ar:"لا كلمات بعد." },
    "list.back":            { en:"Back to the list — {w}", ar:"العودة إلى القائمة — {w}" },
    // account button (dictionary, recorder)
    "acct.signedin.as":     { en:"Signed in as {who} — account menu", ar:"مسجَّل الدخول باسم {who} — قائمة الحساب" },
    "acct.menu":            { en:"Account menu", ar:"قائمة الحساب" },
    "acct.signin.manage":   { en:"Sign in to manage your voice", ar:"سجّل الدخول لإدارة صوتك" },
    // a voice on a word card (screen-reader labels and the failure banner)
    "voice.play":           { en:"Play this voice", ar:"شغّل هذا الصوت" },
    "voice.play.name":      { en:"Play {name}", ar:"شغّل صوت {name}" },
    "voice.withdraw.label": { en:"Withdraw your voice", ar:"اسحب صوتك" },
    "voice.restore.label":  { en:"Restore your voice", ar:"استرجع صوتك" },
    "voice.erase.label":    { en:"Erase this recording", ar:"احذف هذا التسجيل" },
    "voice.change.failed":  { en:"Couldn't change that just now — try again", ar:"تعذّر التغيير الآن — حاول مجددًا" },
    // a voice its owner shares for the first time (card voice row; added 10-14, kept last so review numbers hold)
    "voice.share":          { en:"Let others listen",  ar:"اسمح للآخرين بالاستماع" },
    "voice.private":        { en:"Only you can hear this", ar:"أنت فقط تسمع هذا" },
    "voice.share.label":    { en:"Let other people listen to your voice", ar:"اسمح للآخرين بالاستماع إلى صوتك" },
    // sign-in errors (recorder, add a word)
    "auth.err.domain":      { en:"This web address isn't authorised in Firebase yet. Add it under Authentication → Settings → Authorized domains.", ar:"هذا العنوان غير مُصرَّح به في Firebase بعد. أضِفه من Authentication ← Settings ← Authorized domains." },
    "auth.err.method":      { en:"That sign-in method isn't enabled for this project.", ar:"طريقة الدخول هذه غير مفعّلة لهذا المشروع." },
    "auth.err.badpass":     { en:"Email or password not recognised.", ar:"البريد الإلكتروني أو كلمة المرور غير صحيحة." },
    "auth.err.exists":      { en:"That email already has an account — sign in instead.", ar:"لهذا البريد حسابٌ من قبل — سجّل الدخول بدلًا من ذلك." },
    "auth.err.weak":        { en:"Password needs at least 6 characters.", ar:"يجب أن تتكوّن كلمة المرور من ٦ أحرف على الأقل." },
    "auth.err.popup":       { en:"The sign-in popup was blocked. Allow popups and try again.", ar:"حُجِبت نافذة تسجيل الدخول. اسمح بالنوافذ المنبثقة وحاول مجددًا." },
    "auth.err.other":       { en:"Sign-in failed.", ar:"تعذّر تسجيل الدخول." },
    // "How you appear" (recorder step 1)
    "profile.err.image":    { en:"Couldn't read that image — try another.", ar:"تعذّرت قراءة هذه الصورة — جرّب صورة أخرى." },
    "profile.err.name":     { en:"Add a name, or choose Obscure.", ar:"أضِف اسمًا، أو اختر «مستتر»." },
    "profile.saving":       { en:"Saving…", ar:"جارٍ الحفظ…" },
    "profile.saved.known":  { en:"Saved — you appear by name on your own voices.", ar:"تمّ الحفظ — يظهر اسمك على تسجيلاتك أنت." },
    "profile.saved.obscure":{ en:"Saved — you appear as a nature avatar.", ar:"تمّ الحفظ — تظهر برمزٍ من الطبيعة." },
    "profile.err.save":     { en:"Couldn't save — check your connection and try again.", ar:"تعذّر الحفظ — تحقّق من الاتصال وحاول مجددًا." },

    // The display switch names the mode you're in (its caption on the
    // dictionary, add and recorder pages). Short: it sits under a 40px icon.
    "disp.auto":            { en:"Arabic · English", ar:"عربي · EN" },
    "disp.script":          { en:"Arabic",           ar:"عربي" },
    "disp.sound":           { en:"Sound",            ar:"صوت" },

    // Steward tool pages (steward.html, prompts/admin.html), via afd-tools.js.
    // *x* is bold, `x` is code. Commands and file names stay as they are.
    "tools.mode.both":      { en:"Arabic · English", ar:"عربي · English" },
    "tools.mode.ar":        { en:"Arabic", ar:"عربي" },
    "tools.switch.toar":    { en:"Show Arabic only", ar:"اعرض العربية فقط" },
    "tools.switch.toboth":  { en:"Show Arabic and English", ar:"اعرض العربية والإنجليزية" },
    "tools.nav.dictionary": { en:"Dictionary", ar:"القاموس" },
    "tools.nav.words":      { en:"Contributed words", ar:"الكلمات المُضافة" },
    "tools.nav.windows":    { en:"Prompt windows", ar:"نوافذ التسجيل" },
    "tools.nav.prompts":    { en:"Voice prompts", ar:"الإرشادات الصوتية" },
    "tools.signout":        { en:"sign out", ar:"خروج" },
    "tools.signedin":       { en:"signed in", ar:"مسجَّل الدخول" },
    "tools.signin.title":   { en:"Steward sign-in", ar:"دخول المشرف" },
    "tools.signin.hint":    { en:"Sign in with the steward account.", ar:"سجّل الدخول بحساب المشرف." },
    "tools.email":          { en:"email", ar:"البريد الإلكتروني" },
    "tools.password":       { en:"password", ar:"كلمة المرور" },
    "tools.signin":         { en:"Sign in", ar:"دخول" },
    "tools.signingin":      { en:"signing in…", ar:"جارٍ تسجيل الدخول…" },
    "tools.signin.failed":  { en:"Couldn't sign in ({code})", ar:"تعذّر تسجيل الدخول ({code})" },
    "tools.ownbrowser":     { en:"Use a separate browser for the steward pages (Firefox, or a second Chrome profile). Signing in here replaces your dictionary sign-in in this browser, so words you add afterwards would be credited to the steward.", ar:"استخدم متصفّحًا منفصلًا لصفحات المشرف (فايرفوكس، أو ملفًّا شخصيًّا ثانيًا في كروم). تسجيل الدخول هنا يحلّ محلّ دخولك إلى القاموس في هذا المتصفّح، فتُنسَب الكلمات التي تضيفها بعده إلى المشرف." },
    "tools.notsteward.dict":{ en:"You're signed in with your dictionary account{phone}, not the steward account. Sign in below with the steward email and password.", ar:"أنت مسجَّل الدخول بحساب القاموس{phone}، لا بحساب المشرف. سجّل الدخول أدناه ببريد المشرف وكلمة مروره." },
    "tools.notsteward.email":{ en:"This account isn't listed as the steward. If it should be, on the laptop: `node scripts/grant-steward.mjs {email}`", ar:"هذا الحساب غير مُدرَج مشرفًا. إن كان ينبغي ذلك، فعلى الحاسوب: `node scripts/grant-steward.mjs {email}`" },
    "tools.notallowed":     { en:"Not allowed — this account isn't listed as the steward. On the laptop: `node scripts/grant-steward.mjs <this email>`", ar:"غير مسموح — هذا الحساب غير مُدرَج مشرفًا. على الحاسوب: `node scripts/grant-steward.mjs <this email>`" },
    "tools.refresh":        { en:"refresh", ar:"تحديث" },
    "tools.loading":        { en:"loading…", ar:"جارٍ التحميل…" },
    "tools.saving":         { en:"saving…", ar:"جارٍ الحفظ…" },
    "tools.saved":          { en:"Saved.", ar:"تمّ الحفظ." },
    "tools.err.save":       { en:"Couldn't save ({code})", ar:"تعذّر الحفظ ({code})" },
    "tools.err.load":       { en:"Couldn't load ({code}).", ar:"تعذّر التحميل ({code})." },
    // steward.html — contributed words
    "stw.lead":             { en:"Words people add from the “add a word” page. Look, listen, and take down what shouldn't be there.", ar:"كلماتٌ يضيفها الناس من صفحة «أضِف كلمة». انظر واستمع، وأزِل ما لا ينبغي أن يكون هنا." },
    "stw.tab.review":       { en:"To review", ar:"للمراجعة" },
    "stw.tab.hidden":       { en:"Hidden", ar:"مخفيّة" },
    "stw.tab.all":          { en:"All", ar:"الكل" },
    "stw.empty.review":     { en:"Nothing new to review.", ar:"لا جديد للمراجعة." },
    "stw.empty.hidden":     { en:"No hidden words.", ar:"لا كلمات مخفيّة." },
    "stw.empty.all":        { en:"No contributed words yet.", ar:"لا كلمات مُضافة بعد." },
    "stw.nomeaning":        { en:"(no meaning written)", ar:"(لم يُكتَب معنى)" },
    "stw.badge.removed":    { en:"removed by its creator", ar:"أزالها مُنشئها" },
    "stw.badge.hidden":     { en:"hidden", ar:"مخفيّة" },
    "stw.badge.new":        { en:"new", ar:"جديدة" },
    "stw.badge.reviewed":   { en:"reviewed", ar:"رُوجِعت" },
    "stw.added":            { en:"added", ar:"أُضيفت" },
    "stw.by":               { en:"by", ar:"بواسطة" },
    "stw.open":             { en:"open", ar:"افتح" },
    "stw.voices":           { en:"▶ Voices", ar:"▶ الأصوات" },
    "stw.voices.none":      { en:"no public voices", ar:"لا أصوات عامّة" },
    "stw.voice.word":       { en:"word", ar:"الكلمة" },
    "stw.voice.context":    { en:"sentence", ar:"جملة" },
    "stw.voice.definition": { en:"meaning", ar:"المعنى" },
    "stw.err.play":         { en:"Couldn't play ({code})", ar:"تعذّر التشغيل ({code})" },
    "stw.err.voices":       { en:"Couldn't load voices ({code})", ar:"تعذّر تحميل الأصوات ({code})" },
    "stw.act.fine":         { en:"Looks fine", ar:"تبدو سليمة" },
    "stw.act.show":         { en:"Show again", ar:"أظهِرها مجددًا" },
    "stw.act.hide":         { en:"Hide word", ar:"أخفِ الكلمة" },
    "stw.act.photo":        { en:"Take down photo", ar:"أزِل الصورة" },
    "stw.act.emoji":        { en:"Remove emoji", ar:"أزِل الرمز التعبيري" },
    "stw.confirm.hide":     { en:"Hide this word from the dictionary, search and shared links? You can show it again later.", ar:"إخفاء هذه الكلمة من القاموس والبحث والروابط المُشارَكة؟ يمكنك إظهارها مجددًا لاحقًا." },
    "stw.confirm.photo":    { en:"Delete this photo for good? The word keeps its emoji (if any) or gets its pattern face.", ar:"حذف هذه الصورة نهائيًا؟ تحتفظ الكلمة برمزها التعبيري (إن وُجد) أو تأخذ وجهها الزخرفي." },
    "stw.note":             { en:"*Hide* takes a word out of the dictionary, search and shared links for everyone, and can be undone with *Show again*. *Take down photo* deletes the picture for good. Neither touches anyone's voice: withdrawing a voice stays the speaker's own choice. A word whose creator removed it is purged by the daily sweep once its voices are gone.", ar:"*الإخفاء* يُخرج الكلمة من القاموس والبحث والروابط المُشارَكة للجميع، ويمكن التراجع عنه بـ*أظهِرها مجددًا*. *أزِل الصورة* تحذف الصورة نهائيًا. لا يمسّ أيٌّ منهما صوتَ أحد: سحب الصوت يبقى قرار المتحدّث وحده. الكلمة التي أزالها مُنشئها تُحذَف في الكنس اليومي بعد زوال أصواتها." },
    // prompts/admin.html — prompt windows
    "win.lead":             { en:"Open or close the recording and Arabic-edit windows. Both close themselves when the time runs out — you don't have to come back.", ar:"افتح نافذتَي التسجيل وتعديل العربية أو أغلِقهما. تُغلَق كلتاهما من تلقاء نفسها حين ينتهي الوقت — لا حاجة للعودة." },
    "win.recording":        { en:"Recording", ar:"التسجيل" },
    "win.suggestions":      { en:"Arabic edits", ar:"تعديلات العربية" },
    "win.queue":            { en:"Edit suggestions", ar:"اقتراحات التعديل" },
    "win.open.30d":         { en:"Open 30 days", ar:"افتح ٣٠ يومًا" },
    "win.open.7d":          { en:"Open 7 days", ar:"افتح ٧ أيام" },
    "win.open.8h":          { en:"Open 24 hours", ar:"افتح ٢٤ ساعة" },   // key name historical (was 8 h) — kept so review numbers hold
    "win.open.2h":          { en:"Open 2 hours", ar:"افتح ساعتين" },
    "win.close":            { en:"Close now", ar:"أغلِق الآن" },
    "win.state.open":       { en:"*OPEN* {left} left · until {until}", ar:"*مفتوحة* — بقي {left} · حتى {until}" },
    "win.state.closed":     { en:"*CLOSED*", ar:"*مُغلَقة*" },
    "win.state.unknown":    { en:"*?* couldn't read state", ar:"*؟* تعذّرت قراءة الحالة" },
    "win.left.days":        { en:"{n} days", ar:"{n} يومًا" },
    "win.left.hm":          { en:"{h} h {m} min", ar:"{h} س {m} د" },
    "win.left.m":           { en:"{m} min", ar:"{m} د" },
    "win.opened.recording": { en:"Recording opened.", ar:"فُتِحت نافذة التسجيل." },
    "win.closed.recording": { en:"Recording closed.", ar:"أُغلِقت نافذة التسجيل." },
    "win.opened.suggestions":{ en:"Arabic edits opened.", ar:"فُتِحت نافذة تعديلات العربية." },
    "win.closed.suggestions":{ en:"Arabic edits closed.", ar:"أُغلِقت نافذة تعديلات العربية." },
    "win.queue.empty":      { en:"No suggestions yet.", ar:"لا اقتراحات بعد." },
    "win.queue.was":        { en:"was: {text}", ar:"كان: {text}" },
    "win.queue.notallowed": { en:"Not allowed — this account isn't listed as the steward (`scripts/grant-steward.mjs`).", ar:"غير مسموح — هذا الحساب غير مُدرَج مشرفًا (`scripts/grant-steward.mjs`)." },
    "win.queue.hint":       { en:"Proposals only — read them here. To apply the ones you want, run `node scripts/pull-suggestions.mjs` in `~/afd`: it asks apply / remove / skip for each and writes approved wording into the right file for you (spoken prompts → `prompts/index.html`; on-screen `screen:` keys → `afd-core.js`). Then `git diff` and *publish*. Nothing on this page changes the app by itself. Guide: prompts-and-suggestions-guide.md in the project files.", ar:"هذه اقتراحات فقط — اقرأها هنا. لتطبيق ما تريد منها، شغّل `node scripts/pull-suggestions.mjs` في `~/afd`: يسأل عن كلٍّ منها (تطبيق / حذف / تخطٍّ) ويكتب الصياغة المعتمَدة في الملف الصحيح (الإرشادات المنطوقة ← `prompts/index.html`؛ مفاتيح الشاشة `screen:` ← `afd-core.js`). ثم `git diff` و*النشر*. لا شيء في هذه الصفحة يغيّر التطبيق بنفسه. الدليل: prompts-and-suggestions-guide.md في ملفات المشروع." },
    "win.note":             { en:"Recording is closed unless it's open here. Arabic edits are proposals only — nothing a speaker types goes live until it's committed to the source. Neither window can freeze already-recorded audio; that's a separate one-time lock.", ar:"التسجيل مُغلَق ما لم يُفتَح هنا. تعديلات العربية اقتراحاتٌ فقط — لا يظهر شيءٌ يكتبه المتحدّث حتى يُعتمَد في المصدر. لا تستطيع أيٌّ من النافذتين تجميد الصوت المسجَّل من قبل؛ فذلك قفلٌ منفصل لمرّة واحدة." },

    // steward.html — Coverage tab (appended last so prompt numbers stay stable)
    "stw.tab.coverage":     { en:"Coverage", ar:"التغطية" },
    "stw.cov.list":         { en:"Word list", ar:"قائمة الكلمات" },
    "stw.cov.summary":      { en:"*{n} of {total}* concepts on this list have a word card.", ar:"*{n} من {total}* من مفاهيم هذه القائمة لها بطاقة كلمة." },
    "stw.cov.missing":      { en:"Not covered yet", ar:"لم تُغطَّ بعد" },
    "stw.cov.covered":      { en:"Covered", ar:"مُغطّاة" },
    "stw.cov.none":         { en:"Every concept on this list has a word card.", ar:"لكلّ مفهوم في هذه القائمة بطاقة كلمة." },
    "stw.cov.note":         { en:"Concepts from a standard comparison list that no word card links to yet — a guide to what to ask for next. Concept names are Concepticon's (English). Links are made with `node scripts/apply-concepts.mjs`; hidden and removed words don't count.", ar:"مفاهيم من قائمة مقارنة معيارية لا ترتبط بها أيّ بطاقة كلمة بعد — دليلٌ لما يُطلَب تسجيله لاحقًا. أسماء المفاهيم من Concepticon (بالإنجليزية). تُنشأ الروابط بـ`node scripts/apply-concepts.mjs`؛ ولا تُحتسَب الكلمات المخفيّة أو المُزالة." },
    // the emoji picker in Edit word (added 10-14, kept last so review numbers hold)
    "ep.suggested":         { en:"For this word",      ar:"لهذه الكلمة" },
    "ep.needed":            { en:"Not in the dictionary yet", ar:"ليست في القاموس بعد" },
    "ep.custom":            { en:"Dhofar",             ar:"ظفار" },
    "ep.none":              { en:"No emoji",           ar:"بلا رمز" },
    "ep.other":             { en:"or type one",        ar:"أو اكتب رمزًا" },
    // the recorder's "let other people listen" box applies to what's already uploaded too (added 10-16, kept last so review numbers hold)
    "share.confirm.self":   { en:"Also let other people listen to the recordings you've already uploaded?", ar:"هل تسمح أيضًا للآخرين بالاستماع إلى التسجيلات التي رفعتها من قبل؟" },
    "share.hide.self":      { en:"Also hide the recordings you've already uploaded? Nobody else will hear them until you tick this again.", ar:"هل تُخفي أيضًا التسجيلات التي رفعتها من قبل؟ لن يسمعها أحدٌ غيرك حتى تختار هذا مجددًا." },
    // Help (help.html, and "Help" in the dictionary menu and the account menus; added 10-16, kept last so review numbers hold)
    "help.menu":            { en:"Help", ar:"مساعدة" },
    "help.title":           { en:"Help", ar:"مساعدة" },
    "help.lead":            { en:"Short clips that show each step, and answers to what people ask most.", ar:"مقاطع قصيرة تُريك كلّ خطوة، وإجابات عن أكثر ما يسأل عنه الناس." },
    "help.clips":           { en:"How to…", ar:"كيف…" },
    "help.tour":            { en:"Watch the whole welcome tour", ar:"شاهد جولة الترحيب كاملة" },
    "help.voice.title":     { en:"Who can hear my voice?", ar:"من يسمع صوتي؟" },
    "help.voice.q1":        { en:"Who hears my recordings?", ar:"من يسمع تسجيلاتي؟" },
    "help.voice.a1":        { en:"Everyone who uses the dictionary, while “Let other people listen” is ticked — it is, unless you untick it. You can change it any time on step 1 of the recorder, for everything you've recorded.", ar:"كلّ من يستعمل القاموس، ما دام «السماح للآخرين بالاستماع» مختارًا — وهو كذلك ما لم تُلغِه. يمكنك تغييره متى شئت في الخطوة ١ من المسجّل، لكلّ ما سجّلته." },
    "help.voice.q2":        { en:"A voice says “Only you can hear this”", ar:"يظهر تحت صوتٍ «أنت فقط تسمع هذا»" },
    "help.voice.a2":        { en:"That recording is private. Tap “Let others listen” under it to share it.", ar:"هذا التسجيل خاص. انقر «اسمح للآخرين بالاستماع» تحته لتشاركه." },
    "help.voice.q3":        { en:"How do I take a recording back?", ar:"كيف أسحب تسجيلًا؟" },
    "help.voice.a3":        { en:"Open the word and tap “Withdraw” under your voice: nobody else hears it, and “Restore” brings it back. “Erase” removes it for good.", ar:"افتح الكلمة وانقر «اسحب» تحت صوتك: لن يسمعه أحدٌ غيرك، و«استرجع» يُعيده. أمّا «احذف» فيُزيله نهائيًا." },
    "help.voice.q4":        { en:"Will people see my name?", ar:"هل سيرى الناس اسمي؟" },
    "help.voice.a4":        { en:"Only if you choose. Your voice shows a nature picture, with no name. To show your name and photo on your own voices, use “Edit how you appear” in your account menu.", ar:"فقط إن اخترت ذلك. يظهر صوتك برمزٍ من الطبيعة دون اسم. لإظهار اسمك وصورتك على تسجيلاتك أنت، استعمل «تعديل كيف تظهر» في قائمة حسابك." },
    "help.contact.title":   { en:"Ask a person", ar:"اسأل شخصًا" },
    "help.contact.lead":    { en:"Stuck? Message {name} on WhatsApp — they speak Hakli.", ar:"هل تحتاج مساعدة؟ راسل {name} على واتساب — يتكلّم الحَكلي." },
    "help.contact.btn":     { en:"Message on WhatsApp", ar:"راسل على واتساب" },
    "help.contact.msg":     { en:"Hello, I need help with the Hakli dictionary.", ar:"مرحبًا، أحتاج مساعدة في قاموس الحَكلي." },

    // speaker origin visibility (recorder permission card; dictionary voices)
    "consent.origin":       { en:"Show my town to everyone who hears my voice", ar:"إظهار بلدتي لكلّ من يسمع صوتي" },
    "consent.origin.note":  { en:"Only the town — never the tribe, age or gender. Off unless the speaker chooses it.", ar:"البلدة فقط — لا القبيلة ولا العمر ولا الجنس. لا تُعرَض إلا إذا اختار المتحدّث ذلك." },

    // archiving needs the speaker's spoken consent (recorder permission card)
    "grant.archive.hint":   { en:"Keeping recordings in an archive needs the speaker's spoken consent — record it below before you continue.", ar:"حفظ التسجيلات في أرشيف يحتاج موافقة المتحدّث المنطوقة — سجّلها أدناه قبل المتابعة." },
    "grant.needed":         { en:"Record the speaker's spoken consent first — or untick the archive box.", ar:"سجّل موافقة المتحدّث المنطوقة أولًا — أو ألغِ تحديد خانة الأرشيف." },
    // Spellings: the word itself written in letters, any number per card, each
    // by whoever wrote it (afd-card.js spellingSection; add.html "show it").
    // Added at the END so the prompts tool's section.item numbers don't shift.
    "card.spell.label":     { en:"Written in Hakli",   ar:"مكتوبةً بالحَكلي" },
    "card.spell.add":       { en:"Write it in Hakli",  ar:"اكتبها بالحَكلي" },
    "card.spell.edit":      { en:"Change my spelling", ar:"عدّل كتابتي" },
    "card.spell.hint":      { en:"Write how the word sounds, in Arabic letters, your own way. There's no single right spelling.", ar:"اكتب الكلمة كما تُنطَق، بحروفٍ عربيّة وعلى طريقتك. لا توجد كتابةٌ واحدةٌ صحيحة." },
    "card.spell.save":      { en:"Save",               ar:"احفظ" },
    "card.spell.remove":    { en:"Remove my spelling", ar:"احذف كتابتي" },
    "card.spell.by":        { en:"written by {name}",  ar:"كتبها {name}" },
    "card.spell.mine":      { en:"your spelling",      ar:"كتابتك" },
    "card.spell.hide":      { en:"Hide",               ar:"أخفِ" },
    "card.spell.show":      { en:"Show again",         ar:"أظهِرها مجددًا" },
    "card.spell.hidden":    { en:"hidden",             ar:"مخفيّة" },
    "add.show.spell":       { en:"Write it in Hakli",  ar:"اكتبها بالحَكلي" },
    // Typed search (index.html): the ⌨ beside the mic opens a box that narrows
    // the list as you type, matching spellings, Arabic and English. Added at the
    // END so the prompts tool's section.item numbers don't shift.
    "find.type":            { en:"Type a word",        ar:"اكتب كلمة" },
    "find.type.cap":        { en:"Type",               ar:"اكتب" },
    "find.type.ph":         { en:"In Hakli, Arabic or English", ar:"بالحَكلي أو العربية أو الإنجليزية" },
    "find.type.close":      { en:"Close",              ar:"إغلاق" },
    "find.type.count":      { en:"Matches: {n}",       ar:"المطابقات: {n}" },
    "find.type.none":       { en:"No word matches — add it?", ar:"لا كلمة مطابقة — هل تضيفها؟" },
    // 10-16: the in-page question (AFDCore.ask) and the shared sign-in (afd-signin.js).
    // Added at the END so the review list's numbers don't move. The add.reopen.*
    // lines are consent wording: give them to the strongest reviewer (A5's).
    "add.reopen.sub":       { en:"Yes covers every recording you have made — not only this word. You can hide them again any time.", ar:"«نعم» تشمل كلّ تسجيلاتك — لا هذه الكلمة فقط. ويمكنك إخفاؤها مجددًا في أي وقت." },
    "add.reopen.yes":       { en:"Let people hear",    ar:"دع الناس يسمعون" },
    "add.reopen.no":        { en:"Keep hidden",        ar:"أبقِها مخفيّة" },
    "auth.close":           { en:"Close",              ar:"إغلاق" },
    "add.hear":             { en:"Hear it",            ar:"استمع" },
    // Google's required notice when the reCAPTCHA badge is hidden (afd-signin.js).
    // {privacy} and {terms} become links: keep both, as they are.
    "auth.recaptcha":       { en:"Protected by reCAPTCHA. Google's {privacy} and {terms} apply.", ar:"محميّ بخدمة reCAPTCHA، وتنطبق {privacy} و{terms} من Google." },
    // 10-16 (cont.): the last confirm() boxes on the speaker pages, moved to ask()
    "card.keep":            { en:"Keep the word",      ar:"أبقِ الكلمة" },
    "account.stay":         { en:"Stay signed in",     ar:"ابقَ مسجَّل الدخول" }
  };
  function t(key, mode){
    const s = STRINGS[key];
    if(!s) return key;                       // missing key shows itself → easy to spot
    if(mode === "sound"  && s.icon) return s.icon;
    if(mode === "script" || mode === "sound") return s.ar || s.en;
    return s.en;                             // auto
  }

  /* tf(key, mode, vars) — t() with {name} placeholders filled in. */
  function tf(key, mode, vars){
    return String(t(key, mode)).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars) ? String(vars[k]) : m);
  }

  /* authErrorKey(e) — the STRINGS key for a Firebase sign-in error, shared by
     every page that signs people in. null = say nothing (they closed the popup). */
  function authErrorKey(e){
    const c = (e && e.code) || "";
    if(c.includes("popup-closed") || c.includes("cancelled-popup")) return null;
    if(c.includes("unauthorized-domain"))   return "auth.err.domain";
    if(c.includes("operation-not-allowed")) return "auth.err.method";
    if(c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "auth.err.badpass";
    if(c.includes("email-already-in-use"))  return "auth.err.exists";
    if(c.includes("weak-password"))         return "auth.err.weak";
    if(c.includes("popup-blocked"))         return "auth.err.popup";
    return "auth.err.other";
  }

  /* tHTML(key, mode) — the HTML sibling of t(), for chrome that renders bilingually.
     Its whole reason to exist: in `auto` the label is Arabic-primary with a small
     English subtitle beneath it — the large Arabic is for the speaker in Oman, the
     small English line is for Marty and bilingual helpers. It emits the SAME markup
     the static onboarding/auth chrome already uses
        <span class="bi-ar" dir="rtl">…</span><small class="sub">…</small>
     so dynamically-painted chrome (record button, review card, next/skip, …) looks
     identical to the hand-written screens. `script` = Arabic only; `sound` = the
     icon if one is defined, else Arabic (same fallback as t(), Marty's call).
     Output lands in innerHTML, so every interpolated value is escaped. */
  function escHtml(x){
    return String(x).replace(/[&<>"]/g, c =>
      ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
  }
  function tHTML(key, mode){
    const s = STRINGS[key];
    if(!s) return escHtml(key);                       // missing key shows itself
    if(mode === "sound" && s.icon) return s.icon;
    if(mode === "sound")
      return s.ar ? `<span class="bi-ar" dir="rtl">${escHtml(s.ar)}</span>` : escHtml(s.en);
    if(mode === "script")
      return `<span class="bi-ar" dir="rtl">${escHtml(s.ar || s.en)}</span>`;
    // auto → Arabic primary + English subtitle
    if(!s.ar) return escHtml(s.en);                   // no Arabic yet → English alone
    let html = `<span class="bi-ar" dir="rtl">${escHtml(s.ar)}</span>`;
    if(s.en && s.en !== s.ar) html += `<small class="sub">${escHtml(s.en)}</small>`;
    return html;
  }

  /* ---- identicon — a stable, unique, abstract mark for an entry -------------
     Deterministic from the entryId: the same entry always gets the same "face"
     no matter who records it or how many times. This is the DEFAULT thumbnail so
     a brand-new recorded word has a visual identity with no human assigning a
     picture — essential for words with no emoji, and for any unwritten language.
     (Speaker identity uses the separate fauna avatars; this is WORD identity.)
     Left-right symmetric 5×5 blocks, one colour from a muted khareef palette. */
  const IDENTICON_PAL = ["#3E6B57","#2F5D63","#6B4A7A","#8B3A52","#9A5B33","#47568A","#6E7A3E","#A05A3C"];
  function identicon(seed){
    const s = String(seed || "");
    let h = 2166136261 >>> 0;                       // FNV-1a
    for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const fg = IDENTICON_PAL[(h >>> 28) % IDENTICON_PAL.length];
    let cells = "";
    for(let r=0;r<5;r++){
      for(let c=0;c<3;c++){
        if(!((h >> (r*3 + c)) & 1)) continue;
        cells += `<rect x="${c}" y="${r}" width="1" height="1"/>`;
        if(c < 2) cells += `<rect x="${4-c}" y="${r}" width="1" height="1"/>`;   // mirror
      }
    }
    return `<svg viewBox="0 0 5 5" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" `+
           `shape-rendering="crispEdges" style="background:#EFEAE3"><g fill="${fg}">${cells}</g></svg>`;
  }

  /* ---- in-page steps in the browser history ---------------------------------
     Steps inside one page (recorder 1 → 2 → 3, add say → show → share, search
     results over the list) were not in the browser history, so the phone's Back
     button left the page — from search results it left the app. Installed as an
     app there is no other back button. A page declares its steps here:

       const steps = AFDCore.stepHistory(step => …show that step…);
         // step is null for the page's first screen
       steps.push("show")   after the page itself moved FORWARD to a step
       steps.back(n)        after an in-page back control already moved the
                            screen back over n steps (keeps history in line)

     Back / Forward then call the handler. A step pushed before a reload belongs
     to a page that no longer exists (no microphone, no draft), so it is ignored
     rather than half-restored; steps.adopt() lets a page that CAN restore one
     claim it.

     A link that only changes the #hash is NOT a step, but the browser reports it
     the same way (a popstate with no state). The handler is not called for
     those — b1010b took one for "Back to the first screen", which threw the
     recorder to step 1 whenever "Add a sentence / Add a meaning" was tapped. */
  function stepHistory(onShow){
    const token = Math.random().toString(36).slice(2);
    let path = [], skip = 0, lastHash = location.hash;
    const mine = (s)=> !!(s && s.afdStep && s.afdT === token);
    window.addEventListener("popstate", (e)=>{
      const s = e.state, hashMoved = location.hash !== lastHash;
      lastHash = location.hash;
      if(s && s.afdStep && !mine(s)){ if(skip) skip--; return; }   // from before a reload — not ours
      path = mine(s) ? s.afdPath.slice() : [];
      if(skip){ skip--; return; }                                   // our own back(): the screen already moved
      if(!s && hashMoved) return;                                   // only the #hash changed — the page's hashchange handles it
      try{ onShow(mine(s) ? s.afdStep : null); }catch(err){ console.warn("[AFD] step", err); }
    });
    return {
      push(step, url){
        path.push(step);
        try{ history.pushState({ afdStep:step, afdT:token, afdPath:path.slice() }, "", url || undefined); }
        catch(_){ path.pop(); }
        lastHash = location.hash;
      },
      // The page changed the address itself (history.replaceState): note the
      // hash, so the next Back isn't mistaken for a hash-only move, or the reverse.
      sync(){ lastHash = location.hash; },
      back(n){
        n = Math.min(n == null ? 1 : n, path.length);
        if(n > 0){ skip++; path = path.slice(0, path.length - n); history.go(-n); }
      },
      // Claim the step this page was loaded on (after a reload, or coming Back
      // from another page) — only for a step the page can rebuild by itself.
      adopt(){
        const s = history.state;
        if(!(s && s.afdStep) || mine(s)) return null;
        path = [s.afdStep];
        try{ history.replaceState({ afdStep:s.afdStep, afdT:token, afdPath:path.slice() }, ""); }catch(_){ path = []; return null; }
        return s.afdStep;
      },
      depth(){ return path.length; },
      path(){ return path.slice(); },
      top(){ return path.length ? path[path.length-1] : null; }
    };
  }

  /* ---- spellings: the word itself, written in letters --------------------
     A word card can carry any number of spellings of the documented language,
     each by whoever wrote it, none of them canonical — the same footing as
     voices. Which script they are written in is the instance's business
     (AFDInstance.spelling); this code only handles text.

     spellingText(s) — what is stored: Unicode NFC, trimmed, inner whitespace
       collapsed, invisible joiners and tatweel dropped. The writer's letters
       and marks are otherwise kept exactly as written.
     spellingKey(s)  — what search compares: spellingText with the variation
       writers don't hear as a difference folded away — vowel marks, the alef
       family (أ إ آ ٱ → ا), ى/ی → ي, ک → ك, ة → ه, ؤ → و, ئ → ي, and a lone hamza
       ء. Letters that carry a real sound (ڛ, ڽ and the like) are left alone.
       Stored on each spelling at write time, so a search never recomputes it;
       change the folding and the stored keys need a backfill.
     spellingLang()  — the BCP 47 tag stamped on every spelling: the
       instance's language code plus its spelling script ("qhk-Arab"). */
  function spellingText(s){
    return String(s == null ? "" : s).normalize("NFC")
      .replace(/[​-‍⁠﻿ـ]/g, "")
      .replace(/\s+/g, " ").trim();
  }
  function spellingKey(s){
    return spellingText(s)
      .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, "")
      .replace(/[آأإٱ]/g, "ا")
      .replace(/[ىی]/g, "ي")
      .replace(/ک/g, "ك")
      .replace(/ة/g, "ه")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/ء/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ").trim();
  }
  function spellingLang(){
    const I = window.AFDInstance || {};
    const code = (I.language && I.language.code) || "und";
    const script = I.spelling && I.spelling.script;
    return script ? code + "-" + script : code;
  }
  function spellingDir(){
    const I = window.AFDInstance || {};
    return (I.spelling && I.spelling.dir) || "auto";
  }

  /* ---- field error log (10-16) ------------------------------------------------
     A failure on a phone in Dhofar was invisible unless someone sent a
     screenshot. report() records the few failures that matter (a search, a
     share, an upload) plus uncaught page errors, in afd_client_errors —
     create-only for everyone, readable only by stewards, deleted by TTL after
     30 days (scripts/client-errors.mjs lists them).
     What a record holds is deliberately thin: page, build, where, the error's
     code and a trimmed message (playback tokens and email addresses stripped),
     online or not, and the phone's OS family. No user agent, no uid, no words.
     Each page hands over its Firestore writer with errorSink(); anything
     reported before then waits. At most 8 records per page load, one per
     where+code, so a loop can't flood it. Never throws. */
  const BUILD = (function(){
    try{ const m = /[?&]v=([\w-]+)/.exec((document.currentScript && document.currentScript.src) || ""); return m ? m[1] : ""; }
    catch(_){ return ""; }
  })();
  const _errSeen = new Set(), _errWait = [];
  let _errSent = 0, _errSink = null;
  function _errClean(s){
    return String(s == null ? "" : s)
      .replace(/([?&]token=)[^&\s"']+/gi, "$1…")
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
      .slice(0, 300);
  }
  function _errSend(rec){ try{ Promise.resolve(_errSink(rec)).catch(()=>{}); }catch(_){} }
  function errorSink(fn){
    _errSink = typeof fn === "function" ? fn : null;
    if(_errSink) while(_errWait.length) _errSend(_errWait.shift());
  }
  function report(where, err){
    try{
      const code = String((err && (err.code || err.kind || err.name)) || "error").slice(0, 80);
      const key = where + "|" + code;
      if(_errSeen.has(key) || _errSent >= 8) return;
      _errSeen.add(key); _errSent++;
      const ua = navigator.userAgent || "";
      const rec = {
        page: (location.pathname.replace(/\/+$/, "/index.html").split("/").pop() || "index.html").slice(0, 40),
        where: String(where || "?").slice(0, 60),
        code,
        msg: _errClean(err && err.message ? err.message : (typeof err === "string" ? err : "")),
        build: BUILD.slice(0, 16),
        online: navigator.onLine !== false,
        os: /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "other"
      };
      if(_errSink) _errSend(rec); else if(_errWait.length < 8) _errWait.push(rec);
    }catch(_){}
  }
  // Uncaught errors from the app's own files, and promises nobody caught.
  try{
    window.addEventListener("error", (e)=>{
      if(!e || !e.filename || e.filename.indexOf(location.origin) !== 0) return;   // extensions, other sites
      report("uncaught", e.error || { name:"Error", message: e.message });
    });
    window.addEventListener("unhandledrejection", (e)=>{ report("unhandled", e && e.reason); });
  }catch(_){}

  /* ---- ask(): a yes/no question in the page, not the browser's box (10-16) --------
     confirm() shows "hakli.app says", OK / Cancel in the phone's own language,
     no picture and no voice — and some in-app browsers don't show it at all.
     For a non-reader that's a coin toss, and the first question moved here is
     a consent one (re-opening a withdrawn voice on Add).
       ask({ mode, titleKey, subKey, yesKey, noKey, face, audio, yesIcon, noIcon })
         → Promise<true | false>   (closing it — ✕, Escape, a tap outside — is false)
     mode     the page's display mode: auto = Arabic + small English, else Arabic
     face     HTML for the picture at the top (the speaker's avatar, the word…)
     audio    a URL (or a Promise of one) for the spoken question; it plays on
              open unless quiet mode is on (it's narration), and 🔈 replays it
     danger   the yes button in red (an act that can't be undone, e.g. erasing)
     noKey    leave it out for a notice with one button (yesKey), e.g. "Close"
     yesIcon / noIcon: open · closed · trash · signout · keep · none
     The YES button is never the default focus, so a stray Enter answers no. */
  const ASK_CSS = `
.afd-ask{position:fixed;inset:0;z-index:90;display:flex;align-items:flex-end;justify-content:center;
  background:rgba(23,36,31,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.afd-ask .ask-panel{position:relative;width:100%;max-width:460px;box-sizing:border-box;max-height:92vh;overflow:auto;
  background:var(--cloud,#fff);color:var(--ink,#17241F);border-radius:22px 22px 0 0;padding:22px 18px 20px;
  box-shadow:0 -10px 40px rgba(0,0,0,.18);text-align:center}
@media (min-width:600px){.afd-ask{align-items:center}.afd-ask .ask-panel{border-radius:22px}}
.afd-ask .ask-face{width:84px;height:84px;margin:4px auto 12px;border-radius:50%;overflow:hidden;
  display:flex;align-items:center;justify-content:center;font-size:44px}
.afd-ask .ask-face img{width:100%;height:100%;display:block;object-fit:cover}
.afd-ask .ask-face svg{width:62%;height:62%;display:block}
.afd-ask h2{margin:0;font-size:20px;line-height:1.45}
.afd-ask .ask-sub{margin:8px 0 0;font-size:15px;line-height:1.45;color:var(--ink-soft,#5B6E66)}
.afd-ask .sub{display:block;font-size:12px;font-weight:400;opacity:.72;margin-top:2px}
.afd-ask .ask-btns{display:flex;flex-direction:column;gap:10px;margin-top:20px}
.afd-ask .ask-btn{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:64px;
  padding:12px 16px;border-radius:18px;border:0;font:inherit;font-size:17px;font-weight:600;cursor:pointer;
  -webkit-tap-highlight-color:transparent;touch-action:manipulation}
.afd-ask .ask-btn svg{width:28px;height:28px;flex:0 0 auto}
.afd-ask .ask-yes{background:var(--mountain,#1F3A34);color:#fff}
.afd-ask .ask-yes.ask-danger{background:var(--danger,var(--alert,#9E4433))}
.afd-ask .ask-no{background:var(--cloud,#fff);color:var(--mountain,#1F3A34);box-shadow:inset 0 0 0 1.5px var(--mountain,#1F3A34)}
.afd-ask .ask-hear{position:absolute;top:10px;inset-inline-start:10px;width:44px;height:44px;border-radius:50%;border:0;
  background:transparent;color:var(--mountain,#1F3A34);cursor:pointer}
.afd-ask .ask-hear svg{width:24px;height:24px}
.afd-ask .ask-x{position:absolute;top:10px;inset-inline-end:10px;width:44px;height:44px;border-radius:50%;border:0;
  background:transparent;color:var(--ink-soft,#5B6E66);font-size:22px;cursor:pointer}`;
  const ASK_ICONS = {
    hear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="9" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M17 8.5a4 4 0 0 1 0 6M19.5 6a7.5 7.5 0 0 1 0 11"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    signout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    keep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    none: '',
    closed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
  };
  function askHTML(key, mode){
    const s = STRINGS[key]; if(!s) return escHtml(key);
    let h = `<span dir="rtl">${escHtml(s.ar || s.en)}</span>`;
    if(mode === "auto" && s.en && s.en !== s.ar) h += `<small class="sub">${escHtml(s.en)}</small>`;
    return h;
  }
  function ask(o){
    o = o || {};
    const mode = o.mode || getDisplayMode("auto");
    if(!document.getElementById("afd-ask-css")){
      const st = document.createElement("style"); st.id = "afd-ask-css"; st.textContent = ASK_CSS;
      document.head.appendChild(st);
    }
    return new Promise((resolve)=>{
      const prevFocus = document.activeElement;
      const w = document.createElement("div");
      w.className = "afd-ask"; w.setAttribute("role", "alertdialog"); w.setAttribute("aria-modal", "true");
      w.innerHTML = `<div class="ask-panel">
        <button class="ask-hear" type="button" hidden aria-label="${escHtml(t("add.hear", "auto"))}">${ASK_ICONS.hear}</button>
        <button class="ask-x" type="button" aria-label="${escHtml(t("auth.close", "auto"))}">✕</button>
        ${o.face ? `<div class="ask-face">${o.face}</div>` : ""}
        <h2 id="afdAskTitle">${askHTML(o.titleKey, mode)}</h2>
        ${o.subKey ? `<p class="ask-sub">${askHTML(o.subKey, mode)}</p>` : ""}
        <div class="ask-btns">
          <button class="ask-btn ask-yes${o.danger ? " ask-danger" : ""}" type="button">${ASK_ICONS[o.yesIcon || "open"] || ""}<span>${askHTML(o.yesKey, mode)}</span></button>
          ${o.noKey ? `<button class="ask-btn ask-no" type="button">${ASK_ICONS[o.noIcon || "closed"] || ""}<span>${askHTML(o.noKey, mode)}</span></button>` : ""}
        </div></div>`;
      w.setAttribute("aria-labelledby", "afdAskTitle");
      let done = false, _askAudio = null;
      const end = (v)=>{
        if(done) return; done = true;
        document.removeEventListener("keydown", onKey, true);
        try{ if(_askAudio){ _askAudio.pause(); } }catch(_){}
        w.remove();
        try{ prevFocus && prevFocus.focus && prevFocus.focus(); }catch(_){}
        resolve(v === true);
      };
      const onKey = (e)=>{ if(e.key === "Escape"){ e.stopPropagation(); end(false); } };
      document.addEventListener("keydown", onKey, true);
      w.addEventListener("click", (e)=>{ if(e.target === w) end(false); });
      w.querySelector(".ask-yes").onclick = ()=> end(true);
      if(o.noKey) w.querySelector(".ask-no").onclick = ()=> end(false);
      w.querySelector(".ask-x").onclick   = ()=> end(false);
      document.body.appendChild(w);
      (w.querySelector(".ask-no") || w.querySelector(".ask-x")).focus();   // a stray Enter answers no
      Promise.resolve(o.audio).then((url)=>{
        if(!url || done) return;
        const hear = w.querySelector(".ask-hear");
        hear.hidden = false;
        hear.onclick = ()=>{ _askAudio = playUI(url, "asked") || _askAudio; };
        _askAudio = playUI(url, "narration");
      }).catch(()=>{});
    });
  }

  return {
    ask,
    errorSink, report,
    spellingText, spellingKey, spellingLang, spellingDir,
    entrySlug, entryIdFor, mintEntryId,
    DISP_MODES, DISP_KEY, getDisplayMode, setDisplayMode,
    QUIET_KEY, getQuiet, setQuiet, onQuietChange, mayPlayUI, playUI, attachQuietToggle,
    MIC_CONSTRAINTS, openStream,
    STRINGS, t, tf, tHTML, authErrorKey,
    identicon, stepHistory, dotsHTML, escHtml
  };
})();
