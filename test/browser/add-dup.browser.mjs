// 10-17: "Is it one of these?" — Add checks whether the word just recorded is
// already in the dictionary. Supports, never blocks: the matcher is asked in the
// background; Share asks only if a card is close; "This word" puts the voice on
// that card; "No — it's a new word" makes a new one; a sleeping matcher is never
// waited for. A typed Arabic gloss / Hakli spelling is a second net.
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const ME = { uid:"uDup1", isAnonymous:false, displayName:"Salim", email:"s@example.org", providerData:[{ providerId:"phone" }] };
const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
const FS = { "afd_entries/ent_water": { gloss:"water", glossAr:"ماء", pic:"💧" } };
const near = (d)=> ()=> ({ status:200, body:{ results:[{ entryId:"ent_water", gloss:"water", distance:d }], corpus_n:5 } });
const sayWord = async (page)=>{
  await page.dispatchEvent("#sayBtn", "pointerdown", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(1600);
  await page.dispatchEvent("#sayBtn", "pointerup", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(1500); };
const toShare = async (page, typeAr)=>{ await sayWord(page); await page.click("#sayNext"); await page.waitForTimeout(400);
  if(typeAr){ await page.click("#tileWrite"); await page.waitForTimeout(200); await page.fill("#glossArIn", typeAr); await page.waitForTimeout(200); }
  await page.click("#showNext"); await page.waitForTimeout(600); };
const counts = (page)=> page.evaluate(()=>{ const fs = globalThis.__FS || {};
  return { newCards: Object.entries(fs).filter(([k,v])=> /^afd_entries\/[^/]+$/.test(k) && v && v.source==="user").length,
           onWater: Object.keys(fs).filter(k=> k.startsWith("afd_entries/ent_water/recordings/")).length }; });
const screen = (page)=> page.evaluate(()=> ["say","show","share","done"].find(id=> !document.getElementById(id).hidden));

async function run(name, { matcher, typeAr }, after){
  await scenario(name, async ()=>{
    const t = await newPage(browser, srv.url, { fs:FS, user:ME, init:AUTO, matcher });
    t.page.on("dialog", d=> d.dismiss().catch(()=>{}));
    await t.page.goto(srv.url + "/add.html"); await t.page.waitForTimeout(1200);
    await toShare(t.page, typeAr);
    const t0 = Date.now();
    await t.page.click("#shareBtn");
    await t.page.waitForFunction(()=> !!document.querySelector(".afd-ask") || !document.getElementById("done").hidden, null, { timeout:15000 }).catch(()=>{});
    t.ms = Date.now() - t0;
    await after(t);
    ok("no page errors", !t.state.errors.length, t.state.errors.join(" | "));
    await t.ctx.close();
  });
}

await run("the word sounds like 'water': asked, and 'This word' joins it", { matcher: near(0.08) }, async ({ page })=>{
  const q = await page.evaluate(()=>{ const a=document.querySelector(".afd-ask"); return a && { text:a.innerText,
    rows:a.querySelectorAll(".ask-choice").length, face:(a.querySelector(".ask-cface")||{}).textContent||"",
    play:!!a.querySelector(".ask-cplay") }; });
  await shot(page, "add-dup");
  ok("asked 'Is it one of these?' with water's picture, name and a ▶", !!q && q.rows===1 && /Is it one of these/.test(q.text) && /ماء/.test(q.text) && /💧/.test(q.face) && q.play && /it's a new word/.test(q.text), JSON.stringify(q));
  await page.click(".ask-cpick");
  await page.waitForFunction(()=> !document.getElementById("done").hidden, null, { timeout:10000 }).catch(()=>{});
  const c = await counts(page), msg = await page.innerText("#doneMsg"), see = await page.getAttribute("#doneSee", "href");
  ok("'This word': the voice goes on water; no second card", c.onWater===1 && c.newCards===0 && /on that word now/.test(msg) && /ent_water/.test(see), JSON.stringify({ c, msg, see }));
});

await run("'No — it's a new word' makes a new card", { matcher: near(0.08) }, async ({ page })=>{
  await page.click(".ask-no");
  await page.waitForFunction(()=> !document.getElementById("done").hidden, null, { timeout:10000 }).catch(()=>{});
  const c = await counts(page);
  ok("a new card, nothing on water", c.newCards===1 && c.onWater===0, JSON.stringify(c));
});

await run("not close enough: no question", { matcher: near(0.22) }, async ({ page })=>{
  const c = await counts(page), asked = !!(await page.$(".afd-ask"));
  ok("distance 0.22: shared as a new word without asking", !asked && (await screen(page))==="done" && c.newCards===1, JSON.stringify({ asked, c }));
});

await run("a sleeping matcher is never waited for", { matcher: ()=>"hang" }, async (t)=>{
  const c = await counts(t.page), asked = !!(await t.page.$(".afd-ask"));
  ok("matcher silent: shared at once as a new word (no long wait)", !asked && c.newCards===1 && t.ms < 6000, JSON.stringify({ asked, c, ms:t.ms }));
});

await run("text net: the typed Arabic matches 'ماء'", { matcher: ()=>({ status:200, body:{ results:[], corpus_n:0 } }), typeAr:"مَاء" }, async ({ page })=>{
  const q = await page.evaluate(()=>{ const a=document.querySelector(".afd-ask"); return a ? a.innerText : ""; });
  ok("no audio match, but the typed Arabic (with a diacritic) finds water", /ماء/.test(q) && /Is it one of these/.test(q), JSON.stringify(q));
  await page.click(".ask-no");
});

await browser.close(); srv.close();
finish();
