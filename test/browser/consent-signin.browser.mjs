// 10-16: two things a non-reader in WhatsApp's own browser used to trip on.
//  1. Re-opening a withdrawn voice on Add was the browser's confirm() box —
//     text only, OK / Cancel in the phone's language, sometimes not shown at all.
//     Now it's AFDCore.ask(): in the page, the speaker's own avatar, two big
//     buttons, and closing it means "keep hidden".
//  2. Only Add had a sign-in that works inside in-app browsers (a texted code).
//     The recorder and the dictionary had a Google popup. Now all three build
//     the same sign-in (afd-signin.js).
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const ME = { uid:"uSpeaker1", isAnonymous:false, displayName:null, email:"speaker@example.org", providerData:[{ providerId:"password" }] };
const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
const withdrawnFS = ()=>({
  "afd_speakers/spk_uSpeak_01": { stewardUid:"uSpeaker1", speakerId:"spk_uSpeak_01", consent:"withdrawn", viaAgent:false,
                                  grant:{ publicPlayback:false } },
  "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس" },
  "afd_entries/ent_sun/recordings/rOld": { recordingId:"rOld", entryId:"ent_sun", uid:"uSpeaker1", speakerId:"spk_uSpeak_01",
    type:"word", viaAgent:false, consent:"withdrawn", allowPlayback:false, storagePath:"afd/uSpeaker1/rOld.webm", envelope:[] },
});
const sayWord = async (page)=>{
  await page.dispatchEvent("#sayBtn", "pointerdown", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(1600);
  await page.dispatchEvent("#sayBtn", "pointerup", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(1500); };
const screen = (page)=> page.evaluate(()=> ["say","show","share","done"].find(id=> !document.getElementById(id).hidden));

// Record a word on Add, tick "let others listen", tap Share → the question.
async function toQuestion(){
  const t = await newPage(browser, srv.url, { fs:withdrawnFS(), user:ME, init:AUTO });
  t.dialogs = [];
  t.page.on("dialog", d => { t.dialogs.push(d.type()); d.dismiss().catch(()=>{}); });
  await t.page.goto(srv.url + "/add.html"); await t.page.waitForTimeout(1200);
  await sayWord(t.page);
  await t.page.click("#sayNext"); await t.page.waitForTimeout(400);
  await t.page.click("#showNext"); await t.page.waitForTimeout(600);
  await t.page.evaluate(()=>{ const c=document.getElementById("cPlay"); if(!c.checked) c.click(); });
  await t.page.click("#shareBtn");
  await t.page.waitForSelector(".afd-ask", { timeout:8000 }).catch(()=>{});
  return t;
}
const stored = (page)=> page.evaluate(()=>{
  const fs = globalThis.__FS, recs = Object.entries(fs).filter(([k])=> /recordings\/rec_/.test(k)).map(([,v])=>v);
  return { card: fs["afd_speakers/spk_uSpeak_01"].consent, newTake: recs[0] && recs[0].allowPlayback,
           old: fs["afd_entries/ent_sun/recordings/rOld"].allowPlayback };
});

await scenario("Add: the reopen question is in the page, with the speaker's face", async ()=>{
  const { page, ctx, state, dialogs } = await toQuestion();
  const q = await page.evaluate(()=>{ const a = document.querySelector(".afd-ask"); return a && {
    title: a.querySelector("h2").innerText, sub: (a.querySelector(".ask-sub")||{}).innerText || "",
    face: !!a.querySelector(".ask-face svg, .ask-face img"),
    yes: a.querySelector(".ask-yes").innerText, no: a.querySelector(".ask-no").innerText,
    focusIsNo: document.activeElement === a.querySelector(".ask-no") }; });
  await shot(page, "ask-reopen");
  ok("the question shows in the page, not a browser box", !!q && dialogs.length===0, JSON.stringify({ q, dialogs }));
  ok("it says yes covers every recording, in Arabic and English", !!q && /أخفيتَ صوتك/.test(q.title) && /hidden earlier/.test(q.title) && /not only this word/.test(q.sub), JSON.stringify(q));
  ok("it shows the speaker's own avatar and two labelled answers", !!q && q.face && /Let people hear/.test(q.yes) && /Keep hidden/.test(q.no), JSON.stringify(q));
  ok("'Keep hidden' has the focus, so a stray Enter answers no", !!q && q.focusIsNo);
  await page.click(".ask-no");
  await page.waitForFunction(()=> !document.getElementById("done").hidden, null, { timeout:10000 }).catch(()=>{});
  const s = await stored(page);
  ok("Keep hidden: the word is shared, hidden; the voice stays withdrawn", (await screen(page))==="done" && s.card==="withdrawn" && s.newTake===false && s.old===false, JSON.stringify(s));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await scenario("Add: 'Let people hear' re-opens the voice and every take", async ()=>{
  const { page, ctx, state } = await toQuestion();
  await page.click(".ask-yes");
  await page.waitForFunction(()=> !document.getElementById("done").hidden, null, { timeout:10000 }).catch(()=>{});
  const s = await stored(page);
  ok("yes: the speaker is public again, the new word and the old take both heard", s.card==="public" && s.newTake===true && s.old===true, JSON.stringify(s));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await scenario("Add: closing the question (Escape) means keep hidden", async ()=>{
  const { page, ctx } = await toQuestion();
  await page.keyboard.press("Escape");
  await page.waitForFunction(()=> !document.getElementById("done").hidden, null, { timeout:10000 }).catch(()=>{});
  const s = await stored(page);
  ok("Escape: sheet gone, voice stays withdrawn", !(await page.$(".afd-ask")) && s.card==="withdrawn" && s.newTake===false, JSON.stringify(s));
  await ctx.close();
});

await scenario("Sign-in by texted code on all three pages", async ()=>{
  // Add (signed out): the share screen has the phone box, as before
  {
    const { page, ctx, state } = await newPage(browser, srv.url, { init:AUTO });
    await page.goto(srv.url + "/add.html"); await page.waitForTimeout(1200);
    await sayWord(page);
    await page.click("#sayNext"); await page.waitForTimeout(400);
    await page.click("#showNext"); await page.waitForTimeout(600);
    const has = await page.evaluate(()=>({ phone: !!document.querySelector("#signinHost #authPhone"),
      google: !!document.querySelector("#signinHost #googleBtn"), link: !!document.querySelector("#signinHost #linkBtn") }));
    ok("Add: Google, phone and email link are all there", has.phone && has.google && has.link, JSON.stringify(has));
    ok("Add: no page errors", !state.errors.length, state.errors.join(" | "));
    await ctx.close();
  }
  // Recorder (signed out): step 1 offers the phone, and a code signs in
  {
    const { page, ctx, state } = await newPage(browser, srv.url, { init:AUTO });
    await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1500);
    const vis = await page.isVisible("#signinHost #authPhone");
    const legal = await page.evaluate(()=>{ const n=document.querySelector("#signinHost #recaptchaNote");
      const b=document.createElement("div"); b.className="grecaptcha-badge"; document.body.appendChild(b);
      const hidden = getComputedStyle(b).visibility==="hidden"; b.remove();
      return { links: n ? [...n.querySelectorAll("a")].map(a=>a.getAttribute("href")) : [], text: n ? n.innerText : "", hidden }; });
    ok("Recorder: the reCAPTCHA badge is hidden and its notice shows, with Google's two links",
       legal.hidden && legal.links.filter(h=>/policies\.google\.com\/(privacy|terms)/.test(h)).length >= 2 && /reCAPTCHA/.test(legal.text), JSON.stringify(legal));
    await shot(page, "signin-recorder");
    await page.fill("#authPhone", "91234567");
    await page.click("#phoneBtn"); await page.waitForTimeout(500);
    await page.fill("#authCode", "123456");
    await page.click("#codeBtn"); await page.waitForTimeout(900);
    const inn = await page.evaluate(()=> !document.getElementById("signedIn").classList.contains("hidden"));
    ok("Recorder: the phone sign-in is offered, and a code signs in", vis && inn, JSON.stringify({ vis, inn }));
    ok("Recorder: no page errors", !state.errors.length, state.errors.join(" | "));
    await ctx.close();
  }
  // Dictionary (signed out): the account button opens the sheet, a code signs in, the sheet closes
  {
    const { page, ctx, state } = await newPage(browser, srv.url, { init:AUTO });
    await page.goto(srv.url + "/index.html");
    await page.waitForFunction(()=> document.querySelectorAll("#results > *").length > 0, null, { timeout:15000 }).catch(()=>{});
    await page.click("#account");
    await page.waitForSelector(".afd-si-sheet #authPhone", { timeout:5000 }).catch(()=>{});
    const open = await page.isVisible(".afd-si-sheet #authPhone");
    await shot(page, "signin-dictionary-sheet");
    await page.fill(".afd-si-sheet #authPhone", "+968 9123 4567");
    await page.click(".afd-si-sheet #phoneBtn"); await page.waitForTimeout(500);
    await page.fill(".afd-si-sheet #authCode", "123456");
    await page.click(".afd-si-sheet #codeBtn"); await page.waitForTimeout(900);
    const after = await page.evaluate(()=>({ sheet: !!document.querySelector(".afd-si-sheet"),
      signedIn: document.getElementById("account").classList.contains("in") }));
    ok("Dictionary: the account button opens the shared sign-in", open, String(open));
    ok("Dictionary: a code signs in and the sheet closes", !after.sheet && after.signedIn, JSON.stringify(after));
    // and ✕ closes it without signing in
    ok("Dictionary: no page errors", !state.errors.length, state.errors.join(" | "));
    await ctx.close();
  }
  {
    const { page, ctx } = await newPage(browser, srv.url, { init:AUTO });
    await page.goto(srv.url + "/index.html"); await page.waitForTimeout(1500);
    await page.click("#account"); await page.waitForTimeout(400);
    await page.click(".afd-si-sheet .si-close"); await page.waitForTimeout(300);
    const st = await page.evaluate(()=>({ sheet: !!document.querySelector(".afd-si-sheet"), signedIn: document.getElementById("account").classList.contains("in") }));
    ok("Dictionary: Close shuts the sheet and leaves you signed out", !st.sheet && !st.signedIn, JSON.stringify(st));
    await ctx.close();
  }
});

await scenario("Remove my word and sign out ask in the page too", async ()=>{
  const ANNA = { uid:"uAnna", isAnonymous:false, displayName:null, email:"anna@example.org", providerData:[{ providerId:"phone" }] };
  const FS = { "afd_entries/ent_u_abc": { source:"user", createdBy:"uAnna", gloss:"", glossAr:"قهوة", pic:"☕" } };
  const { page, ctx, state } = await newPage(browser, srv.url, { fs:FS, user:ANNA, init:AUTO });
  const dialogs = []; page.on("dialog", d => { dialogs.push(d.type()); d.dismiss().catch(()=>{}); });
  await page.goto(srv.url + "/index.html#ent_u_abc");
  await page.waitForSelector(".wt-remove", { timeout:10000 }); await page.waitForTimeout(300);
  const tap = ()=> page.evaluate(()=> document.querySelector(".wt-remove").click());
  await tap(); await page.waitForSelector(".afd-ask", { timeout:5000 }).catch(()=>{});
  const q = await page.evaluate(()=>{ const a=document.querySelector(".afd-ask"); return a && {
    title:a.querySelector("h2").innerText, red:a.querySelector(".ask-yes").classList.contains("ask-danger"),
    yes:a.querySelector(".ask-yes").innerText, no:a.querySelector(".ask-no").innerText,
    face:(a.querySelector(".ask-face")||{}).textContent||"" }; });
  await shot(page, "ask-remove");
  ok("Remove my word: asked in the page, in red, with the word's picture", !!q && q.red && /Remove this word/.test(q.title) && /Keep the word/.test(q.no) && /☕/.test(q.face) && !dialogs.length, JSON.stringify({ q, dialogs }));
  await page.click(".ask-no"); await page.waitForTimeout(300);
  const kept = await page.evaluate(()=> !globalThis.__FS["afd_entries/ent_u_abc"].removedAt);
  await tap(); await page.waitForSelector(".afd-ask", { timeout:5000 }); await page.click(".ask-yes"); await page.waitForTimeout(800);
  const removed = await page.evaluate(()=> !!globalThis.__FS["afd_entries/ent_u_abc"].removedAt);
  ok("Keep the word keeps it; Remove removes it", kept && removed, JSON.stringify({ kept, removed }));
  // sign out from the account menu
  await page.click("#account"); await page.waitForTimeout(200);
  await page.click("#acctOut"); await page.waitForSelector(".afd-ask", { timeout:5000 }).catch(()=>{});
  const so = await page.evaluate(()=>{ const a=document.querySelector(".afd-ask"); return a && { yes:a.querySelector(".ask-yes").innerText, no:a.querySelector(".ask-no").innerText }; });
  await page.click(".ask-no"); await page.waitForTimeout(300);
  const stillIn = await page.evaluate(()=> document.getElementById("account").classList.contains("in"));
  ok("Sign out asks in the page; 'Stay signed in' keeps you in", !!so && /Sign out/.test(so.yes) && /Stay signed in/.test(so.no) && stillIn && !dialogs.length, JSON.stringify({ so, stillIn, dialogs }));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await browser.close(); srv.close();
finish();
