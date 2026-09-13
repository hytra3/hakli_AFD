#!/usr/bin/env node
/*  Audio First Dictionary — export speaker ORIGINS for dialect analysis
 *  --------------------------------------------------------------------
 *  A one-off analytical export: pairs each speaker's town/tribe (from the
 *  steward-only /private/profile subdoc) with their speaker code and a count
 *  of their usable recordings, so dialect variety can be derived offline. No
 *  live read-role, claim, or in-app exposure — origin stays steward-only in
 *  the rules; this is the deliberate, one-time way it leaves the system.
 *
 *  Runs with the Admin SDK, which BYPASSES security rules — that's how it can
 *  read the private origin at all. The output file therefore CONTAINS origin
 *  data: treat it as the private data it is. It is written to the repo root by
 *  default, and *.csv is gitignored so it can't be committed by accident; share
 *  it only with the people doing the dialect work.
 *
 *  WITHDRAWN DATA IS EXCLUDED, at both levels:
 *    · a speaker whose bulk consent is not "public" (withdrawn or deleted) is
 *      skipped entirely — their voice was pulled, so their origin must not feed
 *      the analysis;
 *    · for the speakers that ARE included, only "public" recordings are counted,
 *      so a withdrawn take never inflates the token count.
 *
 *  Pseudonymous by construction: keyed by speaker code (spk_…), never a name or
 *  account uid — no stewardUid, no displayName is read or written.
 *
 *  Run:
 *    gcloud auth application-default login          # or GOOGLE_APPLICATION_CREDENTIALS
 *    node scripts/export-origins.mjs                # writes ./afd-origins.csv
 *    node scripts/export-origins.mjs out.csv        # custom output path
 *
 *  Env:
 *    AFD_PROJECT_ID   (default afd-dev)
 */

const OUT        = process.argv[2] || "afd-origins.csv";
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { writeFileSync } = await import("node:fs");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

console.log(`export-origins · project=${PROJECT_ID}`);

// CSV cell: quote + double embedded quotes when the value carries a comma,
// quote, or newline; leave plain values bare. Keeps tribe names with commas safe.
const csv = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Tally usable ("public") recordings per speaker in ONE pass over the corpus.
// Index-free on purpose: we read each entry's recordings subcollection directly
// rather than a collection-group query, so no extra index has to be configured.
const recCount = {};
const entries = await db.collection("afd_entries").listDocuments();
for (const e of entries) {
  const recs = await e.collection("recordings").get();
  recs.forEach((r) => {
    const rd = r.data() || {};
    if (rd.consent === "public" && rd.speakerId) {
      recCount[rd.speakerId] = (recCount[rd.speakerId] || 0) + 1;
    }
  });
}

const rows = [["speakerId", "town", "tribe", "ageBand", "gender", "publicRecordings"]];
let included = 0, skippedWithdrawn = 0, skippedNoOrigin = 0;

// listDocuments() also surfaces "missing" parents that still have a /private
// subcollection; snap.exists filters those orphans out.
const speakers = await db.collection("afd_speakers").listDocuments();
for (const s of speakers) {
  const snap = await s.get();
  if (!snap.exists) continue;
  const d = snap.data() || {};
  if (d.consent !== "public") { skippedWithdrawn++; continue; }   // withdrawn/deleted → out

  const profSnap = await s.collection("private").doc("profile").get();
  const origin = profSnap.exists ? ((profSnap.data() || {}).origin || {}) : {};
  const town = (origin.town || "").trim();
  const tribe = (origin.tribe || "").trim();
  if (!town && !tribe) { skippedNoOrigin++; continue; }           // nothing to contribute

  rows.push([s.id, town, tribe, d.ageBand || "", d.gender || "", recCount[s.id] || 0]);
  included++;
}

writeFileSync(OUT, rows.map((r) => r.map(csv).join(",")).join("\n") + "\n");
console.log(`wrote ${OUT}: ${included} speaker(s) with origin`);
console.log(`skipped: ${skippedWithdrawn} withdrawn/deleted, ${skippedNoOrigin} public-but-no-origin`);
