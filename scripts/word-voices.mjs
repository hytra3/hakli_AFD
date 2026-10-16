#!/usr/bin/env node
/*  Audio First Dictionary — every recording on one word, whatever its state
 *  ----------------------------------------------------------------------
 *  "A speaker recorded this word but it doesn't show or count" — this lists
 *  ALL recording docs on the word (public, private, withdrawn, erased), with
 *  the slot each one is filed under (word / sentence / meaning), who recorded
 *  it, when, how long it is, and — for spotting a word filed as a sentence —
 *  how many separate bursts of speech it heard (a word is said twice → 2).
 *  It also shows the counts stored on the card (voices) for comparison.
 *
 *  If the speaker's take isn't listed at all, it never uploaded: it's still on
 *  their phone (recorder → "This session", in the same browser they recorded in).
 *
 *  READ-ONLY.
 *
 *  Run:
 *    node scripts/word-voices.mjs sun                 # by English or Arabic gloss
 *    node scripts/word-voices.mjs ent_u_2f3b45cc769f  # or by entry id
 *    node scripts/word-voices.mjs مه
 *  Env: AFD_PROJECT_ID (default afd-dev)
 */
const q = (process.argv[2] || "").trim();
if (!q) { console.log("Usage: node scripts/word-voices.mjs <gloss or entry id>"); process.exit(2); }
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getAuth } = await import("firebase-admin/auth");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
await (await import("./lib/preflight.mjs")).preflightOrExit();
const db = getFirestore();

const ms = (v) => !v ? 0 : typeof v.toMillis === "function" ? v.toMillis() : (Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0);
const when = (t) => t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "?";
// Match the way the app itself matches typed words (AFDCore.spellingKey): no
// diacritics or tatweel, one form each of alef / yeh / heh… — so "مه" finds a
// spelling saved as "مَه" (10-16: the first run found nothing for مه).
import { createRequire } from "node:module";
globalThis.window = globalThis.window || {};
createRequire(import.meta.url)("../afd-core.js");
const KEY = (window.AFDCore && window.AFDCore.spellingKey) || ((s) => String(s || "").trim().toLowerCase());
const norm = (s) => KEY(String(s || ""));

// find the word: an entry id, else any entry whose English / Arabic / Hakli text matches
let entries = [];
if (q.startsWith("ent_")) {
  const sn = await db.doc(`afd_entries/${q}`).get();
  if (sn.exists) entries = [sn];
} else {
  const all = await db.collection("afd_entries").get();
  const ids = new Set(all.docs.filter(d => {
    const x = d.data() || {}, g = x.glosses || {};
    return [x.gloss, x.glossAr, g.en, g.ar].some(v => norm(v) === norm(q));
  }).map(d => d.id));
  // the word written in Hakli letters (afd_entries/{id}/spellings/{writer})
  try{ (await db.collectionGroup("spellings").get()).forEach(sp => {
    const d = sp.data() || {};
    if (norm(d.text) === norm(q) || (d.searchKey && d.searchKey === norm(q).slice(0, 60))) ids.add(sp.ref.parent.parent.id); }); }
  catch(e){ console.warn("  (couldn't read the Hakli spellings: " + (e.code || e.message) + ")"); }
  entries = all.docs.filter(d => ids.has(d.id));
}
if (!entries.length) { console.log(`No word matches "${q}".`); process.exit(1); }

const emails = new Map();
const who = async (uid) => {
  if (!uid) return "?";
  if (!emails.has(uid)) emails.set(uid, getAuth().getUser(uid).then(u => u.email || u.phoneNumber || u.displayName || uid.slice(0, 6) + "…").catch(() => uid.slice(0, 6) + "…"));
  return emails.get(uid);
};
const SLOT = { word: "word", context: "sentence", definition: "meaning" };

for (const e of entries) {
  const x = e.data() || {};
  console.log(`\n${e.id}  ${x.gloss || ""} ${x.glossAr || ""}${x.source === "user" ? "  (contributed)" : ""}${x.removedAt ? "  REMOVED" : ""}${x.hiddenAt ? "  HIDDEN" : ""}`);
  console.log(`  counts on the card (public only): ${x.voices ? `word ${x.voices.word} · sentence ${x.voices.context} · meaning ${x.voices.definition}` : "(none stored yet)"}`);
  const recs = (await e.ref.collection("recordings").get()).docs
    .map(s => ({ id: s.id, ...(s.data() || {}) }))
    .sort((a, b) => (ms(a.uploadedAt) || ms(a.recordedAt)) - (ms(b.uploadedAt) || ms(b.recordedAt)));
  if (!recs.length) { console.log("  no recordings uploaded"); continue; }
  for (const r of recs) {
    const slot = SLOT[r.type || r.phase || "word"] || (r.type || r.phase);
    const state = r.consent === "deleted" ? "ERASED" : r.allowPlayback === true ? "public" : r.consent === "withdrawn" ? "withdrawn" : "PRIVATE";
    const secs = r.capture && r.capture.durationMs ? (r.capture.durationMs / 1000).toFixed(1) + "s" : "?";
    const bursts = r.qc && r.qc.bursts != null ? `${r.qc.bursts} burst${r.qc.bursts === 1 ? "" : "s"}` : "";
    console.log(`  ${slot.padEnd(9)} ${state.padEnd(9)} ${when(ms(r.uploadedAt) || ms(r.recordedAt))}  ${secs.padStart(6)} ${bursts.padEnd(9)} ` +
                `${await who(r.uid)}  speaker ${r.speakerId || "?"}${r.viaAgent ? " (by proxy)" : ""}${r.source === "voicenote" ? " · voice note" : ""}` +
                `${r.refiledFrom ? `  (moved from ${SLOT[r.refiledFrom] || r.refiledFrom})` : ""}\n            id ${r.id}`);
  }
}
console.log("\nA single word said twice is ~2–4 s with 2 bursts. If one of those is filed as a sentence or meaning, it was recorded on the wrong tab —\nmove it with:  node scripts/refile-take.mjs <id> word");
