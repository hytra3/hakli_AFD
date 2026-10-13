#!/usr/bin/env node
/*  Audio First Dictionary — export a package (.afd.zip)
 *  ------------------------------------------------------------------
 *  Writes the dictionary into one zip laid out as the export manifest spec
 *  describes (manifest.json, instance.json, *.jsonl records, the audio and
 *  image files, checksums.sha256, a README). See scripts/lib/export.mjs for
 *  exactly what each profile includes.
 *
 *  Profiles so far:
 *    community   the full private backup: everything needed to restore or move
 *                the dictionary, withdrawn voices and speakers' private details
 *                included. Never publish it.
 *
 *  The zip is written OUTSIDE the repo (default ~/afd-exports/), so a publish
 *  can never sweep it into git.
 *
 *  Run:
 *    gcloud auth application-default login
 *    node scripts/export-package.mjs                     # community backup
 *    node scripts/export-package.mjs --dry               # count only, write nothing
 *    node scripts/export-package.mjs --out ~/backups     # another folder
 *  Then check it:
 *    cd ~/afd-exports && mkdir t && cd t && unzip -q ../hakli_community_*.afd.zip && sha256sum -c checksums.sha256
 *  Env:
 *    AFD_PROJECT_ID (default afd-dev) · AFD_BUCKET (default afd-dev.firebasestorage.app)
 */
import { readFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { readInstance } from "./lib/instance.mjs";
import { buildPackage } from "./lib/export.mjs";
import { ZipWriter } from "./lib/zip.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DRY = args.includes("--dry");
const PROFILE = opt("--profile", "community");
const OUT = resolve(opt("--out", join(homedir(), "afd-exports")).replace(/^~/, homedir()));
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const BUCKET = process.env.AFD_BUCKET || "afd-dev.firebasestorage.app";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
if(!DRY && (OUT + "/").startsWith(resolve(repo) + "/")){
  console.error(`Refusing to write inside the repo (${OUT}): a publish would commit it. Use --out somewhere else.`);
  process.exit(1);
}
const instance = readInstance();
const concepts = JSON.parse(readFileSync(join(repo, "data", "concepts.json"), "utf8"));
let commit = "";
try{ commit = execSync("git rev-parse --short HEAD", { cwd: repo }).toString().trim(); }catch(_){}

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getStorage } = await import("firebase-admin/storage");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID, storageBucket: BUCKET });

const now = new Date();
console.log(`export · ${PROFILE} · project=${PROJECT_ID}${DRY ? " · dry run" : ""}`);
const { files, summary, warnings } = await buildPackage({
  db: getFirestore(), bucket: getStorage().bucket(), instance, concepts, profile: PROFILE, now,
  generator: `scripts/export-package.mjs ${commit}`.trim() });

const bytes = files.reduce((n, f) => n + f.data.length, 0);
console.log(`  word cards ${summary.entries} · recordings ${summary.recordings} (${summary.recordingsWithdrawn} withdrawn, ${summary.recordingsErasedSkipped} erased left out)`);
console.log(`  speakers ${summary.speakers} · consent audio ${summary.consentAudio} · withdrawal audio ${summary.withdrawalAudio}`);
console.log(`  audio ${summary.audio} · photos ${summary.images} · avatars ${summary.avatars} · prompts ${summary.prompts} (${summary.promptAudio} recorded)`);
console.log(`  ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
for(const w of warnings) console.log(`  ⚠ ${w}`);

if(DRY){ console.log("\n(dry run — nothing written)"); process.exit(0); }
mkdirSync(OUT, { recursive: true });
const name = `${instance.instanceId}_${PROFILE}_${now.toISOString().slice(0, 10)}.afd.zip`;
const final = join(OUT, name), part = final + ".part";
const zip = new ZipWriter(part);
for(const f of files) zip.add(f.name, f.data, now);
zip.close();
renameSync(part, final);                       // a half-written zip never carries the final name
console.log(`\nWrote ${final} (${(statSync(final).size / 1048576).toFixed(1)} MB)`);
console.log("PRIVATE: withdrawn voices and speakers' private details are inside. Keep it safe; don't publish it.");
