// Every wait on the network shows the resin dots (10-15): the recorder's word
// card (first load, and the next word over the faded old one), the steward
// list, the prompts tool while it signs in and loads. __FS_DELAY slows the
// mocked Firestore so the wait is long enough to see.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const FS = { "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس", pic:"☀️" },
             "afd_entries/ent_moon": { gloss:"moon", glossAr:"القمر", pic:"🌙" } };
const STEW = { uid:"uSteward", isAnonymous:false, displayName:null, email:"steward@example.org", providerData:[{ providerId:"password" }] };
const slow = new Function(`globalThis.__FS_DELAY = 1500; try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ }`);
const dotsIn = (page, sel)=> page.evaluate((sel)=> !!document.querySelector(sel + " .afd-dots"), sel);

await scenario("recorder: the word card's wait shows dots", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init:slow });
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(800);
  await page.click("#listenOnlyBtn"); await page.waitForSelector("#recorder:not(.hidden)", { timeout:8000 });
  await page.waitForTimeout(300);
  ok("first load: dots in the empty card box", await dotsIn(page, "#entryCardHost"));
  await page.waitForSelector("#entryCardHost .card", { timeout:10000 }); await page.waitForTimeout(200);
  ok("…gone once the card is drawn", !(await dotsIn(page, "#entryCardHost")));
  await page.click("#nextWord"); await page.waitForTimeout(300);
  const mid = await page.evaluate(()=>({ dots: !!document.querySelector("#entryCardHost .host-wait.over .afd-dots"),
    old: !!document.querySelector("#entryCardHost .card"), faded: document.getElementById("entryCardHost").classList.contains("swapping") }));
  ok("next word: dots over the faded old card", mid.dots && mid.old && mid.faded, JSON.stringify(mid));
  await page.waitForFunction(()=> !document.querySelector("#entryCardHost .host-wait"), null, { timeout:10000 });
  ok("…gone once the new card is in", !(await page.evaluate(()=> document.getElementById("entryCardHost").classList.contains("swapping"))));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("steward list and prompts tool show dots while loading", async ()=>{
  { const { page } = await newPage(browser, srv.url, { fs:{ ...FS, "afd_admins/uSteward":{ grantedAt:1 } }, user:STEW, init:slow });
    await page.goto(srv.url + "/steward.html"); await page.waitForTimeout(700);
    ok("steward: dots while the words load", await dotsIn(page, "#list")); }
  { const { page } = await newPage(browser, srv.url, { fs:FS, init:slow });
    await page.goto(srv.url + "/prompts/index.html"); await page.waitForTimeout(400);
    ok("prompts tool: dots while it signs in and loads", await dotsIn(page, "#appWait"));
    await page.waitForSelector("#app:not(.hidden)", { timeout:15000 });
    ok("…gone once it's drawn", !(await dotsIn(page, "#appWait"))); }
});

await browser.close(); srv.close();
finish();
