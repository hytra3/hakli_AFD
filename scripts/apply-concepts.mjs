#!/usr/bin/env node
/*  Audio First Dictionary — review and apply concept links
 *  ------------------------------------------------------------------
 *  data/concepts.json holds a proposed concept for each seeded word card
 *  (Concepticon IDs, or a local concept where Concepticon has none). Nothing
 *  goes onto a card until a steward confirms it here.
 *
 *  1. Review: each proposal is shown with its Concepticon gloss, field and any
 *     note. Answer
 *        y           confirm it
 *        n           no concept fits this card
 *        559 560     these Concepticon numbers instead (one or several)
 *        local:hakli/barber   a local concept (can be mixed with numbers)
 *        s / Enter   decide later
 *     Each answer is saved to data/concepts.json straight away, so you can stop
 *     any time and carry on later. Git is the record: `git diff` shows your
 *     decisions.
 *  2. Apply: confirmed links are written to each card's `concepts` field
 *     (only where the card doesn't already match). Safe to re-run.
 *
 *  Run:
 *    gcloud auth application-default login
 *    node scripts/apply-concepts.mjs              # review, then apply
 *    node scripts/apply-concepts.mjs --review     # review only (works offline)
 *    node scripts/apply-concepts.mjs --apply      # apply only, no questions
 *    node scripts/apply-concepts.mjs --dry        # show everything, change nothing
 *  Env:
 *    AFD_PROJECT_ID   (default afd-dev)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { describe, parseAnswer, planWrites } from "./lib/concepts.mjs";
import { preflightOrExit } from "./lib/preflight.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const REVIEW = !args.includes("--apply");
const APPLY = !args.includes("--review");
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";

const here = dirname(fileURLToPath(import.meta.url));
const linksPath = join(here, "..", "data", "concepts.json");
const data = JSON.parse(readFileSync(linksPath, "utf8"));
const { concepts: index, source } = JSON.parse(readFileSync(join(here, "..", "data", "concepticon.json"), "utf8"));
const save = () => { if(!DRY) writeFileSync(linksPath, JSON.stringify(data, null, 1) + "\n"); };

console.log(`Concept links · Concepticon ${source.commit} (${source.date}) · ${Object.keys(data.links).length} cards${DRY ? " · dry run" : ""}`);

// ---- 1. review ----
if(REVIEW){
  const todo = Object.entries(data.links).filter(([, l]) => l.status === "proposed");
  console.log(`${todo.length} to review.\n`);
  // Read answers line by line (works typed or piped). End of input stops the review.
  const rl = DRY ? null : createInterface({ input: process.stdin, terminal: false });
  const lines = rl ? rl[Symbol.asyncIterator]() : null;
  const ask = async (q) => { process.stdout.write(q); const r = await lines.next(); if(r.done) return null; if(!process.stdin.isTTY) process.stdout.write(r.value + "\n"); return r.value; };
  let n = 0, stopped = false;
  for(const [entryId, l] of todo){
    if(stopped) break;
    n++;
    console.log(`[${n}/${todo.length}] ${l.en}  ${l.ar}   (${entryId})`);
    for(const id of l.propose) console.log(`    → ${describe(id, index, data.local)}`);
    for(const id of l.propose){
      const m = /^concepticon:(\d+)$/.exec(id);
      if(m && index[m[1]] && index[m[1]][2]) console.log(`      ${index[m[1]][2]}`);
    }
    if(l.note) console.log(`    note: ${l.note}`);
    if(DRY){ console.log(""); continue; }
    for(;;){
      const ans = await ask("    y / n / numbers / s (s): ");
      if(ans === null){ stopped = true; console.log("\n    (stopped — your answers so far are saved)"); break; }
      const r = parseAnswer(ans, l.propose, index);
      if(r.error){ console.log("    " + r.error); continue; }
      if(r.action === "skip"){ console.log("    skipped\n"); break; }
      l.status = r.action === "none" ? "none" : "confirmed";
      l.concepts = r.concepts;
      l.decidedAt = new Date().toISOString().slice(0, 10);
      save();
      console.log(r.action === "none" ? "    no concept\n" : "    ✓ " + r.concepts.map(id => describe(id, index, data.local)).join("; ") + "\n");
      break;
    }
  }
  if(rl) rl.close();
}

// ---- 2. apply ----
if(APPLY){
  const decided = Object.values(data.links).filter(l => l.status === "confirmed" || l.status === "none").length;
  if(!decided){ console.log("Nothing confirmed yet — nothing to apply."); process.exit(0); }
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  await preflightOrExit();   // fail fast, with what to do, if Google is unreachable or not signed in
  const db = getFirestore();
  const current = {};
  for(const entryId of Object.keys(data.links)){
    const snap = await db.collection("afd_entries").doc(entryId).get();
    if(snap.exists) current[entryId] = (snap.data() || {}).concepts || [];
  }
  const writes = planWrites(data.links, current);
  const missing = Object.keys(data.links).filter(id => !(id in current));
  for(const w of writes) console.log(`  ${DRY ? "would write" : "write"}  afd_entries/${w.entryId}  concepts=${JSON.stringify(w.concepts)}`);
  if(!DRY) for(const w of writes) await db.collection("afd_entries").doc(w.entryId).update({ concepts: w.concepts });
  console.log(`\n${decided} decided · ${writes.length} card(s) ${DRY ? "to update" : "updated"}` +
              (missing.length ? ` · ${missing.length} not in Firestore: ${missing.join(", ")}` : ""));
}
