#!/usr/bin/env node
/*  Audio First Dictionary — backfill each word card's voice counts
 *  ----------------------------------------------------------------------
 *  Writes afd_entries/{id}.voices = { word, context, definition } — the
 *  public voices (allowPlayback == true) on each word — the same count the
 *  afd-voice-counts function keeps current from now on. Run once after that
 *  function's first deploy; safe to re-run any time (it recounts).
 *
 *  Run:
 *    gcloud auth application-default login
 *    node scripts/backfill-voice-counts.mjs            # write
 *    node scripts/backfill-voice-counts.mjs --dry-run  # just print
 *
 *  Env: AFD_PROJECT_ID (default afd-dev)
 */
const DRY = process.argv.includes("--dry-run");
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
await (await import("./lib/preflight.mjs")).preflightOrExit();   // fail fast, with what to do, if Google is unreachable or not signed in
const db = getFirestore();

const entries = await db.collection("afd_entries").get();
let n = 0, changed = 0;
for (const e of entries.docs) {
  const counts = { word: 0, context: 0, definition: 0 };
  const recs = await e.ref.collection("recordings").where("allowPlayback", "==", true).get();
  for (const r of recs.docs) {
    const d = r.data() || {};
    const t = d.type || d.phase || "word";
    if (t in counts) counts[t]++;
  }
  const cur = e.get("voices") || {};
  const same = ["word", "context", "definition"].every(k => (cur[k] || 0) === counts[k]) && e.get("voices");
  n++;
  if (same) continue;
  changed++;
  console.log(`  ${e.id.padEnd(28)} ${JSON.stringify(counts)}${DRY ? "  (dry run)" : ""}`);
  if (!DRY) await e.ref.update({ voices: counts, voicesAt: FieldValue.serverTimestamp() });
}
console.log(`\n${n} words checked, ${changed} ${DRY ? "would change" : "updated"} · project ${PROJECT_ID}`);
