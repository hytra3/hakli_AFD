// 10-19: voices already heard are kept on the phone (afd-voices.js), so they
// play again with no signal — within limits, trimmed hard when the phone is low
// on space, dropped when withdrawn, and removable from Help.
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const INIT = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ }
  globalThis.__URLS = { "afd/uA/r1.webm": location.origin + "/test/browser/fixtures/voice.wav",
                        "afd/uA/r2.webm": location.origin + "/test/browser/fixtures/voice.wav?2" }; };
const take = (id, extra) => ({ recordingId:id, entryId:"ent_sun", uid:"uA", speakerId:"spk_uA_01", type:"word", viaAgent:false,
  consent:"public", allowPlayback:true, storagePath:`afd/uA/${id}.webm`, envelope:[], uploadedAt:{ __ts: Date.now() }, ...extra });
const FS = () => ({
  "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس", pic:"☀️", voices:{ word:2, context:0, definition:0 } },
  "afd_entries/ent_sun/recordings/r1": take("r1"),
  "afd_entries/ent_sun/recordings/r2": take("r2", { type:"context" }),
});
const saved = (page)=> page.evaluate(async ()=>{
  const ix = JSON.parse(localStorage.getItem("afd.voices") || "{}");
  const c = await caches.open("afd-voices-v1"); const keys = (await c.keys()).map(r => r.url.split("/__voice/")[1]);
  return { index: Object.keys(ix).sort(), cached: keys.sort() }; });
const openSun = async (page)=>{
  await page.evaluate(()=>{ location.hash = "ent_moon"; }); await page.waitForTimeout(500);
  await page.evaluate(()=>{ location.hash = "ent_sun"; });
  await page.waitForSelector(".card.open .slot-word", { timeout:10000 }); await page.waitForTimeout(600); };

await scenario("a voice that plays is kept; offline it plays again; the others say 'no signal'", async ()=>{
  const { page, ctx, state } = await newPage(browser, srv.url, { fs:FS(), init:INIT });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".card.open .slot-word", { timeout:10000 }); await page.waitForTimeout(600);
  const before = await saved(page);
  await page.evaluate(()=> document.querySelector(".card.open .play").click());
  await page.waitForFunction(()=> Object.keys(JSON.parse(localStorage.getItem("afd.voices") || "{}")).length > 0, null, { timeout:8000 }).catch(()=>{});
  const after = await saved(page);
  ok("nothing kept until a voice plays; then the voice that played is kept", before.index.length===0 && after.index.join()==="r1" && after.cached.join()==="r1", JSON.stringify({ before, after }));
  await ctx.setOffline(true);
  await openSun(page);
  const off = await page.evaluate(()=>({
    rows: document.querySelectorAll(".card.open .slot-word .voice-row, .card.open .slot-word .vrow, .card.open .slot-word .av").length,
    note: (document.querySelector(".card.open .novoice.offline")||{}).innerText || "" }));
  await shot(page, "voices-offline");
  ok("offline: the heard voice is there to play, and the note says only heard voices can play", off.rows > 0 && /heard before/.test(off.note), JSON.stringify(off));
  const played = await page.evaluate(async ()=>{
    const srcs = []; const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(){ srcs.push(this.src); return orig.call(this); };
    document.querySelector(".card.open .play").click();
    await new Promise(r=>setTimeout(r,800)); return srcs; });
  ok("offline: it plays from the phone's copy (a blob: address)", played.some(s => s.startsWith("blob:")), JSON.stringify(played));
  await ctx.setOffline(false);
  ok("no page errors", !state.errors.filter(e=>!/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e)).length, state.errors.join(" | "));
  await ctx.close();
});

await scenario("a withdrawn voice is dropped from the phone next time the word opens with signal", async ()=>{
  const { page, ctx } = await newPage(browser, srv.url, { fs:FS(), init:INIT });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".card.open .slot-word", { timeout:10000 }); await page.waitForTimeout(600);
  await page.evaluate(()=> document.querySelector(".card.open .play").click());
  await page.waitForFunction(()=> Object.keys(JSON.parse(localStorage.getItem("afd.voices") || "{}")).length > 0, null, { timeout:8000 }).catch(()=>{});
  await page.evaluate(()=>{ const r = globalThis.__FS["afd_entries/ent_sun/recordings/r1"]; r.allowPlayback = false; r.consent = "withdrawn"; });
  await openSun(page);
  const s = await saved(page);
  ok("withdrawn → gone from the phone", !s.index.includes("r1") && !s.cached.includes("r1"), JSON.stringify(s));
  await ctx.close();
});

await scenario("phone low on space: only the last 40 kept; nothing older than 60 days", async ()=>{
  const { page, ctx } = await newPage(browser, srv.url, { fs:FS(), init:()=>{
    try{ Object.defineProperty(navigator.storage, "estimate", { value: async ()=>({ usage: 9.9e9, quota: 1e10 }) }); }catch(_){}
    const now = Date.now(), ix = {};
    for(let i=0;i<60;i++) ix["v"+i] = { entry:"ent_x", bytes:20000, at: now - i*1000 };
    ix.old = { entry:"ent_x", bytes:20000, at: now - 61*864e5 };
    localStorage.setItem("afd.voices", JSON.stringify(ix)); } });
  await page.goto(srv.url + "/help.html"); await page.waitForTimeout(1500);
  const r = await page.evaluate(()=>{ const ix = JSON.parse(localStorage.getItem("afd.voices") || "{}");
    return { n: Object.keys(ix).length, newest: !!ix.v0, oldestKept: !!ix.v39, dropped: !ix.v40, old: !ix.old }; });
  ok("trimmed to the 40 played most recently; the 61-day-old one gone", r.n===40 && r.newest && r.oldestKept && r.dropped && r.old, JSON.stringify(r));
  await ctx.close();
});

await scenario("Help shows the saved voices and removes them", async ()=>{
  const { page, ctx, state } = await newPage(browser, srv.url, { fs:FS(), init:INIT });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".card.open .slot-word", { timeout:10000 }); await page.waitForTimeout(600);
  await page.evaluate(()=> document.querySelector(".card.open .play").click());
  await page.waitForFunction(()=> Object.keys(JSON.parse(localStorage.getItem("afd.voices") || "{}")).length > 0, null, { timeout:8000 }).catch(()=>{});
  await page.goto(srv.url + "/help.html?lang=en"); await page.waitForTimeout(1500);
  const shown = await page.evaluate(()=>({ hidden: document.getElementById("saved").hidden, n: document.getElementById("savedN").innerText }));
  await page.evaluate(()=> document.getElementById("saved").scrollIntoView()); await shot(page, "help-saved");
  await page.click("#savedClear"); await page.waitForTimeout(500);
  const s = await saved(page), done = await page.isVisible("#savedDone");
  ok("Help: 'Voices: 1 · … MB' is shown", !shown.hidden && /^Voices: 1 · /.test(shown.n), JSON.stringify(shown));
  ok("Remove empties it, and says so", s.index.length===0 && s.cached.length===0 && done, JSON.stringify({ s, done }));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await browser.close(); srv.close();
finish();
