// The speaker form is built from afd-instance.js. Serve a variant config —
// gender left out, a town added — and check the form follows it, that the
// speaker record still has all four stored slots, and that nothing that reads
// the form breaks when a field isn't there.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const variant = (body)=>{
  let js = String(body);
  // drop the gender field
  js = js.replace(/\{ id: "spkGender"[\s\S]*?\] \}\n/, "");
  js = js.replace(/(\{ id: "spkAge"[^\n]*), half: true/, "$1");          // age alone on its row now
  // add a town to the suggestion list (no label key: shown by its value)
  js = js.replace(/(\{ value: "Dhalkut", label: "town.dhalkut" \})/, '$1,\n          { value: "Hasik", text: "Hasik" }');
  if(js === String(body)) throw new Error("variant config was not applied");
  return js;
};
const srv  = await serve(ROOT);
const vSrv = await serve(ROOT, (p, body)=> p === "/afd-instance.js" ? variant(body) : undefined);
const browser = await launch();
const USER = { uid:"uTest1", isAnonymous:false, displayName:"Test Steward", email:"test@example.com" };

const read = (page)=> page.evaluate(()=>{
  const q = (id)=>document.getElementById(id);
  return {
    ids: ["spkTown","spkTribe","spkAge","spkGender"].filter(id=>q(id)),
    towns: [...document.querySelectorAll("datalist option")].map(o=>o.value),
    halfRows: document.querySelectorAll("#setup .row .field").length,
    noteShown: !!document.querySelector('[data-str="speaker.nodialect"]'),
  };
});

await scenario("the live config builds today's form", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { user:USER });
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1500);
  const r = await read(page);
  ok("all four fields, in order", r.ids.join() === "spkTown,spkTribe,spkAge,spkGender", JSON.stringify(r.ids));
  ok("the six towns are suggested", r.towns.join() === "Salalah,Mirbat,Taqah,Sadah,Rakhyut,Dhalkut", r.towns.join());
  ok("age and gender share a row", r.halfRows === 2, String(r.halfRows));
  ok("the no-dialect note is shown", r.noteShown);
  const rec = await page.evaluate(()=>{
    AFDSpeakerForm.write({ origin:{ town:"Taqah", tribe:"T" }, ageBand:"60s", gender:"f" });
    return speakerRecord();
  });
  ok("a saved speaker fills the form and reads back the same",
     rec.origin.town === "Taqah" && rec.origin.tribe === "T" && rec.ageBand === "60s" && rec.gender === "f", JSON.stringify(rec));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("a different config builds a different form", async ()=>{
  const { page, state } = await newPage(browser, vSrv.url, { user:USER });
  await page.goto(vSrv.url + "/recorder.html"); await page.waitForTimeout(1500);
  const r = await read(page);
  ok("gender left out of the config → no gender field", r.ids.join() === "spkTown,spkTribe,spkAge", JSON.stringify(r.ids));
  ok("a town added to the config is suggested", r.towns.includes("Hasik"), r.towns.join());
  ok("age, now alone, takes a full row", r.halfRows === 0, String(r.halfRows));
  const out = await page.evaluate(()=>{
    AFDSpeakerForm.write({ origin:{ town:"Hasik", tribe:"" }, ageBand:"40s", gender:"m" });
    const rec = speakerRecord();
    document.getElementById("switchSpeaker").click();          // a new speaker clears age; must not trip on the missing gender
    const after = speakerRecord();
    let chip = ""; try{ chip = speakerChipHTML(); }catch(e){ chip = "THREW " + e.message; }
    return { rec, after, chip };
  });
  ok("the record still carries all four slots (gender empty: not on this form)",
     out.rec.origin.town === "Hasik" && out.rec.ageBand === "40s" && out.rec.gender === "", JSON.stringify(out.rec));
  ok("a new speaker clears age and keeps the town", out.after.ageBand === "" && out.after.origin.town === "Hasik", JSON.stringify(out.after));
  ok("the speaker chip still renders", /Hasik/.test(out.chip) && !/THREW/.test(out.chip), out.chip.slice(0, 200));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close(); vSrv.close();
finish();
