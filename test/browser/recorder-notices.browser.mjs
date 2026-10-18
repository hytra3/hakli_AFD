// 10-17: the recorder's messages and questions are in the page, not alert() /
// confirm(): results come as a notice at the foot of the screen (errors stay
// until tapped), questions as the in-page sheet with labelled buttons.
import { ROOT, serve, launch, newPage, ok, scenario, finish, shot } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const ME = { uid:"uFatma1", isAnonymous:false, displayName:"Fatma", email:"f@example.org", providerData:[{ providerId:"phone" }] };
const AUTO = ()=>{ try{ localStorage.setItem("afd_display_mode","auto"); }catch(_){ } };
const noticeOf = (page)=> page.evaluate(()=>{ const n=document.querySelector(".afd-notice"); return n ? { text:n.innerText, kind:n.className } : null; });

await scenario("upload with nothing waiting: a notice, not an alert", async ()=>{
  const { page, ctx, state } = await newPage(browser, srv.url, { user:ME, init:AUTO });
  const dialogs = []; page.on("dialog", d=>{ dialogs.push(d.type()); d.dismiss().catch(()=>{}); });
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1800);
  await page.evaluate(()=> document.getElementById("syncBtn").click()); await page.waitForTimeout(300);
  const n = await noticeOf(page);
  await shot(page, "recorder-notice");
  ok("a notice in the page says everything is uploaded (Arabic and English)", !!n && /كل التسجيلات مرفوعة/.test(n.text) && /already uploaded/.test(n.text) && / ok/.test(n.kind) && !dialogs.length, JSON.stringify({ n, dialogs }));
  await page.waitForTimeout(6500);
  ok("…and leaves on its own", !(await noticeOf(page)));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await scenario("clearing the phone: a red question, 'Keep them' is the safe answer", async ()=>{
  const { page, ctx, state } = await newPage(browser, srv.url, { user:ME, init:AUTO });
  const dialogs = []; page.on("dialog", d=>{ dialogs.push(d.type()); d.dismiss().catch(()=>{}); });
  await page.goto(srv.url + "/recorder.html"); await page.waitForTimeout(1800);
  await page.evaluate(()=> document.getElementById("clearBtn").click());
  await page.waitForSelector(".afd-ask", { timeout:5000 }).catch(()=>{});
  const q = await page.evaluate(()=>{ const a=document.querySelector(".afd-ask"); return a && { text:a.innerText,
    red:a.querySelector(".ask-yes").classList.contains("ask-danger"), focusNo: document.activeElement===a.querySelector(".ask-no") }; });
  await shot(page, "recorder-clear");
  ok("asked in the page, in red, with the warning to export first", !!q && q.red && q.focusNo && /Delete all 0/.test(q.text) && /Export first/.test(q.text) && /Keep them/.test(q.text) && !dialogs.length, JSON.stringify({ q, dialogs }));
  await page.click(".ask-no");
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
  await ctx.close();
});

await browser.close(); srv.close();
finish();
