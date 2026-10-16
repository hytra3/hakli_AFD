// The welcome page's intro lines come from afd-prompts.js — the same table the
// prompt tool records from — so a line is worded in one place only.
import { ROOT, serve, launch, newPage, ok, scenario, finish } from "./lib.mjs";
import { readFileSync } from "node:fs";

const src = readFileSync(ROOT + "/afd-prompts.js", "utf8");
const P = {}; for(const m of src.matchAll(/key:"(intro\.tour\.\w+)", en:"([^"]*)", ar:"([^"]*)"/g)) P[m[1]] = { en:m[2], ar:m[3] };
const srv  = await serve(ROOT);
// the same site, with one Arabic line edited in afd-prompts.js only
const EDIT = "سطرٌ مُعدَّل للاختبار";
const vSrv = await serve(ROOT, (p, body)=> p === "/afd-prompts.js" ? String(body).replace(P["intro.tour.yours"].ar, EDIT) : undefined);
const browser = await launch();
const text = (page)=> page.evaluate(()=> (document.getElementById("lines")||{}).innerText + "\n" + (document.getElementById("close")||{}).innerText);

await scenario("welcome lines come from the prompt table", async ()=>{
  const { page, state } = await newPage(browser, srv.url, {});
  await page.goto(srv.url + "/welcome.html"); await page.waitForTimeout(1500);
  const t = await text(page);
  ok("the four intro lines are found in afd-prompts.js", Object.keys(P).length === 4, Object.keys(P).join());
  ok("the page shows the table's Arabic for each line",
     ["intro.tour.what","intro.tour.yours","intro.tour.why"].every(k => t.includes(P[k].ar)), t.slice(0, 400));
  ok("the front door leaves out the lines that moved (new, waits)", !t.includes(P["intro.tour.waits"].ar), t.slice(0, 400));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});
await scenario("an edit in afd-prompts.js shows on the welcome page", async ()=>{
  const { page } = await newPage(browser, vSrv.url, {});
  await page.goto(vSrv.url + "/welcome.html"); await page.waitForTimeout(1500);
  const t = await text(page);
  ok("the edited line appears, the old wording is gone", t.includes(EDIT) && !t.includes(P["intro.tour.yours"].ar), t.slice(0, 400));
});

await browser.close(); srv.close(); vSrv.close();
finish();
