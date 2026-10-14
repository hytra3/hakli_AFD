// Waiting, made visible (10-14): while an opening card loads its voices, three
// bouncing dots sit in it; while a tapped word's voice is on its way, the play
// button shows the dots in place of its triangle. Both go once it's ready.
// Also: a word with no picture shows the identicon in every tier.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const FS = {
  "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس" },
  "afd_entries/ent_sun/recordings/r1": { recordingId:"r1", entryId:"ent_sun", uid:"uX", speakerId:"spk_x_01", type:"word",
    consent:"public", allowPlayback:true, storagePath:"afd/uX/r1.webm", envelope:[] },
};
const init = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ }
  globalThis.__URLS = { "afd/uX/r1.webm":"data:audio/wav;base64," }; };
const sunCard = `[...document.querySelectorAll("#results .card")].find(c=>/^sun/.test(c.querySelector(".gloss").textContent))`;

await scenario("dots while a card opens, gone when its voices are in", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init });
  await page.goto(srv.url + "/index.html"); await page.waitForTimeout(1800);
  await page.evaluate(()=>{ globalThis.__FS_DELAY = 1200; });
  await page.evaluate(`${sunCard}.querySelector(".head .gloss").click()`);
  await page.waitForTimeout(600);
  const during = await page.evaluate(`({ dots: !!${sunCard}.querySelector(".detail .ldots-row"), slots: !!${sunCard}.querySelector(".slot-word") })`);
  await page.waitForTimeout(1400);
  const after = await page.evaluate(`({ dots: !!${sunCard}.querySelector(".detail .ldots-row"), slots: !!${sunCard}.querySelector(".slot-word") })`);
  ok("loading: the dots show in the opening card", during.dots && !during.slots, JSON.stringify(during));
  ok("loaded: the dots are gone and the slots are in", !after.dots && after.slots, JSON.stringify(after));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("dots on the play button while the voice is on its way", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init });
  await page.goto(srv.url + "/index.html"); await page.waitForTimeout(1800);
  await page.evaluate(()=>{ globalThis.__FS_DELAY = 1200; });
  await page.evaluate(`${sunCard}.querySelector(".play").click()`);
  await page.waitForTimeout(600);
  const during = await page.evaluate(`({ loading: ${sunCard}.querySelector(".play").classList.contains("loading"),
    dotsShown: getComputedStyle(${sunCard}.querySelector(".play .ldots")).display !== "none",
    triHidden: getComputedStyle(${sunCard}.querySelector(".play svg")).display === "none" })`);
  await page.waitForTimeout(1800);
  const after = await page.evaluate(`({ loading: ${sunCard}.querySelector(".play").classList.contains("loading") })`);
  ok("waiting: the play button shows dots instead of the triangle", during.loading && during.dotsShown && during.triHidden, JSON.stringify(during));
  ok("ready: the triangle is back", !after.loading, JSON.stringify(after));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("a word with no picture shows the identicon in every tier", async ()=>{
  for(const mode of ["auto","script"]){
    const { page } = await newPage(browser, srv.url, { fs:{ "afd_entries/ent_u_rain": { source:"user", createdBy:"uX", glossAr:"امطاراً غزيرة" } },
      init:new Function(`try{ localStorage.setItem("afd_display_mode","${mode}"); }catch(_){ }`) });
    await page.goto(srv.url + "/index.html#ent_u_rain"); await page.waitForTimeout(1500);
    const t = await page.evaluate(()=>{ const th=document.querySelector(".card .thumb"); return { svg: !!(th && th.querySelector("svg")), text: th ? th.textContent.trim() : null }; });
    ok(mode + ": identicon, not the word as text", t.svg && !t.text, JSON.stringify(t));
  }
});

await browser.close(); srv.close();
finish();
