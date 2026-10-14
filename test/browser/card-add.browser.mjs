// Every slot on an open card has its own "+ add" under it — the word too (10-14:
// the word's own recording used to be reachable only from "Say it yourself" at
// the foot of the card). Each goes to the recorder on that word, with the type
// in the hash for sentence and meaning.
import { ROOT, serve, launch, newPage, ok, scenario, finish, SHOTS } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const FS = { "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس" } };

await scenario("each slot has its own add link", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS,
    init:()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } } });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".slot-word", { timeout:10000 }); await page.waitForTimeout(300);
  if(SHOTS) await page.screenshot({ path: SHOTS + "/card-add.png", fullPage:true });
  const a = await page.evaluate(()=> Object.fromEntries(["word","context","definition"].map(t=>{
    const l = document.querySelector(".slot-"+t+" .slot-add");
    return [t, l ? { href: l.getAttribute("href"), text: l.textContent.trim() } : null]; })));
  ok("the word slot has '+ Add a recording' to the recorder on this word",
     a.word && /recorder(\.html)?#ent_sun$/.test(a.word.href) && a.word.text === "Add a recording", JSON.stringify(a));
  ok("sentence and meaning keep their typed links",
     a.context && /#ent_sun\|context$/.test(a.context.href) && a.definition && /#ent_sun\|definition$/.test(a.definition.href), JSON.stringify(a));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
