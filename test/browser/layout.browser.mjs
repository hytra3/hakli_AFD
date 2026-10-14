// The list layout on a phone (10-14): the mic panel folds into one slim row
// while the list scrolls and opens again at the top; the coverage meter lives
// in the panel; no "Add a word" tile above the list (the panel's + does it);
// list cards are compact. Checked in the bilingual and Arabic-only tiers.
import { ROOT, serve, launch, newPage, ok, scenario, finish, SHOTS } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();

for(const mode of ["auto", "script"]){
  await scenario("list layout folds and unfolds — " + mode, async ()=>{
    const { page, state } = await newPage(browser, srv.url, { width:412, height:880,
      init:new Function(`try{ localStorage.setItem("afd_display_mode","${mode}"); }catch(_){ }`) });
    await page.goto(srv.url + "/index.html"); await page.waitForTimeout(1800);
    const look = ()=> page.evaluate(()=>{ const c=document.querySelector(".control").getBoundingClientRect();
      const cov=document.getElementById("coverage"), cr=cov.getBoundingClientRect();
      const mic=document.getElementById("mic").getBoundingClientRect(), hdr=document.querySelector("header").getBoundingClientRect();
      const cards=[...document.querySelectorAll("#results .card")].map(x=>x.getBoundingClientRect());
      return { compact: document.body.classList.contains("compact"), ctrlH: Math.round(c.height),
        covShown: getComputedStyle(cov).display!=="none", covInPanel: cr.top>=c.top && cr.bottom<=c.bottom+1,
        micBelowHeader: mic.top >= hdr.bottom - 1, micW: Math.round(mic.width),
        tile: !!document.querySelector("#results .addword:not(.askwords)"),
        cardH: cards[0] ? Math.round(cards[0].height) : 0,
        whole: cards.filter(b=>b.top>=c.bottom-1 && b.bottom<=innerHeight).length }; });
    const top = await look();
    ok(mode+": at the top the panel is full, the meter in it, no add tile", !top.compact && top.covShown && top.covInPanel && !top.tile, JSON.stringify(top));
    ok(mode+": list cards are compact (≤ 80px)", top.cardH > 0 && top.cardH <= 80, JSON.stringify(top));
    await page.evaluate(()=>window.scrollBy(0, 500)); await page.waitForTimeout(600);
    const down = await look();
    if(SHOTS) await page.screenshot({ path: `${SHOTS}/layout-${mode}-scrolled.png` });
    ok(mode+": scrolled, the panel folds to a slim row (≤ 100px), mic clear of the header", down.compact && down.ctrlH <= 100 && down.micBelowHeader && down.micW <= 56, JSON.stringify(down));
    ok(mode+": folded, the meter is a line inside the panel", down.covShown && down.covInPanel, JSON.stringify(down));
    ok(mode+": folded, at least 7 whole words on screen", down.whole >= 7, JSON.stringify(down));
    await page.evaluate(()=>window.scrollTo(0, 0)); await page.waitForTimeout(600);
    const back = await look();
    ok(mode+": back at the top, the panel opens again", !back.compact && back.ctrlH > 200, JSON.stringify(back));
    ok(mode+": no page errors", !state.errors.length, state.errors.join(" | "));
  });
}

await browser.close(); srv.close();
finish();
