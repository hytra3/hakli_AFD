#!/usr/bin/env node
/*  Audio First Dictionary — seed entry metadata
 *  ------------------------------------------------------------------
 *  Firestore rules forbid the app from writing afd_entries/{id} on purpose
 *  ("entries are seeded from the console / a script, not the app"). This is
 *  that script. It writes one metadata doc per word — gloss, Arabic, domain,
 *  and the pictograph — which `find` shows in the box.
 *
 *  Single source of truth: it reads the WORDS list straight out of index.html,
 *  so you never maintain the vocabulary in two places. Re-run it any time the
 *  wordlist grows; it merges, so it won't clobber fields added elsewhere.
 *
 *  Run (admin creds bypass the read-only rule):
 *    npm i firebase-admin
 *    gcloud auth application-default login        # or set GOOGLE_APPLICATION_CREDENTIALS
 *    node scripts/seed-entries.mjs
 *
 *  Dry run (prints, writes nothing):
 *    node scripts/seed-entries.mjs --dry
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DRY = process.argv.includes("--dry");
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const here = dirname(fileURLToPath(import.meta.url));
const indexPath = join(here, "..", "index.html");

// ---- pull the WORDS array out of index.html (one source of truth) ----
function loadWords(){
  const html = readFileSync(indexPath, "utf8");
  const m = html.match(/const\s+WORDS\s*=\s*(\[[\s\S]*?\])\s*;/);
  if(!m) throw new Error("Could not find `const WORDS = [...]` in index.html");
  // our own file; the literal is a plain array of objects
  const words = Function("return " + m[1])();
  if(!Array.isArray(words) || !words.length) throw new Error("WORDS parsed empty");
  return words;
}

/* Canonical entry identity — MUST match index.html's entryIdFor exactly.
   The app and this seeder both derive ids this way, so a recording always
   lands under the same parent the seeder wrote. Clean ids are unchanged
   ("sun" -> "ent_sun"); only messy ids get normalised. */
function entrySlug(id){
  return String(id)
    .normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g,"_")
    .replace(/^_+|_+$/g,"");
}
const entryIdFor = id => "ent_" + entrySlug(id);

function entryDoc(w){
  return {
    entryId: entryIdFor(w.id),
    gloss:   w.en || "",
    glossAr: w.ar || "",
    domain:  w.dom || "",
    pic:     w.pic || "",         // the pictograph `find` shows in the box
    ref:     w.ref || "",         // rough Hakli transliteration, if noted
    seededAt: new Date().toISOString(),
  };
}

const words = loadWords();
console.log(`Loaded ${words.length} words from index.html`);

if(DRY){
  for(const w of words) console.log("  " + entryIdFor(w.id), JSON.stringify(entryDoc(w)));
  console.log("\n(dry run — nothing written)");
  process.exit(0);
}

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

let n = 0;
for(const w of words){
  const id = entryIdFor(w.id);
  await db.collection("afd_entries").doc(id).set(entryDoc(w), { merge: true });
  n++;
  process.stdout.write(`\r  seeded ${n}/${words.length}  ${id}          `);
}
console.log(`\nDone. ${n} entry docs written to project "${PROJECT_ID}".`);
