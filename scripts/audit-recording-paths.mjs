#!/usr/bin/env node
/*  Audio First Dictionary — audit recording docs ↔ corpus audio
 *  ----------------------------------------------------------------------
 *  Run BEFORE deploying the consent-gated Storage rules. Those rules let the
 *  public fetch afd/{uid}/{file} only when the object's metadata names a
 *  recording doc (entryId + recordingId) whose allowPlayback is true and whose
 *  storagePath is that very file. A take that doesn't line up goes SILENT for
 *  listeners (its uploader can still hear it). This finds every such take,
 *  plus the leftovers of two fixed bugs:
 *
 *    · no-uid       doc with no uid — created by the old embed trigger before
 *                   the recorder's own write, which was then refused forever
 *    · foreign-path storagePath that isn't afd/{uid}/{recordingId}.webm|m4a
 *                   (the purge now refuses these; look at them by hand)
 *    · no-object    storagePath names a file that doesn't exist
 *    · no-meta      object lacks entryId/recordingId metadata, or they don't
 *                   match the doc  → fixable with --fix
 *    · orphan       afd/ object with no recording doc pointing at it (stays
 *                   readable by its uploader only — usually what you want)
 *
 *  Read-only by default. --fix ONLY stamps the missing/mismatched entryId +
 *  recordingId metadata onto objects whose doc names them as its own file. It
 *  never deletes or moves anything, never touches a doc.
 *
 *  Gate the deploy on it (exits non-zero while anything needs a look):
 *    node scripts/audit-recording-paths.mjs && firebase deploy --only storage
 *
 *  Run:
 *    gcloud auth application-default login
 *    node scripts/audit-recording-paths.mjs          # report only
 *    node scripts/audit-recording-paths.mjs --fix    # stamp missing metadata
 *
 *  Env:
 *    AFD_PROJECT_ID   (default afd-dev)
 *    AFD_BUCKET       (default afd-dev.firebasestorage.app)
 */

const FIX        = process.argv.includes("--fix");
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const BUCKET     = process.env.AFD_BUCKET || "afd-dev.firebasestorage.app";
const tag        = FIX ? "" : "(dry run) ";

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getStorage }   = await import("firebase-admin/storage");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID, storageBucket: BUCKET });
const db = getFirestore();
const bucket = getStorage().bucket();

console.log(`${tag}audit-recording-paths · project=${PROJECT_ID} bucket=${BUCKET}`);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const counts = { docs: 0, ok: 0, "no-uid": 0, "foreign-path": 0, "no-object": 0, "no-meta": 0, orphan: 0, fixed: 0 };
const claimed = new Set();
const report = (kind, msg) => { counts[kind]++; console.log(`  ${kind.padEnd(12)} ${msg}`); };

const snaps = await db.collectionGroup("recordings").get();
for (const snap of snaps.docs) {
  const entryRef = snap.ref.parent.parent;
  if (!entryRef || entryRef.parent.id !== "afd_entries") continue;
  counts.docs++;
  const d = snap.data() || {};
  const where = snap.ref.path;

  if (!d.uid) { report("no-uid", `${where}`); continue; }
  if (!d.storagePath) { counts.ok++; continue; }           // text-only take, no audio
  const own = new RegExp(`^afd/${escapeRe(d.uid)}/${escapeRe(snap.id)}\\.(webm|m4a)$`);
  if (!own.test(d.storagePath)) { report("foreign-path", `${where} → ${d.storagePath}`); continue; }
  claimed.add(d.storagePath);

  const file = bucket.file(d.storagePath);
  const [exists] = await file.exists();
  if (!exists) { report("no-object", `${where} → ${d.storagePath}`); continue; }
  const [md] = await file.getMetadata();
  const meta = md.metadata || {};
  if (meta.entryId === entryRef.id && meta.recordingId === snap.id) { counts.ok++; continue; }

  report("no-meta", `${d.storagePath}  has entryId=${meta.entryId ?? "-"} recordingId=${meta.recordingId ?? "-"}` +
                    `  want ${entryRef.id} / ${snap.id}`);
  if (FIX) {
    await file.setMetadata({ metadata: { entryId: entryRef.id, recordingId: snap.id } });
    counts.fixed++;
  }
}

const [files] = await bucket.getFiles({ prefix: "afd/" });
for (const f of files) {
  if (f.name.endsWith("/")) continue;
  if (!claimed.has(f.name)) report("orphan", f.name);
}

console.log(`\n${tag}docs=${counts.docs} ok=${counts.ok} no-uid=${counts["no-uid"]} ` +
            `foreign-path=${counts["foreign-path"]} no-object=${counts["no-object"]} ` +
            `no-meta=${counts["no-meta"]}${FIX ? ` (fixed ${counts.fixed})` : ""} orphan=${counts.orphan}`);

// Orphans are informational; everything else blocks a deploy until looked at.
const blocking = counts["no-uid"] + counts["foreign-path"] + counts["no-object"] + (counts["no-meta"] - counts.fixed);
process.exit(blocking ? 1 : 0);
