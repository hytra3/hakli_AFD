// scripts/lib/join.mjs — joining two word cards that are the same word, and
// undoing it. In-memory stand-ins for Firestore and Storage: no emulator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findWords, planJoin, applyJoin, undoJoin } from "../scripts/lib/join.mjs";

const DEL = Symbol("delete");
function fakeDb(init){
  const S = new Map(Object.entries(structuredClone(init)));
  const get = (o, p) => p.split(".").reduce((x, k) => x == null ? x : x[k], o);
  const docRef = (path) => ({
    id: path.split("/").pop(), path,
    async get(){ const d = S.get(path); return { exists: d !== undefined, id: path.split("/").pop(), data: () => d && structuredClone(d) }; },
    async set(v){ S.set(path, structuredClone(v)); },
    async update(v){
      const d = structuredClone(S.get(path)); if(!d) throw new Error("no doc " + path);
      for(const [k, x] of Object.entries(v)){
        const ks = k.split("."), last = ks.pop(); let o = d;
        for(const p of ks){ o[p] = o[p] || {}; o = o[p]; }
        if(x === DEL) delete o[last]; else o[last] = x;
      }
      S.set(path, d);
    },
    async delete(){ S.delete(path); }
  });
  const coll = (path, filt) => ({
    where(f, op, v){ return coll(path, [f, v]); },
    async get(){
      const docs = [...S.keys()].filter(k => k.startsWith(path + "/") && !k.slice(path.length + 1).includes("/"))
        .filter(k => !filt || get(S.get(k), filt[0]) === filt[1])
        .map(k => ({ id: k.split("/").pop(), ref: docRef(k), data: () => structuredClone(S.get(k)) }));
      return { docs, size: docs.length };
    }
  });
  return { S, doc: docRef, collection: (p) => coll(p) };
}
function fakeBucket(missing = []){
  const meta = new Map();
  return { meta, file: (p) => ({ async setMetadata(m){
    if(missing.includes(p)) throw Object.assign(new Error("No such object: " + p), { code: 404 });
    meta.set(p, { ...(meta.get(p) || {}), ...m.metadata }); } }) };
}
const take = (id, uid, extra) => ({ recordingId: id, entryId: "ent_u_dup", uid, speakerId: "spk_" + uid + "_01", type: "word",
  consent: "public", allowPlayback: true, storagePath: `afd/${uid}/${id}.webm`, gloss: "", reps: [{ vector: [1, 0] }], ...extra });
const world = () => ({
  "afd_entries/ent_water": { gloss: "water", glossAr: "ماء", pic: "💧" },
  "afd_entries/ent_water/recordings/rOld": take("rOld", "uA", { entryId: "ent_water", gloss: "water" }),
  "afd_entries/ent_u_dup": { source: "user", createdBy: "uB", glossAr: "مَاء", pic: "🌊", image: "https://x/afd_pics/uB/ent_u_dup.jpg" },
  "afd_entries/ent_u_dup/recordings/rB1": take("rB1", "uB"),
  "afd_entries/ent_u_dup/recordings/rB2": take("rB2", "uB", { type: "definition", consent: "withdrawn", allowPlayback: false }),
  "afd_entries/ent_u_dup/spellings/uB": { text: "مه", searchKey: "مه", by: "uB" },
  "afd_entries/ent_u_dup/spellings/uA": { text: "ميه", searchKey: "ميه", by: "uA" },
  "afd_entries/ent_water/spellings/uA": { text: "مي", searchKey: "مي", by: "uA" },
  "afd_entries/ent_u_bare": { source: "user", createdBy: "uC" },
});

test("findWords: by id, or by English / Arabic name with the diacritics folded", () => {
  const entries = Object.entries(world()).filter(([k]) => k.split("/").length === 2).map(([k, d]) => ({ id: k.split("/")[1], data: d }));
  assert.deepEqual(findWords("ent_water", entries).map(e => e.id), ["ent_water"]);
  assert.deepEqual(findWords("ماء", entries).map(e => e.id).sort(), ["ent_u_dup", "ent_water"]);
  assert.deepEqual(findWords("WATER", entries).map(e => e.id), ["ent_water"]);
});

test("join: voices move with consent untouched; audio labels follow; spellings copied; INTO keeps its face", async () => {
  const db = fakeDb(world()), bucket = fakeBucket();
  const plan = await planJoin(db, "ent_u_dup", "ent_water");
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.face, {});                                  // water has pic + names already
  await applyJoin(db, bucket, plan, "steward@x", new Date(0));
  const S = db.S;
  assert.equal(S.has("afd_entries/ent_u_dup/recordings/rB1"), false);
  const b1 = S.get("afd_entries/ent_water/recordings/rB1"), b2 = S.get("afd_entries/ent_water/recordings/rB2");
  assert.equal(b1.entryId, "ent_water"); assert.equal(b1.gloss, "water");
  assert.equal(b1.uid, "uB"); assert.equal(b1.consent, "public"); assert.equal(b1.allowPlayback, true);
  assert.equal(b2.consent, "withdrawn"); assert.equal(b2.allowPlayback, false);   // a withdrawn voice stays withdrawn
  assert.deepEqual(b1.reps, [{ vector: [1, 0] }]);                                  // search vectors come along
  assert.equal(b1.joinedFrom.entryId, "ent_u_dup");
  assert.equal(bucket.meta.get("afd/uB/rB1.webm").entryId, "ent_water");
  assert.equal(S.get("afd_entries/ent_water/spellings/uB").text, "مه");             // copied
  assert.equal(S.get("afd_entries/ent_water/spellings/uA").text, "مي");             // uA's own kept
  const from = S.get("afd_entries/ent_u_dup");
  assert.equal(from.joinedInto, "ent_water"); assert.ok(from.hiddenAt); assert.ok(from.image);   // hidden, photo kept
  assert.equal(S.get("afd_entries/ent_water").pic, "💧");
});

test("a kept card with an emoji doesn't take the other's photo (a photo would show instead)", async () => {
  const db = fakeDb(world());
  assert.deepEqual((await planJoin(db, "ent_u_dup", "ent_water")).face, {});
});

test("join fills only what the kept card lacks", async () => {
  const db = fakeDb({ ...world(), "afd_entries/ent_u_keep": { source: "user", createdBy: "uD", gloss: "water" } });
  const plan = await planJoin(db, "ent_u_dup", "ent_u_keep");
  assert.deepEqual(Object.keys(plan.face).sort(), ["glossAr", "image", "pic"]);
  await applyJoin(db, fakeBucket(), plan, "s", new Date(0));
  const k = db.S.get("afd_entries/ent_u_keep");
  assert.equal(k.pic, "🌊"); assert.equal(k.gloss, "water"); assert.equal(k.glosses.ar, "مَاء");
});

test("refuses: a built-in word as the extra, itself, a chain, a missing word", async () => {
  const db = fakeDb(world());
  assert.match((await planJoin(db, "ent_water", "ent_u_dup")).problems.join(), /built-in/);
  assert.match((await planJoin(db, "ent_u_dup", "ent_u_dup")).problems.join(), /itself/);
  assert.match((await planJoin(db, "ent_u_dup", "ent_nope")).problems.join(), /no word ent_nope/);
  await applyJoin(db, fakeBucket(), await planJoin(db, "ent_u_dup", "ent_water"), "s");
  assert.match((await planJoin(db, "ent_u_bare", "ent_u_dup")).problems.join(), /joined into ent_water/);
  await assert.rejects(applyJoin(db, fakeBucket(), await planJoin(db, "ent_water", "ent_u_dup"), "s"), /refused/);
});

test("a join cut off halfway finishes on the next run; a missing audio file doesn't stop it", async () => {
  const db = fakeDb(world());
  const plan = await planJoin(db, "ent_u_dup", "ent_water");
  // first run "died" after copying rB1 but before deleting it
  await db.doc("afd_entries/ent_water/recordings/rB1").set({ ...plan.recs[0].data, entryId: "ent_water", joinedFrom: { entryId: "ent_u_dup" } });
  const again = await planJoin(db, "ent_u_dup", "ent_water");
  assert.deepEqual(again.problems, []);
  const notes = await applyJoin(db, fakeBucket(["afd/uB/rB2.webm"]), again, "s");
  assert.match(notes.join(), /rB2: no audio file/);
  assert.equal(db.S.has("afd_entries/ent_u_dup/recordings/rB1"), false);
  assert.ok(db.S.has("afd_entries/ent_water/recordings/rB2"));
});

test("undo puts everything back and shows the card again", async () => {
  const db = fakeDb({ ...world(), "afd_entries/ent_u_keep": { source: "user", createdBy: "uD", gloss: "water" } });
  const bucket = fakeBucket();
  await applyJoin(db, bucket, await planJoin(db, "ent_u_dup", "ent_u_keep"), "s");
  const r = await undoJoin(db, bucket, "ent_u_dup", "s", DEL);
  assert.equal(r.voices, 2);
  const S = db.S;
  assert.equal(S.get("afd_entries/ent_u_dup/recordings/rB1").entryId, "ent_u_dup");
  assert.equal(S.get("afd_entries/ent_u_dup/recordings/rB1").joinedFrom, undefined);
  assert.equal(S.has("afd_entries/ent_u_keep/recordings/rB1"), false);
  assert.equal(bucket.meta.get("afd/uB/rB1.webm").entryId, "ent_u_dup");
  assert.equal(S.has("afd_entries/ent_u_keep/spellings/uB"), false);
  const from = S.get("afd_entries/ent_u_dup"), keep = S.get("afd_entries/ent_u_keep");
  assert.equal(from.joinedInto, undefined); assert.equal(from.hiddenAt, undefined); assert.ok(from.unjoinedAt);
  assert.equal(keep.pic, undefined); assert.equal(keep.gloss, "water");   // only what it took goes back
  await assert.rejects(undoJoin(db, bucket, "ent_u_dup", "s", DEL), /isn't a joined word/);
});
