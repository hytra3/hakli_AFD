// A voice its owner kept private (the "let other people listen" box unticked):
// on the open card the owner is told plainly that only they can hear it, and
// offered "Let others listen" — not "Restore", which reads as undoing something they never
// did. A voice they withdrew after sharing still says Restore. Sharing flips
// the take public and the row stops saying it's private.
import { ROOT, serve, launch, newPage, ok, scenario, finish, SHOTS } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const ME = { uid:"uSpeaker1", isAnonymous:false, displayName:null, email:"speaker@example.org", providerData:[{ providerId:"phone" }] };
const take = (id, extra) => ({ recordingId:id, entryId:"ent_sun", uid:"uSpeaker1", speakerId:"spk_uSpeak_01",
  type:"word", viaAgent:false, storagePath:`afd/uSpeaker1/${id}.webm`, envelope:[], ...extra });
const FS = {
  "afd_speakers/spk_uSpeak_01": { stewardUid:"uSpeaker1", consent:"withdrawn", viaAgent:false,
                                  grant:{ publicPlayback:false } },
  "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس" },
  // uploaded private: consent stays "public", playback off
  "afd_entries/ent_sun/recordings/rPriv": take("rPriv", { consent:"public",    allowPlayback:false }),
  // shared once, then withdrawn
  "afd_entries/ent_sun/recordings/rWdr":  take("rWdr",  { consent:"withdrawn", allowPlayback:false, type:"context" }),
};
const init = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ }
  globalThis.__URLS = { "afd/uSpeaker1/rPriv.webm":"data:audio/wav;base64,", "afd/uSpeaker1/rWdr.webm":"data:audio/wav;base64," }; };

await scenario("owner sees a private voice and can share it", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:ME, init });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".voice-row", { timeout:10000 });
  await page.waitForTimeout(400);
  const rows = ()=> page.evaluate(()=> [...document.querySelectorAll(".voice-row")].map(r=>({
    status: (r.querySelector(".vr-status")||{}).textContent || "",
    shown:  !!r.querySelector(".vr-status:not([hidden])"),
    btn:    (r.querySelector(".voice-ctl:not(.erase)")||{}).textContent || "" })));
  const before = await rows();
  if(SHOTS) await page.screenshot({ path: SHOTS + "/private-voice.png", fullPage:true });
  const priv = before.find(r => r.btn === "Let others listen"), wdr = before.find(r => r.btn === "Restore");
  ok("the private take says only you can hear it, and offers Let others listen", !!priv && priv.shown && /Only you can hear this/.test(priv.status), JSON.stringify(before));
  ok("a take withdrawn after sharing still offers Restore", !!wdr && wdr.shown, JSON.stringify(before));
  await page.evaluate(()=>{ [...document.querySelectorAll(".voice-ctl")].find(b=>b.textContent==="Let others listen").click(); });
  await page.waitForTimeout(400);
  const after = await rows();
  const fs = await page.evaluate(()=>({ rec: globalThis.__FS["afd_entries/ent_sun/recordings/rPriv"], card: globalThis.__FS["afd_speakers/spk_uSpeak_01"] }));
  ok("Share makes the take playable and opens the speaker card", fs.rec.allowPlayback === true && fs.rec.consent === "public" && fs.card.consent === "public", JSON.stringify(fs));
  ok("after sharing, that row offers Withdraw and no longer says private", after.some(r => r.btn === "Withdraw" && !r.shown), JSON.stringify(after));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("new speakers start with listening ticked; archive and ML stay opt-in", async ()=>{
  for(const pg of ["add.html", "recorder.html"]){
    const { page, state } = await newPage(browser, srv.url, { user:ME, init:()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } } });
    await page.goto(srv.url + "/" + pg); await page.waitForTimeout(800);
    const c = await page.evaluate(()=>({ play: document.getElementById("cPlay").checked,
      archive: document.getElementById("cArchive").checked, ml: document.getElementById("cML").checked }));
    ok(pg + ": listening ticked, archive + ML unticked", c.play && !c.archive && !c.ml, JSON.stringify(c));
    ok(pg + ": no page errors", !state.errors.length, state.errors.join(" | "));
  }
});

await browser.close(); srv.close();
finish();
