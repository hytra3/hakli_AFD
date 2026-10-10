// The phone's Back button follows the steps inside each page; breadcrumbs,
// labels, the not-found page, and a way out of every page.
import { ROOT, serve, launch, newPage, hold, hintText, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
const SOUND = ()=>{ try{ localStorage.setItem("afd_display_mode","sound"); }catch(_){ } };
const USER = { uid:"uTest1", isAnonymous:false, displayName:"Test Steward", email:"test@example.com" };
const FS = { "afd_entries/ent_camel": { gloss:"camel", glossAr:"جمل", pic:"🐪" } };
const HIT = { status:200, body:{ results:[{ entryId:"ent_camel", gloss:"camel", distance:0.09 }, { entryId:"ent_deer", gloss:"deer", distance:0.21 }], corpus_n:12 } };
const back = async (page)=>{ await page.evaluate(()=>history.back()).catch(()=>{}); await page.waitForTimeout(900); };
const fwd  = async (page)=>{ await page.evaluate(()=>history.forward()).catch(()=>{}); await page.waitForTimeout(900); };
const rel = (page)=> page.url().startsWith(srv.url) ? page.url().slice(srv.url.length) : page.url();
const ist = (page)=> page.evaluate(()=>({
  url: location.pathname + location.hash, mastEn: (document.getElementById("mastEn")||{}).textContent,
  hint: (document.getElementById("hint")||{}).innerText, hidden: document.getElementById("results").classList.contains("hidden"),
  cards: document.querySelectorAll("#results .card").length }));
const ready = (page)=> page.waitForFunction(()=> document.querySelectorAll("#results .card").length > 0, null, { timeout:15000 });
const openIndex = async (path, opts={})=>{ const t = await newPage(browser, srv.url, { fs:FS, init:AUTO, matcher:()=>HIT, ...opts });
  await t.page.goto(srv.url + path); await ready(t.page); await t.page.waitForTimeout(400); t.state.calls.length = 0; return t; };
const search = async (page)=>{ await hold(page); await page.waitForFunction(()=> /Here it is|Did you mean/.test(document.getElementById("hint").innerText), null, { timeout:8000 }); await page.waitForTimeout(400); };

/* ------------------------------------------------------------ index: Back */
await scenario("I1 results → phone Back → the list, still in the app", async ()=>{ const { page, ctx, state } = await openIndex("/");
  await search(page);
  const a = await ist(page);
  await back(page); const b = await ist(page);
  ok("I1 results → phone Back → the list, still in the app", a.cards===2 && b.cards>40 && b.url==="/" && /^Hold and speak/.test(b.hint) && b.mastEn==="dictionary", JSON.stringify(b));
  await fwd(page); const c = await ist(page);
  ok("I2 Forward → the same results, no new search", c.cards===2 && state.calls.length===1 && c.mastEn==="speak to find", JSON.stringify([c, state.calls.length]));
  await page.click(".allbtn"); await page.waitForTimeout(900);
  const d = await ist(page);
  await back(page);
  ok("I3 'all words' from results, then Back → leaves (no dead Back press)", d.cards>40 && !page.url().startsWith(srv.url), JSON.stringify([d.url, page.url()]));
  await ctx.close(); });

await scenario("I4 two searches in a row are one step: Back → list, Back → leaves", async ()=>{ const { page, ctx, state } = await openIndex("/");
  await search(page); await search(page);
  await back(page); const a = await ist(page);
  await back(page);
  ok("I4 two searches in a row are one step: Back → list, Back → leaves", a.cards>40 && !page.url().startsWith(srv.url) && state.calls.length===2, JSON.stringify([a.cards, page.url()]));
  await ctx.close(); });

await scenario("I5 results → recorder → Back → the results are still there; Back again → list", async ()=>{ const { page, ctx, state } = await openIndex("/");
  await search(page);
  await page.click("#results .card.open a.sayit"); await page.waitForLoadState("load"); await page.waitForTimeout(900);
  const at = rel(page);
  await page.goBack(); await ready(page); await page.waitForTimeout(700);
  const a = await ist(page);
  await back(page); const b = await ist(page);
  ok("I5 results → recorder → Back → the results are still there; Back again → list", at.startsWith("/recorder.html#ent_camel") && a.cards===2 && /Here it is|Did you mean/.test(a.hint) && b.cards>40, JSON.stringify([at, a, b.cards]));
  await ctx.close(); });

await scenario("I6 a linked word: header says dictionary; the list button is labelled", async ()=>{ const { page, ctx } = await openIndex("/index.html#ent_camel");
  const a = await ist(page);
  await shot(page, "o-entry-allbtn");
  const label = await page.innerText(".allbtn");
  ok("I6 a linked word: header says dictionary; the list button is labelled", a.mastEn==="dictionary" && /All words/i.test(label) && /كل الكلمات/.test(label), JSON.stringify([a.mastEn, label]));
  await search(page);
  await back(page); const b = await ist(page);
  ok("I7 search from a linked word → Back → the list (not a stuck #ent_)", b.cards>40 && b.url==="/index.html", JSON.stringify(b));
  await ctx.close(); });

await scenario("I8 header reads 'speak to find' while listening and finding, 'dictionary' back home", async ()=>{ const { page, ctx } = await openIndex("/", { matcher:()=>"hang" });
  const tile = await page.innerText(".addword");
  await page.dispatchEvent("#mic", "pointerdown", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(500);
  const during = await ist(page);
  await page.dispatchEvent("#mic", "pointerup", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(400);
  const finding = await ist(page);
  await page.click("#mastGlyph"); await page.waitForTimeout(600);
  const home = await ist(page);
  ok("I8 header reads 'speak to find' while listening and finding, 'dictionary' back home", during.mastEn==="speak to find" && finding.mastEn==="speak to find" && home.mastEn==="dictionary", JSON.stringify([during.mastEn, finding.mastEn, home.mastEn]));
  ok("I9 the tile atop the list says 'Add a word'", /^Add a word$/.test(tile.trim()), JSON.stringify(tile));
  await ctx.close(); });
await scenario("I10 too-short hold → header back to 'dictionary'", async ()=>{ const { page, ctx } = await openIndex("/");
  await hold(page, "#mic", 30); await page.waitForTimeout(900);
  const a = await ist(page);
  ok("I10 too-short hold → header back to 'dictionary'", a.mastEn==="dictionary" && !a.hidden, JSON.stringify(a));
  await page.click("#mastScreen"); await page.click('#viewMenu [data-view="needs"]'); await page.waitForTimeout(600);
  await page.evaluate(()=>{ location.hash = "ent_camel"; }); await page.waitForTimeout(900);
  const label = await page.innerText(".allbtn");
  ok("I11 the list button names the list it returns to", /Needs a voice/i.test(label), JSON.stringify(label));
  await ctx.close(); });
await scenario("I12 sound tier: the list button is icons only", async ()=>{ const { page, ctx } = await openIndex("/index.html#ent_camel", { init:SOUND });
  const html = await page.innerHTML(".allbtn");
  ok("I12 sound tier: the list button is icons only", !/all-t/.test(html) && (html.match(/<svg/g)||[]).length===2);
  await shot(page, "o-entry-allbtn-sound");
  await ctx.close(); });

/* --------------------------------------------------------- recorder: Back */
const rst = (page)=> page.evaluate(()=>{
  const vis = (el)=> !!el && !el.closest(".hidden") && el.getClientRects().length>0;
  const pw = document.getElementById("progressWrap");
  return { step: ["setup","miccheck","recorder"].find(id=>vis(document.getElementById(id))), crumb: !pw.classList.contains("is-static"),
    progress: pw.innerText.replace(/\s+/g," ").trim(), rec: vis(document.getElementById("recBtn")),
    chip: vis(document.getElementById("fromChip")) ? document.getElementById("fromChip").getAttribute("href") : null }; });
const toRecorder = async (page)=>{
  await page.click("#toMic"); await page.waitForTimeout(700);
  if(await page.isVisible("#startMic")){ await page.click("#startMic"); await page.waitForTimeout(1500); }
  await page.click("#toRecord"); await page.waitForTimeout(800); };

await scenario("R1 step 1 shows the word you came for, linking back to it", async ()=>{ const { page, ctx } = await newPage(browser, srv.url, { fs:FS, init:AUTO, user:USER });
  await page.goto(srv.url + "/index.html"); await ready(page);
  await page.goto(srv.url + "/recorder.html#ent_camel"); await page.waitForTimeout(1500);
  const s1 = await rst(page); await shot(page, "o-recorder-chip");
  ok("R1 step 1 shows the word you came for, linking back to it", s1.step==="setup" && s1.chip==="index.html#ent_camel" && /camel/i.test(await page.innerText("#fromChip")), JSON.stringify(s1));
  await page.click("#toMic"); await page.waitForTimeout(700);
  const s2 = await rst(page);
  ok("R2 step 2 has a breadcrumb back", s2.step==="miccheck" && s2.crumb, JSON.stringify(s2));
  await page.click("#progressWrap"); await page.waitForTimeout(700);
  const s2b = await rst(page);
  ok("R3 …and it returns to step 1", s2b.step==="setup" && !s2b.crumb, JSON.stringify(s2b));
  await toRecorder(page);
  const s3 = await rst(page);
  await back(page); const b2 = await rst(page);
  await back(page); const b1 = await rst(page);
  ok("R4 phone Back walks 3 → 2 → 1", s3.step==="recorder" && s3.rec && b2.step==="miccheck" && b1.step==="setup", JSON.stringify([s3.step, b2.step, b1.step]));
  await fwd(page); await fwd(page); const f3 = await rst(page);
  ok("R5 Forward returns to recording, button live", f3.step==="recorder" && f3.rec, JSON.stringify(f3));
  await page.click("#progressWrap"); await page.waitForTimeout(700);
  const c1 = await rst(page);
  await page.goBack().catch(()=>{}); await page.waitForTimeout(900);
  ok("R6 breadcrumb 3 → 1, then Back leaves to where you came from (no dead press)", c1.step==="setup" && rel(page).startsWith("/index.html"), JSON.stringify([c1.step, rel(page)]));
  await ctx.close(); });

await scenario("R7 Just listen → Back → step 1 → Back → the dictionary; no chip without a link", async ()=>{ const { page, ctx } = await newPage(browser, srv.url, { fs:FS, init:AUTO });
  await page.goto(srv.url + "/index.html"); await ready(page);
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1200);
  const s0 = await rst(page);
  await page.click("#listenOnlyBtn"); await page.waitForTimeout(700);
  const l = await rst(page);
  await back(page); const b = await rst(page);
  await page.goBack().catch(()=>{}); await page.waitForTimeout(900);
  ok("R7 Just listen → Back → step 1 → Back → the dictionary; no chip without a link", !s0.chip && /LISTENING/.test(l.progress) && b.step==="setup" && rel(page).startsWith("/index.html"), JSON.stringify([l.progress, b.step, rel(page)]));
  await ctx.close(); });

await scenario("R8 the chip returns to that word in the dictionary", async ()=>{ const { page, ctx } = await newPage(browser, srv.url, { fs:FS, init:AUTO, user:USER });
  await page.goto(srv.url + "/recorder.html#ent_camel"); await page.waitForTimeout(1500);
  await page.click("#fromChip"); await page.waitForLoadState("load"); await ready(page); await page.waitForTimeout(600);
  const a = await ist(page);
  ok("R8 the chip returns to that word in the dictionary", a.url==="/index.html#ent_camel" && a.cards===1, JSON.stringify(a));
  await ctx.close(); });

/* -------------------------------------------------------------- add: Back */
const ast = (page)=> page.evaluate(()=> ["say","show","share","done"].find(id=> !document.getElementById(id).hidden));
const sayWord = async (page)=>{
  await page.dispatchEvent("#sayBtn", "pointerdown", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(1600);
  await page.dispatchEvent("#sayBtn", "pointerup", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(1500); };
await scenario("A1 phone Back walks share → show → say, staying on the page", async ()=>{ const { page, ctx } = await newPage(browser, srv.url, { fs:FS, init:AUTO });
  await page.goto(srv.url + "/index.html"); await ready(page);
  await page.click(".addword"); await page.waitForLoadState("load"); await page.waitForTimeout(1200);
  const cap0 = await page.getAttribute("#acct", "data-cap");
  await sayWord(page);
  await page.click("#sayNext"); await page.waitForTimeout(500);
  await page.click("#showNext"); await page.waitForTimeout(500);
  const s3 = await ast(page);
  await back(page); const s2 = await ast(page);
  await back(page); const s1 = await ast(page);
  ok("A1 phone Back walks share → show → say, staying on the page", s3==="share" && s2==="show" && s1==="say" && rel(page)==="/add.html", JSON.stringify([s3,s2,s1,rel(page)]));
  await fwd(page); const f2 = await ast(page);
  await page.click("#showBack"); await page.waitForTimeout(700);
  const b1 = await ast(page);
  await page.goBack().catch(()=>{}); await page.waitForTimeout(900);
  ok("A2 Forward → show; the page's own Back → say; phone Back then leaves to the dictionary", f2==="show" && b1==="say" && rel(page).startsWith("/index.html"), JSON.stringify([f2,b1,rel(page)]));
  ok("A3 account caption says 'sign in' when signed out", cap0==="دخول", JSON.stringify(cap0));
  await ctx.close(); });

await scenario("A4 after sharing, Back from the thank-you leaves the page", async ()=>{ // the whole way to "done": then Back must leave, not reopen the shared word
  const { page, ctx, state } = await newPage(browser, srv.url, { fs:FS, init:AUTO });
  await page.goto(srv.url + "/index.html"); await ready(page);
  await page.goto(srv.url + "/add.html"); await page.waitForTimeout(1200);
  await sayWord(page);
  await page.click("#sayNext"); await page.waitForTimeout(400);
  await page.click("#showNext"); await page.waitForTimeout(400);
  await page.evaluate(()=>{ for(const id of ["cPlay","cArchive","cML"]){ const c=document.getElementById(id); if(c && !c.checked) c.click(); } });
  await page.click("#googleBtn"); await page.waitForTimeout(1200);
  if(await page.isVisible("#shareBtn")){ await page.click("#shareBtn"); }
  await page.waitForTimeout(3500);
  const s = await ast(page);
  if(s !== "done"){ ok("A4 the word could be shared against the stand-in backend (needed to reach the thank-you screen)", false, "stopped on '"+s+"': "+(await page.innerText("#shareErr")).slice(0,160)); }
  else {
    const cap1 = await page.getAttribute("#acct", "data-cap");
    await page.goBack().catch(()=>{}); await page.waitForTimeout(900);
    ok("A4 after sharing, Back from the thank-you leaves the page", rel(page).startsWith("/index.html"), rel(page));
    ok("A5 account caption says 'my account' once signed in", cap1==="حسابي", JSON.stringify(cap1));
  }
  await ctx.close(); });

/* ------------------------------------------------- 404 and the ways out */
await scenario("N1 404 page: every link is absolute and leads into the app", async ()=>{ const { page, ctx, state } = await newPage(browser, srv.url, {});
  await page.goto(srv.url + "/404.html"); await page.waitForTimeout(500);
  const hrefs = await page.$$eval("a[href]", a=>a.map(x=>x.getAttribute("href")));
  await shot(page, "o-404");
  ok("N1 404 page: every link is absolute and leads into the app", hrefs.length===3 && hrefs.every(h=>h.startsWith("/")) && hrefs.includes("/") && hrefs.includes("/add.html") && !state.errors.length, JSON.stringify(hrefs));
  for(const [p, want] of [["hakli-intro.html","index.html"],["hakli-intro-ar.html","index.html"],["prompts/index.html","../index.html"],["steward.html","index.html"],["prompts/admin.html","../index.html"]]){
    await page.goto(srv.url + "/" + p); await page.waitForTimeout(700);
    const hs = await page.$$eval("a[href]", a=>a.filter(x=>x.getClientRects().length).map(x=>x.getAttribute("href")).filter(h=>!h.startsWith("#")));
    const resolved = hs.length ? new URL(hs.find(h=>h===want) || "x:", srv.url + "/" + p).pathname : "";
    ok("N2 "+p+" has a visible link to the dictionary", hs.includes(want) && resolved==="/index.html", JSON.stringify(hs));
    if(p==="hakli-intro.html"){ await page.evaluate(()=>window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(200); await shot(page, "o-intro-enter"); }
  }
  // every relative link on the tool pages resolves to a file that exists
  let dead = [];
  for(const p of ["steward.html","prompts/admin.html","prompts/index.html"]){
    await page.goto(srv.url + "/" + p); await page.waitForTimeout(400);
    for(const h of await page.$$eval("a[href]", a=>a.map(x=>x.href).filter(h=>!h.includes("#")))){
      const r = await page.request.get(h); if(r.status()!==200) dead.push(p+" → "+h+" ("+r.status()+")"); }
  }
  ok("N3 no dead links on the tool pages", dead.length===0, JSON.stringify(dead));
  await ctx.close(); });

await browser.close(); srv.close();
finish();
