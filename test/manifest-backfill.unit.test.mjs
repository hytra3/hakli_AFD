/**
 * Manifest-fields backfill — what it adds to each doc (no emulator needed)
 * ============================================================================
 * The backfill must only ever ADD missing fields, never change a value that
 * is already there, so it is safe to re-run and safe against docs the app
 * wrote itself after #35.
 *
 * RUN:  node --test test/manifest-backfill.unit.test.mjs
 * ============================================================================
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planEntry, planRecording } from "../scripts/lib/manifest-backfill.mjs";
import { readInstance } from "../scripts/lib/instance.mjs";

const INST = readInstance();
const LANG = INST.language.code;

describe("instance config", () => {
  it("the language code is the private-use qhk, never an external code", () => {
    assert.equal(LANG, "qhk");
    assert.match(LANG, /^q[a-t][a-z]$/);                       // BCP 47 private-use range
  });
});

describe("word card — planEntry", () => {
  it("a pre-#35 seeded word gets lang, empty concepts and glosses from gloss/glossAr", () => {
    const p = planEntry({ gloss: "sun", glossAr: "الشمس", domain: "nature", pic: "☀️" }, INST);
    assert.deepEqual(p, { lang: LANG, concepts: [], glosses: { ar: "الشمس", en: "sun" } });
  });
  it("a contributed word with only Arabic gets an Arabic-only glosses map", () => {
    assert.deepEqual(planEntry({ source: "user", glossAr: "ماعز" }, INST).glosses, { ar: "ماعز" });
  });
  it("blank glosses are left out, and no glosses map is made from nothing", () => {
    const p = planEntry({ source: "user", gloss: "", glossAr: "  " }, INST);
    assert.equal("glosses" in p, false);
    assert.deepEqual(p, { lang: LANG, concepts: [] });
  });
  it("a word the app wrote after #35 needs nothing", () => {
    const d = { source: "user", lang: LANG, concepts: [], glossAr: "ماعز", glosses: { ar: "ماعز" } };
    assert.deepEqual(planEntry(d, INST), {});
  });
  it("existing values are never changed — even a different lang, or linked concepts", () => {
    const d = { lang: "ar", concepts: ["concepticon:1343"], glosses: { en: "x" }, gloss: "sun" };
    assert.deepEqual(planEntry(d, INST), {});
  });
  it("access stays absent (reserved)", () => {
    assert.equal("access" in planEntry({}, INST), false);
  });
});

describe("recording — planRecording", () => {
  it("a pre-#35 take gets lang and needs a checksum", () => {
    const { patch, needsHash } = planRecording({ storagePath: "afd/u/r.webm", consent: "public" }, INST);
    assert.deepEqual(patch, { lang: LANG });
    assert.equal(needsHash, true);
  });
  it("a withdrawn take still gets a checksum — its bytes are kept on purpose", () => {
    assert.equal(planRecording({ storagePath: "afd/u/r.webm", consent: "withdrawn" }, INST).needsHash, true);
  });
  it("an erased take awaiting the purge is not checksummed", () => {
    assert.equal(planRecording({ storagePath: "afd/u/r.webm", consent: "deleted" }, INST).needsHash, false);
  });
  it("a skip record with no audio gets lang but no checksum", () => {
    const { patch, needsHash } = planRecording({ consent: "public" }, INST);
    assert.deepEqual(patch, { lang: LANG });
    assert.equal(needsHash, false);
  });
  it("a take that already has lang and sha256 needs nothing", () => {
    const { patch, needsHash } = planRecording({ lang: "ar", sha256: "ab", storagePath: "afd/u/r.webm" }, INST);
    assert.deepEqual(patch, {});
    assert.equal(needsHash, false);
  });
});
