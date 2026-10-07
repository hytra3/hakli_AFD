#!/usr/bin/env node
/*  Audio First Dictionary — backfill missing embeddings
 *  ----------------------------------------------------------------------
 *  The embed trigger embeds a take when its audio lands in Storage, and
 *  retries for up to 24 hours if the take's recording doc isn't there yet
 *  (the recorder writes the doc just after the bytes). A phone that stays
 *  offline longer than that leaves a take with audio and a doc but no vector,
 *  so speak-to-find can never match it. This finds those takes and embeds them.
 *
 *  How: it re-runs the SAME trigger rather than calling the embed service
 *  itself (which only accepts the trigger's own service account). Copying an
 *  object onto itself creates a new generation, which fires the trigger's
 *  "finalized" event again; the trigger then does its usual checks and writes
 *  the vector. The copy keeps every byte and metadata field — including the
 *  download token, so links already handed out keep working — and adds one
 *  marker, backfilledAt (Google refuses a self-copy that changes nothing).
 *
 *  Skipped: erased takes (consent "deleted"), takes whose storagePath isn't
 *  their own file, and takes whose audio lacks the entryId/recordingId
 *  metadata the trigger needs — run scripts/audit-recording-paths.mjs --fix
 *  for those first.
 *
 *  Dry run by default (lists what it would do). Then:
 *    node scripts/backfill-embeddings.mjs --apply
 *  and watch:  gcloud functions logs read afd-embed-trigger --region europe-west1 --project afd-dev
 *
 *  Run:
 *    gcloud auth application-default login
 *    node scripts/backfill-embeddings.mjs            # report only
 *    node scripts/backfill-embeddings.mjs --apply    # re-fire the trigger for each
 *
 *  Env:
 *    AFD_PROJECT_ID   (default afd-dev)
 *    AFD_BUCKET       (default afd-dev.firebasestorage.app)
 */

const APPLY      = process.argv.includes("--apply");
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const BUCKET     = process.env.AFD_BUCKET || "afd-dev.firebasestorage.app";
const tag        = APPLY ? "" : "(dry run) ";

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getStorage }   = await import("firebase-admin/storage");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID, storageBucket: BUCKET });
const db = getFirestore();
const bucket = getStorage().bucket();

console.log(`${tag}backfill-embeddings · project=${PROJECT_ID} bucket=${BUCKET}`);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasVector = (d) => (Array.isArray(d.reps) && d.reps.some((r) => r && Array.isArray(r.vector) && r.vector.length))
                      || (Array.isArray(d.embedding) && d.embedding.length > 0);
const counts = { docs: 0, embedded: 0, missing: 0, refired: 0, skipped: 0 };

const snaps = await db.collectionGroup("recordings").get();
for (const snap of snaps.docs) {
  const entryRef = snap.ref.parent.parent;
  if (!entryRef || entryRef.parent.id !== "afd_entries") continue;
  counts.docs++;
  const d = snap.data() || {};
  if (hasVector(d)) { counts.embedded++; continue; }
  if (!d.storagePath) continue;                            // no audio, nothing to embed
  counts.missing++;
  const where = snap.ref.path;
  const skip = (why) => { counts.skipped++; console.log(`  skip    ${where}  (${why})`); };

  if (d.consent === "deleted") { skip("erased — awaiting purge"); continue; }
  const own = d.uid && new RegExp(`^afd/${escapeRe(d.uid)}/${escapeRe(snap.id)}\\.(webm|m4a)$`).test(d.storagePath);
  if (!own) { skip(`storagePath ${d.storagePath} isn't its own file`); continue; }

  const file = bucket.file(d.storagePath);
  const [exists] = await file.exists();
  if (!exists) { skip("audio file missing"); continue; }
  const [md] = await file.getMetadata();
  const custom = md.metadata || {};
  if (custom.entryId !== entryRef.id || custom.recordingId !== snap.id) {
    skip("audio lacks entryId/recordingId metadata — run audit-recording-paths.mjs --fix"); continue;
  }

  console.log(`  ${APPLY ? "re-fire" : "would re-fire"}  ${where}  ← ${d.storagePath}`);
  if (!APPLY) continue;
  // Self-copy → new generation → "finalized" → the embed trigger runs again.
  // Pinned to the current generation so a concurrent change isn't overwritten.
  const keep = {};
  for (const k of ["contentType", "cacheControl", "contentDisposition", "contentEncoding", "contentLanguage"]) {
    if (md[k]) keep[k] = md[k];
  }
  await file.copy(file, {
    ...keep,
    metadata: { ...custom, backfilledAt: new Date().toISOString() },
    preconditionOpts: { ifGenerationMatch: md.generation },
  });
  counts.refired++;
}

console.log(`\n${tag}docs=${counts.docs} embedded=${counts.embedded} missing=${counts.missing} ` +
            `${APPLY ? "re-fired" : "would re-fire"}=${APPLY ? counts.refired : counts.missing - counts.skipped} skipped=${counts.skipped}`);
if (APPLY && counts.refired) console.log("Embeddings arrive within a minute or two — check the afd-embed-trigger logs.");
