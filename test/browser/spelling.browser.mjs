// Spellings (10-15): the word written in letters, any number per card, each by
// whoever wrote it, none canonical. The header shows them as the headword; an
// open card lists them, lets a signed-in person write or change their own, and
// lets a steward hide one. Never shown in sound mode. add.html offers the same
// as a "show it" tile.
import { ROOT, serve, launch, newPage, ok, scenario, finish, SHOTS } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const STEW = { uid:"uSteward", isAnonymous:false, displayName:null, email:"steward@example.org", providerData:[{ providerId:"password" }] };
const ANNA = { uid:"uAnna", isAnonymous:false, displayName:null, email:"anna@example.org", providerData:[{ providerId:"phone" }] };
const t = (ms)=>({ __ts: ms });
const FS = {
  "afd_admins/uSteward": { email:"steward@example.org" },
  "afd_stewards/uSalim": { visibility:"known", displayName:"Salim" },
  "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس", pic:"☀️" },
  "afd_entries/ent_moon": { gloss:"moon", glossAr:"القمر", pic:"🌙" },
  "afd_entries/ent_sun/spellings/uSalim": { text:"شُوم", searchKey:"شوم", lang:"qhk-Arab", by:"uSalim", at:t(1000) },
  "afd_entries/ent_sun/spellings/uOther": { text:"شوم", searchKey:"شوم", lang:"qhk-Arab", by:"uOther", at:t(2000) },
  "afd_entries/ent_sun/spellings/uBad":   { text:"xxx", searchKey:"xxx", lang:"qhk-Arab", by:"uBad", at:t(3000), hiddenAt:t(4000) },
};
const mode = (m)=> new Function(`try{ localStorage.setItem("afd_display_mode","${m}"); }catch(_){ }`);
const headOf = (page, id)=> page.evaluate((id)=>{
  const c = [...document.querySelectorAll(".card")].find(c => c.querySelector(`.thumb[data-entry="${id}"]`));
  if(!c) return null;
  const g = c.querySelector(".gloss"), sp = g && g.querySelector(".spell");
  return { first: g && g.firstElementChild && g.firstElementChild.className, spell: sp ? sp.textContent : null,
           dir: sp && sp.getAttribute("dir"), lang: sp && sp.getAttribute("lang"), has: g && g.classList.contains("has-spell"),
           text: g && g.textContent };
}, id);

await scenario("the list: spellings are the headword, read in one go", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init:mode("auto") });
  await page.goto(srv.url + "/index.html");
  await page.waitForSelector('.thumb[data-entry="ent_sun"]', { timeout:10000 }); await page.waitForTimeout(500);
  const h = await headOf(page, "ent_sun");
  ok("the spelling comes first, before the translations", h && h.first === "spell" && /^شُوم · شوم/.test(h.text), JSON.stringify(h));
  ok("both writers' spellings show, the hidden one doesn't", h && h.spell === "شُوم · شوم", JSON.stringify(h));
  ok("tagged with the instance's language and script, right to left", h && h.dir === "rtl" && h.lang === "qhk-Arab", JSON.stringify(h));
  const m = await headOf(page, "ent_moon");
  ok("a word nobody has written shows no spelling line", m && m.spell === null && !m.has, JSON.stringify(m));
  const log = await page.evaluate(()=> globalThis.__FSLOG.filter(l => /spellings/.test(l) || l === "list /"));
  ok("one collection-group read, no per-card spelling reads", log.length === 1 && log[0] === "list /", JSON.stringify(log));
  if(SHOTS) await page.screenshot({ path: SHOTS + "/spelling-list.png" });
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("script mode keeps the two Arabic lines apart; sound mode shows none", async ()=>{
  { const { page } = await newPage(browser, srv.url, { fs:FS, init:mode("script") });
    await page.goto(srv.url + "/index.html");
    await page.waitForSelector('.thumb[data-entry="ent_sun"]', { timeout:10000 }); await page.waitForTimeout(500);
    const s = await page.evaluate(()=>{
      const c = [...document.querySelectorAll(".card")].find(c => c.querySelector('.thumb[data-entry="ent_sun"]'));
      const sp = c.querySelector(".spell"), ar = c.querySelector(".glossar");
      return { sp: parseFloat(getComputedStyle(sp).fontSize), ar: parseFloat(getComputedStyle(ar).fontSize), arText: ar.textContent };
    });
    ok("script: the spelling is larger than the Arabic translation under it", s.sp > s.ar + 3 && s.arText === "الشمس", JSON.stringify(s));
    if(SHOTS) await page.screenshot({ path: SHOTS + "/spelling-script.png" }); }
  { const { page } = await newPage(browser, srv.url, { fs:FS, init:mode("sound") });
    await page.goto(srv.url + "/index.html#ent_sun");
    await page.waitForSelector(".slot-word", { timeout:10000 }); await page.waitForTimeout(500);
    const n = await page.evaluate(()=> ({ head: document.querySelectorAll(".spell").length,
      sec: [...document.querySelectorAll(".slot-spell")].filter(s => !s.hidden).length }));
    ok("sound: no spelling in the header or the open card", n.head === 0 && n.sec === 0, JSON.stringify(n)); }
});

await scenario("an open card lists every spelling, attributed, none ranked", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init:mode("auto") });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".slot-spell .spell-row", { timeout:10000 }); await page.waitForTimeout(400);
  const rows = await page.evaluate(()=> [...document.querySelectorAll(".slot-spell .spell-row")].map(r => ({
    text: r.querySelector(".spell-text").textContent, by: r.querySelector(".spell-by").textContent })));
  ok("oldest first; a known contributor is named; the hidden one is left out",
     rows.length === 2 && rows[0].text === "شُوم" && rows[0].by === "written by Salim" && rows[1].text === "شوم" && rows[1].by === "",
     JSON.stringify(rows));
  ok("signed out: no way to write one here", await page.evaluate(()=> !document.querySelector(".slot-spell .spell-tools .wt-btn")));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("a signed-in person writes, changes and removes their own spelling", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:ANNA, init:mode("auto") });
  await page.goto(srv.url + "/index.html#ent_moon");
  await page.waitForSelector(".slot-spell .spell-tools .wt-btn", { timeout:10000 }); await page.waitForTimeout(300);
  ok("an empty card invites the first spelling", await page.evaluate(()=>
    !document.querySelector(".slot-spell .slot-empty").hidden &&
    /Write it in Hakli/.test(document.querySelector(".slot-spell .spell-tools .wt-btn").textContent)));
  await page.click(".slot-spell .spell-tools .wt-btn");
  const inp = await page.evaluate(()=>{ const i = document.querySelector(".spell-edit input"); return { dir:i.dir, lang:i.lang }; });
  ok("the box writes right to left, tagged qhk-Arab", inp.dir === "rtl" && inp.lang === "qhk-Arab", JSON.stringify(inp));
  await page.fill(".spell-edit input", "  إِرِيتـ ");
  if(SHOTS) await page.screenshot({ path: SHOTS + "/spelling-write.png", fullPage:true });
  await page.click(".spell-edit .wt-save"); await page.waitForTimeout(300);
  const d = await page.evaluate(()=> globalThis.__FS["afd_entries/ent_moon/spellings/uAnna"]);
  ok("saved under her own id: tidied text, folded search key, tag, writer, time",
     d && d.text === "إِرِيت" && d.searchKey === "اريت" && d.lang === "qhk-Arab" && d.by === "uAnna" && d.at && d.at.__ts, JSON.stringify(d));
  const after = await page.evaluate(()=>({ head: document.querySelector(".card .spell") && document.querySelector(".card .spell").textContent,
    row: document.querySelector(".slot-spell .spell-row .spell-by").textContent,
    btn: document.querySelector(".slot-spell .spell-tools .wt-btn").textContent }));
  ok("the header and the list update in place; the button now changes hers",
     after.head === "إِرِيت" && after.row === "your spelling" && /Change my spelling/.test(after.btn), JSON.stringify(after));
  await page.click(".slot-spell .spell-tools .wt-btn");
  ok("changing it starts from what she wrote", await page.evaluate(()=> document.querySelector(".spell-edit input").value === "إِرِيت"));
  await page.fill(".spell-edit input", "أريت");
  await page.click(".spell-edit .wt-save"); await page.waitForTimeout(300);
  const d2 = await page.evaluate(()=> globalThis.__FS["afd_entries/ent_moon/spellings/uAnna"]);
  ok("an edit keeps the writer and updates the words", d2.text === "أريت" && d2.searchKey === "اريت" && d2.by === "uAnna", JSON.stringify(d2));
  await page.click(".slot-spell .spell-tools .wt-btn");
  await page.click(".spell-edit .wt-remove"); await page.waitForTimeout(300);
  const gone = await page.evaluate(()=>({ doc: globalThis.__FS["afd_entries/ent_moon/spellings/uAnna"],
    head: !!document.querySelector(".card .spell"), rows: document.querySelectorAll(".slot-spell .spell-row").length }));
  ok("removing it takes it off the card and the header", gone.doc === undefined && !gone.head && gone.rows === 0, JSON.stringify(gone));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("a steward hides a spelling and shows it again", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:STEW, init:mode("auto") });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".slot-spell .spell-hide", { timeout:10000 }); await page.waitForTimeout(400);
  const rows = await page.evaluate(()=> [...document.querySelectorAll(".slot-spell .spell-row")].map(r => ({
    text: r.querySelector(".spell-text").textContent, hidden: r.classList.contains("is-hidden"), btn: r.querySelector(".spell-hide").textContent })));
  ok("the steward sees all three, the hidden one marked, each with hide/show",
     rows.length === 3 && rows[2].hidden && rows[2].btn === "Show again" && rows[0].btn === "Hide", JSON.stringify(rows));
  ok("no edit box for other people's words", await page.evaluate(()=>
    /Write it in Hakli/.test(document.querySelector(".slot-spell .spell-tools .wt-btn").textContent)));
  await page.evaluate(()=> document.querySelectorAll(".slot-spell .spell-hide")[1].click()); await page.waitForTimeout(300);
  const d = await page.evaluate(()=> globalThis.__FS["afd_entries/ent_sun/spellings/uOther"]);
  ok("hiding stamps hiddenAt, leaves the words alone", d.hiddenAt && d.text === "شوم", JSON.stringify(d));
  ok("the header drops it", await page.evaluate(()=> document.querySelector(".card .spell").textContent === "شُوم"));
  await page.evaluate(()=> document.querySelectorAll(".slot-spell .spell-hide")[1].click()); await page.waitForTimeout(300);
  const d2 = await page.evaluate(()=> globalThis.__FS["afd_entries/ent_sun/spellings/uOther"]);
  ok("showing it again clears hiddenAt", d2.hiddenAt === undefined, JSON.stringify(d2));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("add a word: a 'Write it in Hakli' tile", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { user:ANNA, init:mode("auto") });
  await page.goto(srv.url + "/add.html"); await page.waitForTimeout(600);
  await page.evaluate(()=>{ document.getElementById("say").hidden = true; document.getElementById("show").hidden = false; });
  const tile = await page.evaluate(()=>{ const t = document.getElementById("tileSpell"); return { shown: !t.hidden, text: t.textContent }; });
  ok("the tile is there, named apart from 'Write it in Arabic'", tile.shown && /Write it in Hakli/.test(tile.text), JSON.stringify(tile));
  await page.click("#tileSpell");
  const i = await page.evaluate(()=>{ const e = document.getElementById("spellIn"); return { open: !document.getElementById("panelSpell").hidden, dir: e.dir, lang: e.lang }; });
  ok("its panel opens with a right-to-left, qhk-Arab box", i.open && i.dir === "rtl" && i.lang === "qhk-Arab", JSON.stringify(i));
  await page.fill("#spellIn", "شُوم"); await page.waitForTimeout(200);
  ok("typing ticks the tile and makes Next say Next, not Skip", await page.evaluate(()=>
    document.getElementById("tileSpell").classList.contains("filled") && !/Skip/.test(document.getElementById("showNext").textContent)));
  if(SHOTS) await page.screenshot({ path: SHOTS + "/spelling-add.png", fullPage:true });
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
