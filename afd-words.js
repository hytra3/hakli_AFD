/* ============================================================================
   afd-words.js — the canonical entry list, shared across every AFD surface.

   This is the source of truth for which entries exist (the recorder walks it,
   the dictionary lists it, seed-entries.mjs seeds from it). Loaded as a plain
   classic script before page scripts, available as window.AFDWords.

   Fields per entry:
     id   — stable key; entryId is AFDCore.entryIdFor(id)
     en   — English gloss
     ar   — Arabic gloss
     pic  — emoji picture (the non-reader anchor)
     dom  — domain / semantic group
     ref  — Marty's field-note transcription (may be empty)

   Bump the ?v= query on the <script src> when this file changes.
   ============================================================================ */
window.AFDWords = [
 {id:"sun",en:"sun",ar:"الشمس",pic:"☀️",dom:"nature",ref:"shoon (shum)"},
 {id:"moon",en:"moon",ar:"القمر",pic:"🌙",dom:"nature",ref:"erit"},
 {id:"mountain",en:"mountain",ar:"جبل",pic:"⛰️",dom:"nature",ref:"shhr"},
 {id:"sand",en:"sand",ar:"رمل",pic:"🏜️",dom:"nature",ref:"hashi"},
 {id:"clouds",en:"clouds",ar:"غيوم",pic:"☁️",dom:"nature",ref:"ahfre"},
 {id:"cave",en:"cave",ar:"كهف",pic:"🕳️",dom:"nature",ref:"rekub"},
 {id:"valley",en:"valley",ar:"وادي",pic:"🏞️",dom:"nature",ref:""},
 {id:"rocks",en:"rocks",ar:"صخور",pic:"🪨",dom:"nature",ref:""},
 {id:"smoke",en:"smoke",ar:"دخان",pic:"💨",dom:"nature",ref:""},
 {id:"camel",en:"camel",ar:"جمل",pic:"🐪",dom:"animals",ref:""},
 {id:"wolf",en:"wolf",ar:"ذئب",pic:"🐺",dom:"animals",ref:"THeeb / kob"},
 {id:"deer",en:"deer",ar:"غزال",pic:"🦌",dom:"animals",ref:"aboTH"},
 {id:"horn",en:"horn",ar:"قرن",pic:"🐂",dom:"animals",ref:"keron"},
 {id:"bone",en:"bone",ar:"عظم",pic:"🦴",dom:"animals",ref:""},
 {id:"tree",en:"tree",ar:"شجرة",pic:"🌳",dom:"plants",ref:"heruu (was he.rn/hero)"},
 {id:"corn",en:"corn",ar:"ذرة",pic:"🌽",dom:"plants",ref:"mehindi"},
 {id:"fig",en:"fig",ar:"تين",pic:"🫒",dom:"plants",ref:""},
 {id:"date",en:"date (fruit)",ar:"تمر",pic:"🌴",dom:"plants",ref:"toor"},
 {id:"bean",en:"bean",ar:"فاصولياء",pic:"🫘",dom:"plants",ref:"dugger"},
 {id:"hay",en:"hay",ar:"تبن",pic:"🌾",dom:"plants",ref:"TSaah / ehgroht"},
 {id:"water",en:"water",ar:"ماء",pic:"💧",dom:"food",ref:"mi"},
 {id:"milk",en:"milk",ar:"حليب",pic:"🥛",dom:"food",ref:"newSHb"},
 {id:"eggs",en:"eggs",ar:"بيض",pic:"🥚",dom:"food",ref:""},
 {id:"brother",en:"brother",ar:"أخ",pic:"👨",dom:"kinship",ref:"aKee"},
 {id:"sister",en:"sister",ar:"أخت",pic:"👩",dom:"kinship",ref:"aKeeti"},
 {id:"daughter",en:"daughter",ar:"ابنة",pic:"👧",dom:"kinship",ref:"'ibritti"},
 {id:"son",en:"son",ar:"ابن",pic:"👦",dom:"kinship",ref:""},
 {id:"boy",en:"boy",ar:"ولد",pic:"🧒",dom:"kinship",ref:"mbera"},
 {id:"girl",en:"girl",ar:"بنت",pic:"👧",dom:"kinship",ref:"Khabiut"},
 {id:"pillow",en:"pillow",ar:"وسادة",pic:"🛏️",dom:"objects",ref:"emdot"},
 {id:"mirror",en:"mirror",ar:"مرآة",pic:"🪞",dom:"objects",ref:"mirit"},
 {id:"belt",en:"belt",ar:"حزام",pic:"🥋",dom:"objects",ref:""},
 {id:"book",en:"book",ar:"كتاب",pic:"📖",dom:"objects",ref:""},
 {id:"photo",en:"photo",ar:"صورة",pic:"📷",dom:"objects",ref:"akiis"},
 {id:"medicine",en:"medicine",ar:"دواء",pic:"💊",dom:"objects",ref:"haboob"},
 {id:"home",en:"home",ar:"بيت",pic:"🏠",dom:"places",ref:"oat"},
 {id:"school",en:"school",ar:"مدرسة",pic:"🏫",dom:"places",ref:"madrest"},
 {id:"barber",en:"barber",ar:"حلاق",pic:"💈",dom:"people",ref:"halaQ"},
 {id:"white",en:"white",ar:"أبيض",pic:"⬜",dom:"colour",ref:"loon"},
 {id:"red",en:"red",ar:"أحمر",pic:"🟥",dom:"colour",ref:"awthr"}
];
