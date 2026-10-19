// scripts/lib/vectors.mjs — moving a take's search vectors off its recording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasVectors, moveOne } from "../scripts/lib/vectors.mjs";

const DEL = Symbol("delete");
function fake(){
  const S = new Map();
  const ref = (p) => ({ async set(v){ S.set(p, structuredClone(v)); },
    async update(v){ const d = { ...(S.get(p) || {}) }; for(const [k, x] of Object.entries(v)){ if(x === DEL) delete d[k]; else d[k] = x; } S.set(p, d); } });
  return { S, doc: ref };
}
test("a recording with vectors: vectors to afd_vectors first, then stripped, repSpans kept", async () => {
  const db = fake(), recPath = "afd_entries/ent_sun/recordings/r1";
  const data = { uid: "uA", consent: "public", allowPlayback: true, embedding: [1, 0],
                 reps: [{ start: 0.1, end: 0.5, vector: [1, 0] }], embedModel: "mms-300m", nReps: 1 };
  db.S.set(recPath, structuredClone(data));
  const moved = await moveOne(db, { id: "r1", entryId: "ent_sun", ref: db.doc(recPath), data }, DEL, new Date(0));
  assert.equal(moved, true);
  const v = db.S.get("afd_vectors/r1"), r = db.S.get(recPath);
  assert.deepEqual(v.reps, data.reps); assert.deepEqual(v.embedding, [1, 0]); assert.equal(v.entryId, "ent_sun");
  assert.equal(r.embedding, undefined); assert.equal(r.reps, undefined);
  assert.deepEqual(r.repSpans, [{ start: 0.1, end: 0.5 }]);
  assert.equal(r.consent, "public"); assert.equal(r.allowPlayback, true); assert.equal(r.nReps, 1);   // nothing else touched
});
test("already moved, or never embedded: nothing to do", async () => {
  assert.equal(hasVectors({ repSpans: [{ start: 0, end: 1 }] }), false);
  assert.equal(await moveOne(fake(), { id: "r2", entryId: "e", ref: null, data: { nReps: 1 } }, DEL), false);
});
