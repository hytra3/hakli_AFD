// Switching the view mode (Arabic · English → Arabic → sound) keeps the word you
// had open open, and keeps it where it was on screen (11-01). It used to fold
// every card: the list is redrawn in the new mode.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const FS = {
  "afd_entries/ent_sun":  { gloss:"sun",  glossAr:"الشمس", pic:"☀️" },
  "afd_entries/ent_moon": { gloss:"moon", glossAr:"القمر", pic:"🌙" },
};
const init = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
const openIds = (page)=> page.evaluate(()=> [...document.querySelectorAll("#results > .card.open .thumb[data-entry]")].map(t=>t.dataset.entry));
const topOf = (page, id)=> page.evaluate((id)=>{ const t=document.querySelector(`.thumb[data-entry="${id}"]`); return t ? Math.round(t.closest(".card").getBoundingClientRect().top) : null; }, id);

await scenario("a language switch keeps the open card open and in place", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init });
  await page.goto(srv.url + "/index.html");
  await page.waitForSelector('#results .card .thumb[data-entry="ent_moon"]', { timeout:15000 });
  await page.waitForTimeout(300);
  await page.evaluate(()=> document.querySelector('.thumb[data-entry="ent_moon"]').closest(".card").querySelector(".head").click());
  await page.waitForSelector("#results > .card.open", { timeout:5000 });
  await page.evaluate(()=> document.querySelector('.thumb[data-entry="ent_moon"]').closest(".card").scrollIntoView({ block:"center" }));
  await page.waitForTimeout(300);
  const before = await topOf(page, "ent_moon");
  ok("moon is open before the switch", JSON.stringify(await openIds(page)) === '["ent_moon"]', JSON.stringify(await openIds(page)));

  await page.click("#skin");                       // auto → next mode
  await page.waitForFunction(()=> document.querySelector('#results > .card.open .thumb[data-entry="ent_moon"]'), null, { timeout:10000 });
  await page.waitForTimeout(400);
  ok("after the switch the mode changed", await page.evaluate(()=> document.body.dataset.mode) !== "auto");
  ok("moon is still open after the switch", JSON.stringify(await openIds(page)) === '["ent_moon"]', JSON.stringify(await openIds(page)));
  const after = await topOf(page, "ent_moon");
  ok("moon stays where it was on screen (within a line; the new mode settles the cards above a moment later)", before !== null && after !== null && Math.abs(after - before) <= 16, `before ${before}, after ${after}`);

  await page.click("#skin"); await page.waitForTimeout(800);
  ok("still open after a second switch", JSON.stringify(await openIds(page)) === '["ent_moon"]', JSON.stringify(await openIds(page)));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("with nothing open, a switch opens nothing", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init });
  await page.goto(srv.url + "/index.html");
  await page.waitForSelector('#results .card .thumb[data-entry="ent_moon"]', { timeout:15000 });
  await page.waitForTimeout(300);
  await page.click("#skin"); await page.waitForTimeout(800);
  ok("no card opened by itself", (await openIds(page)).length === 0, JSON.stringify(await openIds(page)));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
