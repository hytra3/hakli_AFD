// Typed search (10-15): ⌨ beside the mic opens a box in the hint's place; the
// list narrows as you type, matching spellings, Arabic and English with the
// same forgiving folding. Not in sound mode; closed by ×, Escape, Home or the
// mic. Also: in sound mode an open card keeps its picture (no voice shape).
import { ROOT, serve, launch, newPage, ok, scenario, finish, SHOTS } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const t = (ms)=>({ __ts: ms });
const FS = {
  "afd_entries/ent_sun":   { gloss:"sun",   glossAr:"الشمس", pic:"☀️" },
  "afd_entries/ent_moon":  { gloss:"moon",  glossAr:"القمر", pic:"🌙" },
  "afd_entries/ent_water": { gloss:"water", glossAr:"ماء",   pic:"💧" },
  "afd_entries/ent_sun/spellings/uA":  { text:"شُوم",   searchKey:"شوم",  lang:"qhk-Arab", by:"uA", at:t(1) },
  "afd_entries/ent_moon/spellings/uA": { text:"إِرِيت", searchKey:"اريت", lang:"qhk-Arab", by:"uA", at:t(1) },
  "afd_entries/ent_moon/spellings/uB": { text:"zzz",    searchKey:"zzz",  lang:"qhk-Arab", by:"uB", at:t(2), hiddenAt:t(3) },
};
const mode = (m)=> new Function(`try{ localStorage.setItem("afd_display_mode","${m}"); }catch(_){ }`);
const visible = (page)=> page.evaluate(()=> [...document.querySelectorAll("#results .card")]
  .filter(c => c.style.display !== "none").map(c => c.querySelector(".thumb").dataset.entry));
async function openList(m){
  const r = await newPage(browser, srv.url, { fs:FS, init:mode(m) });
  await r.page.goto(srv.url + "/index.html");
  await r.page.waitForSelector('.thumb[data-entry="ent_sun"]', { timeout:10000 }); await r.page.waitForTimeout(500);
  return r;
}
const type = async (page, s)=>{ await page.fill("#typeIn", s); await page.waitForTimeout(150); };

await scenario("the ⌨ opens a box that narrows the list", async ()=>{
  const { page, state } = await openList("auto");
  const b = await page.evaluate(()=>{ const e = document.getElementById("typeBtn"); const r = e.getBoundingClientRect();
    return { shown: getComputedStyle(e).display !== "none", cap: e.dataset.cap, left: r.left < innerWidth/2 }; });
  ok("⌨ shows over the list, on the mic's other side from +, captioned اكتب", b.shown && b.left && b.cap === "اكتب", JSON.stringify(b));
  await page.click("#typeBtn");
  const o = await page.evaluate(()=>({ box: getComputedStyle(document.getElementById("typeBox")).display,
    hint: getComputedStyle(document.getElementById("hint")).display, focus: document.activeElement.id,
    ph: document.getElementById("typeIn").placeholder }));
  ok("the box takes the hint's place, focused, with a placeholder", o.box === "flex" && o.hint === "none" && o.focus === "typeIn" && /Hakli/.test(o.ph), JSON.stringify(o));
  await type(page, "شوم");
  ok("a spelling, typed without vowel marks, finds its word", JSON.stringify(await visible(page)) === '["ent_sun"]', JSON.stringify(await visible(page)));
  ok("a count says how many", /Matches: 1/.test(await page.textContent("#typeCount")));
  await type(page, "اريت");
  ok("alef forms fold: اريت finds إِرِيت", JSON.stringify(await visible(page)) === '["ent_moon"]');
  await type(page, "القمر");
  ok("the Arabic translation matches", JSON.stringify(await visible(page)) === '["ent_moon"]');
  await type(page, "WAT");
  ok("the English matches, any case", JSON.stringify(await visible(page)) === '["ent_water"]');
  await type(page, "zzz");
  const none = await page.evaluate(()=>({ n: [...document.querySelectorAll("#results .card")].filter(c=>c.style.display!=="none").length,
    link: (document.querySelector("#typeCount a")||{}).getAttribute?.("href") }));
  ok("a hidden spelling doesn't match; nothing found offers to add it", none.n === 0 && none.link === "add.html", JSON.stringify(none));
  await type(page, "شمس");
  if(SHOTS) await page.screenshot({ path: SHOTS + "/typed.png" });
  await page.click("#typeX");
  const c = await page.evaluate(()=>({ typing: document.body.classList.contains("typing"),
    hint: getComputedStyle(document.getElementById("hint")).display,
    all: [...document.querySelectorAll("#results .card")].every(c=>c.style.display!=="none") }));
  ok("× closes it: the hint is back and the whole list shows", !c.typing && c.hint !== "none" && c.all, JSON.stringify(c));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("Escape and Home close it; a mode change keeps it", async ()=>{
  const { page } = await openList("auto");
  await page.click("#typeBtn"); await type(page, "شوم");
  await page.keyboard.press("Escape");
  ok("Escape closes it", await page.evaluate(()=> !document.body.classList.contains("typing")));
  await page.click("#typeBtn"); await type(page, "شوم");
  await page.click("#skin"); await page.waitForTimeout(800);       // auto → sound? (cycle order) — check below
  const m = await page.evaluate(()=> document.body.dataset.mode);
  if(m === "sound"){
    ok("switching to sound mode closes the box and hides ⌨", await page.evaluate(()=> !document.body.classList.contains("typing")
      && getComputedStyle(document.getElementById("typeBtn")).display === "none"));
  }else{
    ok("switching to " + m + " keeps the search and its filter", await page.evaluate(()=> document.body.classList.contains("typing"))
      && JSON.stringify(await visible(page)) === '["ent_sun"]', JSON.stringify(await visible(page)));
  }
  await page.goto(srv.url + "/index.html"); await page.waitForSelector('.thumb[data-entry="ent_sun"]'); await page.waitForTimeout(400);
  await page.click("#typeBtn"); await type(page, "شوم");
  await page.click("#mastGlyph"); await page.waitForTimeout(700);
  ok("Home closes it and shows the whole list", await page.evaluate(()=> !document.body.classList.contains("typing")
    && [...document.querySelectorAll("#results .card")].every(c=>c.style.display!=="none")));
});

await scenario("sound mode: no ⌨; an open card keeps its picture", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:{ ...FS,
      "afd_entries/ent_sun/recordings/r1": { type:"context", consent:"public", allowPlayback:true, uid:"uA", speakerId:"spk_uA_01",
        storagePath:"afd/uA/r1.webm", envelope:[0.2,0.9,0.4,0.8,0.1] } }, init:mode("sound") });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".slot-word", { timeout:10000 }); await page.waitForTimeout(600);
  const s = await page.evaluate(()=>({ btn: getComputedStyle(document.getElementById("typeBtn")).display,
    thumb: document.querySelector(".card .thumb").textContent, wave: !!document.querySelector(".card .thumb .thumb-wave") }));
  ok("no ⌨ in sound mode", s.btn === "none", JSON.stringify(s));
  ok("the open card's box is still ☀️, not a sentence's shape", s.thumb === "☀️" && !s.wave, JSON.stringify(s));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
