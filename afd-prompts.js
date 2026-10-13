/* ============================================================================
   afd-prompts.js — the instance's spoken prompts: what the app says, and what a
   speaker records so it can say it in Hakli.

   One copy, read by:
     • prompts/index.html  the prompt tool (record / review tabs, numbering)
     • welcome.html        shows the intro.tour.* lines as text beside their audio
     • scripts/pull-suggestions.mjs  writes approved Arabic edits back here
   Each item is one line: { key:"…", en:"…", ar:"…", kind:"…" } — keep it that
   way, the suggestion script edits `ar:` on the line that declares the key.

   This is instance content (Hakli's wording), like afd-words.js. A new
   language's dictionary starts from its own copy.

   Loaded as a plain classic script. Bump the ?v= on every page when it changes.
   ============================================================================ */
/* ==== RECORD tab · spoken prompts, numbered R1.1, R1.2 … in the order to record them ====
   Numbers were refreshed on 10-12 (nothing had been recorded): the welcome page's
   eleven clips come first, in the order they are heard, so the first session
   shows a result straight away; then what the app already plays; then the rest,
   which no page plays yet ("for later"). Retired 10-12 because no page used them:
   intro.welcome, intro.longpress, intro.hold_to_speak, intro.find.
   Keeping numbers stable from here: a new line goes at the END of its section,
   a new section at the END of its tab. Recordings and suggestions are keyed by
   `key`, never by number, so a renumbering loses nothing.
   NOTE: `ar` values are MSA drafts — PENDING DHOFARI REVIEW. Items whose gloss
   starts with [توجيه] are recorder DIRECTIVES, not literal UI copy. */
window.AFDPrompts = [
  { tab:"record", start:true, name:"Start here — the welcome page", ar:"ابدأ هنا — صفحة الترحيب",
    note:"The welcome page plays these, in this order. Record them and it speaks Hakli.", items:[
    { key:"intro.tour.what", en:"This is a place to hear the Hakli language — and to keep it, in the voices of its people.", ar:"هذا مكانٌ لسماع لغة الحَكلي، ولحفظها بأصوات أهلها.", kind:"narration" },
    { key:"intro.tour.new", en:"If a word isn't here yet, you can be the first to say it.", ar:"إن لم تكن الكلمة هنا بعد، فيمكنك أن تكون أوّل من يقولها.", kind:"narration" },
    { key:"howto.find", en:"To find a word: hold the green circle and say it", ar:"للعثور على كلمة: اضغط الدائرة الخضراء مطوّلًا وقُلها", kind:"narration" },
    { key:"howto.record", en:"To add your voice: hold the amber button and say the word twice", ar:"لإضافة صوتك: اضغط الزرّ الكهرماني مطوّلًا وقُل الكلمة مرّتين", kind:"narration" },
    { key:"howto.review", en:"Then listen back — keep it, or record again", ar:"ثم استمع إليه — احفظه، أو أعد التسجيل", kind:"narration" },
    { key:"howto.sentence", en:"You can also say the word inside a sentence", ar:"ويمكنك أن تقول الكلمة داخل جملة", kind:"narration" },
    { key:"howto.meaning", en:"And you can say what the word means, in Hakli", ar:"وأن تقول معنى الكلمة، بالحَكلي", kind:"narration" },
    { key:"howto.add", en:"And if a word isn't here yet, tap the plus and add it in your own voice", ar:"وإن لم تكن الكلمة هنا بعد، انقر + وأضِفها بصوتك", kind:"narration" },
    { key:"intro.tour.yours", en:"Every recording is yours — you can take it back anytime.", ar:"كل تسجيلٍ هو ملكك — ويمكنك سحبه في أي وقت.", kind:"narration" },
    { key:"intro.tour.waits", en:"Nothing is lost if you go offline — there is no rush.", ar:"لا يضيع شيء إن انقطع الاتصال — لا عجلة في الأمر.", kind:"narration" },
    { key:"intro.tour.why", en:"Your language, kept in your own voice, for those who come after you.", ar:"لغتُك، محفوظةً بصوتك، لمن يأتي بعدك.", kind:"narration" },
  ]},
  { tab:"record", name:"Heard in the app now", ar:"تُسمَع في التطبيق الآن",
    note:"The dictionary's home page and the Add-a-word page play these.", items:[
    { key:"find_hint", en:"Hold the green circle and say a word — it will find it", ar:"اضغط الدائرة الخضراء مطوّلًا وقل كلمة — وستجدها", kind:"narration" },
    { key:"add.say",          en:"Say your word: hold the button and say it twice, with a short pause", ar:"قُل كلمتك: اضغط باستمرار وقُلها مرّتين، مع وقفة قصيرة", kind:"narration" },
    { key:"add.show",         en:"Now show what it means — a photo, a picture, or say it", ar:"والآن أَرِنا معناها — بصورة، أو رسم، أو قُلها", kind:"narration" },
    { key:"add.show.photo",   en:"Take a photo", ar:"التقط صورة", kind:"label" },
    { key:"add.show.picture", en:"Choose a picture", ar:"اختر رسمًا", kind:"label" },
    { key:"add.show.meaning", en:"Say what it means", ar:"قُل ماذا تعني", kind:"label" },
    { key:"add.share",        en:"Share it: your word goes into the Hakli dictionary, and it stays yours", ar:"شارِكها: تُضاف كلمتك إلى قاموس الحَكلي، وتبقى لك", kind:"narration" },
    { key:"add.done",         en:"Thank you — your word is in the dictionary. Together we strengthen Hakli", ar:"شكرًا لك — كلمتك الآن في القاموس. معًا نُقوّي الحَكلي", kind:"narration" },
    { key:"add.another",      en:"Add another word", ar:"أضِف كلمة أخرى", kind:"label" },
  ]},
  { tab:"record", later:true, name:"Consent grant (most important)", ar:"إعطاء الإذن (الأهمّ)", items:[
    { key:"consent.explain", en:"What it means to let the world hear you — spoken plainly, before any yes", ar:"ماذا يعني أن تدع العالم يسمعك — بوضوحٍ، قبل أي موافقة", kind:"narration" },
    { key:"consent.blessing", en:"Keep your culture strong", ar:"حافظ على قوّة ثقافتك", kind:"label" },   // was "…alive"; re-record if an old take exists
    { key:"consent.truth.world", en:"Anyone, anywhere can hear you", ar:"يمكن لأي شخص، في أي مكان، أن يسمعك", kind:"label" },
    { key:"consent.truth.permanent", en:"It stays — even after today", ar:"يبقى — حتى بعد اليوم", kind:"label" },
    { key:"consent.truth.revocable", en:"You can take it back, anytime", ar:"يمكنك سحبه في أي وقت", kind:"label" },
    { key:"consent.give", en:"Hold, and say yes in your own voice", ar:"اضغط مطوّلًا، وقل «نعم» بصوتك", kind:"label" },
    { key:"consent.give.sub", en:"Your word, in your language", ar:"كلمتك، بلغتك", kind:"label" },
    { key:"consent.notnow", en:"Not now", ar:"ليس الآن", kind:"label" },
  ]},
  { tab:"record", later:true, name:"Your voice (consent control)", ar:"صوتك", items:[
    { key:"voice.title", en:"Your voice", ar:"صوتك", kind:"label" },
    { key:"voice.reassure", en:"These are yours — take any back anytime", ar:"هذه لك — يمكنك سحب أيٍّ منها في أي وقت", kind:"label" },
    { key:"voice.state.shared", en:"Shared", ar:"مُشارَك", kind:"label" },
    { key:"voice.state.takenback", en:"Taken back, kept safe", ar:"مسحوب، ومحفوظ بأمان", kind:"label" },
    { key:"voice.takeback", en:"Take back", ar:"اسحب", kind:"label" },
    { key:"voice.shareagain", en:"Share again", ar:"شارك مجددًا", kind:"label" },
    { key:"voice.bulk.words", en:"All my words", ar:"كل كلماتي", kind:"label" },
    { key:"voice.bulk.definitions", en:"All my definitions", ar:"كل تعريفاتي", kind:"label" },
    { key:"voice.bulk.everything", en:"Everything", ar:"كل شيء", kind:"label" },
    { key:"voice.mask", en:"Mask my avatar — be heard, not traceable", ar:"أخفِ رمزي — أن تُسمَع دون أن تُعرَف", kind:"label" },
    { key:"voice.bulk.confirm", en:"Take back all your words? You can share them again later", ar:"أتسحب كل كلماتك؟ يمكنك مشاركتها مجددًا لاحقًا", kind:"narration", tag:"may change" },
  ]},
  { tab:"record", later:true, name:"Home", ar:"الرئيسيّة", items:[
    { key:"home.speak", en:"Speak to find", ar:"تكلّم لتجد", kind:"label" },
    { key:"home.speak.hint", en:"Tap and say a word", ar:"انقر وانطق كلمة", kind:"label" },
    { key:"home.picture", en:"Look by picture", ar:"ابحث بالصورة", kind:"label" },
    { key:"home.addvoice", en:"Add your voice", ar:"أضِف صوتك", kind:"label" },
    { key:"home.recent", en:"Recently heard", ar:"سُمِع مؤخرًا", kind:"label" },
    { key:"home.momentum", en:"Frame words only: “words in the dictionary”, “voices sharing” (no numbers)", ar:"[توجيه] بصياغة كلماتية فقط: «كلمات في القاموس»، «أصوات تُشارك» (بلا أرقام)", kind:"label", tag:"count" },
  ]},
  { tab:"record", later:true, name:"Record", ar:"التسجيل", items:[
    { key:"record.prompt.image", en:"Say what you see, in Hakli", ar:"قل ما تراه، بالحَكلي", kind:"label" },
    { key:"record.hold", en:"Hold to speak", ar:"اضغط مطوّلًا لتتكلّم", kind:"label" },
    { key:"record.holding", en:"Keep holding", ar:"استمر بالضغط", kind:"label" },
    { key:"record.release", en:"Let go when you finish", ar:"اترك عند الانتهاء", kind:"label" },
  ]},
  { tab:"record", later:true, name:"Review & keep", ar:"الاستماع والحفظ", items:[
    { key:"review.yourtake", en:"Your take", ar:"تسجيلك", kind:"label" },
    { key:"review.clear", en:"Clear, good to keep", ar:"واضح، جيّد للحفظ", kind:"label" },
    { key:"review.check.loud", en:"Loud enough", ar:"بمستوى صوت كافٍ", kind:"label" },
    { key:"review.check.long", en:"Long enough", ar:"بطول كافٍ", kind:"label" },
    { key:"review.check.clip", en:"No clipping", ar:"بلا تشويه", kind:"label" },
    { key:"review.fail.quiet", en:"A bit quiet, try again", ar:"منخفض قليلًا، حاول مجددًا", kind:"label", tag:"may change" },
    { key:"review.fail.short", en:"A bit short, try again", ar:"قصير قليلًا، حاول مجددًا", kind:"label", tag:"may change" },
    { key:"review.reps.unsure", en:"We couldn't quite catch the word twice — listen back, or say it again", ar:"لم نتمكّن من سماع الكلمة جيّدًا مرّتين — استمع إليها، أو انطقها مجددًا", kind:"narration", tag:"may change" },
    { key:"review.redo", en:"Redo", ar:"أعِد", kind:"label" },
    { key:"review.keep", en:"Keep it", ar:"احفظه", kind:"label" },
    { key:"review.savedonphone", en:"Saved on your phone first", ar:"حُفِظ على هاتفك أولًا", kind:"label" },
  ]},
  { tab:"record", later:true, name:"Find a word (result)", ar:"نتيجة البحث", items:[
    { key:"result.whatyousaid", en:"Hear what you said", ar:"اسمع ما قلته", kind:"label" },
    { key:"result.playing", en:"Playing", ar:"يُشغَّل", kind:"label" },
    { key:"result.pure_hakli", en:"Pure Hakli", ar:"حَكلي خالص", kind:"label" },
    { key:"result.voices", en:"“How many said this” — frame words only (no number)", ar:"[توجيه] «كم شخصًا قال هذا» — بصياغة كلماتية فقط (بلا رقم)", kind:"label", tag:"count" },
    { key:"result.meaning", en:"What it means", ar:"ما معناها", kind:"label" },
    { key:"result.notthis", en:"Not this one?", ar:"ليست هذه؟", kind:"label" },
    { key:"result.sayityourself", en:"Say it yourself", ar:"قُلها بنفسك", kind:"label" },
    { key:"result.pick", en:"I heard a few — pick the one you said", ar:"سمعتُ عدّة — اختر ما قلته", kind:"narration", tag:"may change" },
  ]},
  { tab:"record", later:true, name:"Hear how others say it", ar:"كيف يقولها الآخرون", items:[
    { key:"others.title", en:"How others say it", ar:"كيف يقولها الآخرون", kind:"label" },
    { key:"others.playall", en:"Play all", ar:"شغّل الكل", kind:"label" },
    { key:"others.cluster", en:"“How many voices, around one shape” — frame words only (no number)", ar:"[توجيه] «كم صوتًا حول شكلٍ واحد» — بصياغة كلماتية فقط (بلا رقم)", kind:"label", tag:"count" },
    { key:"others.more", en:"And more", ar:"والمزيد", kind:"label" },
  ]},
  { tab:"record", later:true, name:"Everywhere (shared)", ar:"في كلّ مكان", items:[
    { key:"nav.back", en:"Go back", ar:"ارجع", kind:"label" },
    { key:"action.play", en:"Play / listen", ar:"شغّل / استمع", kind:"label" },
    { key:"action.hear_prompt", en:"Hear the prompt", ar:"اسمع التوجيه", kind:"label" },
  ]},
];
