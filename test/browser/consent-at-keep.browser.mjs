// Record-first (11-11): recording needs no sign-in. Consent — sign-in, the
// permissions, and the speaker's spoken consent — is asked at the FIRST keep,
// not before the first take. Decline discards the take. Agent mode foregrounds
// it. A returning speaker who already has a spoken-consent proof skips the gate.
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const USER = { uid:"uTest1", isAnonymous:false, displayName:"Test", email:"t@example.com" };
const FS = { "afd_entries/ent_camel": { gloss:"camel", glossAr:"جمل", pic:"🐪" } };

const toRecorder = async (page)=>{
  await page.click("#toMic"); await page.waitForSelector("#miccheck:not(.hidden)", { timeout:8000 });
  if(await page.isVisible("#startMic").catch(()=>false)){ await page.click("#startMic"); await page.waitForSelector("#toRecord:not(.hidden)", { state:"visible", timeout:10000 }); }
  await page.click("#toRecord"); await page.waitForSelector("#recorder:not(.hidden)", { timeout:8000 }); await page.waitForTimeout(700); };
const record = async (page, ms=1300)=>{
  await page.dispatchEvent("#recBtn","pointerdown",{ pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(ms);
  await page.dispatchEvent("#recBtn","pointerup",{ pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForSelector("#reviewCard:not(.hidden)", { timeout:8000 }); };
const gateState = (page)=> page.evaluate(()=>{ const g=document.getElementById("consentGate"); return {
  open:g.classList.contains("open"), agent:g.classList.contains("agent"), keepDisabled:document.getElementById("cgKeep").disabled,
  signin:g.contains(document.getElementById("authCard")), perms:g.contains(document.getElementById("consentCard")),
  status:document.getElementById("cgStatus").innerText }; });
const uploadedRecs = (page)=> page.evaluate(()=> Object.keys(globalThis.__FS||{}).filter(k=>/afd_entries\/.*\/recordings\/rec_/.test(k)).length);

// 1. Signed out: record, Keep → the gate opens with sign-in + permissions, Keep
//    held until signed in AND the spoken consent is recorded.
await scenario("record-first: the first Keep opens the consent gate (sign-in held, spoken consent needed)", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS });            // NO user — signed out
  await page.goto(srv.url + "/recorder.html#ent_camel"); await page.waitForTimeout(1400);
  // reaching the recorder needs no sign-in
  await toRecorder(page);
  const reachedSignedOut = await page.evaluate(()=> !document.getElementById("recorder").classList.contains("hidden"));
  ok("recording is reachable with no sign-in wall", reachedSignedOut, String(reachedSignedOut));
  await record(page);
  await page.click("#keepBtn");
  await page.waitForTimeout(500);
  let g = await gateState(page);
  await shot(page, "consent-gate-signedout");
  ok("Keep opens the consent gate, with the sign-in and the permissions inside it", g.open && g.signin && g.perms, JSON.stringify(g));
  ok("Keep is held, and the gate asks the speaker to sign in first", g.keepDisabled && /Sign in/.test(g.status), JSON.stringify(g));
  // sign in by texted code (the stub signs in) → the gate now asks for the spoken consent
  await page.fill("#authPhone", "91234567");
  await page.click("#phoneBtn"); await page.waitForTimeout(400);
  await page.fill("#authCode", "123456");
  await page.click("#codeBtn"); await page.waitForTimeout(900);
  g = await gateState(page);
  ok("once signed in, the gate asks for the speaker's spoken consent; Keep is still held", g.open && g.keepDisabled && /spoken consent/.test(g.status), JSON.stringify(g));
  ok("nothing was uploaded before consent", (await uploadedRecs(page))===0, String(await uploadedRecs(page)));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

// 2. Decline discards the pending take (guardrail 1).
await scenario("Decline at the gate discards the take — nothing is kept or uploaded", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS });
  await page.goto(srv.url + "/recorder.html#ent_camel"); await page.waitForTimeout(1400);
  await toRecorder(page);
  await record(page);
  await page.click("#keepBtn"); await page.waitForTimeout(400);
  await page.click("#cgDecline"); await page.waitForTimeout(400);
  const s = await page.evaluate(()=>({
    gateOpen: document.getElementById("consentGate").classList.contains("open"),
    reviewHidden: document.getElementById("reviewCard").classList.contains("hidden"),
    recBack: !document.getElementById("recBtn").classList.contains("hidden") }));
  ok("the gate closes, the review is dropped and the record button is back", !s.gateOpen && s.reviewHidden && s.recBack, JSON.stringify(s));
  ok("nothing was uploaded", (await uploadedRecs(page))===0, String(await uploadedRecs(page)));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

// 3. Agent mode foregrounds the consent (guardrail 3).
await scenario("agent mode: the gate shows the 'you just recorded someone else' banner", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS });
  await page.goto(srv.url + "/recorder.html#ent_camel"); await page.waitForTimeout(1400);
  await page.check("#agentMode");
  await toRecorder(page);
  await record(page);
  await page.click("#keepBtn"); await page.waitForTimeout(400);
  const g = await gateState(page);
  ok("the consent gate foregrounds that someone else's voice was just recorded", g.open && g.agent, JSON.stringify(g));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

// 4. A returning speaker with a spoken-consent proof on file skips the gate.
await scenario("a speaker with spoken consent already on file keeps straight through", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:USER });
  await page.goto(srv.url + "/recorder.html#ent_camel"); await page.waitForTimeout(1400);
  await toRecorder(page);
  await page.evaluate(()=>{ const spk=(document.getElementById("spkId").value||"").trim();
    globalThis.__FS["afd_speakers/"+spk]={ stewardUid:"uTest1", consent:"public", grant:{ audioPath:"afd_consents/uTest1/g.webm" } }; });
  await record(page);
  await page.click("#keepBtn"); await page.waitForTimeout(900);
  const g = await gateState(page);
  ok("the consent gate does not open for a speaker who already consented", !g.open, JSON.stringify(g));
  ok("the take is uploaded", (await uploadedRecs(page))>=1, String(await uploadedRecs(page)));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
