// 11-11: when the microphone can't open, the mic-check screen says *why* and how
// to recover — blocked / no mic / another app using it — instead of one generic
// "didn't open" error. getUserMedia is stubbed to reject with each DOMException.
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const USER = { uid:"uMic1", isAnonymous:false, displayName:"T", email:"t@e.org" };
const FS = { "afd_entries/ent_camel": { gloss:"camel", glossAr:"جمل", pic:"🐪" } };
// bridge view shows Arabic · English, so the English assertion text is present
const deny = (name)=> `(()=>{
  try{ localStorage.setItem("afd_display_mode","bridge"); }catch(_){ }
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("stub ${name}", "${name}"));
})()`;

async function toMicError(page){
  await page.goto(srv.url + "/recorder.html#ent_camel");
  await page.waitForSelector("#miccheck", { timeout:8000 }).catch(()=>{});
  if(await page.isVisible("#toMic")) await page.click("#toMic");
  await page.waitForSelector("#miccheck:not(.hidden)", { timeout:8000 });
  await page.click("#startMic");
  await page.waitForFunction(()=> document.getElementById("verdict").innerText.trim().length > 0, null, { timeout:8000 });
}
const verdict = (page)=> page.evaluate(()=>({
  text: document.getElementById("verdict").innerText.replace(/\s+/g," ").trim(),
  bad: document.getElementById("verdict").classList.contains("bad"),
  toRecordHidden: document.getElementById("toRecord").classList.contains("hidden"),
  listenOnly: !document.getElementById("listenOnlyBtn2").classList.contains("hidden") }));

await scenario("blocked mic: a clear 'blocked' message, record stays shut, listen-only offered", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:USER, init:deny("NotAllowedError") });
  await toMicError(page);
  const v = await verdict(page);
  await shot(page, "mic-blocked");
  ok("the verdict says the mic is blocked (not the generic error)", /blocked/i.test(v.text) && v.bad, JSON.stringify(v));
  ok("can't slip through to recording; listen-only is still offered", v.toRecordHidden && v.listenOnly, JSON.stringify(v));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("no microphone: says so and leaves listen-only open", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:USER, init:deny("NotFoundError") });
  await toMicError(page);
  const v = await verdict(page);
  ok("the verdict says no microphone was found", /no microphone/i.test(v.text) && v.bad, JSON.stringify(v));
  ok("listen-only is offered", v.listenOnly, JSON.stringify(v));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("mic busy: says another app is using it", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:USER, init:deny("NotReadableError") });
  await toMicError(page);
  const v = await verdict(page);
  ok("the verdict says another app is using the microphone", /another app/i.test(v.text) && v.bad, JSON.stringify(v));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
