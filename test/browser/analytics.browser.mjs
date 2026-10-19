// 10-17: usage counts (afd-core track() → afd_events), Help's public counter
// (afd_stats/public), and the steward page's Stats tab. What matters most: an
// event never carries who made it — no uid, no email, no words.
import { ROOT, serve, launch, newPage, hold, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const ALLOWED = ["ev","v","x","n","page","mode","build","online","os","at","expireAt"];
const events = (page)=> page.evaluate(()=> Object.entries(globalThis.__FS||{})
  .filter(([k])=> k.startsWith("afd_events/")).map(([,v])=> v));
const thin = (list)=> list.every(e => Object.keys(e).every(k => ALLOWED.includes(k)));
const ME = { uid:"uCount1", isAnonymous:false, displayName:"Fatma", email:"f@example.org", providerData:[{ providerId:"google.com" }] };
const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
const SOUND = ()=>{ try{ localStorage.setItem("afd_display_mode","sound"); }catch(_){ } };
const HIT = { status:200, body:{ results:[{ entryId:"ent_camel", gloss:"camel", distance:0.09 }, { entryId:"ent_deer", gloss:"deer", distance:0.21 }], corpus_n:12, corpus_age_s:3 } };

await scenario("Help: the counter stays hidden until there are totals; opening is counted", async ()=>{
  const { page, state, ctx } = await newPage(browser, srv.url, { init:SOUND });
  await page.goto(srv.url + "/help.html"); await page.waitForTimeout(900);
  ok("no afd_stats/public → no counter (never a row of zeros)", await page.evaluate(()=> document.getElementById("count").hidden));
  ok("five questions now, the fifth says what is counted",
     await page.evaluate(()=> document.querySelectorAll("#faq details").length) === 5 &&
     (await page.evaluate(()=> document.querySelectorAll("#faq p")[4].textContent)).includes("دون أن يعرف"));
  const ev = await events(page);
  ok("a view (with the display mode) and help|open were counted", ev.some(e=>e.ev==="view" && e.v==="sound") && ev.some(e=>e.ev==="help" && e.v==="open"), JSON.stringify(ev));
  ok("events are thin: only the allowed fields, an expiry, no uid", thin(ev) && ev.every(e=>e.expireAt && e.page==="help.html"), JSON.stringify(ev));
  // the tile leaves the page: the count is written first, then it goes (a short beat)
  await page.evaluate(()=> document.querySelector(".tile").click());
  ok("tapping a clip tile is counted by its id, before the page leaves", (await events(page)).some(e=>e.ev==="help" && e.v==="clip.find"));
  await page.waitForURL(/howto\.html#find/, { timeout:3000 }).catch(()=>{});
  ok("…and then it opens the clip", /howto\.html#find/.test(page.url()), page.url());
  await ctx.close();
});

await scenario("Help: the counter shows the public totals — Arabic digits, the right noun for each number", async ()=>{
  const read = (page)=> page.evaluate(()=>({ shown: !document.getElementById("count").hidden,
    n: ["nWords","nVoices","nSpeakers"].map(id=>document.getElementById(id).textContent),
    l: ["lWords","lVoices","lSpeakers"].map(id=>document.getElementById(id).textContent),
    h: document.getElementById("countH").textContent }));
  const { page, state, ctx } = await newPage(browser, srv.url, { fs:{ "afd_stats/public": { words:312, voices:1040, speakers:41 } } });
  await page.goto(srv.url + "/help.html"); await page.waitForTimeout(900);
  const a = await read(page);
  await shot(page, "help-counter");
  ok("Arabic: Arabic-Indic digits, singular after 11+, under 'The dictionary so far'",
     a.shown && a.n.join("|") === "٣١٢|١٬٠٤٠|٤١" && a.l.join("|") === "كلمة|صوت|متحدّث" && a.h === "القاموس حتى الآن", JSON.stringify(a));
  await page.click('#toggle button[data-m="en"]'); await page.waitForTimeout(200);
  const e = await read(page);
  ok("English: Western digits and plurals", e.n.join("|") === "312|1,040|41" && e.l.join("|") === "words|voices|speakers", JSON.stringify(e));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
  // 1 · 2 · 3–10 take their own forms
  const t = await newPage(browser, srv.url, { fs:{ "afd_stats/public": { words:1, voices:2, speakers:7 } } });
  await t.page.goto(srv.url + "/help.html"); await t.page.waitForTimeout(900);
  const s = await read(t.page);
  ok("Arabic: 1 كلمة · 2 صوتان (dual) · 7 متحدّثين (3–10 plural)", s.n.join("|") === "١|٢|٧" && s.l.join("|") === "كلمة|صوتان|متحدّثين", JSON.stringify(s));
  await t.page.click('#toggle button[data-m="en"]'); await t.page.waitForTimeout(200);
  const se = await read(t.page);
  ok("English: '1 word', '2 voices', '7 speakers'", se.l.join("|") === "word|voices|speakers", JSON.stringify(se));
  await t.ctx.close();
});

await scenario("Dictionary: a search is counted with how it came out, never the word", async ()=>{
  const { page, state, ctx } = await newPage(browser, srv.url, { matcher:()=>HIT, init:AUTO });
  await page.goto(srv.url + "/index.html");
  await page.waitForFunction(()=> document.querySelectorAll("#results > *").length > 3, null, { timeout:15000 });
  await page.waitForTimeout(300);
  await hold(page);
  await page.waitForFunction(()=> /Here it is|Did you mean/.test(document.getElementById("hint").innerText), null, { timeout:15000 });
  await page.waitForTimeout(300);
  const ev = await events(page), s = ev.filter(e=>e.ev==="search");
  ok("one search|here, with how long it took", s.length===1 && s[0].v==="here" && Number.isInteger(s[0].n), JSON.stringify(s));
  ok("the view was counted first, in picture mode", ev[0] && ev[0].ev==="view" && ev[0].v==="auto", JSON.stringify(ev[0]));
  ok("no event names the word or the person", !JSON.stringify(ev).includes("camel") && !JSON.stringify(ev).includes("uCount") && thin(ev), JSON.stringify(ev));
  await page.click("#skin"); await page.waitForTimeout(300);
  ok("changing the view is counted", (await events(page)).some(e=>e.ev==="mode"));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await scenario("Dictionary: a failed search is counted by its kind", async ()=>{
  const { page, ctx } = await newPage(browser, srv.url, { matcher:()=>({ status:503, body:{} }), init:AUTO });
  await page.goto(srv.url + "/index.html");
  await page.waitForFunction(()=> document.querySelectorAll("#results > *").length > 3, null, { timeout:15000 });
  await hold(page);
  await page.waitForFunction(()=> /having trouble/.test(document.getElementById("hint").innerText), null, { timeout:12000 });
  const s = (await events(page)).filter(e=>e.ev==="search");
  ok("search|err.server", s.length===1 && s[0].v==="err.server", JSON.stringify(s));
  await ctx.close();
});

const now = Date.now(), ago = (h)=> ({ __ts: now - h*36e5 });
const SEED = {
  "afd_admins/uCount1": { note:"steward" },
  "afd_stats/public": { words:12, voices:30, speakers:4, at: ago(1) },
  "afd_stats/watch": { checkedAt: ago(0.2), recent:[{ at: ago(3), subject:"Search failing: 3 of 4 in the last hour" }] },
  "afd_stats/day_2026-10-16": { counts:{ "search|here":3, "search|none":1, "play|word":5, "rec|keep":2 } },
  "afd_stats/day_2026-10-17": { counts:{ "search|here":6, "play|word":9, "play|novoice":2 } },
  "afd_events/e1": { ev:"view", v:"sound", page:"index.html", at: ago(2) },
  "afd_events/e2": { ev:"view", v:"auto", page:"index.html", at: ago(30) },
  "afd_events/e3": { ev:"search", v:"here", n:2100, page:"index.html", at: ago(2) },
  "afd_events/e7": { ev:"search", v:"pick", n:52000, page:"index.html", at: ago(40) },
  "afd_events/e4": { ev:"search", v:"err.timeout", n:120000, page:"index.html", at: ago(2) },
  "afd_events/e5": { ev:"play", v:"word", page:"index.html", at: ago(2) },
  "afd_events/e6": { ev:"rec", v:"keep", x:"word", page:"recorder.html", at: ago(50) },
  "afd_client_errors/x1": { where:"search", code:"timeout", page:"index.html", at: ago(2) },
};
await scenario("Steward → Stats: totals, use, failures, alerts and the field-week switch", async ()=>{
  const { page, state, ctx } = await newPage(browser, srv.url, { user:ME, fs:SEED });
  await page.goto(srv.url + "/steward.html#stats");
  await page.waitForFunction(()=> !!document.querySelector("table.st"), null, { timeout:10000 });
  await shot(page, "steward-stats");
  const v = await page.evaluate(()=>({
    on: (document.querySelector('.tab.on')||{}).dataset.tab,
    nums: [...document.querySelectorAll(".st-nums b")].map(b=>b.textContent),
    rows: [...document.querySelectorAll("table.st tbody tr")].map(tr=>[...tr.children].map(td=>td.textContent.trim())),
    bars: document.querySelectorAll(".st-bars").length,
    errs: document.querySelector(".st-err") && document.querySelector(".st-err").textContent,
    alert: document.body.textContent.includes("Search failing"),
    field: (document.getElementById("fieldBtn")||{}).textContent || "" }));
  ok("#stats opens on the Stats tab", v.on === "stats", v.on);
  ok("the totals from afd_stats/public", v.nums.join() === "12,30,4", JSON.stringify(v.nums));
  const row = (i)=> v.rows[i] || [];
  ok("visits: 1 in 24 h, 2 in 7 days; half in sound view", row(0)[1]==="1" && row(0)[2]==="2" && /^1\s*100%$/.test(row(1)[1]) && /^1\s*50%$/.test(row(1)[2]), JSON.stringify(v.rows.slice(0,2)));
  ok("searches split by outcome (found / failed)", row(2)[1]==="2" && /^1\s*50%/.test(row(3)[1]) && /^1\s*50%/.test(row(6)[1]), JSON.stringify(v.rows.slice(2,7)));
  ok("median search time, failures left out (24 h: 2.1 s; 7 days: the slower of two)", row(7)[1]==="2.1 s" && row(7)[2]==="52.0 s", JSON.stringify(row(7)));
  ok("searches over 20 s counted as 'matcher asleep'", /^0/.test(row(8)[1]) && /^1\s*33%/.test(row(8)[2]), JSON.stringify(row(8)));
  ok("a take kept 50 h ago counts in 7 days, not 24 h", row(11)[1]==="0" && row(11)[2]==="1", JSON.stringify(row(11)));
  ok("the page asks Chrome not to translate it", await page.evaluate(()=> document.documentElement.getAttribute("translate")==="no" && !!document.querySelector('meta[name="google"][content="notranslate"]')));
  ok("three day-by-day charts from the digest's daily totals", v.bars === 3, String(v.bars));
  ok("what failed, grouped", /1\s*search · timeout/.test(v.errs||""), v.errs);
  ok("recent alerts listed", v.alert);
  await page.click("#fieldBtn"); await page.waitForTimeout(400);
  const fw = await page.evaluate(()=> (globalThis.__FS||{})["afd_ui_config/watch"]);
  ok("the field-week switch writes only openUntil, ~14 days out",
     fw && Object.keys(fw).join()==="openUntil" && Math.abs(fw.openUntil.ms - Date.now() - 14*864e5) < 6e4, JSON.stringify(fw));
  ok("…and the button now ends it", /End|أنهِ/.test(await page.evaluate(()=> document.getElementById("fieldBtn").textContent)));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await browser.close(); srv.close();
finish();
