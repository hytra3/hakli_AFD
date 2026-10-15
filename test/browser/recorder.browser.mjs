// The recorder's step 3: the card's slots choose what is recorded (the old
// Word / Sentence / Meaning tabs are gone), choosing a slot is not a step in
// the history, and the instructions and readout come from the shared table.
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const USER = { uid:"uTest1", isAnonymous:false, displayName:"Test Steward", email:"test@example.com" };
const FS = { "afd_entries/ent_camel": { gloss:"camel", glossAr:"جمل", pic:"🐪" } };
const mode = (m)=> `(()=>{ try{ localStorage.setItem("afd_display_mode","${m}"); }catch(_){ } })()`;
const toRecorder = async (page)=>{
  await page.click("#toMic"); await page.waitForSelector("#miccheck:not(.hidden)", { timeout:8000 });
  if(await page.isVisible("#startMic")){ await page.click("#startMic"); await page.waitForSelector("#toRecord:not(.hidden)", { state:"visible", timeout:10000 }); }
  await page.click("#toRecord"); await page.waitForSelector("#recorder:not(.hidden)", { timeout:8000 }); await page.waitForTimeout(900); };
const rs = (page)=> page.evaluate(()=>({
  tabs: document.querySelectorAll("#rectype, .rectype, .rt").length,
  type: document.getElementById("entryCardHost").getAttribute("data-rectype"),
  onRec: !document.getElementById("recorder").classList.contains("hidden"),
  hash: location.hash,
  instr: document.getElementById("instruction").innerHTML,
  dots: document.querySelectorAll("#instruction .dot").length,
  progress: document.getElementById("progress").innerText.replace(/\s+/g," ").trim(),
  rec: !document.getElementById("recBtn").classList.contains("hidden") }));
const step = (page)=> page.evaluate(()=> ["setup","miccheck","recorder"].find(id=>!document.getElementById(id).classList.contains("hidden")));
const pick = async (page, type)=>{ await page.click('#entryCardHost a.slot-add[href$="|'+type+'"]', { timeout:5000 });
  await page.waitForFunction((t)=> document.getElementById("entryCardHost").getAttribute("data-rectype")===t, type, { timeout:5000 }); await page.waitForTimeout(700); };

for(const m of ["auto","script","sound"]){
  await scenario(m+": step 3 of the recorder", async ()=>{
    const { page, ctx, state } = await newPage(browser, srv.url, { fs:FS, user:USER });
    await ctx.addInitScript(mode(m));
    await page.goto(srv.url + "/recorder.html#ent_camel"); await page.waitForTimeout(1500);
    await toRecorder(page);
    const word = await rs(page);
    await pick(page, "context");    const sentence = await rs(page);
    await pick(page, "definition"); const meaning  = await rs(page);
    if(m==="auto") await shot(page, "recorder-meaning-slot");

    ok(m+": no Word / Sentence / Meaning tabs; the card's slots choose word → sentence → meaning",
       word.tabs===0 && word.type==="word" && sentence.type==="context" && meaning.type==="definition" && word.rec && !state.errors.length,
       JSON.stringify([word.tabs, word.type, sentence.type, meaning.type, state.errors.slice(0,2)]));
    ok(m+": choosing a slot stays on step 3 (it used to drop to step 1)", sentence.onRec && meaning.onRec && /\|definition$/.test(meaning.hash), JSON.stringify([sentence.onRec, meaning.onRec, meaning.hash]));

    // the instruction for each type, in this display mode
    const noStars = [word, sentence, meaning].every(x=> !x.instr.includes("*"));
    if(m==="sound"){
      ok("sound: the instruction is dots — two for the word, one for a sentence or a meaning", word.dots===2 && sentence.dots===1 && meaning.dots===1 && !/[A-Za-z؀-ۿ]{3}/.test(word.instr.replace(/<[^>]+>/g,"")), JSON.stringify([word.dots, sentence.dots, meaning.dots]));
    }else{
      const en = m==="auto";
      ok(m+": the instruction names what to say, with the one word in bold"+(en?", Arabic then English":", Arabic only"),
         noStars && /<b>مرّتين<\/b>/.test(word.instr) && /<b>جملة<\/b>/.test(sentence.instr) && /<b>تعنيه<\/b>/.test(meaning.instr)
         && (en ? /<b>twice<\/b>/.test(word.instr) && /<b>sentence<\/b>/.test(sentence.instr) && /<b>means<\/b>/.test(meaning.instr)
                : !/[A-Za-z]{4}/.test(word.instr.replace(/<[^>]+>/g,""))),
         JSON.stringify([word.instr, sentence.instr, meaning.instr]));
    }
    // the readout: Arabic always, English only in the bilingual mode
    const arOK = /^‹?\s*الكلمة [٠-٩]+ من [٠-٩]+/.test(word.progress), enOK = /STEP 3 \/ 3 · WORD \d+ OF \d+$/.test(word.progress);
    ok(m+": the step-3 readout reads 'الكلمة N من M'"+(m==="auto"?" and 'STEP 3 / 3 · WORD N OF M'":", with no English"), arOK && (m==="auto" ? enOK : !/[A-Za-z]{3}/.test(word.progress)), JSON.stringify(word.progress));

    // choosing a slot added nothing to the history: Back goes to step 2, Forward returns
    await page.evaluate(()=>history.back());
    await page.waitForFunction(()=> !document.getElementById("miccheck").classList.contains("hidden"), null, { timeout:5000 }).catch(()=>{});
    const b = await step(page);
    await page.evaluate(()=>history.forward()); await page.waitForTimeout(900);
    const f = await step(page);
    ok(m+": after choosing a slot, Back goes to step 2 and Forward returns to step 3", b==="miccheck" && f==="recorder", JSON.stringify([b, f]));

    // listening mode has its own readout
    await page.click("#progressWrap"); await page.waitForSelector("#setup:not(.hidden)", { timeout:5000 });
    await page.click("#listenOnlyBtn"); await page.waitForSelector("#recorder:not(.hidden)", { timeout:5000 }); await page.waitForTimeout(600);
    const listen = await rs(page);
    ok(m+": listening reads 'استماع · الكلمة N من M'"+(m==="auto"?" and 'LISTENING · WORD N OF M'":""),
       /استماع · الكلمة [٠-٩]+ من [٠-٩]+/.test(listen.progress) && (m==="auto" ? /LISTENING · WORD \d+ OF \d+$/.test(listen.progress) : !/[A-Za-z]{3}/.test(listen.progress)) && !listen.rec, JSON.stringify(listen.progress));
    await ctx.close();
  });
}

await scenario("speaker chip", async ()=>{
  const { page, ctx } = await newPage(browser, srv.url, { fs:FS, user:USER }); await ctx.addInitScript(mode("auto"));
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1500);
  const t = await page.evaluate(()=>{ document.getElementById("agentMode").checked=true;
    document.getElementById("spkGender").value="f"; renderSpeakerChip(); const f=document.getElementById("recChip").innerText;
    document.getElementById("spkGender").value="m"; renderSpeakerChip(); return [f, document.getElementById("recChip").innerText]; });
  ok("the speaker chip shows the gender in the form's own words", /أنثى · F/.test(t[0]) && /ذكر · M/.test(t[1]), JSON.stringify(t));
  await ctx.close();
});

await scenario("arrows beside the word counter step through words while recording", async ()=>{
  const { page, ctx, state } = await newPage(browser, srv.url, { fs:FS, user:USER });
  await ctx.addInitScript(mode("auto"));
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1500);
  await toRecorder(page);
  const at = ()=> page.evaluate(()=> document.getElementById("progress").innerText.match(/WORD (\d+) OF (\d+)/));
  const nav = ()=> page.evaluate(()=>{ const n=document.getElementById("wordNav");
    return { shown: getComputedStyle(n).display !== "none", prev: document.getElementById("wordPrev").getAttribute("aria-label"),
             off: document.getElementById("wordNext").disabled }; });
  const n0 = await nav();
  ok("recording mode: ← → beside the counter, labelled", n0.shown && n0.prev === "Previous word" && !n0.off, JSON.stringify(n0));
  const w1 = await at();
  await page.click("#wordNext"); await page.waitForTimeout(500);
  const w2 = await at();
  ok("→ moves to the next word", w1 && w2 && +w2[1] === +w1[1] + 1, JSON.stringify([w1 && w1[0], w2 && w2[0]]));
  const skips = await page.evaluate(()=> JSON.stringify(localStorage).includes("skipped"));
  ok("…without leaving a 'doesn't know this word' mark", !skips);
  await page.click("#wordPrev"); await page.waitForTimeout(500);
  ok("← goes back", +(await at())[1] === +w1[1]);
  await page.evaluate(()=>{ document.getElementById("reviewCard").classList.remove("hidden"); paintWordNav(); });
  ok("a take waiting for Keep / Record again turns them off", (await nav()).off);
  await page.evaluate(()=>{ document.getElementById("reviewCard").classList.add("hidden"); paintWordNav(); });
  await page.click("#progressWrap"); await page.waitForSelector("#setup:not(.hidden)", { timeout:5000 });
  ok("not on the speaker step", !(await nav()).shown);
  await page.click("#listenOnlyBtn"); await page.waitForSelector("#recorder:not(.hidden)", { timeout:5000 }); await page.waitForTimeout(500);
  ok("not in listening mode (it has its own Previous / Next row)", !(await nav()).shown);
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await browser.close(); srv.close();
finish();
