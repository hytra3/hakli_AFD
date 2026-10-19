/*  Moving search vectors off the recordings (10-19) — the logic behind
 *  scripts/move-vectors.mjs, kept here so it can be tested without Firebase.
 *
 *  A recording embedded before 10-19 carries its vectors on the recording doc
 *  (embedding, reps[].vector) — and every phone that opens the word downloads
 *  them. Moving one: write afd_vectors/{recordingId} (server-only), then strip
 *  the vectors from the recording, leaving where each repetition falls
 *  (repSpans). Vectors first, recording second, so a move cut off halfway never
 *  loses a vector; re-running finishes it. */

export const hasVectors = (d) =>
  (Array.isArray(d.reps) && d.reps.some((r) => r && Array.isArray(r.vector) && r.vector.length))
  || (Array.isArray(d.embedding) && d.embedding.length > 0);

/** Rough bytes of the vectors on a recording doc (what each phone stops downloading). */
export const vectorBytes = (d) => JSON.stringify({ e: d.embedding || null, r: d.reps || null }).length;

export function vectorDoc(id, entryId, d, now){
  return { recordingId: id, entryId, embedding: d.embedding || null, reps: d.reps || [],
           model: d.embedModel || "mms-300m", layer: d.embedLayer || 12, pooling: d.embedPooling || "voiced-per-rep",
           at: now || new Date(), movedFrom: "recording" };
}

/** rec: { id, entryId, ref, data }. del: the "delete this field" sentinel. */
export async function moveOne(db, rec, del, now){
  const d = rec.data || {};
  if(!hasVectors(d)) return false;
  await db.doc(`afd_vectors/${rec.id}`).set(vectorDoc(rec.id, rec.entryId, d, now));
  const spans = (d.reps || []).map((x) => ({ start: x.start ?? null, end: x.end ?? null }));
  await rec.ref.update({ embedding: del, reps: del, ...(spans.length && !d.repSpans ? { repSpans: spans } : {}) });
  return true;
}
