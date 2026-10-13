/**
 * Interface strings — every key the pages ask for exists (no emulator needed)
 * ============================================================================
 * Interface text lives in one list, AFDCore.STRINGS (afd-core.js), so it can be
 * reviewed in the prompts tool and translated for another language in one
 * place. A page asks for text by key; a key that isn't in the list shows up
 * on screen as the raw key. This reads every page and script for the keys
 * they name literally and checks each one is defined.
 *
 * RUN:  node --test test/strings.unit.test.mjs
 * ============================================================================
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, root), "utf8");

// load AFDCore the way a page does
const sandbox = { window: {}, localStorage: { getItem(){ return null; }, setItem(){} },
                  document: { addEventListener(){}, readyState: "complete" } };
vm.createContext(sandbox);
vm.runInContext(read("afd-core.js"), sandbox);
vm.runInContext(read("afd-instance.js"), sandbox);
const C = sandbox.window.AFDCore;
const S = C.STRINGS;
const I = sandbox.window.AFDInstance;

const FILES = ["index.html", "add.html", "recorder.html", "welcome.html", "steward.html",
               "prompts/index.html", "prompts/admin.html", "afd-card.js", "afd-core.js"];
// literal keys in the ways the pages ask for text
const PATTERNS = [
  /\b(?:AFDCore|C)\.t(?:f|HTML)?\(\s*"([a-z][\w.]*\w)"/g,      // AFDCore.t("k") / tf / tHTML, C.t("k")
  /\bt(?:Bi|Msg)\(\s*"([a-z][\w.]*\w)"/g,                     // recorder: tBi("k") / tMsg("k")
  /\bset\(\s*"[\w-]+"\s*,\s*"([a-z][\w.]*\w)"/g,              // recorder: set("elementId","k")
  /\bdata-(?:str|k|cap-key)="([a-z][\w.]*\w)"/g,              // markup
  /\bbiLabel\(\s*"([a-z][\w.]*\w)"/g,                         // afd-card.js
  /\bslotSection\(\s*"([a-z][\w.]*\w)"/g,
];
function keysIn(src){
  const out = new Set();
  for(const re of PATTERNS) for(const m of src.matchAll(re)) out.add(m[1]);
  return out;
}

describe("interface strings", () => {
  for(const f of FILES){
    it(`every key ${f} asks for is in the list`, () => {
      const missing = [...keysIn(read(f))].filter(k => !(k in S));
      assert.deepEqual(missing, [], `${f} asks for keys that aren't in AFDCore.STRINGS`);
    });
  }
  it("every label in the speaker form config is in the list", (t) => {
    if(!I.speaker){ t.skip("no speaker form config in afd-instance.js"); return; }
    const keys = [];
    for(const fl of I.speaker.fields){
      keys.push(fl.label);
      if(fl.placeholder) keys.push(fl.placeholder);
      for(const o of fl.options || []) if(o.label) keys.push(o.label);
    }
    if(I.speaker.note) keys.push(I.speaker.note);
    assert.deepEqual(keys.filter(k => !(k in S)), []);
  });
  it("every string has both English and Arabic", () => {
    const half = Object.entries(S).filter(([, v]) => !v.en || !v.ar).map(([k]) => k);
    assert.deepEqual(half, []);
  });
  it("placeholders match between the two languages", () => {
    // {xAr} in the Arabic is the same value as {x}, written in Arabic numerals
    const vars = (t) => [...String(t).matchAll(/\{(\w+?)(?:Ar)?\}/g)].map(m => m[1]).sort().join();
    const bad = Object.entries(S).filter(([, v]) => vars(v.en) !== vars(v.ar)).map(([k]) => k);
    assert.deepEqual(bad, []);
  });
});

describe("sign-in errors", () => {
  it("each Firebase error maps to a string in the list; closing the popup says nothing", () => {
    for(const code of ["auth/unauthorized-domain", "auth/operation-not-allowed", "auth/invalid-credential",
                       "auth/wrong-password", "auth/user-not-found", "auth/email-already-in-use",
                       "auth/weak-password", "auth/popup-blocked", "auth/something-new"]){
      const k = C.authErrorKey({ code });
      assert.ok(k in S, `${code} → ${k}`);
    }
    assert.equal(C.authErrorKey({ code: "auth/popup-closed-by-user" }), null);
  });
  it("tf fills placeholders in either language", () => {
    assert.equal(C.tf("acct.signedin.as", "auto", { who: "Marty" }), "Signed in as Marty — account menu");
    assert.match(C.tf("acct.signedin.as", "script", { who: "Marty" }), /Marty/);
  });
});
