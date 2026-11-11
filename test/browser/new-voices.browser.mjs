// "+n 🔊" — new voices on a word this phone has a voice on (feedback(), afd-card.js).
// 11-08 (Dhofar): the badge never cleared on a phone that remembered a count but
// no longer found a voice of its own on the word. Opening the card now always
// counts as seen.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const take = (id, uid, extra) => ({ recordingId:id, entryId:"ent_sun", uid, speakerId:`spk_${uid}_01`, type:"word", viaAgent:false,
  consent:"public", allowPlayback:true, storagePath:`afd/${uid}/${id}.webm`, envelope:[], uploadedAt:{ __ts: Date.now() }, ...extra });
const FS = () => ({
  "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس", pic:"☀️" },
  "afd_entries/ent_sun/recordings/r1": take("r1", "uA"),
  "afd_entries/ent_sun/recordings/r2": take("r2", "uB"),
});
const seen3 = ()=>{ try{ localStorage.setItem("afd_display_mode","bridge"); localStorage.setItem("afd.seen.ent_sun","1"); }catch(_){ } };
const badge = (page)=> page.evaluate(()=>{ const t=document.querySelector('.thumb[data-entry="ent_sun"]');
  const b=t && t.closest(".card").querySelector(".fb-new"); return b ? b.textContent : null; });

await scenario("a remembered count with no voice of mine: opening the card clears the badge", async ()=>{
  const ME = { uid:"uC", isAnonymous:false, displayName:null, email:"c@example.org", providerData:[{ providerId:"phone" }] };
  const { page, state } = await newPage(browser, srv.url, { fs:FS(), user:ME, init:seen3 });
  await page.goto(srv.url + "/index.html");
  await page.waitForSelector('.thumb[data-entry="ent_sun"]', { timeout:15000 }); await page.waitForTimeout(800);
  ok("the badge shows: 2 voices now, 1 remembered", /^\+1/.test(await badge(page) || ""), String(await badge(page)));
  await page.evaluate(()=>{ location.hash = "ent_sun"; });
  await page.waitForSelector(".card.open .slot-word", { timeout:10000 }); await page.waitForTimeout(800);
  ok("opening the card clears it", (await badge(page)) === null, String(await badge(page)));
  ok("…and remembers the new count", (await page.evaluate(()=> localStorage.getItem("afd.seen.ent_sun"))) === "2");
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("a phone that never had a voice on it gets no badge and stores nothing", async ()=>{
  const { page } = await newPage(browser, srv.url, { fs:FS(), init:()=>{ try{ localStorage.setItem("afd_display_mode","bridge"); }catch(_){ } } });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".card.open .slot-word", { timeout:10000 }); await page.waitForTimeout(800);
  ok("no badge", (await badge(page)) === null);
  ok("nothing remembered", (await page.evaluate(()=> localStorage.getItem("afd.seen.ent_sun"))) === null);
});

await browser.close(); srv.close();
finish();
