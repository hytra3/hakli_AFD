#!/usr/bin/env node
/*  Audio First Dictionary — after a recording session: are we good?
 *  ---------------------------------------------------------------
 *  Read-only. One look at what a session left behind (11-10):
 *
 *   1. Spoken prompts: which R1 / R2 lines are recorded (and when), and which
 *      the app still plays as text only.
 *   2. Voices uploaded in the last N days, by slot: public or not, and whether
 *      each is searchable (has vectors) the way its slot should be — a word,
 *      sentence or meaning should be; a voice note never.
 *   3. Things to fix: voice notes with no language, meaning takes that may be
 *      explanations (→ scripts/meanings-to-notes.mjs), takes not yet searchable.
 *   4. What failed on phones in the same days (afd_client_errors).
 *
 *  Run:   node scripts/session-check.mjs            # the last 2 days
 *         node scripts/session-check.mjs --days 7
 *  Env:   AFD_PROJECT_ID (default afd-dev)
 */
import { createRequire } from "node:module";

const di = process.argv.indexOf("--days");
const DAYS = di >= 0 ? Number(process.argv[di + 1]) || 2 : 2;
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const since = Date.now() - DAYS * 864e5;

globalThis.window = globalThis.window || {};
createRequire(import.meta.url)("../afd-prompts.js");
const SECTIONS = (window.AFDPrompts || []).filter(s => s.tab === "record");

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
await (await import("./lib/preflight.mjs")).preflightOrExit();
const db = getFirestore();

const ms = (v) => !v ? 0 : typeof v.toMillis === "function" ? v.toMillis() : (Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0);
const when = (t) => t ? new Date(t).toISOString().slice(5, 16).replace("T", " ") : "?";
const head = (t) => console.log(`\n━━ ${t}`);
const issues = [];

// ---------------- 1. spoken prompts ----------------
head("Spoken prompts (prompts tool, Record tab)");
const prompts = new Map((await db.collection("afd_ui_prompts").get()).docs.map(d => [d.id, d.data() || {}]));
let total = 0, done = 0;
SECTIONS.forEach((sec, si) => {
  const items = sec.items || [];
  const rec = items.filter(it => (prompts.get(it.key) || {}).status === "recorded");
  total += items.length; done += rec.length;
  const playedNow = si < 2;                                   // R1 (welcome) and R2 (heard in the app now)
  if (!rec.length && !playedNow) return;
  console.log(`  R${si + 1} ${sec.name}: ${rec.length} of ${items.length}`);
  items.forEach((it, ii) => {
    const p = prompts.get(it.key) || {};
    const ok = p.status === "recorded";
    if (ok || playedNow) console.log(`     ${ok ? "✓" : "·"} R${si + 1}.${ii + 1}  ${it.key.padEnd(18)} ${ok ? when(ms(p.recordedAt)) : "not yet — the app shows text only"}`);
  });
});
const strays = [...prompts.keys()].filter(k => (prompts.get(k).status === "recorded") && !SECTIONS.some(s => (s.items || []).some(it => it.key === k)));
console.log(`  ${done} of ${total} spoken lines recorded.` + (strays.length ? `  Recorded but no longer in the list: ${strays.join(", ")}` : ""));

// ---------------- 2. voices uploaded ----------------
head(`Voices uploaded in the last ${DAYS} day(s)`);
const all = (await db.collectionGroup("recordings").get()).docs;
const recent = all.filter(s => (ms((s.data() || {}).uploadedAt) || ms((s.data() || {}).recordedAt)) >= since && (s.data() || {}).consent !== "deleted");
const vec = new Set();
for (let i = 0; i < recent.length; i += 100) {                // vectors live apart (afd_vectors/{recordingId})
  const refs = recent.slice(i, i + 100).map(s => db.doc(`afd_vectors/${s.id}`));
  if (refs.length) (await db.getAll(...refs)).forEach(v => { if (v.exists) vec.add(v.id); });
}
const entries = new Map();
const word = async (s) => { const id = s.ref.parent.parent.id;
  if (!entries.has(id)) entries.set(id, s.ref.parent.parent.get().then(x => x.data() || {}));
  const x = await entries.get(id); return (x.gloss || id) + (x.glossAr ? " " + x.glossAr : ""); };
const SLOT = { word: "word", context: "sentence", definition: "meaning", note: "voice note" };
const by = {};
for (const s of recent) { const t = (s.data().type || s.data().phase || "word"); (by[t] = by[t] || []).push(s); }
if (!recent.length) console.log("  none");
for (const t of ["word", "context", "definition", "note"]) {
  const list = by[t] || []; if (!list.length) continue;
  const pub = list.filter(s => s.data().allowPlayback).length;
  const searchable = list.filter(s => vec.has(s.id)).length;
  console.log(`  ${SLOT[t].padEnd(10)} ${String(list.length).padStart(3)}  · ${pub} public · ${searchable} searchable`);
}
const speakers = new Set(recent.map(s => s.data().speakerId).filter(Boolean));
const words = new Set(recent.map(s => s.ref.parent.parent.id));
if (recent.length) console.log(`  ${speakers.size} speaker(s), ${words.size} word(s)`);

// ---------------- 3. things to fix ----------------
const ageMin = (s) => (Date.now() - (ms(s.data().uploadedAt) || Date.now())) / 6e4;
for (const s of recent) {
  const r = s.data(), t = r.type || r.phase || "word";
  if (t === "note" && !r.lang) issues.push(`voice note with no language: ${s.id} (${await word(s)}) → node scripts/meanings-to-notes.mjs ${s.id}:<qhk|ar|en|mul> --apply`);
  if (t === "note" && vec.has(s.id)) issues.push(`voice note that is searchable: ${s.id} (${await word(s)}) — was it embedded before the trigger was deployed? delete afd_vectors/${s.id}`);
  if (t !== "note" && r.allowPlayback && r.consent === "public" && !vec.has(s.id) && ageMin(s) > 10)
    issues.push(`not searchable yet: ${SLOT[t]} ${s.id} (${await word(s)}), uploaded ${when(ms(r.uploadedAt))} → node scripts/backfill-embeddings.mjs`);
}
const meanings = (by.definition || []);
if (meanings.length) issues.push(`${meanings.length} meaning take(s) — any that are explanations belong in voice notes: node scripts/meanings-to-notes.mjs --days ${DAYS}`);

// ---------------- 4. phone errors ----------------
head(`What failed on phones in the last ${DAYS} day(s)`);
try {
  const errs = (await db.collection("afd_client_errors").get()).docs.map(d => d.data() || {}).filter(e => ms(e.at) >= since);
  if (!errs.length) console.log("  nothing");
  const g = {};
  errs.forEach(e => { const k = `${e.page || "?"} · ${e.where || "?"} · ${e.code || "?"}`; g[k] = (g[k] || 0) + 1; });
  Object.entries(g).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(3)}×  ${k}`));
  if (errs.length) console.log("  (details: node scripts/client-errors.mjs --days " + DAYS + ")");
} catch (e) { console.log("  couldn't read: " + (e.code || e.message)); }

head("To look at");
if (!issues.length) console.log("  Nothing — we're good.");
issues.forEach(t => console.log("  • " + t));
console.log("");
