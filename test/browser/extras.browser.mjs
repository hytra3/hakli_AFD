// The screen stays awake during a search; the dictionary page's words come from
// the shared string table; the review list in the prompts tool keeps its
// numbers; the not-found page takes its words from the table.
import fs from "node:fs";
import { ROOT, serve, launch, newPage, hold, hintText, ok, scenario, finish, shot } from "./lib.mjs";

const fast = (p, body)=> p==="/index.html" ? Buffer.from(String(body).replace("[120000, 60000]", "[2500, 1500]")) : undefined;
const srv = await serve(ROOT, fast);
const browser = await launch();
const HIT = { status:200, body:{ results:[{ entryId:"ent_camel", gloss:"camel", distance:0.09 }], corpus_n:12 } };
// a fake wake lock that counts what the page holds; `slow` makes the request take a while
const fakeWake = (slowMs)=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ }
  const W = (globalThis.__wake = { held:0, asked:0, released:0 });
  Object.defineProperty(navigator, "wakeLock", { configurable:true, value:{ request: async ()=>{
    W.asked++; if(slowMs) await new Promise(r=>setTimeout(r, slowMs));
    W.held++; let done=false; const l = new EventTarget();
    l.release = async ()=>{ if(done) return; done=true; W.held--; W.released++; l.dispatchEvent(new Event("release")); };
    return l; } } }); };
const wake = (page)=> page.evaluate(()=> ({...globalThis.__wake}));
const ready = (page)=> page.waitForFunction(()=> document.querySelectorAll("#results .card").length > 0, null, { timeout:15000 });
const open = async (matcher, slowMs=0)=>{ const t = await newPage(browser, srv.url, { matcher, init:fakeWake, });
  await t.ctx.addInitScript(fakeWake, slowMs);
  await t.page.goto(srv.url + "/"); await ready(t.page); await t.page.waitForTimeout(300); return t; };
const done = (page, re)=> page.waitForFunction((src)=> new RegExp(src).test(document.getElementById("hint").innerText), re.source, { timeout:12000 });

await scenario("K1 screen held awake during the search, let go when results arrive", async ()=>{ const { page, ctx } = await open(()=>({ ...HIT, delay:1500 }));
  const idle = await wake(page);
  await hold(page); await page.waitForTimeout(700);
  const during = await wake(page);
  await done(page, /Here it is|Did you mean/); await page.waitForTimeout(200);
  const after = await wake(page);
  ok("K1 screen held awake during the search, let go when results arrive", idle.held===0 && idle.asked===0 && during.held===1 && after.held===0, JSON.stringify([idle, during, after]));
  await ctx.close(); });
await scenario("K2 let go after a failed search (held across the retry)", async ()=>{ const { page, ctx } = await open(()=>({ status:503, body:{} }));
  await hold(page); await done(page, /having trouble/); await page.waitForTimeout(200);
  const after = await wake(page);
  ok("K2 let go after a failed search (held across the retry)", after.held===0 && after.asked===1, JSON.stringify(after));
  await ctx.close(); });
await scenario("K3 let go when Home cancels the search", async ()=>{ const { page, ctx } = await open(()=>"hang");
  await hold(page); await page.waitForTimeout(500);
  const during = await wake(page);
  await page.click("#mastGlyph"); await page.waitForTimeout(500);
  const after = await wake(page);
  ok("K3 let go when Home cancels the search", during.held===1 && after.held===0, JSON.stringify([during, after]));
  await ctx.close(); });
await scenario("K4 a lock that arrives after the search ended is released at once", async ()=>{ // the lock is slow to arrive and the search is already over: it must not be left held
  const { page, ctx } = await open(()=>HIT, 1200);
  await hold(page); await done(page, /Here it is|Did you mean/); await page.waitForTimeout(1800);
  const after = await wake(page);
  ok("K4 a lock that arrives after the search ended is released at once", after.asked===1 && after.held===0, JSON.stringify(after));
  await ctx.close(); });
await scenario("K5 without wake-lock support the search still works", async ()=>{ // no wake lock in this browser: search works exactly as before
  const { page, ctx, state } = await newPage(browser, srv.url, { matcher:()=>HIT, init:()=>{ try{ localStorage.setItem("afd_display_mode","auto"); delete Navigator.prototype.wakeLock; }catch(_){ } } });
  await page.goto(srv.url + "/"); await ready(page);
  const has = await page.evaluate(()=> "wakeLock" in navigator);
  await hold(page); await done(page, /Here it is|Did you mean/);
  ok("K5 without wake-lock support the search still works", !has && !state.errors.length, JSON.stringify([has, state.errors]));
  await ctx.close(); });

/* ---- the dictionary page's words now come from the shared table */
await scenario("L1 sound tier: idle hint and the no-match card are Arabic only", async ()=>{ const { page, ctx } = await newPage(browser, srv.url, { matcher:()=>({ status:200, body:{ results:[], corpus_n:0 } }), init:()=>{ try{ localStorage.setItem("afd_display_mode","sound"); }catch(_){ } } });
  await page.goto(srv.url + "/"); await ready(page); await page.waitForTimeout(300);
  const idle = await page.innerText("#hint");
  await hold(page); await page.waitForSelector(".empty", { timeout:8000 });
  const empty = await page.innerText(".empty h2");
  ok("L1 sound tier: idle hint and the no-match card are Arabic only", idle.trim()==="تكلّم" && /ليست في القاموس بعد/.test(empty) && !/[A-Za-z]{3}/.test(empty), JSON.stringify([idle, empty]));
  await ctx.close(); });
await scenario("L2 bilingual tier reads exactly as before", async ()=>{ const { page, ctx } = await newPage(browser, srv.url, { matcher:()=>({ status:200, body:{ results:[], corpus_n:0 } }), init:()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } } });
  await page.goto(srv.url + "/"); await ready(page); await page.waitForTimeout(300);
  const idle = await page.innerText("#hint");
  await page.click("#mastScreen"); await page.waitForTimeout(200);
  const menu = (await page.innerText("#viewMenu")).replace(/\s+/g," ");
  await page.keyboard.press("Escape");
  await hold(page); await page.waitForSelector(".empty", { timeout:8000 });
  const empty = (await page.innerText(".empty")).replace(/\s+/g," ");
  ok("L2 bilingual tier reads exactly as before", idle==="Hold and speak\nتكلّم" && /كل الكلمات ALL WORDS/i.test(menu) && /يحتاج صوتًا/.test(menu) && /Not in the dictionary yet Be the first — add this word\.\s*ليست في القاموس بعد — أضِفها/.test(empty), JSON.stringify([idle, menu, empty]));
  await ctx.close(); });

/* ---- the review list in the prompts tool
   Speakers work through it by number ("14.31"), so a number must never come to
   mean a different line. prompt-numbers.json is the list as last accepted:
   every number in it must still point at the same key. New lines may be added
   — at the end of a section, or as a new last section — and then the file is
   refreshed on purpose:
       AFD_UPDATE_NUMBERS=1 node browser/run.mjs extras                        */
// the review list keeps its numbers
await scenario("the review list keeps its numbers", async ()=>{ const { page, ctx, state } = await newPage(browser, srv.url, {});
  await page.goto(srv.url + "/prompts/index.html");
  await page.waitForFunction(()=> document.querySelectorAll("#list h2").length > 5, null, { timeout:15000 });
  const now = await page.evaluate(()=>{ const out={ sections:{}, items:{} }; let ar={};
    for(const el of document.querySelectorAll("#list h2, #list .row")){
      const num = el.querySelector(".num").textContent.trim();
      if(el.tagName==="H2") out.sections[num] = el.textContent.replace(/↑/g,"").replace(/^\s*\d+\s*/,"").trim();
      else{ out.items[num] = (el.querySelector(".rowtext .k")||{}).textContent || ""; ar[num] = !!el.querySelector(".rowtext .a"); } }
    out.noArabic = Object.keys(out.items).filter(n => !ar[n]); return out; });
  const file = new URL("./prompt-numbers.json", import.meta.url);
  const last = Object.keys(now.sections).length;
  // Sections are found by name, not position: new screens go at the end.
  const secNum = (re)=> Object.keys(now.sections).find(n => re.test(now.sections[n]));
  const keysIn = (n)=> Object.entries(now.items).filter(([m])=> m.startsWith(n+".")).map(([,k])=>k);
  const dict = secNum(/Dictionary page/), inDict = dict ? keysIn(dict) : [];
  const want = ["find.waking","find.err.offline","find.missing","find.idle","find.none","view.all","view.record","mast.find","mast.dictionary","notfound.title","notfound.open"].map(k=>"screen:"+k);
  ok("P1 the dictionary page has its own section, with its search, list and not-found words", !!dict && want.every(k=>inDict.includes(k)), JSON.stringify([dict, want.filter(k=>!inDict.includes(k))]));
  const wel = secNum(/Welcome page/), inWel = wel ? keysIn(wel) : [];
  const wantW = ["welcome.hint.none","welcome.enter","wt.find.1","wt.add.tap","wt.close"].map(k=>"screen:"+k);
  ok("P6 the welcome page and walkthrough captions are listed (after the dictionary page), and howto.add is spoken item 2.6",
     !!wel && +wel > +dict && wantW.every(k=>inWel.includes(k)) && now.items["2.6"]==="howto.add",
     JSON.stringify([wel, dict, wantW.filter(k=>!inWel.includes(k)), now.items["2.6"]]));
  const rec = Object.values(now.items);
  ok("P2 the recorder's instructions and readout are listed", ["record.instr.word","record.instr.context","record.instr.definition","record.progress.word","record.progress.listening"].every(k=> rec.includes("screen:"+k)));
  ok("P3 every listed line has Arabic to review", now.noArabic.length===0, JSON.stringify(now.noArabic.slice(0,8)));
  if(process.env.AFD_UPDATE_NUMBERS){
    fs.writeFileSync(file, JSON.stringify({ sections:now.sections, items:now.items }, null, 1) + "\n");
    console.log("   prompt-numbers.json refreshed: " + Object.keys(now.items).length + " lines in " + last + " sections");
  }
  const was = JSON.parse(fs.readFileSync(file, "utf8"));
  const moved = [];
  for(const [n, name] of Object.entries(was.sections)) if(now.sections[n] !== name) moved.push("section "+n+": "+name+" → "+now.sections[n]);
  for(const [n, key] of Object.entries(was.items)) if(now.items[n] !== key) moved.push(n+": "+key+" → "+(now.items[n] || "gone"));
  ok("P4 every number in the review list still points at the same line", moved.length===0 && Object.keys(was.items).length > 100, JSON.stringify(moved.slice(0,8)));
  const added = Object.keys(now.items).filter(n => !(n in was.items));
  ok("P5 prompt-numbers.json is up to date (refresh it when lines are added on purpose)", added.length===0, added.length+" new line(s) not in the file: "+added.slice(0,8).join(", ")+" — AFD_UPDATE_NUMBERS=1 node browser/run.mjs extras");
  await ctx.close(); });

/* ---- 404 takes its words from the table */
await scenario("N4 404 page shows the table's wording (a corrected string reaches it)", async ()=>{ const tr = (p, body)=> p==="/afd-core.js" ? Buffer.from(String(body).replace('ar:"هذه الصفحة غير موجودة"', 'ar:"TEST-AR"')) : undefined;
  const s2 = await serve(ROOT, tr); const { page, ctx, state } = await newPage(browser, s2.url, {});
  await page.goto(s2.url + "/404.html"); await page.waitForTimeout(600);
  const h1 = await page.innerText("h1"); const go = (await page.innerText(".go")).replace(/\s+/g," ");
  ok("N4 404 page shows the table's wording (a corrected string reaches it)", /TEST-AR/.test(h1) && /ادخل القاموس OPEN THE DICTIONARY/i.test(go) && !state.errors.length, JSON.stringify([h1, go, state.errors]));
  await ctx.close(); s2.close(); });

// the account badge for someone signed in by phone
await scenario("the account badge for someone signed in by phone", async ()=>{
  const badge = async (path, sel, user)=>{ const { page, ctx } = await newPage(browser, srv.url, { user, init:()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } } });
    await page.goto(srv.url + path); await page.waitForTimeout(1500);
    const t = (await page.innerText(sel)).trim(); await ctx.close(); return t; };
  const PHONE = { uid:"uPhone", isAnonymous:false, displayName:null, email:null, phoneNumber:"+96891234567" };
  const NAMED = { uid:"uNamed", isAnonymous:false, displayName:"Salim", email:"s@example.com" };
  const a = await badge("/", "#account", PHONE), b = await badge("/recorder.html", "#account", PHONE), c = await badge("/", "#account", NAMED);
  ok("A phone sign-in shows a phone mark, not the number's '+' (which read as an add button); a name still shows its initial", a==="\u260E" && b==="\u260E" && c==="S", JSON.stringify([a, b, c]));
});

// the steward page names the signed-in account in words a person can read
await scenario("the steward page never shows an account id", async ()=>{
  const see = async (path, user, fs)=>{ const { page, ctx } = await newPage(browser, srv.url, { user, fs });
    await page.goto(srv.url + path); await page.waitForTimeout(1200);
    const r = await page.evaluate(()=>({ who: document.getElementById("who").textContent.trim(), msg: (document.getElementById("authmsg")||{}).textContent || "",
      panel: !document.getElementById("panel").classList.contains("hidden"), form: !document.getElementById("signin").classList.contains("hidden") }));
    await ctx.close(); return r; };
  const PHONE = { uid:"q1QvbtezJ6dXnfVMC3kyAlqJKfm2", isAnonymous:false, displayName:null, email:null, phoneNumber:"+96891234567", providerData:[{ providerId:"phone" }] };
  const OTHER = { uid:"uOther", isAnonymous:false, displayName:"Salim", email:"s@example.com", providerData:[{ providerId:"password" }] };
  const STEW  = { uid:"uSteward", isAnonymous:false, displayName:null, email:"steward@example.org", providerData:[{ providerId:"password" }] };
  const p = await see("/steward.html", PHONE), o = await see("/steward.html", OTHER), s = await see("/steward.html", STEW, { "afd_admins/uSteward": { email:"steward@example.org" } });
  ok("Q1 a phone sign-in is shown by its number and told to use the steward sign-in", p.who==="+96891234567" && !/q1Qvbt/.test(p.who + p.msg) && /dictionary account \(\+96891234567\)/.test(p.msg) && /steward email and password/.test(p.msg) && p.form && !p.panel, JSON.stringify(p));
  ok("Q2 an email account that isn't the steward is told how to be listed, by its own address", o.who==="s@example.com" && /grant-steward\.mjs s@example\.com$/.test(o.msg) && o.form && !o.panel, JSON.stringify(o));
  ok("Q3 the steward gets the panel", s.who==="steward@example.org" && s.panel && !s.form, JSON.stringify(s));
  const a = await see("/prompts/admin.html", PHONE);
  ok("Q4 the prompt-windows page shows the number too", a.who==="+96891234567", JSON.stringify(a));
  const tips = [];
  for(const path of ["/steward.html", "/prompts/admin.html"]){ const { page, ctx } = await newPage(browser, srv.url, {});
    await page.goto(srv.url + path); await page.waitForTimeout(800);
    tips.push(await page.locator("#ownBrowser").isVisible() ? (await page.innerText("#ownBrowser")) : ""); await ctx.close(); }
  ok("Q5 both steward sign-in cards say to keep the steward in its own browser", tips.every(t=>/separate browser/.test(t) && /credited to the steward/.test(t)), JSON.stringify(tips));
});

await browser.close(); srv.close();
finish();
