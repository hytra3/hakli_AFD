#!/usr/bin/env node
/*  Audio First Dictionary — backfill the export-manifest fields
 *  ----------------------------------------------------------------------
 *  #35 made the app write lang / concepts / glosses on new word cards and
 *  lang on new takes, and the embed trigger write sha256 on new uploads.
 *  This adds the same fields to docs written before that, so every record
 *  carries what the export manifest needs.
 *
 *  Adds ONLY missing fields (scripts/lib/manifest-backfill.mjs). A value
 *  already present is never changed, so it is safe to re-run.
 *
 *    word cards   lang (instance default, afd-instance.js), concepts: [],
 *                 glosses built from the old gloss / glossAr
 *    recordings   lang (instance default); sha256 of the stored audio,
 *                 except erased takes awaiting the purge
 *
 *  Dry run by default (reports what it would write). Then --apply.
 *
 *  Run:
 *    gcloud auth application-default login
 *    node scripts/backfill-manifest-fields.mjs             # report only
 *    node scripts/backfill-manifest-fields.mjs --apply     # write
 *    node scripts/backfill-manifest-fields.mjs --no-hash   # skip checksums
 *                                                          # (no audio downloads)
 *  Env:
 *    AFD_PROJECT_ID   (default afd-dev)
 *    AFD_BUCKET       (default afd-dev.firebasestorage.app)
 */
import { createHash } from "node:crypto";
import { readInstance } from "./lib/instance.mjs";
import { planEntry, planRecording } from "./lib/manifest-backfill.mjs";

const APPLY      = process.argv.includes("--apply");
const HASH       = !process.argv.includes("--no-hash");
const VERBOSE    = process.argv.includes("--verbose");
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const BUCKET     = process.env.AFD_BUCKET || "afd-dev.firebasestorage.app";
const tag        = APPLY ? "" : "(dry run) ";

const INSTANCE = readInstance();

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getStorage }   = await import("firebase-admin/storage");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID, storageBucket: BUCKET });
const db = getFirestore();
const bucket = getStorage().bucket();

console.log(`${tag}backfill-manifest-fields · project=${PROJECT_ID} · instance=${INSTANCE.instanceId} lang=${INSTANCE.language.code}${HASH ? "" : " · no checksums"}`);

const c = {
  entries: 0, entriesPatched: 0, entryLang: 0, entryConcepts: 0, entryGlosses: 0, entryNoGloss: 0,
  recs: 0, recsPatched: 0, recLang: 0, hashed: 0, hashSkipped: 0, hashMissingFile: 0,
};
// Transient errors (a slow or dropped connection) are retried a few times;
// anything still failing is counted and reported, never thrown, so the run
// always ends with an honest summary. Re-running picks up whatever is left.
const TRANSIENT = new Set([4 /* DEADLINE_EXCEEDED */, 8 /* RESOURCE_EXHAUSTED */, 10 /* ABORTED */, 14 /* UNAVAILABLE */]);
const failed = [];
const writer = APPLY ? db.bulkWriter() : null;
writer && writer.onWriteError((e) => {
  if(TRANSIENT.has(e.code) && e.failedAttempts < 4){
    console.log(`  retry   ${e.documentRef.path}  (${e.message.split(",")[0]}, attempt ${e.failedAttempts})`);
    return true;
  }
  failed.push(e.documentRef.path);
  console.error(`  FAILED  ${e.documentRef.path}: ${e.message.split(",")[0]}`);
  return false;
});
const write = (ref, patch) => {
  if(VERBOSE || !APPLY) console.log(`  ${APPLY ? "write" : "would write"}  ${ref.path}  ${JSON.stringify(patch)}`);
  if(writer) writer.update(ref, patch).catch(() => {});   // failures are counted in onWriteError
};

// ---- word cards ----
const entries = await db.collection("afd_entries").get();
for(const snap of entries.docs){
  c.entries++;
  const d = snap.data() || {};
  const patch = planEntry(d, INSTANCE);
  if("lang" in patch) c.entryLang++;
  if("concepts" in patch) c.entryConcepts++;
  if("glosses" in patch) c.entryGlosses++;
  else if(!("glosses" in d)) c.entryNoGloss++;          // nothing to build one from
  if(Object.keys(patch).length){ c.entriesPatched++; write(snap.ref, patch); }
}

// ---- recordings ----
const recs = await db.collectionGroup("recordings").get();
for(const snap of recs.docs){
  const entryRef = snap.ref.parent.parent;
  if(!entryRef || entryRef.parent.id !== "afd_entries") continue;   // corpus takes only
  c.recs++;
  const d = snap.data() || {};
  const { patch, needsHash } = planRecording(d, INSTANCE);
  if("lang" in patch) c.recLang++;

  if(needsHash && HASH){
    const file = bucket.file(d.storagePath);
    const [exists] = await file.exists();
    if(!exists){
      c.hashMissingFile++;
      console.log(`  skip    ${snap.ref.path}  (audio ${d.storagePath} not in Storage)`);
    }else{
      const [bytes] = await file.download();
      patch.sha256 = createHash("sha256").update(bytes).digest("hex");
      c.hashed++;
    }
  }else if(needsHash){
    c.hashSkipped++;
  }
  if(Object.keys(patch).length){ c.recsPatched++; write(snap.ref, patch); }
}

if(writer) await writer.close();
const failedEntries = failed.filter((p) => !p.includes("/recordings/")).length;
const failedRecs = failed.length - failedEntries;

console.log(`
${tag}word cards   ${c.entries} read · ${c.entriesPatched - failedEntries} ${APPLY ? "updated" : "to update"}${failedEntries ? ` · ${failedEntries} FAILED` : ""}
               lang ${c.entryLang} · concepts ${c.entryConcepts} · glosses ${c.entryGlosses}${c.entryNoGloss ? ` · ${c.entryNoGloss} with no gloss to build from` : ""}
${tag}recordings   ${c.recs} read · ${c.recsPatched - failedRecs} ${APPLY ? "updated" : "to update"}${failedRecs ? ` · ${failedRecs} FAILED` : ""}
               lang ${c.recLang} · sha256 ${c.hashed}${c.hashMissingFile ? ` · ${c.hashMissingFile} audio missing` : ""}${c.hashSkipped ? ` · ${c.hashSkipped} checksums skipped (--no-hash)` : ""}`);
if(!APPLY) console.log("\n(dry run — nothing written; add --apply to write)");
if(failed.length){
  console.log(`\n${failed.length} write(s) failed. Nothing else was affected; run the same command again to finish.`);
  process.exitCode = 1;
}
