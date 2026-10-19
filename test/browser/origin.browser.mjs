// Speaker origin visibility, tier 3: a speaker who chose "show my town" gets
// the town under their voice; one who didn't gets nothing. And the recorder's
// permission card carries the choice into the consent record.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const USER = { uid:"uTest1", isAnonymous:false, displayName:"Test", email:"t@example.com" };
const rec = (sid) => ({ uid:"uOwner", speakerId:sid, type:"word", consent:"public", allowPlayback:true, storagePath:`afd/uOwner/${sid}.webm`, envelope:[.1,.6,.2], uploadedAt:{ __ts:1 } });
const FS = {
  "afd_entries/ent_sun/recordings/r1": rec("spk_town"),
  "afd_entries/ent_sun/recordings/r2": rec("spk_none"),
  "afd_speakers/spk_town/public/origin": { town:"Taqah" },     // chose it
};
const urls = `globalThis.__URLS = { "afd/uOwner/spk_town.webm":"data:audio/wav;base64,", "afd/uOwner/spk_none.webm":"data:audio/wav;base64," };`;

for(const mode of ["auto", "script"]){
  await scenario(mode + ": the town shows under the voice of a speaker who chose it", async ()=>{
    const { page, ctx, state } = await newPage(browser, srv.url, { fs:FS, init:`(()=>{ ${urls} try{ localStorage.setItem("afd_display_mode","${mode}"); }catch(_){ } })()` });
    await page.goto(srv.url + "/index.html#ent_sun"); await page.waitForTimeout(2500);
    const towns = await page.evaluate(()=> [...document.querySelectorAll(".av-town")].map(x=>x.textContent));
    ok(mode + ": exactly one town label, for the speaker who chose it", towns.length === 1, JSON.stringify(towns));
    ok(mode + ": shown in the mode's own words", mode === "auto" ? towns[0] === "Taqah" : towns[0] === "طاقة", JSON.stringify(towns));
    ok(mode + ": no page errors", !state.errors.length, state.errors.join(" | "));
    await ctx.close();
  });
}

await scenario("the permission card carries the choice", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { user:USER });
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1500);
  const r = await page.evaluate(()=>{
    const row = document.getElementById("cOriginRow"), box = document.getElementById("cOrigin");
    const off = speakerRecord().consent;
    box.checked = true; const on = speakerRecord().consent;
    document.getElementById("switchSpeaker").click();
    return { shown: !!row && !row.hidden, offDefault: off.publicOrigin === false, on: on.publicOrigin === true,
             version: on.version, clearedForNext: !document.getElementById("cOrigin").checked };
  });
  ok("the fourth permission is on the card, off by default", r.shown && r.offDefault, JSON.stringify(r));
  ok("ticking it records publicOrigin in the grant (consent version cv_2026_10)", r.on && r.version === "cv_2026_10", JSON.stringify(r));
  ok("the next speaker starts with it off", r.clearedForNext, JSON.stringify(r));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
