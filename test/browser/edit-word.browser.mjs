// Edit a word's face — English, Arabic, emoji — from the open card (10-14).
// A steward on any word (seeded included); a contributor on their own word;
// nobody else sees the button. The header repaints in place after saving.
import { ROOT, serve, launch, newPage, ok, scenario, finish, SHOTS } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const STEW = { uid:"uSteward", isAnonymous:false, displayName:null, email:"steward@example.org", providerData:[{ providerId:"password" }] };
const ANNA = { uid:"uAnna", isAnonymous:false, displayName:null, email:"anna@example.org", providerData:[{ providerId:"phone" }] };
const BOB  = { uid:"uBob",  isAnonymous:false, displayName:null, email:"bob@example.org",  providerData:[{ providerId:"phone" }] };
const FS = {
  "afd_admins/uSteward": { email:"steward@example.org" },
  "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس", pic:"☀️" },
  "afd_entries/ent_u_abc": { source:"user", createdBy:"uAnna", gloss:"", glossAr:"قهوة", pic:"☕" },
};
const init = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
const hasEdit = (page)=> page.evaluate(()=> [...document.querySelectorAll(".wt-btn")].some(b=>/Edit word/.test(b.textContent)));

await scenario("a steward edits a seeded word's text and emoji", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:STEW, init });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".word-tools", { timeout:10000 }); await page.waitForTimeout(300);
  ok("the steward sees Edit word on a seeded word", await hasEdit(page));
  await page.evaluate(()=>[...document.querySelectorAll(".wt-btn")].find(b=>/Edit word/.test(b.textContent)).click());
  const before = await page.evaluate(()=>({ en:document.querySelector('[data-f="en"]').value, ar:document.querySelector('[data-f="ar"]').value, pic:document.querySelector('[data-f="pic"]').value }));
  ok("the editor opens with the word's current text and emoji", before.en==="sun" && before.ar==="الشمس" && before.pic==="☀️", JSON.stringify(before));
  await page.waitForSelector(".ep-tab", { timeout:5000 });
  const pk = await page.evaluate(()=>({
    sug: [...document.querySelectorAll(".ep-sug .ep-e")].map(b=>b.dataset.e),
    tabs: [...document.querySelectorAll(".ep-tab")].map(t=>t.textContent),
    needed: [...document.querySelectorAll(".ep-grid .ep-e")].map(b=>b.dataset.e) }));
  ok("picker: suggests the word's own emoji (sun → ☀️)", pk.sug.includes("\u2600\uFE0F"), JSON.stringify(pk.sug));
  ok("picker: 'not in the dictionary yet' first, then Dhofar, then the list's fields", /Not in the dictionary yet/.test(pk.tabs[0]) && /Dhofar/.test(pk.tabs[1]) && /^The physical world/.test(pk.tabs[2]) && /^The body/.test(pk.tabs[3]), JSON.stringify(pk.tabs));
  ok("picker: 'not in the dictionary yet' leaves out words already here (sun)", pk.needed.length > 20 && !pk.needed.includes("\u2600\uFE0F") && pk.needed.includes("\u{1F525}"), JSON.stringify(pk.needed.slice(0,12)));
  await page.evaluate(()=>[...document.querySelectorAll(".ep-tab")].find(t=>/^Animals/.test(t.textContent)).click());
  await page.evaluate(()=>document.querySelector('.ep-grid .ep-e[data-e="\u{1F415}"]').click());
  const picked = await page.evaluate(()=>({ v: document.querySelector('[data-f="pic"]').value, cur: document.querySelector(".ep-cur").textContent }));
  ok("picker: tapping an emoji fills the box and the preview", picked.v==="\u{1F415}" && picked.cur==="\u{1F415}", JSON.stringify(picked));
  await page.fill('[data-f="en"]', "  the  sun ");
  await page.fill('[data-f="pic"]', "\u{1F31E}");
  if(SHOTS) await page.screenshot({ path: SHOTS + "/edit-word.png", fullPage:true });
  await page.click(".wt-edit .wt-save"); await page.waitForTimeout(300);
  const d = await page.evaluate(()=> globalThis.__FS["afd_entries/ent_sun"]);
  ok("saved: tidied English, Arabic kept, new emoji, glosses, who + when",
     d.gloss==="the sun" && d.glossAr==="الشمس" && d.pic==="\u{1F31E}" && d.glosses.en==="the sun" && d.glosses.ar==="الشمس"
     && d.editedBy==="uSteward" && d.editedAt, JSON.stringify(d));
  const head = await page.evaluate(()=>{ const c=document.querySelector(".card.open")||document.querySelector(".card");
    return { thumb:c.querySelector(".thumb").textContent, gloss:c.querySelector(".gloss").textContent,
             tags: !!c.querySelector(".gloss .tags") }; });
  ok("the header repaints in place, tags row kept", head.thumb==="\u{1F31E}" && /^the sun/.test(head.gloss) && /الشمس/.test(head.gloss) && head.tags, JSON.stringify(head));
  ok("the editor closes after saving", await page.evaluate(()=> document.querySelector(".wt-edit").hidden));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("a contributor edits their own word; others can't", async ()=>{
  { const { page, state } = await newPage(browser, srv.url, { fs:FS, user:ANNA, init });
    await page.goto(srv.url + "/index.html#ent_u_abc");
    await page.waitForSelector(".word-tools", { timeout:10000 }); await page.waitForTimeout(300);
    ok("the creator sees Edit word on her own word", await hasEdit(page));
    await page.evaluate(()=>[...document.querySelectorAll(".wt-btn")].find(b=>/Edit word/.test(b.textContent)).click());
    await page.fill('[data-f="en"]', "coffee"); await page.fill('[data-f="pic"]', "");
    await page.click(".wt-edit .wt-save"); await page.waitForTimeout(300);
    const d = await page.evaluate(()=> globalThis.__FS["afd_entries/ent_u_abc"]);
    ok("an empty emoji clears it; English added", d.gloss==="coffee" && d.pic===undefined && d.glosses.en==="coffee", JSON.stringify(d));
    ok("no page errors", !state.errors.length, state.errors.join(" | ")); }
  { const { page } = await newPage(browser, srv.url, { fs:FS, user:BOB, init });
    await page.goto(srv.url + "/index.html#ent_sun");
    await page.waitForSelector(".slot-word", { timeout:10000 }); await page.waitForTimeout(600);
    ok("someone else sees no Edit word on a seeded word", !(await hasEdit(page))); }
});

await browser.close(); srv.close();
finish();
