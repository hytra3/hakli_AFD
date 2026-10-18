#!/usr/bin/env node
/*  Audio First Dictionary — join two word cards that are the same word
 *  ----------------------------------------------------------------------
 *  Two cards for one word (e.g. "water" twice: someone added it before Add
 *  asked "Is it one of these?"). This moves every voice on the extra card onto
 *  the one it duplicates, then hides the extra card. Nobody's consent changes;
 *  the audio isn't copied. The card you keep keeps its own picture, and gets
 *  the other's only where it has none. Details: scripts/lib/join.mjs.
 *
 *  It can be undone (--undo): moved voices remember where they came from, and
 *  the hidden card stays (the nightly purge leaves joined cards alone).
 *
 *  Run (look first — without --apply nothing is written):
 *    gcloud auth application-default login
 *    node scripts/join-words.mjs water                   # list every card called "water", with ids
 *    node scripts/join-words.mjs 💧                      # …or every card with that picture
 *    node scripts/join-words.mjs --all                   # every card, contributed ones first
 *    node scripts/join-words.mjs <extra> <keep>          # the plan: what moves where
 *    node scripts/join-words.mjs <extra> <keep> --apply  # do it
 *    node scripts/join-words.mjs --undo <extra>          # the plan to put it back
 *    node scripts/join-words.mjs --undo <extra> --apply  # put it back
 *  <extra> / <keep>: an entry id (ent_…) or what the word is called, when that
 *  names only one card. The extra card must be a contributed one; built-in
 *  words (the list the app ships with) are only ever kept.
 *
 *  Before the first --apply: redeploy the purge (bash scripts/deploy-purge.sh)
 *  so it knows to leave joined cards alone.
 *
 *  Env: AFD_PROJECT_ID (default afd-dev), AFD_BUCKET (default
 *  afd-dev.firebasestorage.app), AFD_STEWARD (who to stamp; default your gcloud account)
 */
import { execSync } from "node:child_process";
import { findWords, planJoin, applyJoin, undoJoin } from "./lib/join.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply"), UNDO = args.includes("--undo"), ALL = args.includes("--all");
const words = args.filter(a => !a.startsWith("--"));
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const BUCKET = process.env.AFD_BUCKET || "afd-dev.firebasestorage.app";
let by = process.env.AFD_STEWARD || "";
if (!by) { try { by = execSync("gcloud config get-value account", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { by = "steward"; } }
if ((!words.length && !ALL) || (UNDO && words.length !== 1) || (!UNDO && words.length > 2)) {
  console.log("Usage:\n  node scripts/join-words.mjs <word>                    list cards called that\n" +
              "  node scripts/join-words.mjs <extra> <keep> [--apply]   join\n" +
              "  node scripts/join-words.mjs --undo <extra> [--apply]   undo a join");
  process.exit(2);
}

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
const { getStorage } = await import("firebase-admin/storage");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID, storageBucket: BUCKET });
await (await import("./lib/preflight.mjs")).preflightOrExit();
const db = getFirestore(), bucket = getStorage().bucket();

const entries = (await db.collection("afd_entries").get()).docs.map(d => ({ id: d.id, data: d.data() || {} }));
const label = (e) => [e.data.pic, e.data.gloss || (e.data.glosses && e.data.glosses.en), e.data.glossAr].filter(Boolean).join(" ") || "(no name)";
async function describe(e){
  const recs = (await db.collection(`afd_entries/${e.id}/recordings`).get()).docs.map(d => d.data() || {});
  const live = recs.filter(r => r.consent !== "deleted");
  const kinds = ["word", "context", "definition"].map(t => live.filter(r => (r.type || r.phase || "word") === t).length);
  const when = e.data.createdAt && e.data.createdAt.toDate ? e.data.createdAt.toDate().toISOString().slice(0, 10) : "";
  const state = e.data.joinedInto ? `joined into ${e.data.joinedInto}` : e.data.removedAt ? "removed" : e.data.hiddenAt ? "hidden" : "";
  return `  ${e.id.padEnd(24)} ${label(e)}\n` +
         `      ${e.data.source === "user" ? "contributed" + (when ? " " + when : "") : "built-in"} · voices: ${kinds[0]} word, ${kinds[1]} sentence, ${kinds[2]} meaning` +
         `${live.some(r => r.allowPlayback) ? "" : live.length ? " (none public)" : ""}${e.data.image ? " · photo" : ""}${state ? " · " + state : ""}`;
}
function one(q){
  const m = findWords(q, entries);
  if (m.length === 1) return m[0];
  console.log(m.length ? `"${q}" names ${m.length} cards — use an id:` : `No card "${q}".`);
  return null;
}

if (ALL) {
  const list = entries.filter(e => !e.data.joinedInto)
    .sort((a, b) => ((b.data.source === "user") - (a.data.source === "user")) || label(a).localeCompare(label(b)));
  console.log(`All ${list.length} cards (contributed first):\n`);
  for (const e of list) console.log(await describe(e));
  process.exit(0);
}

if (!UNDO && words.length === 1) {
  const m = findWords(words[0], entries);
  if (!m.length) { console.log(`No card "${words[0]}". Try its picture (e.g. 💧) or part of its Arabic name.`); process.exit(1); }
  console.log(`Cards called "${words[0]}":\n`);
  for (const e of m) console.log(await describe(e) + "\n");
  if (m.length > 1) {
    const builtIn = m.find(e => e.data.source !== "user");
    console.log(`To join one into another: node scripts/join-words.mjs <extra id> <keep id>` +
                (builtIn ? `\n(keep the built-in ${builtIn.id})` : ""));
  }
  process.exit(0);
}

if (UNDO) {
  const e = one(words[0]); if (!e) process.exit(1);
  if (!e.data.joinedInto) { console.log(`${e.id} isn't joined into anything.`); process.exit(1); }
  const n = (await db.collection(`afd_entries/${e.data.joinedInto}/recordings`).where("joinedFrom.entryId", "==", e.id).get()).size;
  console.log(`Undo: ${e.id} (${label(e)}) was joined into ${e.data.joinedInto}.`);
  console.log(`  ${n} voice(s) go back to ${e.id}; it shows in the dictionary again.`);
  if ((e.data.joinedFace || []).length) console.log(`  ${e.data.joinedInto} loses what it took from it (${e.data.joinedFace.join(", ")}) if unchanged since.`);
  if (!APPLY) { console.log("\n  (look only) Add --apply to undo it."); process.exit(0); }
  const r = await undoJoin(db, bucket, e.id, by, FieldValue.delete());
  console.log(`\n  Done: ${r.voices} voice(s) back on ${e.id}. Counts and search update within a few minutes.`);
  process.exit(0);
}

const from = one(words[0]); if (!from) process.exit(1);
const into = one(words[1]); if (!into) process.exit(1);
const plan = await planJoin(db, from.id, into.id);
console.log(`Join: the extra card\n${await describe(from)}\ninto the card to keep\n${await describe(into)}\n`);
if (plan.problems.length) { console.log("Can't join:\n  · " + plan.problems.join("\n  · ")); process.exit(1); }
const byKind = (t) => plan.recs.filter(r => (r.data.type || r.data.phase || "word") === t && r.data.consent !== "deleted").length;
console.log(`  ${plan.recs.length} recording(s) move: ${byKind("word")} word, ${byKind("context")} sentence, ${byKind("definition")} meaning` +
            `${plan.recs.some(r => r.data.consent === "deleted") ? " (+ erased ones, still waiting for the purge)" : ""}.`);
console.log(`  Each keeps its speaker, owner and consent exactly as now.`);
if (plan.spells.length) console.log(`  ${plan.spells.length} Hakli spelling(s) copied over.`);
if (plan.keptSpells.length) console.log(`  ${plan.keptSpells.length} writer(s) already spelled it on ${into.id} — theirs is kept.`);
console.log(Object.keys(plan.face).length
  ? `  ${into.id} has no ${Object.keys(plan.face).join(", ")} — takes ${from.id}'s.`
  : `  ${into.id} keeps its own picture and names.`);
console.log(`  ${from.id} is hidden (not deleted) and marked as joined; --undo puts it back.`);
if (!APPLY) { console.log("\n  (look only) Add --apply to join them."); process.exit(0); }
const notes = await applyJoin(db, bucket, plan, by);
for (const n of notes) console.log("  note: " + n);
console.log(`\n  Joined. Counts update within seconds; search picks it up within 5 minutes (or bash scripts/reindex.sh).`);
