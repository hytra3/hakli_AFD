#!/usr/bin/env node
/*  Audio First Dictionary — every public take has an upload time?
 *  ----------------------------------------------------------------------
 *  Word cards list public voices newest first (orderBy uploadedAt), and
 *  Firestore leaves a doc WITHOUT that field out of an ordered query. Every
 *  take written by the app has it (afd-upload.js, since 08-14) and join-words
 *  carries it, so this should print 0. Read-only unless --fix, which sets
 *  uploadedAt from recordedAt (or now) on the ones missing it.
 *
 *  Run:
 *    gcloud auth application-default login
 *    node scripts/check-uploaded-at.mjs          # look
 *    node scripts/check-uploaded-at.mjs --fix    # write
 *
 *  Env: AFD_PROJECT_ID (default afd-dev)
 */
const FIX = process.argv.includes("--fix");
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = await import("firebase-admin/firestore");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
await (await import("./lib/preflight.mjs")).preflightOrExit();
const db = getFirestore();

const snaps = await db.collectionGroup("recordings").get();
const missing = snaps.docs.filter(d => d.get("uploadedAt") == null);
for (const d of missing) {
  const r = d.data() || {};
  const ms = typeof r.recordedAt === "number" ? r.recordedAt : Date.parse(r.recordedAt || "");
  console.log(`  ${d.ref.path}  ${r.allowPlayback ? "public" : "hidden"}  recordedAt ${r.recordedAt || "—"}`);
  if (FIX) await d.ref.update({ uploadedAt: isFinite(ms) ? Timestamp.fromMillis(ms) : FieldValue.serverTimestamp() });
}
console.log(`\n${snaps.size} takes checked, ${missing.length} without uploadedAt${FIX && missing.length ? " — fixed" : ""} · project ${PROJECT_ID}`);
