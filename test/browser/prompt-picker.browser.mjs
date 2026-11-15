// The steward "which take plays" picker (#1 Ship 2, prompts/admin.html). Prompt
// lines keep an append-only takes[] manifest (Ship 1); the steward points the app
// at the take that should play, without deleting the others. The per-line history
// reuses the shared provenance panel (AFDCore.ledgerPanel) — the same component
// the #6 word-card ledger uses in steward.html.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();

// A real (non-anonymous) steward — admin.html rejects an anonymous session.
const STEWARD = { uid:"uStew", isAnonymous:false, email:"steward@example.com", providerData:[{ providerId:"password" }] };
const take = (id, at) => ({ id, path:"afd_ui/intro.tour.what/"+id+".webm", by:"u"+id, ct:"audio/webm", at });
const seed = () => ({
  // two takes → the picker lists this line; canonical defaults to the latest (t2)
  "afd_ui_prompts/intro.tour.what": { key:"intro.tour.what", intent:"What is this?", intentAr:"ما هذا؟",
    status:"recorded", storagePath:take("t2").path, latestTakeId:"t2", takes:[take("t1",1000), take("t2",2000)] },
  // a single take → never offered (there is no choice to make)
  "afd_ui_prompts/find.hint": { key:"find.hint", status:"recorded", storagePath:"afd_ui/find.hint/t1.webm",
    latestTakeId:"t1", takes:[take("t1",1000)] }
});
const open = async ()=>{
  const t = await newPage(browser, srv.url, { fs:seed(), user:STEWARD });
  await t.page.goto(srv.url + "/prompts/admin.html");
  await t.page.waitForSelector("#panel:not(.hidden)", { timeout:15000 });
  await t.page.waitForSelector("#takes .qgroup", { timeout:8000 });
  return t;
};
const groups = (page)=> page.$$eval("#takes .qgroup", g=>g.length);
const badged  = (page)=> page.$$eval("#takes .takerow", rs=> rs.map(r=> !!r.querySelector(".badge")));
const doc = (page)=> page.evaluate(()=> (globalThis.__FS||{})["afd_ui_prompts/intro.tour.what"]);

await scenario("lists only lines with more than one take, and marks the one that plays", async ()=>{
  const { page, state } = await open();
  ok("one multi-take line is listed (the single-take line is not)", (await groups(page)) === 1, String(await groups(page)));
  const b = await badged(page);
  ok("exactly one take is marked as the one that plays", b.filter(Boolean).length === 1, JSON.stringify(b));
  ok("the latest take (second row) plays by default", b[0] === false && b[1] === true, JSON.stringify(b));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("choosing another take points the app at it — nothing is deleted", async ()=>{
  const { page, state } = await open();
  // "Play this one" on the first (earlier) take
  await page.evaluate(()=> document.querySelectorAll("#takes .takerow")[0].querySelector(".btn.primary").click());
  await page.waitForFunction(()=> ((globalThis.__FS||{})["afd_ui_prompts/intro.tour.what"]||{}).canonicalTakeId === "t1", null, { timeout:5000 });
  const d = await doc(page);
  ok("canonicalTakeId is now the chosen take", d.canonicalTakeId === "t1", d.canonicalTakeId);
  ok("storagePath points at the chosen take (so every player uses it)", d.storagePath === "afd_ui/intro.tour.what/t1.webm", d.storagePath);
  ok("both takes are kept — the manifest is unchanged", Array.isArray(d.takes) && d.takes.length === 2, String(d.takes && d.takes.length));
  // the picker re-renders: the chosen (first) take now carries the badge
  await page.waitForFunction(()=>{ const r = document.querySelectorAll("#takes .takerow"); return r.length === 2 && !!r[0].querySelector(".badge"); }, null, { timeout:5000 });
  const b = await badged(page);
  ok("the chosen take is now shown as the one that plays", b[0] === true && b[1] === false, JSON.stringify(b));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("the shared provenance panel shows one row per take", async ()=>{
  const { page, state } = await open();
  await page.evaluate(()=> document.querySelector("#takes .qgroup > button.btn").click());   // the History toggle
  await page.waitForSelector("#takes .ledger .st-err", { timeout:5000 });
  const n = await page.$$eval("#takes .ledger .st-err", r=>r.length);
  ok("one provenance row per take", n === 2, String(n));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close();
finish();
