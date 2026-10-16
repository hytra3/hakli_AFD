#!/usr/bin/env node
/*  Audio First Dictionary — one speaker's takes that look like the word, filed elsewhere
 *  ----------------------------------------------------------------------
 *  The recorder used to keep the last word's tab (fixed 10-16), so a speaker
 *  who'd just recorded a sentence or meaning could say the NEXT word and have
 *  it filed as that word's sentence or meaning. This lists everything one
 *  speaker recorded, word by word, and flags the takes that look like the word
 *  said twice — the recorder's word protocol — but sit in another slot:
 *
 *      filed as sentence or meaning · 2 bursts of speech · up to ~4.5 s ·
 *      and no word take of theirs on that word yet
 *
 *  It's a guess from the shape of the audio, so LISTEN before moving: each
 *  flagged line has the word's link. Then --apply moves every flagged take to
 *  the word slot (same change as refile-take.mjs: type/phase only, stamped
 *  refiledFrom/At/By). Without --apply it writes nothing.
 *
 *  Run:
 *    node scripts/find-misfiled.mjs --email someone@example.com
 *    node scripts/find-misfiled.mjs --speaker spk_5pPfA5_01
 *    node scripts/find-misfiled.mjs --email someone@example.com --apply
 *    node scripts/find-misfiled.mjs --email … --apply --skip <id>,<id>   # leave some where they are
 *    node scripts/find-misfiled.mjs --email … --meanings [--apply]      # every meaning on a word with no word take
 *  Env: AFD_PROJECT_ID (default afd-dev), AFD_STEWARD (who to stamp)
 */
import { execSync } from "node:child_process";

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] || "") : ""; };
const EMAIL = arg("--email"), SPEAKER = arg("--speaker");
const APPLY = process.argv.includes("--apply");
const SKIP = new Set(arg("--skip").split(",").map(s => s.trim()).filter(Boolean));
// --meanings: you've listened and her "meanings" ARE the word (the first Dhofar
// speaker, 10-16: every meaning was the word said twice, every sentence a real
// sentence). Flag every MEANING take on a word they have no word take for,
// whatever its length or burst count; sentences are never flagged.
const MEANINGS = process.argv.includes("--meanings");
const MAX_MS = Number(process.env.AFD_WORD_MAX_MS || 4500);
if (!EMAIL && !SPEAKER) { console.log("Usage: node scripts/find-misfiled.mjs --email <address> | --speaker <spk_code> [--meanings] [--apply] [--skip id,id]"); process.exit(2); }
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
let by = process.env.AFD_STEWARD || "";
if (!by) { try { by = execSync("gcloud config get-value account", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { by = "steward"; } }

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
const { getAuth } = await import("firebase-admin/auth");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
await (await import("./lib/preflight.mjs")).preflightOrExit();
const db = getFirestore();

let uid = "";
if (EMAIL) {
  try { uid = (await getAuth().getUserByEmail(EMAIL)).uid; }
  catch { console.log(`No account with the address ${EMAIL}.`); process.exit(1); }
}
const SLOT = { word: "word", context: "sentence", definition: "meaning" };
const typeOf = (r) => r.type || r.phase || "word";

const all = (await db.collectionGroup("recordings").get()).docs
  .map(s => ({ ref: s.ref, id: s.id, entryId: s.ref.parent.parent.id, ...(s.data() || {}) }))
  .filter(r => r.consent !== "deleted")
  .filter(r => (uid ? r.uid === uid : true) && (SPEAKER ? r.speakerId === SPEAKER : true));
if (!all.length) { console.log("No recordings found for that speaker."); process.exit(0); }

const byEntry = new Map();
for (const r of all) { if (!byEntry.has(r.entryId)) byEntry.set(r.entryId, []); byEntry.get(r.entryId).push(r); }

const flagged = [];
console.log(`${all.length} take(s) on ${byEntry.size} word(s)${EMAIL ? " by " + EMAIL : ""}${SPEAKER ? " · speaker " + SPEAKER : ""}\n`);
for (const [entryId, recs] of byEntry) {
  const e = (await db.doc(`afd_entries/${entryId}`).get()).data() || {};
  const hasWord = recs.some(r => typeOf(r) === "word");
  console.log(`${(e.gloss || "") + " " + (e.glossAr || "")}`.trim() + `   https://hakli.app/#${entryId}`);
  for (const r of recs) {
    const t = typeOf(r), ms = (r.capture && r.capture.durationMs) || 0, bursts = r.qc ? r.qc.bursts : null;
    const looksLikeWord = !hasWord && (MEANINGS ? t === "definition"
                                                : (t !== "word" && bursts === 2 && ms > 0 && ms <= MAX_MS));
    if (looksLikeWord && !SKIP.has(r.id)) flagged.push(r);
    console.log(`   ${(SLOT[t] || t).padEnd(9)} ${(ms / 1000).toFixed(1).padStart(4)} s  ${bursts == null ? "?" : bursts} burst${bursts === 1 ? "" : "s"}  ` +
                `${r.allowPlayback ? "public " : "hidden "}  id ${r.id}${looksLikeWord ? (SKIP.has(r.id) ? "   (skipped)" : "   ← looks like the word") : ""}`);
  }
}

console.log(`\n${flagged.length} take(s) ${MEANINGS ? "filed as a meaning on a word with no word take" : "look like the word filed in another slot"}.`);
if (!flagged.length) process.exit(0);
// two flagged takes on one word: only one can be "the word" by this rule of thumb — say so, move both only if asked
const twice = [...new Set(flagged.map(r => r.entryId))].filter(id => flagged.filter(r => r.entryId === id).length > 1);
if (twice.length) console.log(`Note: ${twice.length} word(s) have two flagged takes (both 2-burst and short). Listen to those; --skip the one that isn't the word.`);
if (!APPLY) { console.log("Listen first (open each link, signed in as steward). Then run again with --apply to move them all to the word slot."); process.exit(0); }

for (const r of flagged) {
  await r.ref.update({ type: "word", phase: "word", refiledFrom: typeOf(r), refiledAt: FieldValue.serverTimestamp(), refiledBy: by });
  console.log(`  moved ${r.id} (${r.entryId}): ${SLOT[typeOf(r)]} → word`);
}
console.log("Done. Each word card's counts update within a few seconds.");
