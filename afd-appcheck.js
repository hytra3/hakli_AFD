/*  App Check (10-19) — "is this request really from hakli.app?"
 *
 *  Each page calls startAppCheck(app) right after initializeApp. From then on
 *  Firestore and Storage attach a token on their own; the matcher gets one via
 *  appCheckHeaders(). The token comes from Google's invisible score check
 *  (Fraud Defense, formerly reCAPTCHA Enterprise) — nobody sees a puzzle.
 *
 *  Nothing is blocked by this file. Until enforcement is switched on in the
 *  Firebase console (and APPCHECK_ENFORCE on the matcher), requests without a
 *  token still work; the console just counts them as unverified.
 *
 *  The SDK is loaded with a dynamic import, so a page opened offline (or where
 *  Google is blocked) carries on without it instead of failing to start.
 *  No key in afd-instance.js (appCheckKey) → does nothing at all. */
const SDK = "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
let ready = null, mod = null, markStarted;
const started = new Promise((r) => { markStarted = r; });   // a call made before startAppCheck waits for it
const wait = (ms) => new Promise((r) => setTimeout(() => r(null), ms));

export function startAppCheck(app){
  const key = window.AFDInstance && window.AFDInstance.appCheckKey;
  if(!key || !app) return null;
  if(ready) return ready;
  ready = import(SDK).then((m) => {
    mod = m;
    return m.initializeAppCheck(app, { provider: new m.ReCaptchaEnterpriseProvider(key), isTokenAutoRefreshEnabled: true });
  }).catch((e) => {
    if(navigator.onLine !== false) try{ window.AFDCore && window.AFDCore.report && window.AFDCore.report("appcheck.start", e); }catch(_){}
    return null;
  });
  markStarted(ready);
  return ready;
}

/** Headers for a call to the matcher: the token if it comes within 2.5 s, else
 *  none (the search goes ahead either way). After the first, the SDK keeps a
 *  fresh token ready, so this is usually instant. */
export function appCheckHeaders(){
  const get = (async () => {
    try{
      if(!(window.AFDInstance && window.AFDInstance.appCheckKey)) return {};
      const ac = await (ready || started);
      if(!ac || !mod) return {};
      const t = await mod.getToken(ac, false);
      return t && t.token ? { "X-Firebase-AppCheck": t.token } : {};
    }catch(_){ return {}; }
  })();
  return Promise.race([get, wait(2500).then(() => ({}))]);
}
