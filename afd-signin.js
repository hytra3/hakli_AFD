/* ============================================================================
   afd-signin.js — the ONE way people sign in, on every page (10-16).

   Was: add.html had Google + phone (a texted code) + email/password + an email
   link; the recorder and the dictionary had only a Google popup (+ email and
   password in the recorder). Google sign-in often can't open inside WhatsApp's
   or Instagram's own browser — exactly where someone lands after opening a
   shared word — so a person could add a word but not "+ Add a recording".
   Now all three pages build the same sign-in from here.

   mountSignIn(host, opts)    builds the sign-in into `host`; returns { repaint }
   finishEmailLink(auth, opt) completes an email link that came back to this page
   signInSheet(opts)          the same sign-in in a sheet over the page (the
                              dictionary's account button); resolves with the
                              signed-in user, or null if closed

   opts:
     auth        the page's Firebase Auth
     label(key)  HTML for a STRINGS key, in the page's own style (bilingual etc.)
     text(key)   plain text for a STRINGS key (window.prompt); default: Arabic · English
     showError(html)  where errors go ("" clears)
     onBegin()   a sign-in is under way that should continue the page's task
                 (add.html: carry on into sharing); onFail() when it didn't

   Element ids inside are the ones add.html always had (googleBtn, authPhone,
   phoneBtn, codeBox, authCode, codeBtn, emailBox, authEmail, authPass,
   signupBtn, emailBtn, linkBtn, linkSent, browserHint), so one page must not
   mount it twice at once. Styles are its own (.afd-si), from the page's colour
   tokens where it has them.
   Bump the ?v= on every import when this file changes.
   ============================================================================ */
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword,
         createUserWithEmailAndPassword, RecaptchaVerifier, signInWithPhoneNumber,
         sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const C = window.AFDCore;
const LINK_EMAIL_KEY = "afd.linkEmail";

const CSS = `
.afd-si{display:flex;flex-direction:column;gap:10px;text-align:center}
.afd-si [hidden],.afd-si .si-hidden{display:none!important}
/* The invisible reCAPTCHA behind the texted code floats a badge over the page's
   bottom corner (it covered "Just listen" in the recorder). Google allows hiding
   it when the page says, beside the form, that reCAPTCHA protects it — .si-legal. */
.grecaptcha-badge{visibility:hidden!important}
.afd-si .si-legal{margin:0;font-size:11px;line-height:1.45;color:var(--ink-soft,#5B6E66);opacity:.85}
.afd-si .si-legal a{color:inherit;text-decoration:underline}
.afd-si .si-legal .sub{font-size:10.5px}
.afd-si .si-note{margin:2px 0 0;font-size:14px;line-height:1.45;color:var(--ink-soft,#5B6E66)}
.afd-si .bi-ar,.afd-si-sheet .bi-ar{display:block}
.afd-si .sub,.afd-si-sheet .sub{display:block;font-size:12px;opacity:.78;margin-top:1px;font-weight:400;color:inherit}
.afd-si .si-btn{display:block;width:100%;min-height:52px;padding:12px 16px;border-radius:16px;border:0;
  font:inherit;font-size:16px;font-weight:600;cursor:pointer;background:var(--mountain,#1F3A34);color:#fff;
  -webkit-tap-highlight-color:transparent;touch-action:manipulation}
.afd-si .si-btn.si-alt{background:var(--cloud,#fff);color:var(--mountain,#1F3A34);box-shadow:inset 0 0 0 1.5px var(--mountain,#1F3A34)}
.afd-si .si-btn.si-quiet{background:transparent;color:var(--mountain,#1F3A34);font-weight:500;min-height:44px}
.afd-si .si-btn:disabled{opacity:.55;cursor:default}
.afd-si .si-row{display:flex;gap:10px}.afd-si .si-row>*{flex:1}
.afd-si input{width:100%;box-sizing:border-box;min-height:50px;padding:10px 14px;border-radius:14px;font:inherit;font-size:17px;
  border:1.5px solid var(--mist-2,#C4D2CC);background:var(--cloud,#fff);color:var(--ink,#17241F)}
.afd-si input:focus{outline:none;border-color:var(--mountain,#1F3A34)}
.afd-si .si-box{display:flex;flex-direction:column;gap:10px}
.afd-si details{text-align:center}
.afd-si summary{cursor:pointer;padding:8px;color:var(--mountain,#1F3A34);font-size:14px;list-style:none}
.afd-si summary::-webkit-details-marker{display:none}
.afd-si details[open] summary{margin-bottom:8px}
.afd-si .si-or{height:1px;background:var(--mist-2,#C4D2CC);margin:6px 0 2px}
.afd-si-sheet{position:fixed;inset:0;z-index:80;display:flex;align-items:flex-end;justify-content:center;
  background:rgba(23,36,31,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.afd-si-sheet .si-panel{width:100%;max-width:460px;max-height:92vh;overflow:auto;box-sizing:border-box;
  background:var(--cloud,#fff);color:var(--ink,#17241F);border-radius:22px 22px 0 0;padding:20px 18px 22px;
  box-shadow:0 -10px 40px rgba(0,0,0,.18)}
@media (min-width:600px){.afd-si-sheet{align-items:center}.afd-si-sheet .si-panel{border-radius:22px}}
.afd-si-sheet h2{margin:0 0 4px;font-size:19px;text-align:center}
.afd-si-sheet h2 .sub{font-size:12px;opacity:.7}
`;
function injectCss(){
  if(document.getElementById("afd-si-css")) return;
  const s = document.createElement("style"); s.id = "afd-si-css"; s.textContent = CSS;
  document.head.appendChild(s);
}
function defaultText(key){
  const x = (C.STRINGS && C.STRINGS[key]) || { en:key, ar:key };
  return x.ar && x.en && x.ar !== x.en ? x.ar + " · " + x.en : (x.ar || x.en);
}
function dotsOn(btn){
  const d = document.createElement("span"); d.innerHTML = C.dotsHTML(); const dots = d.firstChild;
  btn.disabled = true; if(dots) btn.appendChild(dots);
  return ()=>{ if(dots) dots.remove(); btn.disabled = false; };
}
async function withDots(btn, fn){ const off = dotsOn(btn); try{ return await fn(); }finally{ off(); } }

// The number as typed → E.164. A bare 8-digit number is Omani (the instance's
// default country, afd-instance.js signin.defaultCountry, else +968).
function phoneNumber(raw){
  let n = String(raw||"").replace(/[^\d+]/g, "");
  const cc = ((window.AFDInstance && window.AFDInstance.signin && window.AFDInstance.signin.defaultCountry) || "+968");
  if(n.startsWith("00")) n = "+" + n.slice(2);
  if(!n.startsWith("+") && n.length === 8) n = cc + n;
  else if(!n.startsWith("+") && n.length >= 10) n = "+" + n;
  return n;
}

let _seq = 0;
export function mountSignIn(host, opts){
  injectCss();
  const o = Object.assign({ text: defaultText, showError: ()=>{}, onBegin: ()=>{}, onFail: ()=>{} }, opts || {});
  const auth = o.auth, L = o.label;
  const capId = "afd-si-recaptcha-" + (++_seq);
  host.innerHTML = `
  <div class="afd-si">
    <button class="si-btn" id="googleBtn" type="button" data-k="setup.google"></button>
    <p class="si-note si-hidden" id="browserHint" data-k="add.share.browser"></p>
    <div class="si-or" aria-hidden="true"></div>
    <div class="si-box" id="phoneBox">
      <p class="si-note" data-k="add.auth.phone"></p>
      <input type="tel" id="authPhone" placeholder="+968 9123 4567" autocomplete="tel" inputmode="tel" dir="ltr">
      <button class="si-btn si-alt" id="phoneBtn" type="button" data-k="add.auth.phone.send"></button>
      <div class="si-box si-hidden" id="codeBox">
        <p class="si-note" data-k="add.auth.code"></p>
        <input type="text" id="authCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" dir="ltr">
        <button class="si-btn" id="codeBtn" type="button" data-k="add.auth.code.go"></button>
      </div>
      <div id="${capId}"></div>
      <p class="si-legal" id="recaptchaNote"></p>
    </div>
    <details id="emailBox">
      <summary data-k="setup.oremail"></summary>
      <div class="si-box">
        <input type="email" id="authEmail" placeholder="you@example.com" autocomplete="username" dir="ltr">
        <input type="password" id="authPass" placeholder="••••••••" autocomplete="current-password" dir="ltr">
        <div class="si-row">
          <button class="si-btn si-alt" id="signupBtn" type="button" data-k="setup.signup"></button>
          <button class="si-btn" id="emailBtn" type="button" data-k="setup.signin"></button>
        </div>
        <button class="si-btn si-quiet" id="linkBtn" type="button" data-k="add.auth.link"></button>
        <p class="si-note si-hidden" id="linkSent" data-k="add.auth.link.sent"></p>
      </div>
    </details>
  </div>`;
  const root = host.firstElementChild;
  const $ = (id)=> root.querySelector("#" + id);
  function repaint(){
    root.querySelectorAll("[data-k]").forEach(el => { el.innerHTML = L(el.dataset.k); });
    // reCAPTCHA's required notice, with Google's two links in place of {privacy} / {terms}
    const x = (C.STRINGS && C.STRINGS["auth.recaptcha"]) || null, note = root.querySelector("#recaptchaNote");
    if(x && note){
      const link = (href, txt)=> `<a href="${href}" target="_blank" rel="noopener">${C.escHtml(txt)}</a>`;
      const fillLinks = (t, pv, tm)=> C.escHtml(t)
        .replace("{privacy}", link("https://policies.google.com/privacy", pv))
        .replace("{terms}", link("https://policies.google.com/terms", tm));
      const en = fillLinks(x.en, "Privacy Policy", "Terms of Service");
      const ar = fillLinks(x.ar, "سياسة الخصوصية", "شروط الخدمة");
      // the English line only where the page's own labels carry English too
      const bilingual = /class="sub"/.test(L("add.auth.phone"));
      note.innerHTML = `<span class="bi-ar" dir="rtl">${ar}</span>` + (bilingual ? `<small class="sub">${en}</small>` : "");
    }
  }
  repaint();

  function failed(e){
    console.warn("[AFD] sign-in", e);
    o.onFail();
    const k = C.authErrorKey(e);
    if(!k) return;                                         // they closed the popup
    C.report("signin", e);
    // Google that won't open (an in-app browser) gets the "use your phone, or
    // open in Chrome/Safari" hint rather than a bare error.
    const c = (e && e.code) || "";
    if(/popup|web-storage|operation-not-supported|internal/.test(c) || k === "auth.err.other") $("browserHint").classList.remove("si-hidden");
    o.showError(k === "auth.err.other" && e && e.message && !/popup|internal/.test(c) ? C.escHtml(e.message) : L(k));
  }
  let recaptcha = null, phoneConfirm = null;
  function phoneFailed(e){
    console.warn("[AFD] phone sign-in", e);
    o.onFail();
    C.report("signin.phone", e);
    const c = (e && e.code) || "";
    // operation-not-allowed: texts to that country are off (Firebase's SMS region policy)
    o.showError(L(c.includes("too-many") || c.includes("quota") ? "add.auth.toomany"
                : c.includes("operation-not-allowed") ? "add.auth.region"
                : c.includes("code") ? "add.auth.code.bad" : "add.auth.phone.bad"));
  }

  $("googleBtn").onclick = async ()=>{
    o.showError(""); o.onBegin();
    try{ await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch(e){ failed(e); }
  };
  $("emailBtn").onclick = async ()=>{
    o.showError(""); o.onBegin();
    try{ await withDots($("emailBtn"), ()=> signInWithEmailAndPassword(auth, $("authEmail").value.trim(), $("authPass").value)); }
    catch(e){ failed(e); }
  };
  $("signupBtn").onclick = async ()=>{
    o.showError(""); o.onBegin();
    try{ await withDots($("signupBtn"), ()=> createUserWithEmailAndPassword(auth, $("authEmail").value.trim(), $("authPass").value)); }
    catch(e){ failed(e); }
  };
  // Phone: the code is typed right here, so it works inside in-app browsers (no
  // popup, no redirect). Firebase needs an invisible reCAPTCHA to send the text;
  // it's made on the first tap and reused.
  $("phoneBtn").onclick = async ()=>{
    o.showError("");
    const n = phoneNumber($("authPhone").value);
    if(!/^\+\d{8,15}$/.test(n)){ o.showError(L("add.auth.phone.bad")); return; }
    const off = dotsOn($("phoneBtn"));
    try{
      if(!recaptcha) recaptcha = new RecaptchaVerifier(auth, capId, { size:"invisible" });
      phoneConfirm = await signInWithPhoneNumber(auth, n, recaptcha);
      $("codeBox").classList.remove("si-hidden");
      $("authCode").focus();
    }catch(e){
      phoneFailed(e);
      try{ recaptcha && recaptcha.clear(); }catch(_){} recaptcha = null;     // a fresh one next time
    }finally{ off(); }
  };
  $("codeBtn").onclick = async ()=>{
    if(!phoneConfirm) return;
    o.showError(""); o.onBegin();
    try{ await withDots($("codeBtn"), ()=> phoneConfirm.confirm($("authCode").value.trim())); }
    catch(e){ phoneFailed(e); }
  };
  $("authCode").addEventListener("keydown", e=>{ if(e.key === "Enter") $("codeBtn").click(); });
  // Email link: no password. It comes back to THIS page (finishEmailLink).
  $("linkBtn").onclick = async ()=>{
    o.showError("");
    const email = $("authEmail").value.trim();
    if(!email){ $("authEmail").focus(); return; }
    try{
      await withDots($("linkBtn"), ()=> sendSignInLinkToEmail(auth, email,
        { url: location.origin + location.pathname + location.search, handleCodeInApp: true }));
      try{ localStorage.setItem(LINK_EMAIL_KEY, email); }catch(_){}
      $("linkSent").classList.remove("si-hidden");
    }catch(e){ failed(e); }
  };
  return { repaint, root };
}

/* An email sign-in link that came back to this page: finish it, and drop the
   one-time code from the address. Safe to call on every load. */
export function finishEmailLink(auth, opts){
  const o = Object.assign({ text: defaultText, showError: ()=>{}, onBegin: ()=>{}, onFail: ()=>{} }, opts || {});
  if(!isSignInWithEmailLink(auth, location.href)) return Promise.resolve(false);
  return (async ()=>{
    let email = null; try{ email = localStorage.getItem(LINK_EMAIL_KEY); }catch(_){}
    if(!email) email = window.prompt(o.text("add.auth.link.email")) || "";
    let ok = false;
    try{
      o.onBegin();
      await signInWithEmailLink(auth, email.trim(), location.href);
      try{ localStorage.removeItem(LINK_EMAIL_KEY); }catch(_){}
      ok = true;
    }catch(e){ console.warn("[AFD] email link", e); o.onFail(); C.report("signin.link", e); if(o.label) o.showError(o.label(C.authErrorKey(e) || "auth.err.other")); }
    history.replaceState(history.state, "", location.pathname + location.hash);
    return ok;
  })();
}

/* The sign-in in a sheet over the page. Resolves with the user once signed in
   (a real account — not the anonymous one the prompts tool may leave), or null
   when closed (✕, a tap outside, Escape). */
export function signInSheet(opts){
  injectCss();
  const o = opts || {}, auth = o.auth, L = o.label;
  return new Promise((resolve)=>{
    const wrap = document.createElement("div");
    wrap.className = "afd-si-sheet"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML = `<div class="si-panel">
      <h2 id="afdSiTitle">${L(o.titleKey || "setup.signin.title")}</h2>
      <p class="si-note" style="text-align:center;margin:0 0 14px">${L(o.noteKey || "setup.signin.note")}</p>
      <div class="si-host"></div>
      <p class="si-note si-err" role="status" aria-live="polite" style="color:var(--danger,#9E4433);min-height:1.2em"></p>
      <button class="si-close" type="button" style="display:block;margin:6px auto 0;background:none;border:0;font:inherit;color:var(--mountain,#1F3A34);padding:10px 16px;cursor:pointer">${L("auth.close")}</button>
    </div>`;
    wrap.setAttribute("aria-labelledby", "afdSiTitle");
    const err = wrap.querySelector(".si-err");
    const host = wrap.querySelector(".si-host");
    let done = false, unsub = null;
    const finish = (u)=>{
      if(done) return; done = true;
      try{ unsub && unsub(); }catch(_){}
      document.removeEventListener("keydown", onKey);
      wrap.remove(); resolve(u || null);
    };
    const onKey = (e)=>{ if(e.key === "Escape") finish(null); };
    wrap.addEventListener("click", (e)=>{ if(e.target === wrap) finish(null); });
    wrap.querySelector(".si-close").onclick = ()=> finish(null);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    mountSignIn(host, { auth, label: L, text: o.text, showError: (h)=>{ err.innerHTML = h || ""; } });
    // signed in by any route (popup, code, password) → done
    unsub = onAuthStateChanged(auth, (u)=>{ if(u && !u.isAnonymous) finish(u); });
  });
}
