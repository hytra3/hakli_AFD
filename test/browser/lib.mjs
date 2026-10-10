/*  Browser tests — the harness
 *  ------------------------------------------------------------------
 *  Opens the app's real pages in headless Chromium at phone size and walks
 *  them the way a person would: hold the mic, press Back, tap a slot.
 *
 *  Nothing here touches the live project:
 *    · the pages are served from this checkout over localhost;
 *    · Firebase (the four gstatic modules the pages import) is replaced by
 *      small in-memory stand-ins, seeded per test;
 *    · the matcher (the Cloud Run /search call) is answered by the test —
 *      a result, an error, a dropped connection, or no answer at all;
 *    · the microphone is Chromium's fake device;
 *    · every other outside request is blocked.
 *
 *  GitHub runs these on every pull request. To run them yourself (optional —
 *  needs an OS the pinned playwright-core has a Chromium for; Ubuntu 26.04 is
 *  not one as of 1.56.0):
 *         cd test && npm install && npx playwright-core install chromium
 *         npm run test:browser
 *  One file:           node browser/run.mjs search
 *  Keep screenshots:   AFD_SHOTS=/tmp/shots npm run test:browser
 *  Another Chromium:   AFD_CHROMIUM=/path/to/chrome npm run test:browser
 *  Another checkout:   AFD_ROOT=/path/to/older/build npm run test:browser
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// the checkout under test: this repo, or another one (AFD_ROOT=/path — e.g. an older build, to see a check fail)
export const ROOT  = process.env.AFD_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SHOTS = process.env.AFD_SHOTS || null;

const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon", ".webmanifest":"application/manifest+json", ".json":"application/json" };

export function serve(root, transform){
  return new Promise(res=>{
    const srv = http.createServer((req, rsp)=>{
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if(p.endsWith("/")) p += "index.html";
      const f = path.join(root, p);
      if(!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ rsp.writeHead(404); rsp.end("404"); return; }
      let body = fs.readFileSync(f);
      if(transform){ const t = transform(p, body); if(t!==undefined) body = t; }
      rsp.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", "cache-control":"no-store" });
      rsp.end(body);
    });
    srv.listen(0, "127.0.0.1", ()=>res({ url:`http://127.0.0.1:${srv.address().port}`, close:()=>srv.close() }));
  });
}

const STUB = {
"firebase-app.js": `export function initializeApp(c){ return { options:c }; }`,
"firebase-firestore.js": `
const FS = (globalThis.__FS = globalThis.__FS || {});
const LOG = (globalThis.__FSLOG = globalThis.__FSLOG || []);
let auto = 0;
function mk(a, p){ const base = (a && a.__p) ? a.__p.slice() : []; return base.concat(p.map(String)); }
export function getFirestore(){ return {}; }
export function collection(a, ...p){ return { __p: mk(a,p), type:"collection" }; }
export function doc(a, ...p){ let pp = mk(a,p); if(pp.length % 2) pp.push("auto"+(++auto));
  const self = { __p:pp, id:pp[pp.length-1], path:pp.join("/"), type:"document" };
  Object.defineProperty(self, "parent", { get(){ const cp=pp.slice(0,-1); return { __p:cp, id:cp[cp.length-1],
    get parent(){ return cp.length>1 ? doc({}, ...cp.slice(0,-1)) : null; } }; } });
  return self; }
export function where(f,op,v){ return { k:"where", f, op, v }; }
export function limit(n){ return { k:"limit", n }; }
export function query(c, ...cons){ return { __p:c.__p, cons }; }
function snap(ref){ const d = FS[ref.path]; return { id:ref.id, ref, exists:()=>d!==undefined, data:()=>d && JSON.parse(JSON.stringify(d), revive) }; }
function revive(k, v){ return (v && typeof v==="object" && "__ts" in v) ? { toMillis:()=>v.__ts, toDate:()=>new Date(v.__ts), seconds:Math.floor(v.__ts/1000) } : v; }
export async function getDoc(ref){ LOG.push("get "+ref.path); if(globalThis.__FS_FAIL){ const e=new Error("unavailable"); e.code="unavailable"; throw e; } return snap(ref); }
export async function getDocs(q){ const pre = q.__p.join("/") + "/"; LOG.push("list "+pre); if(globalThis.__FS_FAIL){ const e=new Error("unavailable"); e.code="unavailable"; throw e; }
  let docs = Object.keys(FS).filter(k=>k.startsWith(pre) && !k.slice(pre.length).includes("/")).map(k=>snap(doc({}, ...k.split("/"))));
  let lim = Infinity;
  for(const c of (q.cons||[])){
    if(c.k==="limit") lim = c.n;
    if(c.k==="where"){ docs = docs.filter(d=>{ const x=(d.data()||{})[c.f];
      return c.op==="==" ? x===c.v : c.op==="in" ? c.v.includes(x) : c.op==="!=" ? x!==c.v : true; }); }
  }
  docs = docs.slice(0, lim);
  return { docs, empty:!docs.length, size:docs.length, forEach:(f)=>docs.forEach(f) }; }
export async function setDoc(ref, data, o){ LOG.push("set "+ref.path); FS[ref.path] = (o&&o.merge) ? Object.assign({}, FS[ref.path], data) : data; }
export async function updateDoc(ref, data){ LOG.push("update "+ref.path); FS[ref.path] = Object.assign({}, FS[ref.path], data); }
export async function addDoc(col, data){ const r = doc(col); FS[r.path]=data; return r; }
export async function deleteDoc(ref){ delete FS[ref.path]; }
export function serverTimestamp(){ return { __ts: Date.now() }; }
export function deleteField(){ return undefined; }
export class Timestamp{ constructor(ms){ this.ms=ms; } toMillis(){ return this.ms; } toDate(){ return new Date(this.ms); }
  static now(){ return new Timestamp(Date.now()); } static fromMillis(ms){ return new Timestamp(ms); } static fromDate(d){ return new Timestamp(+d); } }
`,
"firebase-storage.js": `
const URLS = (globalThis.__URLS = globalThis.__URLS || {});
export function getStorage(){ return {}; }
export function ref(s, p){ return { fullPath:p, name:String(p).split("/").pop() }; }
export async function getDownloadURL(r){ if(URLS[r.fullPath]) return URLS[r.fullPath]; const e=new Error("storage/object-not-found"); e.code="storage/object-not-found"; throw e; }
export async function uploadBytes(r, b, m){ URLS[r.fullPath] = "data:audio/wav;base64,"; return { ref:r, metadata:m||{} }; }
export async function getMetadata(r){ if(URLS[r.fullPath]) return { fullPath:r.fullPath, customMetadata:{} }; const e=new Error("storage/object-not-found"); e.code="storage/object-not-found"; throw e; }
export async function deleteObject(r){ delete URLS[r.fullPath]; }
`,
"firebase-auth.js": `
const subs = new Set(); const A = { currentUser: globalThis.__USER || null };
function emit(){ for(const f of subs) try{ f(A.currentUser); }catch(e){ console.error(e); } }
globalThis.__setUser = (u)=>{ A.currentUser = u; emit(); };
export function getAuth(){ return A; }
export function onAuthStateChanged(a, cb){ subs.add(cb); setTimeout(()=>cb(A.currentUser), 0); return ()=>subs.delete(cb); }
const FAKE = { uid:"uTest1", isAnonymous:false, displayName:"Test Steward", email:"test@example.com", phoneNumber:null };
export class GoogleAuthProvider{}
export class RecaptchaVerifier{ constructor(){ } render(){ return Promise.resolve(0); } clear(){} verify(){ return Promise.resolve("x"); } }
export async function signInWithPopup(){ A.currentUser = FAKE; emit(); return { user:FAKE }; }
export async function signInAnonymously(){ A.currentUser = { uid:"uAnon", isAnonymous:true }; emit(); return { user:A.currentUser }; }
export async function signInWithEmailAndPassword(){ A.currentUser = FAKE; emit(); return { user:FAKE }; }
export async function createUserWithEmailAndPassword(){ A.currentUser = FAKE; emit(); return { user:FAKE }; }
export async function signInWithPhoneNumber(){ return { confirm: async ()=>{ A.currentUser = FAKE; emit(); return { user:FAKE }; } }; }
export function isSignInWithEmailLink(){ return false; }
export async function sendSignInLinkToEmail(){}
export async function signInWithEmailLink(){ A.currentUser = FAKE; emit(); return { user:FAKE }; }
export async function signOut(){ A.currentUser = null; emit(); }
`,
};

export async function launch(){
  return chromium.launch({ executablePath: process.env.AFD_CHROMIUM || undefined,
    args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--no-sandbox"] });
}

const OPEN = new Set();   // browser contexts still open — closed when a scenario ends, however it ends

/* matcher: a function (callIndex, url) => {status, body, delay} | "abort" (connection drops) | "hang" (never answers) */
export async function newPage(browser, base, { matcher, fs:fsData, user, init, width=412, height=880 }={}){
  const ctx = await browser.newContext({ viewport:{ width, height }, deviceScaleFactor:1.5, hasTouch:true, isMobile:true,
    permissions:["microphone"], locale:"en-US", serviceWorkers:"block" });
  OPEN.add(ctx); ctx.on("close", ()=>OPEN.delete(ctx));
  const page = await ctx.newPage();
  const state = { calls:[], console:[], errors:[], external:[] };
  page.on("console", m=>state.console.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", e=>state.errors.push(String(e && e.stack || e)));
  await ctx.addInitScript(({fsData, user})=>{
    globalThis.__FS = Object.assign({}, fsData||{}); if(user) globalThis.__USER = user;
    try{ if(!sessionStorage.getItem("__t")){ sessionStorage.setItem("__t","1"); } }catch(_){ }
  }, { fsData, user });
  if(init) await ctx.addInitScript(init);
  await ctx.route("**/*", async (route)=>{
    const u = new URL(route.request().url());
    if(u.origin === base) return route.continue();
    if(u.hostname === "www.gstatic.com" && u.pathname.includes("/firebasejs/")){
      const name = u.pathname.split("/").pop();
      if(STUB[name]) return route.fulfill({ status:200, contentType:"text/javascript", body:STUB[name], headers:{ "access-control-allow-origin":"*" } });
    }
    if(u.hostname.endsWith(".run.app")){
      const i = state.calls.length; state.calls.push({ url:u.pathname+u.search, t:Date.now() });
      const cors = { "access-control-allow-origin":"*" };
      let r = matcher ? await matcher(i, u) : { status:200, body:{ results:[], corpus_n:0 } };
      if(r === "abort") return route.abort("failed");
      if(r === "hang") return;                       // never answer
      if(r.delay) await new Promise(x=>setTimeout(x, r.delay));
      try{ return await route.fulfill({ status:r.status||200, contentType:"application/json", headers:cors, body:JSON.stringify(r.body ?? {}) }); }
      catch(_){ return; }                            // request was aborted meanwhile
    }
    if(u.hostname.startsWith("fonts.")) return route.fulfill({ status:200, contentType:"text/css", body:"" });
    state.external.push(u.href);
    return route.abort("blockedbyclient");
  });
  return { ctx, page, state };
}

export async function hold(page, sel="#mic", ms=900){
  await page.dispatchEvent(sel, "pointerdown", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
  await page.waitForTimeout(ms);
  await page.dispatchEvent(sel, "pointerup", { pointerId:1, pointerType:"touch", isPrimary:true, bubbles:true });
}
export const hintText = (page)=> page.evaluate(()=> (document.getElementById("hint")||{}).innerText || "");

/* ---- results ---------------------------------------------------------------
   A test file is a plain script: a list of scenarios, each making one or more
   checks. A scenario that throws (a wait that never came true) counts as one
   failed check and the file carries on with the next. finish() prints the
   tally and sets the exit code; run.mjs runs the files and retries a failing
   file once, since a browser on a busy machine can be a moment late. */
const results = [];
export function ok(name, cond, extra=""){
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS " : "FAIL ") + name + (!cond && extra ? "  — " + String(extra).slice(0, 600) : ""));
}
export async function scenario(name, fn){
  try{ await fn(); }
  catch(e){ ok(name + " (did not finish)", false, String(e && e.message || e).split("\n")[0]); }
  finally{ for(const c of [...OPEN]) await c.close().catch(()=>{}); }
}
export function finish(){
  const bad = results.filter(r => !r.pass).length;
  console.log("\n" + (results.length - bad) + "/" + results.length + " passed");
  process.exitCode = bad ? 1 : 0;
  return bad;
}
export const shot = async (page, name, full=false)=>{ if(SHOTS){ fs.mkdirSync(SHOTS, { recursive:true }); await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: full }); } };
