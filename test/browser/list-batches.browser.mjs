// 10-19: the word list in batches. Past 150 words the dictionary puts cards on
// the page 60 at a time as the list scrolls; typed search shows every match.
// Up to 150 words, nothing changes (one go, as before).
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
const many = (n) => { const fs = {};
  for(let i=0;i<n;i++) fs[`afd_entries/ent_u_${String(i).padStart(4,"0")}`] =
    { source:"user", createdBy:"uX", gloss:"word"+i, glossAr:"كلمة"+i, pic:"🔹", createdAt:{ __ts: Date.now()-i*1000 }, voices:{ word:1, context:0, definition:0 } };
  return fs; };
const cards = (page)=> page.evaluate(()=> document.querySelectorAll("#results > .card").length);

await scenario("a short list goes on in one go", async ()=>{
  const { page, ctx } = await newPage(browser, srv.url, { fs:many(20), init:AUTO });
  await page.goto(srv.url + "/index.html");
  await page.waitForFunction(()=> document.querySelectorAll("#results > .card").length > 3, null, { timeout:15000 });
  await page.waitForTimeout(400);
  const n = await cards(page), mark = await page.$(".list-more");
  const total = await page.evaluate(()=> (window.AFDWords||[]).length) + 20;
  ok("every card at once, no 'more' marker", n === total && !mark, JSON.stringify({ n, total, mark: !!mark }));
  await ctx.close();
});

await scenario("a long list: 60 first, more as it scrolls, all of them in the end", async ()=>{
  const { page, ctx, state } = await newPage(browser, srv.url, { fs:many(300), init:AUTO });
  await page.goto(srv.url + "/index.html");
  await page.waitForFunction(()=> document.querySelectorAll("#results > .card").length > 3, null, { timeout:20000 });
  await page.waitForTimeout(400);
  const first = await cards(page), total = await page.evaluate(()=> (window.AFDWords||[]).length) + 300;
  ok("the first batch is 60 cards, with the marker under it", first === 60 && !!(await page.$(".list-more")), JSON.stringify({ first }));
  for(let i=0;i<12 && (await cards(page)) < total;i++){
    await page.evaluate(()=> window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(250);
  }
  const end = await cards(page);
  ok("scrolling brings the rest, and the marker goes", end === total && !(await page.$(".list-more")), JSON.stringify({ end, total }));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await scenario("typed search on a long list finds a word that wasn't on the page yet", async ()=>{
  const { page, ctx } = await newPage(browser, srv.url, { fs:many(300), init:AUTO });
  await page.goto(srv.url + "/index.html");
  await page.waitForFunction(()=> document.querySelectorAll("#results > .card").length > 3, null, { timeout:20000 });
  await page.waitForTimeout(400);
  await page.click("#typeBtn"); await page.fill("#typeIn", "word299"); await page.waitForTimeout(800);
  const shown = await page.evaluate(()=> [...document.querySelectorAll("#results > .card")].filter(c => c.style.display !== "none").map(c => c.innerText.replace(/\s+/g, " ")));
  ok("'word299' (card 345 of 345) is found and shown", shown.length === 1 && /word299/.test(shown[0]), JSON.stringify(shown));
  await ctx.close();
});

await browser.close(); srv.close();
finish();
