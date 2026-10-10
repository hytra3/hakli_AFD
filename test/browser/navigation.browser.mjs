// Navigation dead ends: every way a person could be left stranded, or shown
// something stale, on the dictionary page and the recorder.
import { ROOT, serve, launch, newPage, hold, hintText, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
const USER = { uid:"uTest1", isAnonymous:false, displayName:"Test Steward", email:"test@example.com" };
const FS = { "afd_entries/ent_camel": { gloss:"camel", glossAr:"جمل", pic:"🐪" } };
const HIT = { status:200, body:{ results:[{ entryId:"ent_camel", gloss:"camel", distance:0.09 }, { entryId:"ent_deer", gloss:"deer", distance:0.21 }], corpus_n:12 } };
const st = (page)=> page.evaluate(()=>({
  url: location.pathname + location.hash, mastEn: (document.getElementById("mastEn")||{}).textContent,
  hint: (document.getElementById("hint")||{}).innerText, hidden: document.getElementById("results").classList.contains("hidden"),
  cards: document.querySelectorAll("#results .card").length, busy: document.body.classList.contains("busy") }));
const ready = (page)=> page.waitForFunction(()=> document.querySelectorAll("#results .card").length > 0, null, { timeout:15000 });
const open = async (path, opts={})=>{ const t = await newPage(browser, srv.url, { fs:FS, init:AUTO, ...opts });
  await t.page.goto(srv.url + path); await ready(t.page); await t.page.waitForTimeout(400); return t; };

// 1 — a too-short hold must not leave a blank page; Home must work from it
await scenario("1 — a too-short hold must not leave a blank page; Home must work from it", async ()=>{ const { page, ctx } = await open("/");
  await hold(page, "#mic", 30); await page.waitForTimeout(900);
  const a = await st(page);
  ok("1a too-short hold → the list is still on screen", !a.hidden && a.cards > 40 && /Hold a little longer/.test(a.hint), JSON.stringify(a));
  await page.click("#mastGlyph"); await page.waitForTimeout(600);
  const b = await st(page);
  ok("1b Home afterwards → list, idle hint", !b.hidden && b.cards > 40 && /^Hold and speak/.test(b.hint), JSON.stringify(b));
  await ctx.close(); });

// 2 — from a linked word back to all words: clean address, idle hint, reload stays on the list
await scenario("2 — from a linked word back to all words: clean address, idle hint, reload stays on the list", async ()=>{ const { page, ctx } = await open("/index.html#ent_camel");
  await page.click(".allbtn"); await ready(page); await page.waitForTimeout(500);
  const a = await st(page);
  ok("2a 'all words' from a linked word → no #ent_ left, idle hint", a.url==="/index.html" && /^Hold and speak/.test(a.hint) && a.cards > 40, JSON.stringify(a));
  await page.reload(); await ready(page); await page.waitForTimeout(500);
  const b = await st(page);
  ok("2b reload afterwards stays on the list", b.cards > 40 && b.mastEn==="dictionary", JSON.stringify(b));
  await ctx.close(); });
await scenario("2c Home from a linked word → same", async ()=>{ const { page, ctx } = await open("/index.html#ent_camel");
  await page.click("#mastGlyph"); await ready(page); await page.waitForTimeout(500);
  const a = await st(page);
  ok("2c Home from a linked word → same", a.url==="/index.html" && /^Hold and speak/.test(a.hint) && a.cards > 40, JSON.stringify(a));
  await page.evaluate(()=>{ location.hash = "ent_camel"; }); await page.waitForTimeout(900);
  const b = await st(page);
  ok("2d the same link still opens the word again", b.cards===1 && b.url.endsWith("#ent_camel"), JSON.stringify(b));
  await ctx.close(); });

// 3 — after a search, 'all words' clears "Here it is"
await scenario("3 — after a search, 'all words' clears \"Here it is\"", async ()=>{ const { page, ctx } = await open("/", { matcher:()=>HIT });
  await hold(page); await page.waitForFunction(()=> /Here it is|Did you mean/.test(document.getElementById("hint").innerText), null, { timeout:8000 });
  await page.click(".allbtn"); await page.waitForTimeout(700);
  const a = await st(page);
  ok("3 'all words' after a search → idle hint over the list", /^Hold and speak/.test(a.hint) && a.cards > 40 && a.mastEn==="dictionary", JSON.stringify(a));
  await ctx.close(); });

// 4 — Home leaves a filtered view
await scenario("4 — Home leaves a filtered view", async ()=>{ const { page, ctx } = await open("/");
  await page.click("#mastScreen"); await page.click('#viewMenu [data-view="needs"]'); await page.waitForTimeout(600);
  const a = await st(page);
  await page.click("#mastGlyph"); await page.waitForTimeout(700);
  const b = await st(page);
  ok("4 Home from 'Needs a voice' → All words", a.mastEn==="Needs a voice" && b.mastEn==="dictionary", JSON.stringify([a.mastEn, b.mastEn]));
  await page.click("#mastScreen"); await page.waitForTimeout(200);
  ok("4b view menu shows All words as current", await page.evaluate(()=> document.querySelector('#viewMenu [data-view="all"]').getAttribute("aria-current")==="true"));
  await ctx.close(); });

// 5 — Home during a search in flight cancels it and shows the list; the late failure never appears
await scenario("5 — Home during a search in flight cancels it and shows the list; the late failure never appears", async ()=>{ const { page, ctx, state } = await open("/", { matcher:()=>"hang" });
  await hold(page); await page.waitForTimeout(500);
  const a = await st(page);
  await page.click("#mastGlyph"); await page.waitForTimeout(700);
  const b = await st(page);
  ok("5 Home while 'Finding…' → list back, not busy", a.busy && a.hidden && !b.busy && !b.hidden && /^Hold and speak/.test(b.hint), JSON.stringify([a.hint, b.hint, b.busy]));
  await ctx.close(); });

// 6 — a link to a word that doesn't exist
await scenario("6 — a link to a word that doesn't exist", async ()=>{ const { page, ctx } = await open("/index.html#ent_nosuchword");
  await page.waitForTimeout(800);
  const a = await st(page); await shot(page, "wf6-missing");
  ok("6a unknown word link → says so, over the whole list", /isn't in the dictionary/.test(a.hint) && a.cards > 40 && a.url==="/index.html", JSON.stringify(a));
  await ctx.close(); });
await scenario("6b no answer from Firestore → the link is not called missing", async ()=>{ // Firestore can't answer (no signal) → must NOT claim the word is missing
  const { page, ctx } = await open("/index.html#ent_u_abc", { init:()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } globalThis.__FS_FAIL = true; } });
  const a = await st(page);
  ok("6b no answer from Firestore → the link is not called missing", a.cards===1 && !/isn't in the dictionary/.test(a.hint) && a.url.endsWith("#ent_u_abc"), JSON.stringify(a));
  await ctx.close(); });
await scenario("6c a contributed word that exists opens as before", async ()=>{ const { page, ctx } = await open("/index.html#ent_u_real", { fs:{ ...FS, "afd_entries/ent_u_real": { glossAr:"قهوة", pic:"☕", source:"user", createdBy:"x" } } });
  const a = await st(page);
  ok("6c a contributed word that exists opens as before", a.cards===1 && /Here it is/.test(a.hint) && a.url.endsWith("#ent_u_real"), JSON.stringify(a));
  await ctx.close(); });
await scenario("6d a removed word still says 'removed'", async ()=>{ const { page, ctx } = await open("/index.html#ent_u_gone", { fs:{ ...FS, "afd_entries/ent_u_gone": { glossAr:"x", source:"user", createdBy:"x", removedAt:{ __ts:1 } } } }).catch(async e=>{ return { page:null, ctx:null }; });
  if(page){ const a = await st(page); ok("6d a removed word still says 'removed'", /was removed/.test(a.hint), JSON.stringify(a)); await ctx.close(); }
  else {
    const t = await newPage(browser, srv.url, { fs:{ ...FS, "afd_entries/ent_u_gone": { glossAr:"x", source:"user", createdBy:"x", removedAt:{ __ts:1 } } }, init:AUTO });
    await t.page.goto(srv.url + "/index.html#ent_u_gone"); await t.page.waitForTimeout(1500);
    const a = await st(t.page); ok("6d a removed word still says 'removed'", /was removed/.test(a.hint), JSON.stringify(a)); await t.ctx.close(); } });

// 7 — recorder: Just listen, then back and on to recording
await scenario("7 — recorder: Just listen, then back and on to recording", async ()=>{ const { page, ctx } = await newPage(browser, srv.url, { init:AUTO, user:USER });
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1500);
  await page.click("#listenOnlyBtn"); await page.waitForTimeout(600);
  const listening = await page.evaluate(()=> document.getElementById("progress").innerText);
  await page.click("#progressWrap"); await page.waitForTimeout(400);
  await page.click("#toMic"); await page.waitForTimeout(800);
  if(await page.isVisible("#startMic")){ await page.click("#startMic"); await page.waitForTimeout(1500); }
  await page.click("#toRecord"); await page.waitForTimeout(900);
  const after = await page.evaluate(()=>({ progress: document.getElementById("progress").innerText.replace(/\s+/g," "),
    rec: !document.getElementById("recBtn").classList.contains("hidden") && document.getElementById("recBtn").getClientRects().length>0 }));
  await shot(page, "wf7-record-after-listen");
  ok("7 after 'Just listen', Continue → mic → record shows the record button", /LISTENING/.test(listening) && after.rec && /STEP 3/.test(after.progress), JSON.stringify(after));
  // and listening is still reachable afterwards
  await page.click("#progressWrap"); await page.waitForTimeout(400);
  await page.click("#listenOnlyBtn"); await page.waitForTimeout(600);
  ok("7b 'Just listen' still works afterwards", /LISTENING/.test(await page.evaluate(()=> document.getElementById("progress").innerText)));
  await ctx.close(); });

await browser.close(); srv.close();
finish();
