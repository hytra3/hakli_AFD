// Archiving needs the speaker's spoken consent: ticking "archive" asks for it,
// and Continue won't go on to recording without it. Unticked, or with consent
// on file, Continue goes on as before.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const USER = { uid:"uTest1", isAnonymous:false, displayName:"Test", email:"t@example.com" };
const state = () => ({
  mic: !document.getElementById("miccheck").classList.contains("hidden"),
  note: document.getElementById("grantNote").textContent,
  warn: document.getElementById("grantNote").classList.contains("warn"),
});

await scenario("archive ticked, no spoken consent: Continue stops and asks for it", async ()=>{
  const { page, state: st } = await newPage(browser, srv.url, { user:USER });
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1500);
  await page.evaluate(()=>{ const c=document.getElementById("cArchive"); c.checked=true; c.dispatchEvent(new Event("change")); });
  const hint = await page.evaluate(()=>document.getElementById("grantNote").textContent);
  ok("ticking archive says spoken consent is needed", /spoken consent/.test(hint), hint);
  await page.click("#toMic"); await page.waitForTimeout(600);
  const s = await page.evaluate(state);
  ok("Continue does not go on to the microphone", !s.mic, JSON.stringify(s));
  ok("the note asks for the consent (or to untick)", s.warn && /untick/.test(s.note), JSON.stringify(s));
  ok("no page errors", !st.errors.length, st.errors.join(" | "));
});

await scenario("archive unticked again: Continue goes on", async ()=>{
  const { page, state: st } = await newPage(browser, srv.url, { user:USER });
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1500);
  await page.evaluate(()=>{ const c=document.getElementById("cArchive"); c.checked=true; c.dispatchEvent(new Event("change")); });
  await page.click("#toMic"); await page.waitForTimeout(400);
  await page.evaluate(()=>{ const c=document.getElementById("cArchive"); c.checked=false; c.dispatchEvent(new Event("change")); });
  await page.click("#toMic"); await page.waitForTimeout(600);
  const s = await page.evaluate(state);
  ok("goes on to the microphone", s.mic, JSON.stringify(s));
  ok("the warning is gone", !s.warn && !s.note, JSON.stringify(s));
  ok("no page errors", !st.errors.length, st.errors.join(" | "));
});

await scenario("archive ticked, spoken consent already on the speaker card: Continue goes on", async ()=>{
  const { page, state: st } = await newPage(browser, srv.url, { user:USER, fs:{} });
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1500);
  const spk = await page.evaluate(async ()=>{ await window.AFD.settleSpeakerField(); return document.getElementById("spkId").value.trim(); });
  await page.evaluate((spk)=>{ globalThis.__FS[`afd_speakers/${spk}`] = { stewardUid:"uTest1", consent:"public", grant:{ audioPath:"afd_consents/uTest1/g.webm" } }; }, spk);
  await page.evaluate(()=>{ const c=document.getElementById("cArchive"); c.checked=true; c.dispatchEvent(new Event("change")); });
  await page.click("#toMic"); await page.waitForTimeout(600);
  const s = await page.evaluate(state);
  ok("goes on to the microphone", s.mic, JSON.stringify(s));
  ok("no page errors", !st.errors.length, st.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
