// 10-16: the recorder's "Let other people listen" box applies to what the
// speaker has already uploaded too — asked, not silent. Unticking offers to hide
// all their takes; ticking offers to share them all (erased ones never return).
// Cancel leaves the uploaded takes as they were.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const ME = { uid:"uFatma1", isAnonymous:false, displayName:"Fatma", email:"f@example.org", providerData:[{ providerId:"phone" }] };
const take = (id, extra) => ({ recordingId:id, entryId:"ent_sun", uid:"uFatma1", speakerId:"spk_uFatma_01", type:"word", viaAgent:false,
  storagePath:`afd/uFatma1/${id}.webm`, envelope:[], ...extra });
const FS = {
  "afd_speakers/spk_uFatma_01": { stewardUid:"uFatma1", consent:"public", viaAgent:false, grant:{ publicPlayback:true } },
  "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس" },
  "afd_entries/ent_sun/recordings/rPub":  take("rPub",  { consent:"public", allowPlayback:true }),
  "afd_entries/ent_sun/recordings/rPriv": take("rPriv", { consent:"public", allowPlayback:false, type:"context" }),   // uploaded while the box was unticked
  "afd_entries/ent_sun/recordings/rGone": take("rGone", { consent:"deleted", allowPlayback:false, type:"definition" }),
};
const init = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
const states = (page)=> page.evaluate(()=> Object.fromEntries(["rPub","rPriv","rGone"].map(id=>{
  const r = globalThis.__FS["afd_entries/ent_sun/recordings/"+id]; return [id, (r.allowPlayback?"on":"off")+"/"+r.consent]; })));
const setBox = async (page, on)=>{ await page.evaluate(v=>{ document.getElementById("spkId").value="spk_uFatma_01";
  const c=document.getElementById("cPlay"); if(c.checked!==v){ c.checked=v; c.dispatchEvent(new Event("change")); } }, on); await page.waitForTimeout(900); };

await scenario("the box applies to uploaded takes, when the speaker says so", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:ME, init });
  const asked = [];
  let answer = true;
  page.on("dialog", d=>{ asked.push(d.message()); answer ? d.accept() : d.dismiss(); });
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1800);
  await setBox(page, false);
  const hidden = await states(page);
  ok("untick → asked in plain words, and every take is hidden", /hide the recordings you've already uploaded/i.test(asked[0]||"")
     && hidden.rPub==="off/withdrawn" && hidden.rPriv==="off/withdrawn" && hidden.rGone==="off/deleted", JSON.stringify([asked, hidden]));
  await setBox(page, true);
  const shown = await states(page);
  ok("tick → asked, and every take is shared again — an erased one stays erased", /already uploaded/i.test(asked[1]||"")
     && shown.rPub==="on/public" && shown.rPriv==="on/public" && shown.rGone==="off/deleted", JSON.stringify([asked, shown]));
  answer = false;
  await setBox(page, false);
  const kept = await states(page);
  ok("untick but Cancel → uploaded takes stay as they were (only new ones are private)", kept.rPub==="on/public" && kept.rPriv==="on/public", JSON.stringify(kept));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
