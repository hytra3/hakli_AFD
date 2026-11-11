// A steward's photo for any word (11-08), and the fig's built-in picture.
//  • a seeded word with a picture shipped in afd-words.js (img:) shows it
//    instead of its emoji until someone gives it a photo,
//  • Edit word → 📷 Photo, for stewards only: the photo is re-encoded, saved
//    as afd_pics/{uid}/{entryId}~{ms}.jpg and the card repaints in place,
//  • Remove photo asks first, clears the field, and the card falls back.
import { ROOT, serve, launch, newPage, ok, scenario, finish, SHOTS } from "./lib.mjs";

const srv = await serve(ROOT);
const browser = await launch();
const STEW = { uid:"uSteward", isAnonymous:false, displayName:null, email:"steward@example.org", providerData:[{ providerId:"password" }] };
const ANNA = { uid:"uAnna", isAnonymous:false, displayName:null, email:"anna@example.org", providerData:[{ providerId:"phone" }] };
const FS = {
  "afd_admins/uSteward": { email:"steward@example.org" },
  "afd_entries/ent_fig": { gloss:"fig", glossAr:"تين", pic:"🫒" },
  "afd_entries/ent_sun": { gloss:"sun", glossAr:"الشمس", pic:"☀️" },
  "afd_entries/ent_u_abc": { source:"user", createdBy:"uAnna", glossAr:"قهوة", pic:"☕" },
};
const init = ()=>{ try{ localStorage.setItem("afd_display_mode","bridge"); }catch(_){ } };
// a tiny real PNG, so the page's canvas re-encode has something to draw
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwHwyBNBgwMDAwAAD/7wf5cCRYnwAAAABJRU5ErkJggg==", "base64");
const thumbOf = (page, id)=> page.evaluate((id)=>{ const t=document.querySelector(`.thumb[data-entry="${id}"]`);
  return t ? { img: t.querySelector("img") ? t.querySelector("img").getAttribute("src") : "", text: t.textContent } : null; }, id);
const openEdit = (page)=> page.evaluate(()=>[...document.querySelectorAll(".wt-btn")].find(b=>/Edit word/.test(b.textContent)).click());

await scenario("the fig shows its built-in photo, not the olive", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:null, init });
  await page.goto(srv.url + "/index.html");
  await page.waitForSelector('.thumb[data-entry="ent_fig"]', { timeout:15000 }); await page.waitForTimeout(400);
  const f = await thumbOf(page, "ent_fig");
  ok("fig's thumb is the bundled photo", f && /img\/words\/fig\.jpg$/.test(f.img), JSON.stringify(f));
  const s = await thumbOf(page, "ent_sun");
  ok("other words keep their emoji", s && !s.img && s.text==="☀️", JSON.stringify(s));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("a steward takes a photo for a seeded word, then removes it", async ()=>{
  const { page, state } = await newPage(browser, srv.url, { fs:FS, user:STEW, init });
  await page.goto(srv.url + "/index.html#ent_sun");
  await page.waitForSelector(".word-tools", { timeout:10000 }); await page.waitForTimeout(300);
  await openEdit(page);
  ok("the steward sees the photo button", await page.evaluate(()=> !!document.querySelector(".wt-photo-take")));
  ok("no Remove photo while there's no photo", await page.evaluate(()=> document.querySelector(".wt-photo-clear").hidden));
  await page.setInputFiles(".wt-photo input[type=file]", { name:"sun.png", mimeType:"image/png", buffer:PNG });
  await page.waitForSelector(".afd-crop__btn--ok", { timeout:8000 });   // the framing overlay
  await page.click(".afd-crop__btn--ok");                               // accept the default square
  await page.waitForFunction(()=> globalThis.__FS["afd_entries/ent_sun"].image, null, { timeout:8000 });
  const d = await page.evaluate(()=> globalThis.__FS["afd_entries/ent_sun"]);
  ok("saved: the steward's own ~stamped file for this word, who + when",
     /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/afd-dev\.firebasestorage\.app\/o\/afd_pics%2FuSteward%2Fent_sun~\d{13}\.jpg\?alt=media$/.test(d.image)
     && d.imageBy==="uSteward" && d.imageAt && d.pic==="☀️", JSON.stringify(d));
  const t = await thumbOf(page, "ent_sun");
  ok("the card repaints with the photo", t && t.img===d.image, JSON.stringify(t));
  if(SHOTS) await page.screenshot({ path: SHOTS + "/word-photo.png", fullPage:true });
  await page.click(".wt-photo-clear");
  await page.waitForSelector(".afd-ask .ask-yes", { timeout:5000 });
  await page.click(".afd-ask .ask-yes"); await page.waitForTimeout(300);
  const d2 = await page.evaluate(()=> globalThis.__FS["afd_entries/ent_sun"]);
  ok("Remove photo clears the field", d2.image===undefined && d2.imageBy==="uSteward", JSON.stringify(d2));
  const t2 = await thumbOf(page, "ent_sun");
  ok("…and the emoji is back", t2 && !t2.img && t2.text==="☀️", JSON.stringify(t2));
  ok("no page errors", !state.errors.length, state.errors.join(" | "));
});

await scenario("a contributor can edit her word but gets no photo button", async ()=>{
  const { page } = await newPage(browser, srv.url, { fs:FS, user:ANNA, init });
  await page.goto(srv.url + "/index.html#ent_u_abc");
  await page.waitForSelector(".word-tools", { timeout:10000 }); await page.waitForTimeout(300);
  await openEdit(page);
  ok("no photo button for a non-steward", await page.evaluate(()=> !document.querySelector(".wt-photo-take")));
});

await browser.close(); srv.close();
finish();
