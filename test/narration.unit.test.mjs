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
class FakeAudio { constructor(u){ this.src=u; this.paused=true; this.l={}; FakeAudio.all.push(this); }
  play(){ this.paused=false; return Promise.resolve(); } pause(){ this.paused=true; (this.l.pause||[]).forEach(f=>f()); }
  addEventListener(e,f){ (this.l[e]=this.l[e]||[]).push(f); } }
FakeAudio.all = [];
const sandbox = { Audio: FakeAudio, window: {}, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
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

describe("nothing the app says can end up in a recording (11-10)", () => {
  it("recording stops a prompt that is playing", () => {
    set("sound", false); C.setCapturing(false);
    const a = C.playUI("u1", "narration"); assert.ok(a && !a.paused);
    C.setCapturing(true); assert.equal(a.paused, true);
  });
  it("while recording, no prompt can start — narration or asked", () => {
    C.setCapturing(true);
    assert.equal(C.playUI("u2", "narration"), null);
    assert.equal(C.playUI("u3", "asked"), null);
  });
  it("after recording, prompts play again", () => {
    C.setCapturing(false);
    const a = C.playUI("u4", "asked"); assert.ok(a && !a.paused);
  });
});
