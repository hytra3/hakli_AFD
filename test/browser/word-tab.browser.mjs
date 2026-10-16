// 10-16, from the first Dhofar speaker: her word for "sun" was filed as a
// MEANING — the recorder kept the last word's tab, so the next word opened on
// Meaning. A new word now starts on the Word tab; a link that names a slot
// (#ent_x|context) still opens on that slot for that word.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const ME = { uid:"uFatma1", isAnonymous:false, displayName:"Fatma", email:"f@example.org", providerData:[{ providerId:"phone" }] };
const seed = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ }
  const rq = indexedDB.open("hakli_recorder", 1);
  rq.onupgradeneeded = e=>{ const d=e.target.result; d.createObjectStore("clips",{keyPath:"recordingId"}); d.createObjectStore("meta",{keyPath:"key"}); };
  rq.onsuccess = e=>{ const d=e.target.result; d.transaction("meta","readwrite").objectStore("meta").put({ key:"speaker", speakerId:"spk_uFatma_01", viaAgent:false,
    consent:{ publicPlayback:true, archivalDeposit:false, mlTraining:false, attribution:"pseudonymous" } }); }; };
const tab = (page)=> page.evaluate(()=> document.getElementById("entryCardHost").getAttribute("data-rectype"));

await scenario("a new word starts on the Word tab", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { user:ME, init:seed });
  await page.goto(srv.url + "/recorder.html#ent_sun|definition"); await page.waitForTimeout(2500);
  const onRec = await page.evaluate(()=> !document.getElementById("recorder").classList.contains("hidden"));
  ok("(setup) the recorder is on screen", onRec);
  ok("a link to sun's meaning opens on the Meaning tab", await tab(page) === "definition", await tab(page));
  await page.click("#wordNext"); await page.waitForTimeout(600);
  ok("→ to the next word: back on the Word tab", await tab(page) === "word", await tab(page));
  // pick Sentence by hand, move on: the next word is on Word again
  await page.evaluate(()=>{ const b=[...document.querySelectorAll("[data-type='context'], [data-rectype-btn='context'], .slot-context .slot-add")][0]; if(b) b.click(); });
  await page.waitForTimeout(400);
  const picked = await tab(page);
  await page.click("#wordNext"); await page.waitForTimeout(600);
  ok("after choosing another slot by hand, the next word is on Word again", await tab(page) === "word", JSON.stringify({ picked, now: await tab(page) }));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
