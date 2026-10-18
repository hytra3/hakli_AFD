// 10-17: the dictionary without signal. The word list keeps a copy on the phone
// (Firestore's local cache, dictionary page only), and an opened word whose
// voices can't be fetched says "no signal" — it used to say "no voice yet",
// which in the field reads as "nobody has recorded this".
// (The real cache is Firestore's own; here the stand-in only records that the
// page asked for it. What this file checks is what the page SAYS offline.)
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ }
  globalThis.__URLS = { "afd/uA/r1.webm":"data:audio/wav;base64," }; };
const FS = {
  "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس", pic:"☀️", voices:{ word:1, context:0, definition:0 } },
  "afd_entries/ent_sun/recordings/r1": { recordingId:"r1", entryId:"ent_sun", uid:"uA", speakerId:"spk_uA_01",
    type:"word", viaAgent:false, consent:"public", allowPlayback:true, storagePath:"afd/uA/r1.webm", envelope:[] },
};
const note = (page)=> page.evaluate(()=>{ const n=document.querySelector(".card.open .novoice"); return n ? { text:n.innerText, offline:n.classList.contains("offline") } : null; });

await scenario("the dictionary asks for the offline cache; other pages don't", async ()=>{
  for(const [pg, want] of [["index.html", true], ["recorder.html", false], ["add.html", false]]){
    const { page, ctx, state } = await newPage(browser, srv.url, { fs:FS, init:AUTO });
    await page.goto(srv.url + "/" + pg); await page.waitForTimeout(1200);
    const asked = await page.evaluate(()=> globalThis.__FS_CACHE === true);
    ok(pg + (want ? ": keeps a copy of what it reads" : ": keeps no copy (speaker details)"), asked === want, String(asked));
    ok(pg + ": no page errors", !state.errors.length, state.errors.join(" | "));
    await ctx.close();
  }
});

await scenario("online, a word with a voice plays it — no notes", async ()=>{
  const { page, ctx } = await newPage(browser, srv.url, { fs:FS, init:AUTO });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".card.open .voice-row, .card.open .slot-word", { timeout:10000 }); await page.waitForTimeout(500);
  const n = await note(page), rows = await page.locator(".card.open .voice-row, .card.open .vrow, .card.open .slot-word .av").count();
  ok("online: no 'no signal' note, and the voice is listed", !n && rows > 0, JSON.stringify({ n, rows }));
  await ctx.close();
});

await scenario("offline, an opened word says 'no signal', not 'no voice yet'", async ()=>{
  const { page, ctx, state } = await newPage(browser, srv.url, { fs:FS, init:AUTO });
  await page.goto(srv.url + "/index.html");
  await page.waitForFunction(()=> document.querySelectorAll("#results > *").length > 3, null, { timeout:15000 });
  await ctx.setOffline(true);
  await page.evaluate(()=>{ location.hash = "ent_sun"; });
  await page.waitForSelector(".card.open .novoice", { timeout:10000 }).catch(()=>{});
  await page.waitForTimeout(400);
  const n = await note(page);
  await shot(page, "offline-card");
  const noneYet = await page.evaluate(()=> [...document.querySelectorAll(".card.open .slot-empty")].filter(e=>!e.hidden).length);
  ok("offline: no slot claims 'none yet'", noneYet === 0, String(noneYet));
  ok("offline: the card says there's no signal", !!n && n.offline && /No signal/.test(n.text) && !/No voice yet/.test(n.text), JSON.stringify(n));
  // the play button on a word with voices, offline: the same, not "be the first to say it"
  await page.evaluate(()=>{ const b=document.querySelector(".card.open .play"); if(b) b.click(); });
  await page.waitForTimeout(400);
  const all = await page.evaluate(()=> [...document.querySelectorAll(".card.open .novoice")].map(e=>e.innerText).join(" | "));
  ok("offline: tapping play doesn't claim nobody has said it", !/No voice yet/.test(all), all);
  await ctx.setOffline(false);
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await browser.close(); srv.close();
finish();
