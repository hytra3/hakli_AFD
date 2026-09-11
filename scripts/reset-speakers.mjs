#!/usr/bin/env node
/*  Audio First Dictionary — reset ONLY the speaker docs (afd_speakers)
 *  ------------------------------------------------------------------
 *  For the {uid} -> {speakerId} re-key. Clears afd_speakers/* and their
 *  /private/* subdocs so the collection rebuilds cleanly under the new
 *  per-speaker keying. Deliberately does NOT touch:
 *    · afd_entries/{id} + recordings  — your prompt corpus (still collecting)
 *    · afd_stewards/{uid}             — contributor profiles
 *    · Storage (audio, avatars)       — untouched
 *
 *  SAFE BY DEFAULT: dry run unless you pass --yes.
 *
 *  Run:
 *    gcloud auth application-default login          # or GOOGLE_APPLICATION_CREDENTIALS
 *    node scripts/reset-speakers.mjs                # dry run — counts only
 *    node scripts/reset-speakers.mjs --yes          # delete the speaker docs
 *
 *  Env:
 *    AFD_PROJECT_ID   (default afd-dev)
 */

const CONFIRMED  = process.argv.includes("--yes");
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const tag        = CONFIRMED ? "" : "(dry run) ";

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

console.log(`${tag}reset-speakers · project=${PROJECT_ID}`);

// listDocuments() also returns refs to "missing" parents that still have a
// /private subcollection, so orphaned subdocs get cleaned up too.
const speakers = await db.collection("afd_speakers").listDocuments();
let docCount = 0, privCount = 0;
for(const s of speakers){
  const priv = await s.collection("private").listDocuments();
  privCount += priv.length;
  docCount++;
  if(!CONFIRMED) continue;
  for(const p of priv) await p.delete();
  await s.delete();
}

console.log(`${tag}${docCount} speaker doc(s), ${privCount} private subdoc(s) ` +
            (CONFIRMED ? "deleted." : "would be removed."));
if(!CONFIRMED) console.log("Re-run with --yes to delete.");
