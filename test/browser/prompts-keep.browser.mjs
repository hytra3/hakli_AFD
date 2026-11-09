// The prompts tool keeps a take when the card moves on (11-09, in the field):
// "✓ Keep it" is drawn as the chosen button, so helpers tapped Next → and lost
// the take. Now Next, Back, a row in the list, the other tab or "Go to next
// unrecorded" all keep it first, for the line it was recorded on. Only ↻ Redo
// throws a take away. Moving on while still recording stops and keeps it too.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const OPEN = { "afd_ui_config/recording": { openUntil:{ __ts: Date.now() + 3600e3 } } };

const open = async ()=>{ const t = await newPage(browser, srv.url, { fs:OPEN });
  await t.page.goto(srv.url + "/prompts/index.html#R1.1");
  await t.page.waitForSelector("#app:not(.hidden)", { timeout:15000 });
  await t.page.waitForFunction(()=> !document.getElementById("recbtn").classList.contains("hidden") && !document.getElementById("recbtn").disabled, null, { timeout:8000 });
  return t; };
const take = async (page)=>{ await page.click("#recbtn"); await page.waitForTimeout(700); await page.click("#recbtn");
  await page.waitForSelector("#review:not(.hidden)", { timeout:5000 }); };
const cur = (page)=> page.evaluate(()=> location.hash.slice(1));
const dot = (page, num)=> page.evaluate((num)=>{ for(const r of document.querySelectorAll("#list .row"))
  if(r.querySelector(".num").textContent.trim()===num) return r.querySelector(".dot").className; return null; }, num);
const kept = (page, num)=> page.waitForFunction((num)=>{ for(const r of document.querySelectorAll("#list .row"))
  if(r.querySelector(".num").textContent.trim()===num) return /done|pend/.test(r.querySelector(".dot").className); return false; }, num, { timeout:5000 }).then(()=>true, ()=>false);
const uploaded = (page, key)=> page.waitForFunction((key)=> !!(globalThis.__FS||{})["afd_ui_prompts/"+key], key, { timeout:5000 }).then(()=>true, ()=>false);

await scenario("Next → keeps the take on the line it was recorded on", async ()=>{
  const { page, state } = await open();
  await take(page);
  await page.click("#next"); await page.waitForTimeout(300);
  ok("the card moved to R1.2", (await cur(page)) === "R1.2", await cur(page));
  ok("R1.1 is marked kept", await kept(page, "R1.1"), await dot(page, "R1.1"));
  ok("…and uploaded for intro.tour.what", await uploaded(page, "intro.tour.what"));
  ok("R1.2 starts fresh (Record, no review)", await page.evaluate(()=> document.getElementById("review").classList.contains("hidden") && document.getElementById("recbtn").textContent==="Record"));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("Back, a row, the other tab and next-unrecorded keep it too; Redo does not", async ()=>{
  const { page, state } = await open();
  await page.click("#next"); await page.waitForTimeout(200);          // R1.2
  await take(page); await page.click("#prev"); await page.waitForTimeout(300);
  ok("← Back keeps R1.2", await kept(page, "R1.2"), await dot(page, "R1.2"));
  await take(page);                                                    // on R1.1
  await page.evaluate(()=>{ for(const r of document.querySelectorAll("#list .row")) if(r.querySelector(".num").textContent.trim()==="R1.5"){ r.click(); return; } });
  await page.waitForTimeout(300);
  ok("tapping a row keeps R1.1", await kept(page, "R1.1"), await dot(page, "R1.1"));
  await take(page); await page.click("#tabReview"); await page.waitForTimeout(300);
  await page.click("#tabRecord"); await page.waitForTimeout(300);
  ok("switching to the Arabic tab keeps R1.5", await kept(page, "R1.5"), await dot(page, "R1.5"));
  await page.evaluate(()=>{ for(const r of document.querySelectorAll("#list .row")) if(r.querySelector(".num").textContent.trim()==="R1.3"){ r.click(); return; } });
  await page.waitForTimeout(300);
  await take(page); await page.click("#nextpending"); await page.waitForTimeout(300);
  ok("Go to next unrecorded keeps R1.3", await kept(page, "R1.3"), await dot(page, "R1.3"));
  await page.evaluate(()=>{ for(const r of document.querySelectorAll("#list .row")) if(r.querySelector(".num").textContent.trim()==="R1.6"){ r.click(); return; } });
  await page.waitForTimeout(300);
  await take(page); await page.click("#redo"); await page.click("#next"); await page.waitForTimeout(500);
  ok("↻ Redo then Next keeps nothing for R1.6", !(await kept(page, "R1.6")), await dot(page, "R1.6"));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("Next while still recording stops and keeps the take", async ()=>{
  const { page, state } = await open();
  await page.click("#recbtn"); await page.waitForTimeout(700);
  await page.click("#next"); await page.waitForTimeout(500);
  ok("R1.1 kept", await kept(page, "R1.1"), await dot(page, "R1.1"));
  ok("the recorder is stopped, R1.2 shows Record", await page.evaluate(()=> document.getElementById("recbtn").textContent==="Record" && !document.getElementById("recbtn").classList.contains("rec")));
  ok("✓ Keep it still keeps and moves on as before", await (async ()=>{ await take(page); await page.click("#keep"); await page.waitForTimeout(300);
    return (await kept(page, "R1.2")) && (await cur(page)) !== "R1.2"; })());
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
