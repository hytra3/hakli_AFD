// 10-17: Add keeps words on the phone while there's no signal. A share with no
// signal parks the word ("saved on this phone"), the person can add another,
// and every parked word goes on its own when signal returns.
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const ME = { uid:"uQueue1", isAnonymous:false, displayName:"Salim", email:"s@example.org", providerData:[{ providerId:"phone" }] };
const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
const screen = (page)=> page.evaluate(()=> ["say","show","share","done"].find(id=> !document.getElementById(id).hidden));
const sayWord = async (page)=>{
  await page.dispatchEvent("#sayBtn", "pointerdown", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(1600);
  await page.dispatchEvent("#sayBtn", "pointerup", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(1500); };
const toShare = async (page)=>{ await sayWord(page); await page.click("#sayNext"); await page.waitForTimeout(400);
  await page.click("#showNext"); await page.waitForTimeout(600); };
const userEntries = (page)=> page.evaluate(()=> Object.entries(globalThis.__FS||{})
  .filter(([k,v])=> /^afd_entries\/[^/]+$/.test(k) && v && v.source==="user").length);
const note = (page)=> page.evaluate(()=>{ const b=document.getElementById("queueNote"); return b.classList.contains("hidden") ? "" : b.innerText; });

await scenario("signed in, no signal: two words kept, both shared when signal returns", async ()=>{
  const { page, ctx, state } = await newPage(browser, srv.url, { user:ME, init:AUTO });
  await page.goto(srv.url + "/add.html"); await page.waitForTimeout(1200);
  await ctx.setOffline(true);
  await toShare(page);
  const parkVisible = await page.isVisible("#parkBtn");
  await page.click("#shareBtn"); await page.waitForTimeout(800);
  const s1 = await screen(page), msg1 = await page.innerText("#doneMsg"), see1 = await page.isVisible("#doneSee");
  await shot(page, "add-kept");
  ok("no signal: the share screen offers 'keep it on this phone'", parkVisible);
  ok("Share with no signal keeps the word and says so — no error, no 'see it' link", s1==="done" && /Saved on this phone/.test(msg1) && !see1, JSON.stringify({ s1, msg1, see1 }));
  await page.click("#doneAnother"); await page.waitForTimeout(500);
  await toShare(page);
  await page.click("#shareBtn"); await page.waitForTimeout(800);
  const n2 = await note(page);
  ok("a second word kept too; the note says 2 are waiting", /: 2/.test(n2) && (await userEntries(page))===0, JSON.stringify(n2));
  await page.click("#doneAnother"); await page.waitForTimeout(300);
  await shot(page, "add-queue-note");
  await ctx.setOffline(false);
  await page.waitForFunction(()=> !!document.querySelector(".afd-notice"), null, { timeout:12000 }).catch(()=>{});
  const sent = await page.evaluate(()=>{ const n=document.querySelector(".afd-notice"); return n ? n.innerText : ""; });
  const after = await userEntries(page), left = await note(page);
  ok("signal back: both words are shared on their own, the note goes, a notice says so", after===2 && !left && /Shared now: 2/.test(sent), JSON.stringify({ after, left, sent }));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await scenario("signed out, no signal: keep it; the note offers the sign-in", async ()=>{
  const { page, ctx, state } = await newPage(browser, srv.url, { init:AUTO });
  await page.goto(srv.url + "/add.html"); await page.waitForTimeout(1200);
  await ctx.setOffline(true);
  await toShare(page);
  await page.click("#parkBtn"); await page.waitForTimeout(600);
  await page.click("#doneAnother"); await page.waitForTimeout(300);
  await ctx.setOffline(false); await page.waitForTimeout(2600);
  const n = await note(page);
  ok("back online but signed out: the word waits, and the note says to sign in", /Sign in to share/.test(n) && (await userEntries(page))===0, JSON.stringify(n));
  await page.click("#queueNote");
  await page.waitForSelector(".afd-si-sheet #authPhone", { timeout:5000 }).catch(()=>{});
  await page.fill(".afd-si-sheet #authPhone", "91234567");
  await page.click(".afd-si-sheet #phoneBtn"); await page.waitForTimeout(400);
  await page.fill(".afd-si-sheet #authCode", "123456");
  await page.click(".afd-si-sheet #codeBtn");
  await page.waitForFunction(()=> !!document.querySelector(".afd-notice"), null, { timeout:12000 }).catch(()=>{});
  const after = await userEntries(page), left = await note(page);
  ok("tapping the note signs in, and the waiting word is shared", after===1 && !left, JSON.stringify({ after, left }));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await browser.close(); srv.close();
finish();
