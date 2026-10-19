// A popular word (10-19): the card shows its public voices a page at a time,
// newest first, and a "More voices" row under the slots fetches the next page.
// Before, it took 12 in no particular order — the newest could never appear.
// Until the Firestore index is built the ordered query is refused; the card
// then falls back to the old 12, with no "More voices", and nothing breaks.
import { ROOT, serve, launch, newPage, ok, scenario, finish, SHOTS } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();

// 30 public voices on "sun": 20 words, 6 sentences, 4 meanings, one a minute
// apart (v01 oldest … v30 newest). counts as the voice-counts function keeps them.
const T0 = Date.UTC(2026, 9, 1);
const FS = { "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس", voices:{ word:20, context:6, definition:4 } } };
const URLS = {};
for(let i = 1; i <= 30; i++){
  const id = "v" + String(i).padStart(2, "0");
  const type = i <= 20 ? "word" : i <= 26 ? "context" : "definition";
  FS["afd_entries/ent_sun/recordings/" + id] = { recordingId:id, entryId:"ent_sun", uid:"u"+id, speakerId:"spk_"+id,
    type, viaAgent:false, consent:"public", allowPlayback:true, storagePath:`afd/u${id}/${id}.webm`, envelope:[],
    uploadedAt:{ __ts: T0 + i*60000 } };
  URLS[`afd/u${id}/${id}.webm`] = "data:audio/wav;base64,";
}
const init = (noIndex)=> `try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ }
  globalThis.__URLS = ${JSON.stringify(URLS)}; ${noIndex ? "globalThis.__FS_NOINDEX = true;" : ""}`;
// how many voices the open card holds in each slot, and the More voices row's text
const shown = (page)=> page.evaluate(()=>{
  return { chipWord: +(document.querySelector(".slot-word .voices-chip .count")||{}).textContent || 0,
           chipCtx:  +(document.querySelector(".slot-context .voices-chip .count")||{}).textContent || 0,
           chipDef:  +(document.querySelector(".slot-definition .voices-chip .count")||{}).textContent || 0,
           more: (()=>{ const m=document.querySelector(".more-voices"); return m ? m.textContent.replace(/\s+/g," ").trim() : null; })() };
});

await scenario("newest first, then More voices fetches the rest", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init:init(false) });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".slot-word .voices-chip", { timeout:10000 }); await page.waitForTimeout(300);
  const a = await shown(page);
  // newest 12 = v19..v30: words v19,v20 (2) · sentences v21..v26 (6) · meanings v27..v30 (4)
  ok("the first page is the 12 newest voices", a.chipWord===2 && a.chipCtx===6 && a.chipDef===4, JSON.stringify(a));
  ok("a 'More voices' row says how many more (+18)", a.more && /More voices/.test(a.more) && /\+18/.test(a.more), JSON.stringify(a));
  if(SHOTS) await page.screenshot({ path: SHOTS + "/more-voices-1.png", fullPage:true });
  await page.click(".slot-word .voices-chip");           // open the word list, to see it stays open
  await page.click(".more-voices"); await page.waitForTimeout(500);
  const b = await shown(page);
  ok("the next page joins the slots (words v07..v20 → 14)", b.chipWord===14 && b.chipCtx===6 && b.chipDef===4, JSON.stringify(b));
  ok("the open word list stays open after the redraw", await page.evaluate(()=> !!document.querySelector(".slot-word .voices-chip.open")));
  ok("still more: +6", b.more && /\+6/.test(b.more), JSON.stringify(b));
  await page.click(".more-voices"); await page.waitForTimeout(500);
  const c = await shown(page);
  ok("the last page brings all 20 word voices, and the row goes", c.chipWord===20 && c.more===null, JSON.stringify(c));
  if(SHOTS) await page.screenshot({ path: SHOTS + "/more-voices-2.png", fullPage:true });
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("without the index: the old 12, no More voices, no error on screen", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, init:init(true) });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".slot-word .voices-chip", { timeout:10000 }); await page.waitForTimeout(300);
  const a = await shown(page);
  ok("12 voices still show", a.chipWord + a.chipCtx + a.chipDef === 12, JSON.stringify(a));
  ok("no 'More voices' row", a.more === null, JSON.stringify(a));
  ok("the fallback was noted in the console", state.console.some(l => /newest-first index/.test(l)));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("a word with few voices has no More voices row", async ()=>{
  const few = { "afd_entries/ent_sun": FS["afd_entries/ent_sun"] };
  for(const k of ["v01","v02","v03"]) few["afd_entries/ent_sun/recordings/"+k] = FS["afd_entries/ent_sun/recordings/"+k];
  const { page, state } = await newPage(browser, srv.url, { fs:few, init:init(false) });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".slot-word .voices-chip", { timeout:10000 }); await page.waitForTimeout(300);
  const a = await shown(page);
  ok("three voices, no row", a.chipWord===3 && a.more===null, JSON.stringify(a));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
