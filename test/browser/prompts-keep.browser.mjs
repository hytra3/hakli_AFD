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
  ok("R1.2 starts fresh (Record, no review)", await page.evaluate(()=> document.getElementById("review").classList.contains("hidden") && document.getElementById("recbtn").dataset.state==="idle"));
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
  ok("the recorder is stopped, R1.2 shows Record", await page.evaluate(()=> document.getElementById("recbtn").dataset.state==="idle" && !document.getElementById("recbtn").classList.contains("rec")));
  ok("✓ Keep it still keeps and moves on as before", await (async ()=>{ await take(page); await page.click("#keep"); await page.waitForTimeout(300);
    return (await kept(page, "R1.2")) && (await cur(page)) !== "R1.2"; })());
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

// 11-10, from the field: the button was tap-to-start / tap-to-stop with no cue,
// while every other record button in the app is hold-to-speak. Now both work,
// and the button and the line under it always say what stops it.
const state_ = (page)=> page.evaluate(()=>({ st: document.getElementById("recbtn").dataset.state,
  lb: document.querySelector("#recbtn .lb").textContent, hint: document.getElementById("rechint").innerText.replace(/\s+/g," "),
  ring: getComputedStyle(document.getElementById("recbtn"), "::after").animationName,
  review: !document.getElementById("review").classList.contains("hidden") }));
await scenario("record button: hold and speak, let go to stop", async ()=>{
  const { page, state } = await open();
  let s = await state_(page);
  ok("idle: says hold or tap, in English and Arabic", s.st==="idle" && /Hold and speak, or tap/.test(s.hint) && /اضغط باستمرار/.test(s.hint), JSON.stringify(s));
  const b = await (await page.$("#recbtn")).boundingBox();
  await page.mouse.move(b.x + b.width/2, b.y + b.height/2); await page.mouse.down(); await page.waitForTimeout(700);
  s = await state_(page);
  ok("while held: Recording, 'let go to stop', and a pulsing ring", s.st==="hold" && s.lb==="Recording" && /let go to stop/.test(s.hint) && /أفلت/.test(s.hint) && s.ring==="recpulse", JSON.stringify(s));
  await page.mouse.up(); await page.waitForTimeout(400);
  s = await state_(page);
  ok("letting go stops it and shows Keep / Redo", s.st==="idle" && s.review && s.lb==="Record again", JSON.stringify(s));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});
await scenario("record button: a tap starts it, the next tap stops it", async ()=>{
  const { page, state } = await open();
  await page.click("#recbtn"); await page.waitForTimeout(600);
  let s = await state_(page);
  ok("after a tap: still recording, 'Tap to stop', 'tap ■ to stop'", s.st==="tap" && s.lb==="Tap to stop" && /tap ■ to stop/.test(s.hint) && /انقر ■/.test(s.hint), JSON.stringify(s));
  await page.click("#recbtn"); await page.waitForTimeout(400);
  s = await state_(page);
  ok("the second tap stops it", s.st==="idle" && s.review, JSON.stringify(s));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
