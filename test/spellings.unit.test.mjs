/**
 * Spellings — the text helpers and the export (no emulator needed)
 * ============================================================================
 * AFDCore.spellingText / spellingKey / spellingLang (afd-core.js), and how
 * spellings travel in an export package (scripts/lib/export.mjs).
 *
 * RUN:  node --test test/spellings.unit.test.mjs
 * ============================================================================
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildPackage } from "../scripts/lib/export.mjs";
import { readInstance } from "../scripts/lib/instance.mjs";

const root = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, root), "utf8");
const sandbox = { window: {}, localStorage: { getItem(){ return null; }, setItem(){} },
                  document: { addEventListener(){}, readyState: "complete" } };
vm.createContext(sandbox);
vm.runInContext(read("afd-core.js"), sandbox);
vm.runInContext(read("afd-instance.js"), sandbox);
const C = sandbox.window.AFDCore;

describe("spelling text", () => {
  it("is stored as written, tidied: NFC, trimmed, one space, no tatweel or joiners", () => {
    assert.equal(C.spellingText("  شُـــوم ‌  حكلي "), "شُوم حكلي");
    assert.equal(C.spellingText("أ"), "أ");            // decomposed hamza → composed
  });
  it("keeps vowel marks and the writer's own letters", () => {
    assert.equal(C.spellingText("ڛُوْم"), "ڛُوْم");
  });
});

describe("search key — forgiving", () => {
  const same = (a, b) => assert.equal(C.spellingKey(a), C.spellingKey(b), `${a} ~ ${b}`);
  it("ignores vowel marks and tatweel", () => { same("شُوْم", "شوم"); same("شـوم", "شوم"); });
  it("folds the alef family, ى/ی/ي, ک/ك, ة/ه, ؤ/و, ئ/ي, lone hamza", () => {
    same("أخ", "اخ"); same("إبن", "ابن"); same("آل", "ال"); same("ٱل", "ال");
    same("على", "علي"); same("علی", "علي"); same("کتاب", "كتاب");
    same("مدرسة", "مدرسه"); same("مؤمن", "مومن"); same("بئر", "بير"); same("سماء", "سما");
  });
  it("keeps letters that carry their own sound", () => {
    assert.notEqual(C.spellingKey("ڛوم"), C.spellingKey("سوم"));
  });
});

describe("spelling language tag", () => {
  it("is the instance's code plus its spelling script", () => {
    assert.equal(C.spellingLang(), "qhk-Arab");
    assert.equal(C.spellingDir(), "rtl");
  });
});

// ---- export ----
const ts = (iso) => ({ toDate: () => new Date(iso) });
function fakeDb(docs){
  const snap = (path) => {
    const parts = path.split("/"), id = parts.at(-1);
    const ref = { id, path, parent: { id: parts.at(-2), parent: null } };
    if(parts.length === 4) ref.parent.parent = { id: parts[1], parent: { id: parts[0] } };
    return { id, ref, exists: true, data: () => docs[path] };
  };
  const snapOrMissing = (p) => p in docs ? snap(p) : { exists: false, data: () => undefined };
  return {
    collection: (c) => ({ get: async () => ({ docs: Object.keys(docs).filter(p => p.split("/").length === 2 && p.startsWith(c + "/")).map(snap) }),
                          doc: (id) => ({ get: async () => snapOrMissing(`${c}/${id}`) }) }),
    collectionGroup: (c) => ({ get: async () => ({ docs: Object.keys(docs).filter(p => p.split("/").at(-2) === c).map(snap) }) }),
  };
}
const bucket = { file: () => ({ exists: async () => [false], download: async () => [Buffer.alloc(0)] }),
                 getFiles: async () => [[]] };
const DOCS = {
  "afd_entries/ent_sun": { gloss: "sun", glossAr: "الشمس", lang: "qhk" },
  "afd_entries/ent_sun/spellings/uB": { text: "شمس", searchKey: "شمس", lang: "qhk-Arab", by: "uB", at: ts("2026-10-15T11:00:00Z") },
  "afd_entries/ent_sun/spellings/uA": { text: "شُوم", searchKey: "شوم", lang: "qhk-Arab", by: "uA", at: ts("2026-10-15T10:00:00Z") },
  "afd_entries/ent_sun/spellings/uC": { text: "xxx", searchKey: "xxx", lang: "qhk-Arab", by: "uC", at: ts("2026-10-15T12:00:00Z"), hiddenAt: ts("2026-10-15T13:00:00Z") },
};
const entriesOf = (pkg) => {
  const f = pkg.files.find(x => x.name === "entries.jsonl");
  return f.data.toString("utf8").trim().split("\n").map(JSON.parse);
};

describe("spellings in an export", () => {
  it("the community backup keeps every spelling on its card, oldest first, writers and hidden ones included", async () => {
    const pkg = await buildPackage({ db: fakeDb(DOCS), bucket, instance: readInstance(), concepts: {}, now: new Date() });
    const sun = entriesOf(pkg).find(e => e.entryId === "ent_sun");
    assert.deepEqual(sun.spellings.map(s => [s.text, s.by]), [["شُوم", "uA"], ["شمس", "uB"], ["xxx", "uC"]]);
    assert.equal(sun.spellings[0].lang, "qhk-Arab");
    assert.ok(sun.spellings[2].hiddenAt);
  });
});
