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
    "roster.erased":        { en:"Erased",             ar:"محذوف" },
    "roster.restore.confirm": { en:"Make {spk}'s recordings public again?", ar:"إعادة نشر تسجيلات {spk}؟" },
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
    "account.signout.confirm": { en:"Sign out? You can sign back in anytime.", ar:"تسجيل الخروج؟ يمكنك الدخول مجددًا في أي وقت." }
  };
  function t(key, mode){
    const s = STRINGS[key];
    if(!s) return key;                       // missing key shows itself → easy to spot
    if(mode === "sound"  && s.icon) return s.icon;
    if(mode === "script" || mode === "sound") return s.ar || s.en;
    return s.en;                             // auto
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

  return {
    entrySlug, entryIdFor, mintEntryId,
    DISP_MODES, DISP_KEY, getDisplayMode, setDisplayMode,
    MIC_CONSTRAINTS, openStream,
    STRINGS, t, tHTML,
    identicon
  };
})();
