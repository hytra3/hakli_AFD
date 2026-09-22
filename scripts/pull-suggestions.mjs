#!/usr/bin/env node
/*  Audio First Dictionary — pull Arabic-edit suggestions
 *  ------------------------------------------------------------------
 *  The prompt tool captures Dhofari-Arabic edit proposals into the
 *  afd_ui_suggestions collection (append-only; nothing goes live on its own).
 *  This is the review/commit step: it reads that queue, shows each proposal
 *  next to the CURRENT source wording, and — for the ones you approve — rewrites
 *  that key's `ar:` straight into the file that owns it:
 *    • spoken-prompt keys (e.g. "record.hold")          → prompts/index.html
 *    • on-screen keys, prefixed "screen:" (e.g. "screen:record.hold")
 *                                                        → afd-core.js (STRINGS)
 *  The prefix is what keeps a spoken prompt and a same-named button label from
 *  being confused. Git stays the source of truth: this only edits your working
 *  tree; you review `git diff` and push (publish-site.sh).
 *
 *  It also tidies stale data on the way past: the leftover `open` field on
 *  afd_ui_config/suggestions (superseded by the openUntil model), and, once you
 *  confirm, the suggestion docs you've applied or declined.
 *
 *  Run (admin creds bypass the notAnon read rule):
 *    npm i firebase-admin
 *    gcloud auth application-default login        # or set GOOGLE_APPLICATION_CREDENTIALS
 *    node scripts/pull-suggestions.mjs
 *
 *  Dry run (prints the queue, writes nothing, deletes nothing):
 *    node scripts/pull-suggestions.mjs --dry
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";

const DRY = process.argv.includes("--dry");
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const here = dirname(fileURLToPath(import.meta.url));
const promptsPath = join(here, "..", "prompts", "index.html");
const corePath    = join(here, "..", "afd-core.js");
const SCREEN = "screen:";

let src  = readFileSync(promptsPath, "utf8");
let core = readFileSync(corePath, "utf8");

// Map key -> current `ar:` by reading the prompt lines (one item per line).
function currentArMap(text){
  const map = {};
  for(const line of text.split(/\r?\n/)){
    const k = line.match(/key:"([^"]+)"/);
    if(!k) continue;
    const a = line.match(/\bar:"([^"]*)"/);
    if(a) map[k[1]] = a[1];
  }
  return map;
}
// Same for afd-core.js STRINGS, whose lines read:  "record.hold": { en:"…", ar:"…" },
// Keys come back prefixed "screen:" so they never collide with prompt keys.
function currentCoreArMap(text){
  const map = {};
  for(const line of text.split(/\r?\n/)){
    const m = line.match(/^\s*"([A-Za-z0-9_.-]+)"\s*:\s*\{.*?\bar:"([^"]*)"/);
    if(m) map[SCREEN + m[1]] = m[2];
  }
  return map;
}
const escAr = v => String(v).replace(/[\r\n]+/g, " ").trim()
                   .replace(/\\/g, "\\\\").replace(/"/g, '\\"');
function applyToCore(key, newAr){
  const bare = key.slice(SCREEN.length), val = escAr(newAr);
  const lines = core.split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    if(lines[i].trimStart().startsWith('"'+bare+'"') && /\bar:"[^"]*"/.test(lines[i])){
      lines[i] = lines[i].replace(/\bar:"[^"]*"/, 'ar:"'+val+'"');
      core = lines.join("\n");
      return true;
    }
  }
  return false;
}
// Rewrite the `ar:` on the single line that declares `key`. Returns false if
// the key (or an ar: on its line) isn't found, so nothing is silently lost.
function applyToSource(key, newAr){
  if(key.startsWith(SCREEN)) return applyToCore(key, newAr);
  const val = escAr(newAr);
  const lines = src.split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    if(lines[i].includes('key:"'+key+'"') && /\bar:"[^"]*"/.test(lines[i])){
      lines[i] = lines[i].replace(/\bar:"[^"]*"/, 'ar:"'+val+'"');
      src = lines.join("\n");
      return true;
    }
  }
  return false;
}

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

// --- tidy: drop the stale `open` field left over from the boolean switch ---
const cfgRef = db.doc("afd_ui_config/suggestions");
const cfgSnap = await cfgRef.get();
if(cfgSnap.exists && cfgSnap.data().open !== undefined){
  if(DRY) console.log("[dry] would remove stale `open` field from afd_ui_config/suggestions");
  else { await cfgRef.update({ open: FieldValue.delete() }); console.log("tidied: removed stale `open` field from afd_ui_config/suggestions"); }
}

// --- read + group the queue ---
const snap = await db.collection("afd_ui_suggestions").get();
const groups = new Map();
snap.forEach(d => {
  const r = { id: d.id, ...d.data() };
  if(!groups.has(r.key)) groups.set(r.key, []);
  groups.get(r.key).push(r);
});
if(groups.size === 0){ console.log("No suggestions in the queue."); process.exit(0); }

const cur = { ...currentArMap(src), ...currentCoreArMap(core) };
const ms   = r => (r.createdAt && r.createdAt.toMillis) ? r.createdAt.toMillis() : 0;
const when = r => { try{ return r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleString() : ""; }catch(_){ return ""; } };

const rl = DRY ? null : createInterface({ input: process.stdin, output: process.stdout });
const applied = [], removed = [];

for(const [key, items] of groups){
  items.sort((a,b)=> ms(b)-ms(a));
  console.log("\n\x1b[2m"+key+"\x1b[0m");
  console.log("  current source: " + (cur[key] ?? "(key not found in " + (key.startsWith(SCREEN) ? "afd-core.js" : "prompts/index.html") + ")"));
  for(const r of items){
    console.log("  ─ suggested:  " + r.arSuggested);
    if(r.arSeen && r.arSeen !== cur[key]) console.log("    (they saw:   " + r.arSeen + ")");
    if(r.note) console.log("    note: " + r.note);
    // On-screen strings carry placeholders the app fills in ({spk}, {n}…). A
    // suggestion that drops or renames one would show a blank or a raw "{n}".
    const need = (String(cur[key]||"").match(/\{[a-z]+\}/g) || []);
    const lost = need.filter(t => !String(r.arSuggested||"").includes(t));
    if(lost.length) console.log("    \x1b[33m! missing placeholder(s) "+lost.join(" ")+" — fix the wording before applying\x1b[0m");
    console.log("    " + when(r) + "  ·  " + String(r.by||"?").slice(0,14));
    if(DRY) continue;
    const ans = (await rl.question("    apply / remove / skip [a/r/s] (s): ")).trim().toLowerCase();
    if(ans === "a" || ans === "apply"){
      if(applyToSource(key, r.arSuggested)){ applied.push(r); console.log("    \u2713 applied to source"); }
      else console.log("    ! couldn't find that key's ar: line — left in queue");
    } else if(ans === "r" || ans === "remove"){
      removed.push(r); console.log("    \u2717 will remove from queue");
    } else {
      console.log("    · skipped");
    }
  }
}

if(DRY){ console.log("\n[dry] "+groups.size+" key(s) in queue; nothing written."); process.exit(0); }

if(applied.length){
  const toCore = applied.filter(r => String(r.key).startsWith(SCREEN)).length;
  const toPrompts = applied.length - toCore;
  if(toPrompts) writeFileSync(promptsPath, src);
  if(toCore)    writeFileSync(corePath, core);
  console.log("\nWrote "+applied.length+" edit(s): "+toPrompts+" into prompts/index.html, "+toCore+" into afd-core.js.");
  console.log("  → review:  git diff prompts/index.html afd-core.js");
  console.log("  → then commit & push to make them live.");
} else {
  console.log("\nNo source edits made.");
}

const processed = [...applied, ...removed];
if(processed.length){
  const ans = (await rl.question("\nRemove "+processed.length+" processed suggestion(s) from the queue now? [y/N]: ")).trim().toLowerCase();
  if(ans === "y" || ans === "yes"){
    for(const r of processed) await db.doc("afd_ui_suggestions/"+r.id).delete();
    console.log("Removed "+processed.length+" from the queue.");
  } else {
    console.log("Left them in the queue.");
  }
}
if(rl) rl.close();
process.exit(0);
