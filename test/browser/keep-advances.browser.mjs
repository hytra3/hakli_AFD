// Keep must complete and reveal the compare card — the one control that leads on
// to the next word. Regression guard for two faults seen 2026-11-16:
//   · speakerRecord() read `currentUser`, which lives in the firebase <script
//     type="module"> scope and is invisible to the classic recorder script, so
//     every Keep threw ReferenceError — nothing was kept and step 3 was a dead
//     end (#122).
//   · the note slot asks the note language on keep; the picker must resolve and
//     the keep must carry on through to the compare card, where "Next word"
//     (#121, now the primary action) is the way on.
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const USER = { uid:"uTest1", isAnonymous:false, displayName:"Test", email:"t@example.com" };
const FS = { "afd_entries/ent_camel": { gloss:"camel", glossAr:"جمل", pic:"🐪" } };
// bridge mode so any English lines show; matches the other recorder tests
const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","bridge"); }catch(_){ } };

const toRecorder = async (page)=>{
  await page.click("#toMic"); await page.waitForSelector("#miccheck:not(.hidden)", { timeout:8000 });
  if(await page.isVisible("#startMic").catch(()=>false)){ await page.click("#startMic"); await page.waitForSelector("#toRecord:not(.hidden)", { state:"visible", timeout:10000 }); }
  await page.click("#toRecord"); await page.waitForSelector("#recorder:not(.hidden)", { timeout:8000 }); await page.waitForTimeout(700); };
const record = async (page, ms=1300)=>{
  await page.dispatchEvent("#recBtn","pointerdown",{ pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(ms);
  await page.dispatchEvent("#recBtn","pointerup",{ pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForSelector("#reviewCard:not(.hidden)", { timeout:8000 }); };
// a returning speaker with a spoken-consent proof on file skips the consent gate
const seedProof = (page)=> page.evaluate(()=>{ const spk=(document.getElementById("spkId").value||"").trim();
  globalThis.__FS["afd_speakers/"+spk]={ stewardUid:"uTest1", consent:"public", grant:{ audioPath:"afd_consents/uTest1/g.webm" } }; });
const afterKeep = (page)=> page.evaluate(()=>({
  reviewHidden: document.getElementById("reviewCard").classList.contains("hidden"),
  compareShown: !document.getElementById("compareCard").classList.contains("hidden"),
  nextVisible: (()=>{ const b=document.getElementById("compareNext"); return !!(b && !b.classList.contains("hidden") && b.offsetParent!==null); })() }));

// 1. Word slot: Keep saves the take and reveals the compare card with "Next word".
await scenario("word slot: Keep saves the take and reveals the compare card with Next word", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:USER, init:AUTO });
  await page.goto(srv.url + "/recorder.html#ent_camel"); await page.waitForTimeout(1400);
  await toRecorder(page);
  await seedProof(page);
  await record(page);
  await page.click("#keepBtn");
  await page.waitForSelector("#compareCard:not(.hidden)", { timeout:8000 }).catch(()=>{});
  const s = await afterKeep(page); await shot(page, "keep-advances-word");
  ok("the review card closes after Keep", s.reviewHidden, JSON.stringify(s));
  ok("the compare card (the way to the next word) appears", s.compareShown, JSON.stringify(s));
  ok("'Next word' is visible as the way on", s.nextVisible, JSON.stringify(s));
  ok("no page errors (no currentUser ReferenceError)", !state.errors.length, state.errors.join(" | "));
});

// 2. Note slot: Keep asks the note language; after a pick, the keep must finish.
await scenario("note slot: picking the note language lets Keep finish through to the compare card", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:USER, init:AUTO });
  await page.goto(srv.url + "/recorder.html#ent_camel|note"); await page.waitForTimeout(1400);
  await toRecorder(page);
  await seedProof(page);
  await record(page);
  await page.click("#keepBtn");
  await page.waitForSelector(".afd-ask .ask-cpick", { timeout:8000 });    // the note-language picker
  await page.click(".afd-ask .ask-choice:nth-child(1) .ask-cpick");       // Hakli
  await page.waitForSelector("#compareCard:not(.hidden)", { timeout:8000 }).catch(()=>{});
  const s = await afterKeep(page); await shot(page, "keep-advances-note");
  ok("after choosing a language, the review card closes", s.reviewHidden, JSON.stringify(s));
  ok("the compare card appears — no dead-end after the picker", s.compareShown, JSON.stringify(s));
  ok("'Next word' is visible as the way on", s.nextVisible, JSON.stringify(s));
  ok("no page errors (no currentUser ReferenceError)", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
