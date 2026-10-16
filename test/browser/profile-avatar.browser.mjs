// 10-16, from the first Dhofar speaker:
//  · "Edit how you appear" (#profile) opens the recorder on step 1 at the
//    "How you appear" card — a returning speaker used to land on step 3.
//  · A contributor's own photo fills its circle, with no coloured ring.
import { ROOT, serve, launch, newPage, ok, scenario, finish, SHOTS } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const ME = { uid:"uFatma1", isAnonymous:false, displayName:"Fatma", email:"f@example.org", providerData:[{ providerId:"phone" }] };
// a returning speaker: a saved speaker on this phone (the recorder's fast path skips to recording)
const seedSpeaker = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ }
  const rq = indexedDB.open("hakli_recorder", 1);
  rq.onupgradeneeded = e=>{ const d=e.target.result; d.createObjectStore("clips",{keyPath:"recordingId"}); d.createObjectStore("meta",{keyPath:"key"}); };
  rq.onsuccess = e=>{ const d=e.target.result; d.transaction("meta","readwrite").objectStore("meta").put({ key:"speaker", speakerId:"spk_uFatma_01", viaAgent:false,
    consent:{ publicPlayback:true, archivalDeposit:false, mlTraining:false, attribution:"pseudonymous" } }); }; };
const where = (page)=> page.evaluate(()=>({ setup: !document.getElementById("setup").classList.contains("hidden"),
  recorder: !document.getElementById("recorder").classList.contains("hidden"),
  you: (()=>{ const y=document.getElementById("youCard"); if(!y || y.classList.contains("hidden")) return null; const r=y.getBoundingClientRect(); return { top:Math.round(r.top), onScreen: r.top < innerHeight && r.bottom > 0 }; })() }));

await scenario("Edit how you appear opens step 1 at the profile card", async ()=>{
  { const { page } = await newPage(browser, srv.url, { user:ME, init:seedSpeaker });
    await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(2500);
    const a = await where(page);
    ok("(control) a returning speaker without #profile goes straight on past step 1", !a.setup, JSON.stringify(a)); }
  { const { page, state } = await newPage(browser, srv.url, { user:ME, init:seedSpeaker });
    await page.goto(srv.url + "/recorder.html#profile"); await page.waitForTimeout(2500);
    const b = await where(page);
    ok("#profile stays on step 1", b.setup && !b.recorder, JSON.stringify(b));
    ok("#profile shows the How you appear card, scrolled into view", b.you && b.you.onScreen, JSON.stringify(b));
    ok("no page errors", !state.errors.length, state.errors.join(" | ")); }
});

await scenario("a contributor's photo fills its circle", async ()=>{
  const PNG = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#2b6cb0"/></svg>');
  const FS = {
    "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس" },
    "afd_stewards/uFatma1": { visibility:"known", displayName:"Fatma Almashani", hasAvatar:true },
    "afd_entries/ent_sun/recordings/r1": { recordingId:"r1", entryId:"ent_sun", uid:"uFatma1", speakerId:"spk_uFatma_01", type:"context",
      viaAgent:false, consent:"public", allowPlayback:true, storagePath:"afd/uFatma1/r1.webm", envelope:[] },
  };
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init:new Function(`try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ }
    globalThis.__URLS = { "afd/uFatma1/r1.webm":"data:audio/wav;base64,", "afd_avatars/uFatma1/avatar":${JSON.stringify(PNG)} };`) });
  await page.goto(srv.url + "/index.html#ent_sun"); await page.waitForSelector(".slot-context .av img", { timeout:10000 }); await page.waitForTimeout(400);
  const r = await page.evaluate(()=>{ const b=document.querySelector(".slot-context .av"), i=b.querySelector("img"), cs=getComputedStyle(b);
    const bb=b.getBoundingClientRect(), ib=i.getBoundingClientRect();
    return { bg: cs.backgroundColor, pad: cs.paddingTop, gap: Math.round((bb.width-ib.width)*10)/10 }; });
  if(SHOTS) await page.screenshot({ path: SHOTS + "/avatar.png", clip:{ x:0, y:380, width:412, height:260 } });
  ok("the photo fills the circle: no padding, no colour behind it", r.pad==="0px" && r.gap===0 && /rgba\(0, 0, 0, 0\)|transparent/.test(r.bg), JSON.stringify(r));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
