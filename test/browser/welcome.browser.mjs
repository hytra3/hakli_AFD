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

await scenario("the how-to page: six one-job clips, each with its own link", async ()=>{
  const { page, state } = await newPage(browser, srv.url, {});
  await page.goto(srv.url + "/welcome.html"); await page.waitForTimeout(800);
  ok("H1 the welcome page links to the how-to clips", await page.evaluate(()=> (document.getElementById("howtoLink")||{}).getAttribute && document.getElementById("howtoLink").getAttribute("href")==="howto.html"));
  await page.goto(srv.url + "/howto.html#hear"); await page.waitForTimeout(1200);
  const h = await page.evaluate(()=>({ n:document.querySelectorAll(".tile").length, on:[...document.querySelectorAll('.tile[aria-pressed="true"]')].map(b=>b.dataset.id),
    src:document.getElementById("frame").getAttribute("src"), t:document.getElementById("title").textContent }));
  ok("H2 six tiles, worded from the string table", h.n===6 && h.t==="كيف تستعمله", JSON.stringify(h));
  ok("H3 a link to #hear opens that clip", h.on.join()==="hear" && /scene=hear/.test(h.src), JSON.stringify(h));
  await page.click('.tile[data-id="meaning"]'); await page.waitForTimeout(600);
  const m = await page.evaluate(()=>({ hash:location.hash, src:document.getElementById("frame").getAttribute("src") }));
  ok("H4 tapping a tile plays that clip and the address names it", m.hash==="#meaning" && /scene=meaning/.test(m.src), JSON.stringify(m));
  ok("H5 no page errors", !state.errors.length, state.errors.join(" | "));
});

await browser.close(); srv.close(); vSrv.close();
finish();
