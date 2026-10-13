// The steward page's Coverage tab: which concepts on a standard comparison
// list (data/concepticon.json) have a word card linked to them.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const STEW = { uid:"uSteward", isAnonymous:false, displayName:null, email:"steward@example.org", providerData:[{ providerId:"password" }] };
const FS = {
  "afd_admins/uSteward": { email:"steward@example.org" },
  // seeded cards, linked: FIRE (221) and NOSE (1221) are on Leipzig-Jakarta 100
  "afd_entries/ent_fire":  { gloss:"fire", glossAr:"نار", concepts:["concepticon:221"] },
  "afd_entries/ent_nose":  { gloss:"nose", glossAr:"أنف", concepts:["concepticon:1221"] },
  // a hidden card doesn't count
  "afd_entries/ent_u_x":   { source:"user", gloss:"water", concepts:["concepticon:948"], hiddenAt:{ __ts: 1 } },
  // a card with no links
  "afd_entries/ent_sun":   { gloss:"sun", concepts:[] },
};

await scenario("coverage of the standard lists", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:STEW, init:()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } }, width:640, height:1200 });
  await page.goto(srv.url + "/steward.html"); await page.waitForTimeout(1200);
  await page.click('.tab[data-tab="coverage"]');
  await page.waitForSelector("#covList", { timeout:8000 });
  const r = await page.evaluate(()=>({
    n: document.getElementById("n-coverage").textContent,
    sum: document.querySelector(".covsum").innerText,
    covered: [...document.querySelectorAll(".covl.done li b")].map(b=>b.textContent),
    missing: document.querySelectorAll(".covl:not(.done) li").length,
    who: [...document.querySelectorAll(".covl.done .cw")].map(x=>x.textContent) }));
  ok("Leipzig-Jakarta 100 first: 2 of 100 covered", r.n === "2/100" && /2 of 100/.test(r.sum), JSON.stringify(r));
  ok("covered concepts name the word cards that cover them", r.covered.join() === "FIRE,NOSE" && /fire/.test(r.who[0]), JSON.stringify(r));
  ok("a hidden card doesn't count", !r.covered.includes("WATER") && r.missing === 98, String(r.missing));
  await page.selectOption("#covList", "Swadesh-1955-100"); await page.waitForTimeout(300);
  const s = await page.evaluate(()=>({ n: document.getElementById("n-coverage").textContent,
    covered: [...document.querySelectorAll(".covl.done li b")].map(b=>b.textContent) }));
  ok("switching to Swadesh 100 recounts against that list", /\/100$/.test(s.n) && s.covered.includes("FIRE"), JSON.stringify(s));
  await page.click("#langSwitch"); await page.waitForTimeout(300);
  const ar = await page.evaluate(()=>({ dir: document.documentElement.dir, sum: document.querySelector(".covsum").innerText,
    still: document.querySelector('.tab.on').dataset.tab }));
  ok("Arabic only: the tab stays open, the summary is in Arabic", ar.dir === "rtl" && ar.still === "coverage" && /من/.test(ar.sum) && !/of/.test(ar.sum), JSON.stringify(ar));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
