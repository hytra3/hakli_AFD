// Runs the browser test files one after another and prints one tally.
//   node browser/run.mjs            all files
//   node browser/run.mjs search     just browser/search.browser.mjs
// A file that fails is run once more: a headless browser on a busy machine can
// be a moment late, and one late wait should not fail a pull request. A file
// that fails twice fails the run; a file that only passed on the second try is
// named, so a check that is flaky — or a bug that only shows sometimes — is seen.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const all = fs.readdirSync(here).filter(f => f.endsWith(".browser.mjs")).sort();
const want = process.argv.slice(2);
const files = want.length ? all.filter(f => want.some(w => f.startsWith(w))) : all;
if(!files.length){ console.error("No test file matches: " + want.join(", ") + "\nHave: " + all.join(", ")); process.exit(2); }

const tally = (out)=>{ const m = /(\d+)\/(\d+) passed\s*$/.exec(out.trim()); return m ? { pass:+m[1], total:+m[2] } : null; };
const run = (f)=>{ const r = spawnSync(process.execPath, [path.join(here, f)], { encoding:"utf8", timeout: 15*60*1000 });
  return { out: (r.stdout||"") + (r.stderr||""), code: r.status === null ? 1 : r.status }; };

let failed = [], retried = [], checks = 0;
for(const f of files){
  console.log("\n━━ " + f);
  let r = run(f); process.stdout.write(r.out);
  if(r.code !== 0){
    console.log("\n   ↻ " + f + " failed — running it once more");
    r = run(f); process.stdout.write(r.out);
    if(r.code === 0) retried.push(f);
  }
  const t = tally(r.out); if(t) checks += t.pass;
  if(r.code !== 0 || !t) failed.push(f);
}
console.log("\n━━ " + (files.length - failed.length) + "/" + files.length + " files passed · " + checks + " checks");
if(retried.length) console.log("   passed only on the second try: " + retried.join(", "));
if(failed.length){ console.log("   FAILED: " + failed.join(", ")); process.exit(1); }
