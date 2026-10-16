#!/usr/bin/env node
/*  Audio First Dictionary — move a recording to the right slot on its word
 *  ----------------------------------------------------------------------
 *  For a take recorded on the wrong tab: the word said twice but filed as the
 *  word's sentence or meaning (the first Dhofar speaker's "sun", 10-16).
 *  Changes ONLY its slot (type / phase) — the audio, the speaker, consent and
 *  everything else stay exactly as they are — and stamps the move on the
 *  recording (refiledFrom, refiledAt, refiledBy) so it can be traced and undone.
 *  The word card's counts update by themselves (the voice-counts function).
 *
 *  Phones can't do this (a recording's slot is fixed by the rules once it's
 *  uploaded); this is the steward's correction, made with the speaker's OK.
 *
 *  Find the id with:  node scripts/word-voices.mjs <word>
 *
 *  Run:
 *    node scripts/refile-take.mjs <recordingId> word            # look first: shows the change, writes nothing
 *    node scripts/refile-take.mjs <recordingId> word --apply    # make it
 *  Slots: word · sentence · meaning
 *  Env: AFD_PROJECT_ID (default afd-dev), AFD_STEWARD (who to stamp; default your gcloud account)
 */
import { execSync } from "node:child_process";

const [id, slotArg] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
const TYPE = { word: "word", sentence: "context", context: "context", meaning: "definition", definition: "definition" }[(slotArg || "").toLowerCase()];
const SLOT = { word: "word", context: "sentence", definition: "meaning" };
if (!id || !TYPE) { console.log("Usage: node scripts/refile-take.mjs <recordingId> <word|sentence|meaning> [--apply]"); process.exit(2); }
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
let by = process.env.AFD_STEWARD || "";
if (!by) { try { by = execSync("gcloud config get-value account", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { by = "steward"; } }

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
await (await import("./lib/preflight.mjs")).preflightOrExit();
const db = getFirestore();

// recording ids are unique; find this one under whichever word it's on
const snaps = (await db.collectionGroup("recordings").get()).docs.filter(d => d.id === id);
if (snaps.length !== 1) { console.log(snaps.length ? `"${id}" matches ${snaps.length} recordings — stopping.` : `No recording "${id}".`); process.exit(1); }
const snap = snaps[0], r = snap.data() || {};
const entry = (await snap.ref.parent.parent.get()).data() || {};
const from = r.type || r.phase || "word";

console.log(`${snap.ref.path}`);
console.log(`  word:     ${entry.gloss || ""} ${entry.glossAr || ""}`);
console.log(`  take:     ${r.capture && r.capture.durationMs ? (r.capture.durationMs / 1000).toFixed(1) + " s" : "?"}` +
            `${r.qc && r.qc.bursts != null ? `, ${r.qc.bursts} bursts` : ""}, speaker ${r.speakerId || "?"}, ${r.allowPlayback ? "public" : "not public"}`);
console.log(`  slot:     ${SLOT[from] || from}  →  ${SLOT[TYPE]}`);
if (from === TYPE) { console.log("  Already in that slot — nothing to do."); process.exit(0); }
if (r.consent === "deleted") { console.log("  This take is erased — leaving it alone."); process.exit(1); }
if (!APPLY) { console.log("\n  (look only) Add --apply to move it."); process.exit(0); }

await snap.ref.update({ type: TYPE, phase: TYPE, refiledFrom: from, refiledAt: FieldValue.serverTimestamp(), refiledBy: by });
console.log(`\n  Moved. ${r.allowPlayback ? "The card's counts update within a few seconds." : ""}`);
