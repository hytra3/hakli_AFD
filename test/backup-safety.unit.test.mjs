// The community backup is encrypted (age), an empty archive isn't written, and
// the scripts say quickly and clearly when Google can't be reached.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ZipWriter } from "../scripts/lib/zip.mjs";
import { ageAvailable, encryptTo, decryptWithIdentity, BACKUPS_README } from "../scripts/lib/encrypt.mjs";
import { checkGoogle } from "../scripts/lib/preflight.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "afd-safe-"));
const sampleZip = () => {
  const z = new ZipWriter();
  z.add("manifest.json", Buffer.from('{"v":1}'), new Date("2026-10-15T12:00:00Z"));
  z.add("speakers.jsonl", Buffer.from('{"speakerId":"spk_x","origin":{"town":"Taqah"}}\n'), new Date("2026-10-15T12:00:00Z"));
  z.close(); return z.buffer();
};

describe("zip in memory", () => {
  it("is byte-for-byte the zip a file would hold", () => {
    const d = tmp(), p = join(d, "a.zip"), when = new Date("2026-10-15T12:00:00Z");
    const f = new ZipWriter(p); f.add("x.txt", Buffer.from("hello"), when); f.close();
    const m = new ZipWriter();  m.add("x.txt", Buffer.from("hello"), when); m.close();
    assert.deepEqual(m.buffer(), readFileSync(p));
  });
});

describe("encrypted backup (age)", { skip: !ageAvailable() && "age not installed" }, () => {
  it("encrypts, and only the key opens it, giving back the same zip", async () => {
    const d = tmp(), id = join(d, "key.txt");
    assert.equal(spawnSync("age-keygen", ["-o", id]).status, 0);
    const pub = readFileSync(id, "utf8").match(/public key: (age1\w+)/)[1];
    const zip = sampleZip(), out = join(d, "hakli_community_2026-10-15.afd.zip.age");
    await encryptTo(out, zip, { recipients: [pub] });
    const enc = readFileSync(out);
    assert.ok(enc.toString("latin1").startsWith("age-encryption.org/v1"), "an age file");
    assert.ok(!enc.includes(Buffer.from("Taqah")) && !enc.includes(Buffer.from("speakers.jsonl")), "nothing readable inside");
    assert.deepEqual(decryptWithIdentity(out, id), zip);
    assert.deepEqual(readdirSync(d).sort(), ["hakli_community_2026-10-15.afd.zip.age", "key.txt"], "no .part or plain zip left behind");
  });
  it("when age fails, nothing is left behind", async () => {
    const d = tmp(), out = join(d, "b.afd.zip.age");
    await assert.rejects(encryptTo(out, sampleZip(), { recipients: ["not-a-key"] }), /nothing was written/);
    assert.deepEqual(readdirSync(d), []);
  });
  it("with a passphrase, age asks on the terminal and the file opens with it", { skip: !existsSync("/usr/bin/python3") && "python3 needed for a terminal" }, () => {
    // drive the real CLI path (age -p) through a pseudo-terminal
    const d = tmp(), out = join(d, "c.afd.zip.age"), zipPath = join(d, "in.zip");
    writeFileSync(zipPath, sampleZip());
    const driver = `
import os, pty, sys, time
out, src = sys.argv[1], sys.argv[2]
pid, fd = pty.fork()
if pid == 0:
    os.execvp("node", ["node", "--input-type=module", "-e",
      "import {encryptTo} from '${new URL("../scripts/lib/encrypt.mjs", import.meta.url).pathname}';"
      "import {readFileSync} from 'node:fs';"
      "await encryptTo(process.argv[1], readFileSync(process.argv[2]));", out, src])
buf = b""
def until(s, t=15):
    global buf
    end = time.time() + t
    while s not in buf and time.time() < end:
        try: buf += os.read(fd, 1024)
        except OSError: break
for _ in range(2):
    until(b"assphrase")
    os.write(fd, b"correct horse battery\\n"); buf = b""
os.waitpid(pid, 0)
`;
    const r = spawnSync("python3", ["-c", driver, out, zipPath], { encoding: "utf8", timeout: 60000 });
    assert.ok(existsSync(out), "encrypted file written: " + r.stderr);
    const dec = `
import os, pty, sys
pid, fd = pty.fork()
if pid == 0: os.execvp("age", ["age", "-d", "-o", sys.argv[2], sys.argv[1]])
buf=b""
while b"assphrase" not in buf: buf += os.read(fd, 1024)
os.write(fd, b"correct horse battery\\n")
try:
    while os.read(fd, 1024): pass
except OSError: pass
os.waitpid(pid, 0)
`;
    spawnSync("python3", ["-c", dec, out, join(d, "back.zip")], { timeout: 60000 });
    assert.deepEqual(readFileSync(join(d, "back.zip")), readFileSync(zipPath));
  });
  it("the folder README says how to open and check a backup, and to keep the passphrase", () => {
    assert.match(BACKUPS_README, /age -d -o backup\.zip/);
    assert.match(BACKUPS_README, /sha256sum -c checksums\.sha256/);
    assert.match(BACKUPS_README, /password manager/);
  });
});

describe("reaching Google", () => {
  // CI runs every test file inside the emulators (firebase emulators:exec), which
  // sets FIRESTORE_EMULATOR_HOST — and checkGoogle rightly skips itself then. So
  // these tests clear it while they run, or they never see the errors they test.
  let savedEmu;
  before(() => { savedEmu = process.env.FIRESTORE_EMULATOR_HOST; delete process.env.FIRESTORE_EMULATOR_HOST; });
  after(() => { if(savedEmu !== undefined) process.env.FIRESTORE_EMULATOR_HOST = savedEmu; });
  it("talking to the emulator: no check at all", async () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    try{ await checkGoogle({ probe: () => { throw new Error("should not probe"); }, token: async () => { throw new Error("no"); } }); }
    finally{ delete process.env.FIRESTORE_EMULATOR_HOST; }
  });
  const okToken = async () => ({ access_token: "t" });
  it("network down: says so quickly, with the IPv4 fix", async () => {
    const saved = process.env.NODE_OPTIONS; delete process.env.NODE_OPTIONS;
    const t0 = Date.now();
    await assert.rejects(checkGoogle({ probe: () => new Promise(() => {}), token: okToken, timeoutMs: 300 }),
      (e) => /Can't reach Google/.test(e.message) && /ipv4first/.test(e.message));
    assert.ok(Date.now() - t0 < 2000);
    if(saved !== undefined) process.env.NODE_OPTIONS = saved;
  });
  it("the IPv4 hint is left out once it's already set", async () => {
    const saved = process.env.NODE_OPTIONS; process.env.NODE_OPTIONS = "--dns-result-order=ipv4first";
    await assert.rejects(checkGoogle({ probe: async () => { throw Object.assign(new Error("x"), { code: "ENOTFOUND" }); }, token: okToken }),
      (e) => /ENOTFOUND/.test(e.message) && !/export NODE_OPTIONS/.test(e.message));
    if(saved === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = saved;
  });
  it("reachable but not signed in: says to run gcloud auth", async () => {
    await assert.rejects(checkGoogle({ probe: async () => 404, token: async () => { throw new Error("Could not load the default credentials"); } }),
      /gcloud auth application-default login/);
  });
  it("reachable and signed in: carries on", async () => {
    await checkGoogle({ probe: async () => 404, token: okToken });
  });
});
