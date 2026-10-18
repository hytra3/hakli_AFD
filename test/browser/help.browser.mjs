// 10-16: one Help page (help.html) — the six how-to clips, the welcome tour,
// "Who can hear my voice?", and "Ask a person" (WhatsApp), which stays hidden
// until afd-instance.js names someone. Reached from the dictionary's ☰ menu
// (everyone) and from the account menu (index and recorder).
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
// the same site with a helper configured in afd-instance.js
const cSrv = await serve(ROOT, (p, body)=> p === "/afd-instance.js"
  ? String(body).replace("help: { contact: null }", 'help: { contact: { name:{ ar:"سالم", en:"Salim" }, whatsapp:"+968 9123 4567" } }') : undefined);
const browser = await launch();
const ME = { uid:"uHelp1", isAnonymous:false, displayName:"Fatma", email:"f@example.org", providerData:[{ providerId:"phone" }] };
const look = (page)=> page.evaluate(()=>({
  title: document.getElementById("title").textContent,
  tiles: [...document.querySelectorAll(".tile")].map(a=>a.getAttribute("href")),
  tour: document.getElementById("tour").getAttribute("href"),
  faq: [...document.querySelectorAll("#faq details")].map(d=>d.querySelector("summary").textContent && d.querySelector("p").textContent ? 1 : 0).length,
  blank: [...document.querySelectorAll("#faq summary, #faq p, .tile .t")].filter(e=>!e.textContent.trim()).length,
  contact: !document.getElementById("contact").hidden,
  wa: (document.getElementById("wa")||{}).href || "",
  lead: (document.getElementById("contactLead")||{}).textContent || "" }));

await scenario("the Help page", async ()=>{
  const { page, state } = await newPage(browser, srv.url, {});
  await page.goto(srv.url + "/help.html"); await page.waitForTimeout(800);
  const a = await look(page);
  ok("titled from the string table (Arabic first)", a.title === "مساعدة", JSON.stringify(a));
  ok("six clip tiles, each linking to its how-to clip",
     a.tiles.join() === ["find","hear","record","sentence","meaning","add"].map(id=>"howto.html#"+id).join(), JSON.stringify(a.tiles));
  ok("a link to the welcome tour", a.tour === "welcome.html");
  ok("five questions about who can hear my voice, none blank", a.faq === 5 && a.blank === 0, JSON.stringify(a));
  ok("no helper configured → 'Ask a person' is hidden", !a.contact, JSON.stringify(a));
  await page.click('#toggle button[data-m="en"]'); await page.waitForTimeout(200);
  const e = await look(page);
  ok("English toggle", e.title === "Help" && await page.evaluate(()=>document.documentElement.dir) === "ltr", JSON.stringify(e));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("a helper set in afd-instance.js shows 'Ask a person'", async ()=>{
  const { page, state } = await newPage(browser, cSrv.url, {});
  await page.goto(cSrv.url + "/help.html"); await page.waitForTimeout(800);
  const a = await look(page);
  ok("the section shows, naming the helper", a.contact && a.lead.includes("سالم"), JSON.stringify(a));
  ok("WhatsApp link: digits only, with the help message", /^https:\/\/wa\.me\/96891234567\?text=/.test(a.wa) && decodeURIComponent(a.wa).includes("قاموس"), a.wa);
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("Help in the dictionary's ☰ menu (signed out)", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { init:()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } } });
  await page.goto(srv.url + "/index.html"); await page.waitForTimeout(1500);
  await page.click("#mastScreen"); await page.waitForTimeout(200);
  const has = await page.evaluate(()=>{ const b=document.querySelector('#viewMenu [data-view="help"]'); return b ? b.textContent : null; });
  ok("the menu lists Help (Arabic + English labels)", has && has.includes("مساعدة") && has.includes("Help"), String(has));
  await Promise.all([ page.waitForURL(/help\.html/, { timeout:5000 }).catch(()=>{}), page.click('#viewMenu [data-view="help"]') ]);
  ok("tapping it opens help.html", /help\.html/.test(page.url()), page.url());
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

for(const pg of ["index.html", "recorder.html"]){
  await scenario("Help in the account menu · " + pg, async ()=>{
    const { page, state } = await newPage(browser, srv.url, { user:ME, init:()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } } });
    await page.goto(srv.url + "/" + pg); await page.waitForTimeout(2500);
    const label = await page.evaluate(()=> (document.getElementById("acctHelp")||{}).textContent || "");
    ok("the account menu has Help", label.includes("مساعدة"), label);
    await page.evaluate(()=> document.getElementById("account").click()); await page.waitForTimeout(200);
    if(pg === "index.html"){
      await shot(page, "acct-menu");
      // auto mode: each item's Arabic and English on lines of their own, not run together
      const stacked = await page.evaluate(()=> [...document.querySelectorAll("#acctMenu button")].every(b=>{
        const ar=b.querySelector(".bi-ar"), en=b.querySelector(".sub");
        return !en || (ar && en.getBoundingClientRect().top >= ar.getBoundingClientRect().bottom - 1); }));
      ok("the account menu's Arabic and English sit on separate lines", stacked);
    }
    await Promise.all([ page.waitForURL(/help\.html/, { timeout:5000 }).catch(()=>{}), page.evaluate(()=> document.getElementById("acctHelp").click()) ]);
    ok("tapping it opens help.html", /help\.html/.test(page.url()), page.url());
    ok("no page errors", !state.errors.length, state.errors.join(" | "));
  });
}

await browser.close(); srv.close(); cSrv.close();
finish();
