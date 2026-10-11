// Speak-to-find: what a search says and does when it works, is slow, or fails.
// The matcher is mocked, and the two per-attempt time limits are shortened so
// the timeout path runs in seconds.
import { ROOT, serve, launch, newPage, hold, hintText, ok, scenario, finish, shot } from "./lib.mjs";

// shrink the per-attempt timeouts so the timeout path is testable
const fast = (p, body)=> p==="/index.html"
  ? Buffer.from(String(body).replace("[120000, 60000]", "[2500, 1500]").replace("SEARCH_SLOW_MS    = 6000", "SEARCH_SLOW_MS    = 1200"))
  : undefined;
const srv = await serve(ROOT, fast);
const browser = await launch();
const resultsHidden = (page)=> page.evaluate(()=> document.getElementById("results").classList.contains("hidden"));
const HIT = { status:200, body:{ results:[{ entryId:"ent_camel", gloss:"camel", distance:0.09 }, { entryId:"ent_deer", gloss:"deer", distance:0.21 }], corpus_n:12, corpus_age_s:3 } };

const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
async function open(matcher, opts={}){
  const t = await newPage(browser, srv.url, { matcher, init:AUTO, ...opts });
  await t.page.goto(srv.url + "/index.html");
  await t.page.waitForFunction(()=> document.querySelectorAll("#results > *").length > 3, null, { timeout:15000 });
  await t.page.waitForTimeout(300);
  t.state.calls.length = 0;                              // forget the page-open warm-up call
  return t;
}

// A — empty corpus: a normal answer with no results
await scenario("A — empty corpus: a normal answer with no results", async ()=>{ const { page, state, ctx } = await open(()=>({ status:200, body:{ results:[], corpus_n:0 } }));
  await hold(page); await page.waitForSelector(".empty", { timeout:8000 });
  ok("A empty corpus → 'Not in the dictionary yet', one call", (await page.innerText(".empty")).includes("Not in the dictionary yet") && state.calls.length===1, `calls=${state.calls.length}`);
  await ctx.close(); });

// B — slow answer: says it is still looking, then shows results
await scenario("B — slow answer: says it is still looking, then shows results", async ()=>{ const { page, state, ctx } = await open(()=>({ ...HIT, delay:2000 }));
  await hold(page); await page.waitForTimeout(1500);
  const mid = await hintText(page); await shot(page, "b-still-looking");
  await page.waitForFunction(()=> /Here it is|Did you mean/.test(document.getElementById("hint").innerText), null, { timeout:8000 });
  ok("B slow search → 'Still looking' hint, then results", /Still looking/.test(mid) && state.calls.length===1, JSON.stringify(mid));
  await ctx.close(); });

// C — 503 twice: one retry, then names the failure and restores the list
await scenario("C — 503 twice: one retry, then names the failure and restores the list", async ()=>{ const { page, state, ctx } = await open(()=>({ status:503, body:{ detail:"corpus unavailable" } }));
  await hold(page);
  await page.waitForFunction(()=> /having trouble/.test(document.getElementById("hint").innerText), null, { timeout:9000 });
  const h = await hintText(page); await shot(page, "c-server-error");
  ok("C 503 ×2 → retried once, 'having trouble' + code", state.calls.length===2 && /HTTP 503/i.test(h), `calls=${state.calls.length} ${JSON.stringify(h)}`);
  ok("C list is back on screen after the failure", !(await resultsHidden(page)) && (await page.locator("#results > *").count()) > 3);
  ok("C busy state cleared", !(await page.evaluate(()=>document.body.classList.contains("busy"))));
  await ctx.close(); });

// D — 503 then 200: the retry succeeds silently
await scenario("D — 503 then 200: the retry succeeds silently", async ()=>{ const { page, state, ctx } = await open((i)=> i===0 ? { status:503, body:{} } : HIT);
  await hold(page);
  await page.waitForFunction(()=> /Here it is|Did you mean/.test(document.getElementById("hint").innerText), null, { timeout:9000 });
  ok("D 503 then OK → results after one retry", state.calls.length===2, `calls=${state.calls.length}`);
  await ctx.close(); });

// E — connection drops both times
await scenario("E — connection drops both times", async ()=>{ const { page, state, ctx } = await open(()=>"abort");
  await hold(page);
  await page.waitForFunction(()=> /reach the matcher/.test(document.getElementById("hint").innerText), null, { timeout:9000 });
  const h = await hintText(page); await shot(page, "e-network");
  ok("E dropped connection ×2 → 'Couldn't reach the matcher' + NETWORK", state.calls.length===2 && /NETWORK/i.test(h), `calls=${state.calls.length} ${JSON.stringify(h)}`);
  await ctx.close(); });

// F — phone is offline: said at once, no request, no retry
await scenario("F — phone is offline: said at once, no request, no retry", async ()=>{ const { page, state, ctx } = await open(()=>HIT);
  await ctx.setOffline(true);
  await hold(page);
  await page.waitForFunction(()=> /No internet connection/.test(document.getElementById("hint").innerText), null, { timeout:6000 });
  const h = await hintText(page); await shot(page, "f-offline");
  ok("F offline → 'No internet connection' + OFFLINE, no request", state.calls.length===0 && /OFFLINE/i.test(h), `calls=${state.calls.length} ${JSON.stringify(h)}`);
  await ctx.close(); });

// G — clip the service can't decode: no retry
await scenario("G — clip the service can't decode: no retry", async ()=>{ const { page, state, ctx } = await open(()=>({ status:400, body:{ detail:"could not decode audio" } }));
  await hold(page);
  await page.waitForFunction(()=> /make out that recording/.test(document.getElementById("hint").innerText), null, { timeout:6000 });
  await page.waitForTimeout(2500);
  ok("G 400 → 'Couldn't make out that recording', not retried", state.calls.length===1 && /HTTP 400/i.test(await hintText(page)), `calls=${state.calls.length}`);
  await ctx.close(); });

// H — no answer at all: times out, retries once, then says so
await scenario("H — no answer at all: times out, retries once, then says so", async ()=>{ const { page, state, ctx } = await open(()=>"hang");
  const t0 = Date.now(); await hold(page);
  await page.waitForFunction(()=> /took too long/.test(document.getElementById("hint").innerText), null, { timeout:12000 });
  const h = await hintText(page); await shot(page, "h-timeout");
  ok("H no answer → timeout, one retry, 'took too long' + TIMEOUT", state.calls.length===2 && /TIMEOUT/i.test(h), `calls=${state.calls.length} after ${Date.now()-t0}ms ${JSON.stringify(h)}`);
  await ctx.close(); });

// I — pressing the mic again abandons the search in flight; its late failure never shows
await scenario("I — pressing the mic again abandons the search in flight; its late failure never shows", async ()=>{ const { page, state, ctx } = await open((i)=> i===0 ? "hang" : HIT);
  await hold(page); await page.waitForTimeout(600);
  await page.dispatchEvent("#mic", "pointerdown", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(700);
  const during = await hintText(page);
  await page.waitForTimeout(3200);                      // first search's timeout would have fired by now
  const still = await hintText(page);
  await page.dispatchEvent("#mic", "pointerup", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForFunction(()=> /Here it is|Did you mean/.test(document.getElementById("hint").innerText), null, { timeout:8000 });
  ok("I new hold supersedes the old search (no stale hint over 'Listening…')", /Listening/.test(during) && /Listening/.test(still) && state.calls.length===2, JSON.stringify([during, still, state.calls.length]));
  await ctx.close(); });

// J — Arabic-only tiers show the Arabic line and the code
await scenario("J — Arabic-only tiers show the Arabic line and the code", async ()=>{ const { page, ctx } = await open(()=>({ status:503, body:{} }), { init:()=>{ try{ localStorage.setItem("afd_display_mode","sound"); }catch(_){ } } });
  const mode = await page.evaluate(()=> AFDCore.getDisplayMode("sound"));
  await hold(page);
  await page.waitForFunction(()=> /HTTP 503/i.test(document.getElementById("hint").innerText), null, { timeout:9000 });
  const h = await hintText(page); await shot(page, "j-arabic-tier");
  ok("J sound tier → Arabic message + code", /[؀-ۿ]/.test(h) && !/matcher/.test(h), `mode=${mode} ${JSON.stringify(h)}`);
  await ctx.close(); });

// K — the display mode is changed while a search is waiting
await scenario("K — the display mode is changed while a search is waiting", async ()=>{ const { page, state, ctx } = await open((i)=> i===0 ? "hang" : { status:503, body:{} });   // first try never answers (so there is time to switch modes); the retry gets a 503
  await hold(page); await page.waitForFunction(()=> /Still looking/.test(document.getElementById("hint").innerText), null, { timeout:8000 });
  const st = ()=> page.evaluate(()=>({ hint: document.getElementById("hint").innerText, hidden: document.getElementById("results").classList.contains("hidden"),
    mast: (document.getElementById("mastAr")||{}).textContent, busy: document.body.classList.contains("busy"), firstGloss: (document.querySelector("#results .card .gloss")||{}).innerText || "" }));
  const before = await st();
  await page.click("#skin"); await page.waitForTimeout(300);          // auto → sound
  const sound = await st();
  await page.click("#skin"); await page.waitForTimeout(300);          // sound → script
  const script = await st();
  ok("K1 the waiting message follows the display mode (Arabic only outside the bilingual mode)",
     /Still looking/.test(before.hint) && !/[A-Za-z]{3}/.test(sound.hint) && /ما زلت أبحث/.test(sound.hint) && !/[A-Za-z]{3}/.test(script.hint) && /ما زلت أبحث/.test(script.hint), JSON.stringify([before.hint, sound.hint, script.hint]));
  ok("K2 changing the mode mid-search leaves the search screen alone (list stays hidden, header stays 'speak to find')",
     sound.hidden && script.hidden && script.busy && script.mast==="قُل لتجد", JSON.stringify(script));
  await page.waitForFunction(()=> /HTTP 503/i.test(document.getElementById("hint").innerText), null, { timeout:15000 }); await page.waitForTimeout(600);
  const after = await st();
  ok("K3 when the search ends, the message and the list underneath are both in the new mode",
     !after.hidden && !/[A-Za-z]{4}/.test(after.hint.replace(/HTTP 503/i,"")) && /في البحث مشكلة/.test(after.hint) && !/[A-Za-z]{3}/.test(after.firstGloss) && /[\u0600-\u06FF]/.test(after.firstGloss), JSON.stringify(after));
  await ctx.close(); });

await browser.close(); srv.close();
finish();
