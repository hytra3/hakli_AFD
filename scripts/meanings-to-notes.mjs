#!/usr/bin/env node
/*  Audio First Dictionary — move "meaning" takes into voice notes
 *  -------------------------------------------------------------
 *  Before voice notes existed (11-09), speakers explained words in the meaning
 *  slot ("my father", in Arabic or Hakli). This lists every meaning take, then
 *  moves the ones you name into the voice-notes slot, each with its language.
 *
 *  A move changes the slot (type / phase) and sets `lang`. The audio, speaker,
 *  consent and playback stay as they are. It stamps refiledFrom / refiledAt /
 *  refiledBy so it can be traced, and deletes the take's search vectors
 *  (afd_vectors/{id}), since a note is never a search match. The matcher drops
 *  it within a few minutes (or run scripts/reindex.sh). Card counts update by
 *  themselves.
 *
 *  Run:
 *    node scripts/meanings-to-notes.mjs                       # list every meaning take (writes nothing)
 *    node scripts/meanings-to-notes.mjs --days 3              # only the last 3 days
 *    node scripts/meanings-to-notes.mjs rec_a:ar rec_b:qhk    # show the moves (writes nothing)
 *    node scripts/meanings-to-notes.mjs rec_a:ar rec_b:qhk --apply
 *  Languages: qhk (Hakli) · ar (Arabic) · en (English) · mul (a mix)
 *  A take that is already a voice note: the same command sets or corrects its language.
 *  Undo one:  node scripts/meanings-to-notes.mjs --undo rec_a --apply   (back to meaning; vectors
 *             come back with  node scripts/backfill-embeddings.mjs)
 *  Env: AFD_PROJECT_ID (default afd-dev), AFD_STEWARD (who to stamp; default your gcloud account)
 */
import { execSync } from "node:child_process";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const UNDO = argv.includes("--undo");
const di = argv.indexOf("--days");
const DAYS = di >= 0 ? Number(argv[di + 1]) : 0;
const pairs = argv.filter((a, i) => !a.startsWith("--") && !(di >= 0 && i === di + 1));
const LANGS = { qhk: "Hakli", ar: "Arabic", en: "English", mul: "a mix" };
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
let by = process.env.AFD_STEWARD || "";
if (!by) { try { by = execSync("gcloud config get-value account", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { by = "steward"; } }

const moves = [];
for (const p of pairs) {
  const [id, lang] = p.split(":");
  if (!UNDO && !LANGS[lang]) { console.log(`"${p}": give each take a language — id:qhk, id:ar, id:en or id:mul.`); process.exit(2); }
  moves.push({ id, lang });
}

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
await (await import("./lib/preflight.mjs")).preflightOrExit();
const db = getFirestore();

const ms = (v) => !v ? 0 : typeof v.toMillis === "function" ? v.toMillis() : (Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0);
const when = (t) => t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "?";
const secs = (r) => r.capture && r.capture.durationMs ? (r.capture.durationMs / 1000).toFixed(1) + " s" : "?";
const entries = new Map();
const word = async (ref) => { const id = ref.parent.parent.id;
  if (!entries.has(id)) entries.set(id, ref.parent.parent.get().then(s => s.data() || {}));
  const x = await entries.get(id); return `${x.gloss || id} ${x.glossAr || ""}`.trim(); };

const all = (await db.collectionGroup("recordings").get()).docs;

// ---------------- list ----------------
if (!moves.length) {
  const since = DAYS ? Date.now() - DAYS * 864e5 : 0;
  const rows = all.filter(s => { const r = s.data() || {}; return (r.type || r.phase) === "definition" && r.consent !== "deleted"
      && (ms(r.uploadedAt) || ms(r.recordedAt)) >= since; })
    .sort((a, b) => (ms(b.data().uploadedAt) || 0) - (ms(a.data().uploadedAt) || 0));
  if (!rows.length) { console.log(`No meaning takes${DAYS ? ` in the last ${DAYS} days` : ""}.`); process.exit(0); }
  console.log(`${rows.length} meaning take(s), newest first:\n`);
  for (const s of rows) {
    const r = s.data();
    console.log(`  ${s.id}  ${(await word(s.ref)).padEnd(24)} ${secs(r).padStart(6)}  ${r.speakerId || "?"}  ${when(ms(r.uploadedAt))}  ${r.allowPlayback ? "public" : "not public"}`);
  }
  console.log(`\nListen on the card (hakli.app/index.html#<entry id>), then move the explanations:\n` +
              `  node scripts/meanings-to-notes.mjs <id>:ar <id>:qhk …          (look first)\n` +
              `  … --apply                                                    (make the moves)\n` +
              `Languages: qhk Hakli · ar Arabic · en English · mul a mix. Real meanings: leave them out.`);
  process.exit(0);
}

// ---------------- move (or undo) ----------------
let bad = 0;
for (const m of moves) {
  const hits = all.filter(s => s.id === m.id);
  if (hits.length !== 1) { console.log(`  ${m.id}: ${hits.length ? hits.length + " matches" : "not found"} — skipped`); bad++; continue; }
  const s = hits[0], r = s.data() || {}, from = r.type || r.phase || "word";
  const w = await word(s.ref);
  if (r.consent === "deleted") { console.log(`  ${m.id} ${w}: erased — skipped`); bad++; continue; }
  if (UNDO) {
    if (from !== "note") { console.log(`  ${m.id} ${w}: not a voice note — skipped`); bad++; continue; }
    console.log(`  ${m.id} ${w}: voice note → ${r.refiledFrom === "definition" ? "meaning" : r.refiledFrom || "meaning"}`);
    if (APPLY) await s.ref.update({ type: r.refiledFrom || "definition", phase: r.refiledFrom || "definition", lang: FieldValue.delete(),
      refiledFrom: "note", refiledAt: FieldValue.serverTimestamp(), refiledBy: by });
    continue;
  }
  if (from === "note") {                                // already a note: just set (or correct) its language
    console.log(`  ${m.id} ${w.padEnd(24)} voice note: language ${r.lang ? LANGS[r.lang] || r.lang : "(none)"} → ${LANGS[m.lang]}`);
    if (APPLY) await s.ref.update({ lang: m.lang, langSetBy: by, langSetAt: FieldValue.serverTimestamp() });
    continue;
  }
  if (from !== "definition") { console.log(`  ${m.id} ${w}: it's a ${from}, not a meaning — skipped (use refile-take.mjs)`); bad++; continue; }
  console.log(`  ${m.id} ${w.padEnd(24)} ${secs(r).padStart(6)}  meaning → voice note, ${LANGS[m.lang]}`);
  if (APPLY) {
    const batch = db.batch();
    batch.update(s.ref, { type: "note", phase: "note", lang: m.lang, refiledFrom: from, refiledAt: FieldValue.serverTimestamp(), refiledBy: by });
    batch.delete(db.doc(`afd_vectors/${m.id}`));       // a note is never a search match
    await batch.commit();
  }
}
console.log(APPLY ? `\nDone${bad ? ` (${bad} skipped)` : ""}. ` + (UNDO ? "To make them findable again: node scripts/backfill-embeddings.mjs" : "Search drops the moved takes within a few minutes.")
                  : `\n(look only) Add --apply to make ${moves.length - bad} move(s).`);
