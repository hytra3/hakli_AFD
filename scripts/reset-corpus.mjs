#!/usr/bin/env node
/*  Audio First Dictionary — reset the TEST corpus
 *  ------------------------------------------------------------------
 *  Wipes contributed RECORDINGS (their Firestore docs AND their Storage
 *  audio) so you can start the real dictionary fresh. It deliberately does
 *  NOT touch:
 *    · afd_entries/{id} entry shells  — your dictionary skeleton
 *                                       (re-seed/refresh with seed-entries.mjs)
 *    · afd-words.js                    — the wordlist (a repo file)
 *    · afd_ui/ prompt audio           — the app's spoken interface
 *    · your 16 years of legacy fieldwork — archived elsewhere, never in here
 *
 *  SAFE BY DEFAULT: with no flags this is a DRY RUN — it counts what it would
 *  remove and removes nothing. You must pass --yes to actually delete.
 *
 *  Run:
 *    gcloud auth application-default login          # or GOOGLE_APPLICATION_CREDENTIALS
 *    node scripts/reset-corpus.mjs                  # dry run — shows the counts
 *    node scripts/reset-corpus.mjs --yes           # delete ALL contributors' takes
 *    node scripts/reset-corpus.mjs --yes --uid=UID # delete only one contributor's takes
 *
 *  Env:
 *    AFD_PROJECT_ID   (default afd-dev)
 *    AFD_BUCKET       (default afd-dev.firebasestorage.app)
 */

const CONFIRMED  = process.argv.includes("--yes");
const uidArg     = (process.argv.find(a => a.startsWith("--uid=")) || "").split("=")[1] || null;
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const BUCKET     = process.env.AFD_BUCKET     || "afd-dev.firebasestorage.app";
const tag        = CONFIRMED ? "" : "(dry run) ";

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getStorage }   = await import("firebase-admin/storage");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID, storageBucket: BUCKET });
const db     = getFirestore();
const bucket = getStorage().bucket();

console.log(`${tag}reset-corpus · project=${PROJECT_ID} bucket=${BUCKET}` +
            (uidArg ? ` · uid=${uidArg}` : " · ALL contributors"));

/* ---- 1) Firestore recording docs (entry shells are left in place) ---- */
let recCount = 0;
const entries = await db.collection("afd_entries").listDocuments();
for(const entry of entries){
  const col = entry.collection("recordings");
  let refs;
  if(uidArg){
    const snap = await col.where("uid", "==", uidArg).get();
    refs = snap.docs.map(d => d.ref);
  } else {
    refs = await col.listDocuments();
  }
  recCount += refs.length;
  if(!CONFIRMED) continue;
  for(let i = 0; i < refs.length; i += 400){       // Firestore batch cap is 500
    const batch = db.batch();
    refs.slice(i, i + 400).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}
console.log(`${tag}recordings ${CONFIRMED ? "deleted" : "to delete"}: ${recCount}`);

/* ---- 2) Storage audio under afd/ (afd_ui/ is a different prefix, untouched) ---- */
const prefix = uidArg ? `afd/${uidArg}/` : "afd/";
const [files] = await bucket.getFiles({ prefix });
let audioCount = 0;
if(CONFIRMED){
  for(const f of files){
    try{ await f.delete(); audioCount++; }
    catch(e){ console.warn("  storage delete failed:", f.name, e.message); }
  }
} else {
  audioCount = files.length;
}
console.log(`${tag}audio objects under "${prefix}" ${CONFIRMED ? "deleted" : "to delete"}: ${audioCount}`);

console.log(CONFIRMED
  ? `\nDone. Recordings cleared. Entry shells, wordlist, and UI audio untouched.`
  : `\n(dry run — nothing deleted. Re-run with --yes to clear for real.)`);

process.exit(0);
