/**
 * When the app may speak on its own (no emulator needed)
 * ======================================================
 * 11-10, from the field: spoken Hakli hints played in the Arabic view too, and
 * surprised readers. Narration (sound the app VOLUNTEERS) is for people who
 * can't read the screen: it plays only in the sound view, and quiet mode
 * silences it there. Sound someone ASKED for (a tapped 🔈 / ▶) and the Hakli
 * recordings themselves play in every view.
 *
 * RUN:  node --test test/narration.unit.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const store = {};
const sandbox = { window: {}, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
                  document: { addEventListener(){}, readyState: "complete" } };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL("../afd-core.js", import.meta.url), "utf8"), sandbox);
const C = sandbox.window.AFDCore;
const set = (mode, quiet) => { if(mode === null) delete store.afd_display_mode; else store.afd_display_mode = mode; store.afd_quiet = quiet ? "1" : "0"; };

describe("narration plays only in the sound view", () => {
  it("sound view: narration plays", () => { set("sound", false); assert.equal(C.mayPlayUI("narration"), true); });
  it("no view chosen yet = the sound view (every page's default): narration plays", () => { set(null, false); assert.equal(C.mayPlayUI("narration"), true); });
  it("Arabic view: no narration", () => { set("script", false); assert.equal(C.mayPlayUI("narration"), false); });
  it("Arabic · English view: no narration", () => { set("auto", false); assert.equal(C.mayPlayUI("narration"), false); });
  it("quiet silences narration in the sound view", () => { set("sound", true); assert.equal(C.mayPlayUI("narration"), false); });
  for (const m of ["sound", "script", "auto"]) for (const q of [false, true])
    it(`a sound someone asked for always plays (${m}${q ? ", quiet" : ""})`, () => { set(m, q); assert.equal(C.mayPlayUI("asked"), true); });
});
