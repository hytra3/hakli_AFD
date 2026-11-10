// Voice notes (11-09, from the field): a fourth slot on every card, for talking
// ABOUT the word in any language ("everybody knows father — but 'my father'…").
// The card shows the slot with its own "+ Add a voice note", and each note says
// which language it is in. The recorder records one (up to a minute), and on
// Keep asks which language was spoken; closing the question means Hakli.
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const USER = { uid:"uTest1", isAnonymous:false, displayName:"Test Steward", email:"test@example.com" };
const take = (id, extra) => ({ recordingId:id, entryId:"ent_father", uid:"uOther", speakerId:"spk_o_01", viaAgent:false,
  consent:"public", allowPlayback:true, storagePath:`afd/uOther/${id}.webm`, envelope:[], uploadedAt:{ __ts: Date.now() - 60000 }, ...extra });
const FS = {
  "afd_entries/ent_father": { gloss:"father", glossAr:"أب", pic:"👨" },
  "afd_entries/ent_father/recordings/rW":  take("rW",  { type:"word" }),
  "afd_entries/ent_father/recordings/rN1": take("rN1", { type:"note", lang:"qhk" }),
  "afd_entries/ent_father/recordings/rN2": take("rN2", { type:"note", lang:"ar" }),
};
const init = (m)=> new Function(`try{ localStorage.setItem("afd_display_mode","${m}"); }catch(_){ }
  globalThis.__UPLOAD_DELAY = 1500;
  globalThis.__URLS = { "afd/uOther/rW.webm":"data:audio/wav;base64,", "afd/uOther/rN1.webm":"data:audio/wav;base64,", "afd/uOther/rN2.webm":"data:audio/wav;base64," };`);

await scenario("the card has a voice-notes slot, and each note says its language", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init:init("auto") });
  await page.goto(srv.url + "/index.html#ent_father");
  await page.waitForSelector(".slot-note", { timeout:10000 }); await page.waitForTimeout(400);
  const chip = await page.$(".slot-note .voices-chip"); if(chip) await chip.click();
  await page.waitForTimeout(300); await shot(page, "voice-notes-card", true);
  const a = await page.evaluate(()=>{
    const s = document.querySelector(".slot-note");
    const order = [...document.querySelectorAll(".slot")].map(x => [...x.classList].find(c => c.startsWith("slot-")));
    return { order, label: s.querySelector(".slot-label").textContent.trim(),
      add: (s.querySelector(".slot-add")||{}).getAttribute ? s.querySelector(".slot-add").getAttribute("href") : null,
      addText: (s.querySelector(".slot-add")||{}).textContent.trim(),
      tags: [...s.querySelectorAll(".note-lang")].map(t => t.textContent.trim()).sort(),
      wordTags: document.querySelectorAll(".slot-word .note-lang").length }; });
  ok("the notes slot comes last, after the meaning", JSON.stringify(a.order.slice(-2)) === JSON.stringify(["slot-definition","slot-note"]), JSON.stringify(a.order));
  ok("it is labelled voice notes, in English and Arabic", /voice notes/.test(a.label) && /ملاحظات صوتية/.test(a.label), a.label);
  ok("'+ Add a voice note' opens the recorder on this word's notes", /recorder(\.html)?#ent_father\|note$/.test(a.add) && a.addText === "Add a voice note", JSON.stringify([a.add, a.addText]));
  ok("each note shows its language (Hakli · Arabic); the word's voice has no tag", JSON.stringify(a.tags) === JSON.stringify(["Arabic","Hakli"]) && a.wordTags === 0, JSON.stringify(a));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("sound view: the slot is there, with no language text", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init:init("sound") });
  await page.goto(srv.url + "/index.html#ent_father");
  await page.waitForSelector(".slot-note", { timeout:10000 }); await page.waitForTimeout(400);
  ok("no language tags in sound view", await page.evaluate(()=> !document.querySelector(".note-lang")));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

const toRecorder = async (page)=>{
  await page.click("#toMic"); await page.waitForSelector("#miccheck:not(.hidden)", { timeout:8000 });
  if(await page.isVisible("#startMic")){ await page.click("#startMic"); await page.waitForSelector("#toRecord:not(.hidden)", { state:"visible", timeout:10000 }); }
  await page.click("#toRecord"); await page.waitForSelector("#recorder:not(.hidden)", { timeout:8000 }); await page.waitForTimeout(900); };
const recordFor = async (page, ms)=>{
  const b = await page.$("#recBtn"); const box = await b.boundingBox();
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
  await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
  await page.waitForSelector("#reviewCard:not(.hidden)", { timeout:10000 }); await page.waitForTimeout(300); };
const notesIn = (page)=> page.evaluate(()=> Object.entries(globalThis.__FS||{})
  .filter(([k,v]) => /^afd_entries\/ent_father\/recordings\//.test(k) && v && v.type==="note" && v.uid==="uTest1").map(([,v]) => ({ lang:v.lang, type:v.type })));

await scenario("recorder: a voice note asks its language on Keep", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:USER, init:init("auto") });
  await page.goto(srv.url + "/recorder.html#ent_father|note"); await page.waitForTimeout(1500);
  await toRecorder(page);
  const r = await page.evaluate(()=>({ type: document.getElementById("entryCardHost").getAttribute("data-rectype"),
    instr: document.getElementById("instruction").innerText }));
  ok("the link opens on the notes slot, with its own instruction", r.type==="note" && /Any language/.test(r.instr) && /بأيّ لغة/.test(r.instr), JSON.stringify(r));

  await recordFor(page, 2500);
  const before = await page.evaluate(()=> document.querySelectorAll("#entryCardHost .slot-note [data-lang]").length);
  await page.click("#keepBtn");
  await page.waitForSelector(".afd-ask", { timeout:5000 }); await page.waitForTimeout(200);
  await shot(page, "voice-notes-ask");
  const q = await page.evaluate(()=>({ title: document.querySelector(".afd-ask h2").innerText,
    choices: [...document.querySelectorAll(".afd-ask .ask-ctext")].map(x => x.innerText.replace(/\s+/g," ").trim()) }));
  ok("Keep asks 'Which language did you speak?'", /Which language/.test(q.title) && /بأيّ لغة تكلّمت/.test(q.title), q.title);
  ok("…with four choices: Hakli, Arabic, English, a mix", q.choices.length===4 && /Hakli/.test(q.choices[0]) && /Arabic/.test(q.choices[1]) && /English/.test(q.choices[2]) && /mix/.test(q.choices[3]), JSON.stringify(q.choices));
  await page.click(".afd-ask .ask-choice:nth-child(2) .ask-cpick");          // Arabic
  await page.waitForFunction(()=> !document.querySelector(".afd-ask"), null, { timeout:3000 });
  const waitNotes = (n)=> page.waitForFunction((n)=> Object.entries(globalThis.__FS||{}).filter(([k,v]) => /recordings\//.test(k) && v && v.type==="note" && v.uid==="uTest1").length >= n, n, { timeout:8000 }).catch(()=>{});
  await waitNotes(1);
  let notes = await notesIn(page);
  ok("the note uploads as type note, language ar", notes.length===1 && notes[0].lang==="ar", JSON.stringify(notes));
  // 11-10: the card on screen redraws once the take is uploaded — no reload
  const shown = await page.waitForFunction((b)=> document.querySelectorAll("#entryCardHost .slot-note [data-lang]").length > b, before, { timeout:6000 }).then(()=>true, ()=>false);
  ok("the new note shows on the card without a reload (" + before + " → more)", shown,
     await page.evaluate(()=> (document.querySelector("#entryCardHost .slot-note")||{}).innerText));

  // a second note; closing the question files it under the dictionary's own language
  await page.click('#entryCardHost a.slot-add[href$="|note"]'); await page.waitForTimeout(800);
  if(await page.isVisible("#recBtn")){
    await recordFor(page, 1500);
    await page.click("#keepBtn"); await page.waitForSelector(".afd-ask", { timeout:5000 });
    await page.click(".afd-ask .ask-x"); await waitNotes(2);
    notes = await notesIn(page);
    ok("closing the question means Hakli (qhk)", notes.length===2 && notes.some(n => n.lang==="qhk"), JSON.stringify(notes));
  }else ok("record button back for a second note", false, "recBtn hidden after compare");
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("recorder: the word slot is not asked a language", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:USER, init:init("auto") });
  await page.goto(srv.url + "/recorder.html#ent_father"); await page.waitForTimeout(1500);
  await toRecorder(page);
  await recordFor(page, 2000);
  await page.click("#keepBtn"); await page.waitForTimeout(800);
  ok("no language question for a word take", !(await page.$(".afd-ask")));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
