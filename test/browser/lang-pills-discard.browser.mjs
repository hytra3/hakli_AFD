// 11-10, from the field: one way of naming languages, and a way out of Add.
//  · Pills mark translations and a note's language; bold amber marks Hakli. The
//    open card's English and Arabic each carry a pill; a closed card in the list
//    shows none. Add's translation boxes are named by the same pills.
//  · Add: "Back to the dictionary" on the first step (the word waits);
//    "Throw this word away" once there's something to lose — asks, Keep is the
//    safe answer; throwing away clears the draft and goes to the dictionary.
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const ME = { uid:"uP1", isAnonymous:false, displayName:"S", email:"s@e.org" };
const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };

await scenario("card: translations carry pills once the card is open", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:{}, init:AUTO });
  await page.goto(srv.url + "/index.html");
  await page.waitForFunction(()=> [...document.querySelectorAll(".card")].some(c=>/^sun\b/.test((c.querySelector(".gloss")||{}).innerText||"")), null, { timeout:10000 }).catch(()=>{});
  const pills = ()=> page.evaluate(()=>{ const c=[...document.querySelectorAll(".card")].find(c=>/^sun\b/.test((c.querySelector(".gloss")||{}).innerText||""));
    return c && [...c.querySelectorAll(".head .gloss .lang-pill")].filter(p => getComputedStyle(p).display !== "none").map(p => p.dataset.lang + ":" + p.textContent); });
  const closed = await pills();
  ok("in the list (closed): no pills showing", Array.isArray(closed) && closed.length === 0, JSON.stringify(closed));
  await page.evaluate(()=>{ const c=[...document.querySelectorAll(".card")].find(c=>/^sun\b/.test((c.querySelector(".gloss")||{}).innerText||"")); c.querySelector(".head .gloss").click(); });
  await page.waitForTimeout(1200);
  const open = await pills();
  await shot(page, "pills-card");
  ok("open: 'sun' has an English pill and 'الشمس' an Arabic one", JSON.stringify(open) === JSON.stringify(["en:English","ar:عربي"]), JSON.stringify(open));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

const sayWord = async (page)=>{
  await page.dispatchEvent("#sayBtn","pointerdown",{pointerId:1,pointerType:"touch",isPrimary:true,bubbles:true}); await page.waitForTimeout(1600);
  await page.dispatchEvent("#sayBtn","pointerup",{pointerId:1,pointerType:"touch",isPrimary:true,bubbles:true}); await page.waitForTimeout(1500); };
const vis = (page, id)=> page.evaluate((id)=>{ const e=document.getElementById(id); return !!e && !e.hidden && !e.closest("[hidden]"); }, id);

await scenario("Add: the translation boxes are named by pills", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:{}, user:ME, init:AUTO });
  await page.goto(srv.url + "/add.html"); await page.waitForTimeout(1200);
  await sayWord(page); await page.click("#sayNext"); await page.waitForTimeout(300);
  await page.click("#tileWrite"); await page.waitForTimeout(300);
  const l = await page.evaluate(()=>({ ar: document.getElementById("lblAr").innerText.trim(), en: document.getElementById("lblEn").innerText.replace(/\s+/g," ").trim(),
    arPill: !!document.querySelector('#lblAr .lang-pill[data-lang="ar"]'), enPill: !!document.querySelector('#lblEn .lang-pill[data-lang="en"]') }));
  ok("Arabic box: the عربي pill; English box: the English pill + (if you like)", l.arPill && l.enPill && l.ar==="عربي" && /English/.test(l.en) && /if you like/.test(l.en) && /إن شئت/.test(l.en), JSON.stringify(l));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("Add: leave from the first step; throw a word away (asks first)", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:{}, user:ME, init:AUTO });
  await page.goto(srv.url + "/add.html"); await page.waitForTimeout(1200);
  ok("first step, nothing recorded: 'Back to the dictionary', no throw-away", (await vis(page,"leaveBtn")) && !(await vis(page,"discardBtn")));
  ok("'Back to the dictionary' goes to the dictionary", (await page.getAttribute("#leaveBtn","href")) === "index.html");
  await sayWord(page);
  ok("after recording: 'Throw this word away' appears", await vis(page,"discardBtn"));
  await page.click("#sayNext"); await page.waitForTimeout(300);
  ok("second step: no 'Back to the dictionary' (it has Back), throw-away still there", !(await vis(page,"leaveBtn")) && (await vis(page,"discardBtn")));
  await page.click("#discardBtn"); await page.waitForSelector(".afd-ask", { timeout:3000 });
  const q = await page.evaluate(()=>({ t: document.querySelector(".afd-ask").innerText, danger: !!document.querySelector(".afd-ask .ask-danger") }));
  await shot(page, "add-discard-ask");
  ok("it asks, in red, with 'Keep it'", /Throw this word away\?/.test(q.t) && /تتخلّص/.test(q.t) && /Keep it/.test(q.t) && q.danger, JSON.stringify(q));
  await page.click(".afd-ask .ask-no"); await page.waitForTimeout(300);
  ok("'Keep it': still on Add, the word still there", /add\.html/.test(page.url()) && (await page.evaluate(()=> !document.getElementById("show").hidden)));
  await page.click("#discardBtn"); await page.waitForSelector(".afd-ask"); await page.click(".afd-ask .ask-yes");
  await page.waitForURL(/index\.html/, { timeout:5000 }).catch(()=>{});
  ok("'Throw it away': back in the dictionary", /index\.html/.test(page.url()), page.url());
  await page.goto(srv.url + "/add.html"); await page.waitForTimeout(1200);
  ok("…and Add starts fresh: no 'word waiting' banner", await page.evaluate(()=> document.getElementById("draftBanner").classList.contains("hidden")));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
