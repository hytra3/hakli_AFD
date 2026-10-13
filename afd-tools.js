/* ============================================================================
   afd-tools.js — Arabic / Arabic + English for the steward's tool pages
   (steward.html, prompts/admin.html).

   Their text lives in AFDCore.STRINGS like the rest of the app, so it is on the
   prompts tool's review list and is translated in one place. These pages are
   text-heavy forms, not the wordless dictionary, so they have two states:
     • Arabic + English — the shared display mode "auto"
     • Arabic only      — "script" (and "sound", which has no meaning here)
   The switch writes the same setting the dictionary uses, so a person who
   reads Arabic sees Arabic everywhere. Arabic only also turns the page
   right-to-left.

   Markup:  <span data-t="key"></span>           painted with the current mode
            <input data-t-ph="key">              placeholder
   Script:  AFDTools.text(key, vars)  → plain text (textContent, confirm())
            AFDTools.html(key, vars)  → markup (innerHTML)
   In strings, *x* is bold and `x` is code.

   Load after afd-core.js. Bump the ?v= on every page when this file changes.
   ============================================================================ */
window.AFDTools = (function(){
  const C = window.AFDCore;
  const S = () => (C && C.STRINGS) || {};
  let mode = (C && C.getDisplayMode("auto")) === "auto" ? "auto" : "script";
  const listeners = [];

  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
  // A value may be { ar, en } when it differs by language (a duration, say).
  const fill = (t, vars, lang) => String(t).replace(/\{(\w+)\}/g, (m, k) => {
    if(!vars || !(k in vars)) return m;
    const v = vars[k];
    if(v && typeof v === "object") return String(v[lang] != null ? v[lang] : v.en);
    // numbers in Arabic text use Arabic digits, as in the rest of the app
    if(typeof v === "number" && lang === "ar") return v.toLocaleString("ar-EG");
    return String(v);
  });
  const fmt = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*([^*]+)\*/g, "<b>$1</b>");
  const plain = (t) => String(t).replace(/`([^`]+)`/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  function pair(key, vars){
    const s = S()[key];
    if(!s) return { ar: key, en: key };
    return { ar: fill(s.ar || s.en, vars, "ar"), en: fill(s.en, vars, "en") };
  }

  // plain text: "Arabic · English", or Arabic alone
  function text(key, vars){
    const p = pair(key, vars);
    return mode === "auto" ? plain(p.ar) + " · " + plain(p.en) : plain(p.ar);
  }
  // markup: an Arabic line and an English line (CSS lays them out), or Arabic alone
  function html(key, vars){
    const p = pair(key, vars);
    const ar = '<span class="t-ar" dir="rtl" lang="ar">' + fmt(p.ar) + '</span>';
    return mode === "auto" ? ar + '<span class="t-en" lang="en">' + fmt(p.en) + '</span>' : ar;
  }

  function paint(root){
    const r = root || document;
    r.querySelectorAll("[data-t]").forEach(el => { el.innerHTML = html(el.getAttribute("data-t")); });
    r.querySelectorAll("[data-t-ph]").forEach(el => { el.placeholder = text(el.getAttribute("data-t-ph")); });
    if(!root){
      document.documentElement.lang = mode === "auto" ? "en" : "ar";
      document.documentElement.dir  = mode === "auto" ? "ltr" : "rtl";
      document.querySelectorAll(".t-switch").forEach(paintSwitch);
    }
  }

  // The switch names the mode you are in; tapping it changes to the other.
  function paintSwitch(b){
    // the mode's own name, as its readers write it (STRINGS, so it is translated with the rest)
    const name = S()[mode === "auto" ? "tools.mode.both" : "tools.mode.ar"] || {};
    b.innerHTML = '<span lang="ar">' + esc(name.ar || name.en || mode) + '</span>';
    const other = mode === "auto" ? "tools.switch.toar" : "tools.switch.toboth";
    b.title = text(other); b.setAttribute("aria-label", text(other));
  }
  function setMode(m){
    mode = m === "auto" ? "auto" : "script";
    if(C) C.setDisplayMode(mode);
    paint();
    listeners.forEach(fn => { try{ fn(mode); }catch(e){ console.warn("[AFDTools]", e); } });
  }
  function mountSwitch(b){
    b.classList.add("t-switch"); b.type = "button";
    b.addEventListener("click", () => setMode(mode === "auto" ? "script" : "auto"));
    paintSwitch(b);
  }

  return {
    get mode(){ return mode; },
    text, html, pair, paint, setMode, mountSwitch,
    onChange(fn){ listeners.push(fn); }
  };
})();
