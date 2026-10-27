// Reports (10-26): trust by default, hold after a report.
//  · someone reports another person's voice — pictogram reason, a spoken
//    reason from the (fake) mic — and the report and the hold land together
//  · the voice's owner sees it's held, and isn't offered Share
//  · someone reports a contributed word card; it leaves the list
//  · a steward's note shows to its recipient on sign-in, once
//  · the steward page lists the report, clears it, and sends a note
import { ROOT, serve, launch, newPage, ok, scenario, finish, SHOTS } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const ME = { uid:"uTest1", isAnonymous:false, displayName:null, email:"me@example.org", phoneNumber:null };
const take = (id, uid, extra) => ({ recordingId:id, entryId:"ent_sun", uid, speakerId:"spk_" + uid.slice(0,6) + "_01",
  type:"word", viaAgent:false, consent:"public", allowPlayback:true, storagePath:`afd/${uid}/${id}.webm`, envelope:[],
  uploadedAt:{ __ts:Date.now() }, ...extra });
const init = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ }
  globalThis.__URLS = { "afd/uOther/rA.webm":"data:audio/wav;base64,", "afd/uOther/rB.webm":"data:audio/wav;base64,",
                        "afd/uTest1/rMine.webm":"data:audio/wav;base64,", "afd/uOther/rW.webm":"data:audio/wav;base64," }; };
const fsOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__FS)));

await scenario("reporting someone else's voice holds it, with the reason and a spoken note", async ()=>{
  const FS = {
    "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس" },
    "afd_entries/ent_sun/recordings/rA": take("rA", "uOther"),
    "afd_entries/ent_sun/recordings/rB": take("rB", "uOther"),
  };
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:ME, init });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".voices-chip", { timeout:10000 });
  await page.click(".slot-word .voices-chip");
  await page.click(".slot-word .voice-row .vr-flag");
  await page.waitForSelector(".afd-flag .fl-tile", { timeout:5000 });
  const sendDisabled = await page.$eval(".afd-flag .fl-go", b => b.disabled);
  ok("Send waits for a reason", sendDisabled);
  await page.click('.afd-flag .fl-tile[data-r="rude"]');
  await page.click(".afd-flag .fl-say .fl-btn");             // start the spoken reason
  await page.waitForTimeout(1300);
  await page.click(".afd-flag .fl-say .fl-btn");             // stop
  await page.waitForTimeout(400);
  if(SHOTS) await page.screenshot({ path: SHOTS + "/report-sheet.png" });
  await page.click(".afd-flag .fl-go");
  await page.waitForSelector(".afd-flag", { state:"detached", timeout:5000 });
  await page.waitForTimeout(400);
  const fs = await fsOf(page);
  const f = fs["afd_flags/ent_sun~rA~uTest1"], r = fs["afd_entries/ent_sun/recordings/rA"];
  ok("the report is filed under one id per person per voice", !!f && f.kind === "voice" && f.reason === "rude" && f.by === "uTest1" && f.held === true, JSON.stringify(f));
  ok("the spoken reason went to the reporter's own folder", !!f && f.audioPath === "afd_flags/uTest1/ent_sun~rA~uTest1.webm", f && f.audioPath);
  ok("the voice is held and no longer playable", !!r.heldAt && r.allowPlayback === false && r.consent === "public", JSON.stringify(r));
  ok("its consent is untouched", r.consent === "public" && !r.withdrawal);
  const rows = await page.$$eval(".slot-word .voice-row", rs => rs.length);
  ok("the reported row leaves the card", rows === 1, "rows " + rows);
  const msg = await page.evaluate(() => (document.querySelector(".afd-notice") || {}).innerText || "");
  ok("a thank-you says a steward will look", /steward will look/.test(msg), msg);
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("reporting twice says you already did", async ()=>{
  const FS = {
    "afd_entries/ent_sun": { gloss:"sun" },
    "afd_entries/ent_sun/recordings/rA": take("rA", "uOther"),
    "afd_flags/ent_sun~rA~uTest1": { kind:"voice", entryId:"ent_sun", recordingId:"rA", reason:"wrong", by:"uTest1", held:false },
  };
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:ME, init });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".solo-voice .vr-flag", { timeout:10000 });   // a single voice: the avatar with Report beside it
  await page.click(".solo-voice .vr-flag");
  await page.waitForTimeout(500);
  const sheet = await page.$(".afd-flag");
  const msg = await page.evaluate(() => (document.querySelector(".afd-notice") || {}).innerText || "");
  ok("no second sheet, and a note that it's already reported", !sheet && /already reported/.test(msg), msg);
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("its owner sees the voice is held, and isn't offered Share", async ()=>{
  const FS = {
    "afd_entries/ent_sun": { gloss:"sun" },
    "afd_speakers/spk_uTest1_01": { stewardUid:"uTest1", consent:"public", viaAgent:false },
    "afd_entries/ent_sun/recordings/rMine": take("rMine", "uTest1", { allowPlayback:false, heldAt:{ __ts:Date.now() } }),
  };
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:ME, init });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".voice-row", { timeout:10000 });
  await page.waitForTimeout(300);
  const row = await page.$eval(".voice-row", r => ({
    status: (r.querySelector(".vr-status") || {}).textContent || "",
    shareShown: !!r.querySelector(".voice-ctl:not(.erase):not([hidden])"),
    erase: !!r.querySelector(".voice-ctl.erase"), flag: !!r.querySelector(".vr-flag") }));
  ok("says a steward is looking at it", /steward is looking/.test(row.status), row.status);
  ok("no Share / Restore while held; Erase still there", !row.shareShown && row.erase, JSON.stringify(row));
  ok("no Report on your own voice", !row.flag);
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("reporting a contributed word card holds it out of the dictionary", async ()=>{
  const FS = {
    "afd_entries/ent_u_kettle": { source:"user", createdBy:"uOther", gloss:"kettle", pic:"\u{1FAD6}" },
    "afd_entries/ent_u_kettle/recordings/rW": { ...take("rW", "uOther"), entryId:"ent_u_kettle" },
  };
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:ME, init });
  await page.goto(srv.url + "/index.html#ent_u_kettle");
  await page.waitForSelector(".reportit", { timeout:10000 });
  await page.click(".reportit");
  await page.waitForSelector(".afd-flag .fl-tile", { timeout:5000 });
  await page.click('.afd-flag .fl-tile[data-r="wrong"]');
  await page.click(".afd-flag .fl-go");
  await page.waitForSelector(".afd-flag", { state:"detached", timeout:5000 });
  await page.waitForTimeout(500);
  const fs = await fsOf(page);
  const f = fs["afd_flags/ent_u_kettle~card~uTest1"], e = fs["afd_entries/ent_u_kettle"];
  ok("the card report is filed", !!f && f.kind === "card" && f.reason === "wrong" && f.held === true && !("recordingId" in f), JSON.stringify(f));
  ok("the word is held", !!e.heldAt, JSON.stringify(e));
  ok("its voices are untouched", fs["afd_entries/ent_u_kettle/recordings/rW"].allowPlayback === true);
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("a steward's note shows once, on sign-in", async ()=>{
  const FS = {
    "afd_entries/ent_sun": { gloss:"sun", pic:"☀️" },
    "afd_notices/n1": { to:"uTest1", from:"uStew", entryId:"ent_sun", recordingId:"rMine", reason:"wrong", text:"Was this meant for another word?", at:{ __ts:Date.now() } },
    "afd_notices/n0": { to:"uTest1", from:"uStew", entryId:"ent_sun", reason:"rude", at:{ __ts:1 }, seenAt:{ __ts:2 } },
    "afd_notices/nX": { to:"someoneElse", from:"uStew", entryId:"ent_sun", reason:"rude", at:{ __ts:3 } },
  };
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:ME, init });
  await page.goto(srv.url + "/index.html");
  await page.waitForSelector(".afd-flag .fl-go", { timeout:10000 });
  const txt = await page.$eval(".afd-flag", w => w.innerText);
  if(SHOTS) await page.screenshot({ path: SHOTS + "/report-notice.png" });
  ok("it says it's a note from a steward, why, and the text", /note from a steward/.test(txt) && /Wrong word/.test(txt) && /another word/.test(txt), txt);
  await page.click(".afd-flag .fl-go");
  await page.waitForTimeout(400);
  const fs = await fsOf(page);
  ok("OK marks it seen", !!fs["afd_notices/n1"].seenAt);
  ok("only that one was shown (not the seen one, not someone else's)", !(await page.$(".afd-flag")) && !fs["afd_notices/nX"].seenAt);
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("steward: the report is listed, cleared, and a note goes back", async ()=>{
  const FS = {
    "afd_admins/uTest1": { at:1 },
    "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس" },
    "afd_speakers/spk_uOther_01": { stewardUid:"uOther", consent:"public", viaAgent:false },
    "afd_entries/ent_sun/recordings/rA": take("rA", "uOther", { allowPlayback:false, heldAt:{ __ts:Date.now() }, speakerId:"spk_uOther_01" }),
    "afd_flags/ent_sun~rA~uR1": { kind:"voice", entryId:"ent_sun", recordingId:"rA", reason:"rude", by:"uR1", held:true, at:{ __ts:Date.now() - 1000 } },
    "afd_flags/ent_sun~rA~uR2": { kind:"voice", entryId:"ent_sun", recordingId:"rA", reason:"rude", by:"uR2", held:false, at:{ __ts:Date.now() } },
  };
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:ME, init });
  await page.goto(srv.url + "/steward.html#reports");
  await page.waitForSelector("#list .flagrow", { timeout:10000 });
  const n = await page.$eval("#n-flags", e => e.textContent.trim());
  ok("the Reports tab counts one open thing (two reports on one voice)", n === "1", n);
  const rows = await page.$$eval("#list .flagrow", rs => rs.length);
  ok("both reports are listed under it", rows === 2, "rows " + rows);
  if(SHOTS) await page.screenshot({ path: SHOTS + "/report-steward.png", fullPage:true });
  // send a note first, while it's open
  await page.click('#list .actions .btn:not(.primary):not(.danger)');
  await page.waitForSelector("#list .compose textarea");
  await page.fill("#list .compose textarea", "Please record it again.");
  await page.click("#list .compose .send");
  await page.waitForSelector("#list .sent", { timeout:5000 });
  let fs = await fsOf(page);
  const note = Object.entries(fs).find(([k]) => k.startsWith("afd_notices/"));
  ok("a note goes to whoever recorded it", !!note && note[1].to === "uOther" && note[1].from === "uTest1" && note[1].reason === "rude"
     && note[1].recordingId === "rA" && note[1].text === "Please record it again.", JSON.stringify(note));
  // looks fine → show it
  await page.click("#list .actions .btn.primary");
  await page.waitForTimeout(600);
  fs = await fsOf(page);
  const r = fs["afd_entries/ent_sun/recordings/rA"];
  ok("cleared: the hold is gone and it plays again", !r.heldAt && r.allowPlayback === true && !!r.modClearedAt && r.modBy === "uTest1", JSON.stringify(r));
  ok("both reports are resolved as approved", ["uR1","uR2"].every(u => fs["afd_flags/ent_sun~rA~" + u].resolution === "approved"));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
