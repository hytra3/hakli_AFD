/*  Encrypt a backup with age (https://age-encryption.org), a small, widely
 *  used encryption tool: `sudo apt install age`.
 *
 *  With a passphrase, age asks for it itself, on the terminal; it never passes
 *  through this script. Leave it empty and age makes up a strong one and
 *  prints it — put it straight into the password manager.
 *  With recipients (age public keys, "age1…"), no question is asked.
 *
 *  The zip goes to age through a pipe, so the unencrypted backup never
 *  touches the disk.
 *
 *  Decrypt:  age -d -o backup.zip hakli_community_….afd.zip.age
 */
import { spawn, spawnSync } from "node:child_process";
import { openSync, closeSync, renameSync, rmSync } from "node:fs";

export function ageAvailable(){
  try{ return spawnSync("age", ["--version"], { stdio: "ignore" }).status === 0; }catch(_){ return false; }
}

/** Encrypt `data` (a Buffer) into `outPath`, atomically: written to
 *  `outPath.part`, renamed only when age finishes cleanly.
 *  recipients: [] → passphrase (age asks on the terminal). */
export function encryptTo(outPath, data, { recipients = [] } = {}){
  const part = outPath + ".part";
  const args = recipients.length ? recipients.flatMap(r => ["-r", r]) : ["-p"];
  const fd = openSync(part, "w");
  return new Promise((resolve, reject) => {
    const child = spawn("age", args, { stdio: ["pipe", fd, "inherit"] });
    child.on("error", (e) => { closeSync(fd); rmSync(part, { force: true }); reject(e); });
    child.on("close", (code) => {
      closeSync(fd);
      if(code === 0){ renameSync(part, outPath); resolve(outPath); }
      else{ rmSync(part, { force: true }); reject(new Error(`age stopped (exit ${code}) — nothing was written`)); }
    });
    child.stdin.on("error", () => {});          // age exiting early (wrong confirmation) closes the pipe
    child.stdin.end(data);
  });
}

/** For tests and checks: decrypt with an identity file. */
export function decryptWithIdentity(path, identityFile){
  const r = spawnSync("age", ["-d", "-i", identityFile, path]);
  if(r.status !== 0) throw new Error(String(r.stderr));
  return r.stdout;
}

export const BACKUPS_README = `AFD backups (this folder)
=========================

hakli_community_DATE.afd.zip.age
  The full PRIVATE backup: every word card, recording and photo, withdrawn
  voices, and speakers' private details (town, tribe, age, gender).
  Encrypted with age and a passphrase. Never publish it or attach it to email.
  Keep the passphrase in the password manager. Without it the backup can't be
  opened by anyone, including you.

hakli_archive_DATE.afd.zip
  A deposit for a language archive: only speakers who agreed to archiving and
  recorded spoken consent. Not encrypted (the archive must open it). Speaker
  details inside are marked RESTRICTED.

Open and check a backup
  mkdir -p /tmp/afd-check && cd /tmp/afd-check
  age -d -o backup.zip ~/afd-exports/hakli_community_DATE.afd.zip.age
  unzip -q backup.zip && sha256sum -c checksums.sha256
  cd ~ && rm -rf /tmp/afd-check        # don't leave the opened copy lying around

Install age if it's missing:  sudo apt install age
`;
