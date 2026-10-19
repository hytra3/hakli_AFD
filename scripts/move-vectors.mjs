#!/usr/bin/env node
/*  Audio First Dictionary — move search vectors off the recordings (one time)
 *  ----------------------------------------------------------------------
 *  Since 10-19 the embed trigger keeps a take's search vectors apart, in
 *  afd_vectors/{recordingId}, which no phone can read. Takes embedded before
 *  that still carry them on the recording doc, so every phone that opens the
 *  word downloads them. This moves them, once. Details: scripts/lib/vectors.mjs.
 *
 *  ORDER: deploy the matcher first (bash scripts/deploy-service.sh) — it reads
 *  both places. This script asks the matcher before --apply and refuses if it's
 *  still the old one (that one would find no vectors, and search would come back
 *  empty). Then the trigger (bash scripts/deploy-trigger.sh), then this.
 *
 *  Run:
 *    gcloud auth application-default login
 *    node scripts/move-vectors.mjs            # look only: how many, how much
 *    node scripts/move-vectors.mjs --apply    # move them (safe to re-run)
 *  Env: AFD_PROJECT_ID (default afd-dev), AFD_EMBED_URL (default the afd-embed service)
 */
import { hasVectors, vectorBytes, moveOne } from "./lib/vectors.mjs";

const APPLY = process.argv.includes("--apply"), SKIP = process.argv.includes("--skip-matcher-check");
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const EMBED_URL = process.env.AFD_EMBED_URL || "https://afd-embed-454829954488.europe-west1.run.app";

async function matcherIsNew(){
  const r = await fetch(`${EMBED_URL}/about`, { signal: AbortSignal.timeout(150000) });
  if(r.status === 404) return false;             // the old matcher has no /about
  if(!r.ok) throw new Error(`matcher answered ${r.status}`);
  return (await r.json()).vectors === "apart";
}

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
await (await import("./lib/preflight.mjs")).preflightOrExit();
const db = getFirestore();

const recs = (await db.collectionGroup("recordings").get()).docs
  .filter((s) => s.ref.parent.parent && s.ref.parent.parent.parent.id === "afd_entries")
  .map((s) => ({ id: s.id, entryId: s.ref.parent.parent.id, ref: s.ref, data: s.data() || {} }));
const todo = recs.filter((r) => hasVectors(r.data));
const kb = Math.round(todo.reduce((n, r) => n + vectorBytes(r.data), 0) / 1024);
console.log(`move-vectors · ${PROJECT_ID}\n  ${recs.length} recordings · ${todo.length} still carry their vectors (~${kb} KB that phones download)`);
if(!todo.length){ console.log("  Nothing to move."); process.exit(0); }
if(!APPLY){ console.log("\n  (look only) Add --apply to move them."); process.exit(0); }

if(!SKIP){
  console.log("  Checking the matcher is the new one (it may take a minute to wake)…");
  let fresh = false;
  try{ fresh = await matcherIsNew(); }catch(e){ console.log(`  Couldn't ask the matcher: ${e.message}`); process.exit(1); }
  if(!fresh){
    console.log("  The matcher is still the old one — it would find no vectors after the move.\n" +
                "  Deploy it first: bash scripts/deploy-service.sh   (then run this again)");
    process.exit(1);
  }
}
let n = 0;
for(const r of todo){
  await moveOne(db, r, FieldValue.delete(), new Date());
  if(++n % 25 === 0) console.log(`  ${n} / ${todo.length}`);
}
console.log(`\n  Moved ${n}. Search keeps working throughout; phones download ~${kb} KB less across these words.`);
