/*  Read afd-instance.js from a Node script.
 *  ------------------------------------------------------------------
 *  afd-instance.js is a classic browser script (window.AFDInstance = {...}).
 *  Scripts read the same file, so the instance's language and contact
 *  languages live in exactly one place. Throws if the file or its language
 *  code is missing: a script must never guess which language a record is in.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function readInstance(path = join(root, "afd-instance.js")){
  const js = readFileSync(path, "utf8");
  const m = js.match(/window\.AFDInstance\s*=\s*(\{[\s\S]*\})\s*;/);
  if(!m) throw new Error("Could not find `window.AFDInstance = {...}` in " + path);
  const inst = Function("return " + m[1])();   // our own file; a plain object literal
  if(!inst.language || !inst.language.code) throw new Error(path + " has no language.code");
  return inst;
}
