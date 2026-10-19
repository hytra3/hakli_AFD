/**
 * Export package — contents, privacy rules and the zip itself (no emulator)
 * ============================================================================
 * Small stand-ins for Firestore and Storage feed scripts/lib/export.mjs; the zip
 * from scripts/lib/zip.mjs is then opened by independent tools (Python's
 * zipfile, unzip, sha256sum) so the format is checked by someone other than us.
 *
 * RUN:  node --test test/export.unit.test.mjs
 * ============================================================================
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buildPackage, plain, MANIFEST_VERSION, archiveSpeakerCode } from "../scripts/lib/export.mjs";
import { ZipWriter } from "../scripts/lib/zip.mjs";
import { readInstance } from "../scripts/lib/instance.mjs";
import { makeWavConverter } from "../scripts/lib/wav.mjs";

const ts = (iso) => ({ toDate: () => new Date(iso) });
const sha = (b) => createHash("sha256").update(b).digest("hex");

// ---- fakes: just the methods export.mjs uses ----
function fakeDb(docs){
  const snap = (path) => {
    const parts = path.split("/"), id = parts.at(-1);
    const ref = { id, path,
      parent: { id: parts.at(-2), parent: parts.length > 2 ? { id: parts.at(-3), parent: { id: parts.at(-4) } } : null },
      collection: (c) => ({ doc: (d) => ({ get: async () => snapOrMissing(`${path}/${c}/${d}`) }) }) };
    // parent.parent must look like the entry's ref: { id, parent: { id: "afd_entries" } }
    if(parts.length === 4) ref.parent.parent = { id: parts[1], parent: { id: parts[0] } };
    return { id, ref, exists: true, data: () => docs[path] };
  };
  const snapOrMissing = (p) => p in docs ? snap(p) : { exists: false, data: () => undefined };
  return {
    collection: (c) => ({ get: async () => ({ docs: Object.keys(docs).filter(p => p.split("/").length === 2 && p.startsWith(c + "/")).map(snap) }),
                          doc: (id) => ({ get: async () => snapOrMissing(`${c}/${id}`) }) }),
    collectionGroup: (c) => ({ get: async () => ({ docs: Object.keys(docs).filter(p => p.split("/").at(-2) === c).map(snap) }) }),
  };
}
function fakeBucket(objects){
  return {
    file: (p) => ({ exists: async () => [p in objects], download: async () => [objects[p]] }),
    getFiles: async ({ prefix }) => [Object.keys(objects).filter(p => p.startsWith(prefix)).map(name => ({ name }))],
  };
}

const A1 = Buffer.from("audio-public"), A2 = Buffer.from("audio-withdrawn"), A3 = Buffer.from("audio-erased");
const DOCS = {
  "afd_entries/ent_sun": { gloss: "sun", glossAr: "الشمس", lang: "qhk", concepts: ["concepticon:1343"], seededAt: "2026-08-01" },
  "afd_entries/ent_u_abc": { source: "user", createdBy: "uA", createdAt: ts("2026-10-01T10:00:00Z"), glossAr: "ماعز", image: "https://x/afd_pics%2FuA%2Fent_u_abc.jpg" },
  "afd_entries/ent_sun/recordings/r_pub": { uid: "uA", speakerId: "spk_uA_01", consent: "public", allowPlayback: true,
     storagePath: "afd/uA/r_pub.webm", sha256: sha(A1), recordedAt: "2026-10-02", embedding: [0.1, 0.2],
     reps: [{ start: 0.1, end: 0.5, vector: [0.1] }], embedModel: "mms-300m", embedLayer: 12, embedPooling: "voiced-per-rep", nReps: 1 },
  "afd_entries/ent_sun/recordings/r_wd": { uid: "uA", speakerId: "spk_uA_01", consent: "withdrawn", allowPlayback: false,
     storagePath: "afd/uA/r_wd.webm", withdrawal: { at: ts("2026-10-03T00:00:00Z"), audioPath: "afd_withdrawals/uA/w1.webm" } },
  "afd_entries/ent_sun/recordings/r_del": { uid: "uA", speakerId: "spk_uA_01", consent: "deleted", storagePath: "afd/uA/r_del.webm" },
  "afd_speakers/spk_uA_01": { stewardUid: "uA", consent: "public", grant: { version: "cv_2026_08", archivalDeposit: true, audioPath: "afd_consents/uA/g1.webm" } },
  "afd_speakers/spk_uA_01/private/profile": { origin: { town: "Taqah", tribe: "T" }, ageBand: "60s", gender: "f" },
  "afd_stewards/uA": { visibility: "known", displayName: "Salim" },
  "afd_ui_prompts/intro.tour.what": { status: "recorded", storagePath: "afd_ui/intro.tour.what.webm" },
};
const OBJ = {
  "afd/uA/r_pub.webm": A1, "afd/uA/r_wd.webm": A2, "afd/uA/r_del.webm": A3,
  "afd_withdrawals/uA/w1.webm": Buffer.from("no"), "afd_consents/uA/g1.webm": Buffer.from("yes"),
  "afd_pics/uA/ent_u_abc.jpg": Buffer.from("jpeg"), "afd_avatars/uA/avatar.jpg": Buffer.from("face"),
  "afd_ui/intro.tour.what.webm": Buffer.from("prompt"),
};

let pkg, byName, dir, zipPath;
const lines = (n) => byName[n].toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
before(async () => {
  pkg = await buildPackage({ db: fakeDb(DOCS), bucket: fakeBucket(OBJ), instance: readInstance(),
    concepts: JSON.parse(readFileSync(new URL("../data/concepts.json", import.meta.url), "utf8")),
    now: new Date("2026-10-13T12:00:00Z"), generator: "test" });
  byName = Object.fromEntries(pkg.files.map(f => [f.name, f.data]));
  dir = mkdtempSync(join(tmpdir(), "afdexp-"));
  zipPath = join(dir, "t.afd.zip");
  const z = new ZipWriter(zipPath); for(const f of pkg.files) z.add(f.name, f.data); z.close();
});

describe("what the community backup holds", () => {
  it("manifest names the version and profile, and counts what's inside", () => {
    const m = JSON.parse(byName["manifest.json"]);
    assert.equal(m.version, MANIFEST_VERSION); assert.equal(m.profile, "community");
    assert.equal(m.counts.entries, 2); assert.equal(m.counts.recordings, 2);
  });
  it("erased recordings and their audio are left out; withdrawn ones are kept", () => {
    const ids = lines("recordings.jsonl").map(r => r.recordingId).sort();
    assert.deepEqual(ids, ["r_pub", "r_wd"]);
    assert.ok(byName["audio/r_wd.webm"] && !byName["audio/r_del.webm"]);
  });
  it("embedding vectors are dropped, the model and rep offsets kept", () => {
    const r = lines("recordings.jsonl").find(x => x.recordingId === "r_pub");
    assert.equal(r.embedding, undefined); assert.equal(r.reps, undefined);
    assert.deepEqual(r.embeddingModel, { model: "mms-300m", layer: 12, pooling: "voiced-per-rep", nReps: 1, repOffsets: [[0.1, 0.5]] });
  });
  it("a take embedded since 10-19 (vectors apart, repSpans on the recording) exports the same", async () => {
    const { recordingRecord } = await import("../scripts/lib/export.mjs");
    const r = recordingRecord("r_new", "ent_sun", { embedModel: "mms-300m", embedLayer: 12, embedPooling: "voiced-per-rep",
      nReps: 2, repSpans: [{ start: 0.1, end: 0.5 }, { start: 0.9, end: 1.3 }] });
    assert.equal(r.repSpans, undefined);
    assert.deepEqual(r.embeddingModel, { model: "mms-300m", layer: 12, pooling: "voiced-per-rep", nReps: 2, repOffsets: [[0.1, 0.5], [0.9, 1.3]] });
  });
  it("speakers carry their private details and the spoken grant", () => {
    const s = lines("speakers.jsonl")[0];
    assert.deepEqual(s.private.origin, { town: "Taqah", tribe: "T" });
    assert.equal(s.grant.audioFile, "consent/spk_uA_01/g1.webm");
    assert.ok(byName["consent/spk_uA_01/g1.webm"]);
  });
  it("withdrawal proofs, photos, avatars and recorded prompts come along", () => {
    for(const f of ["withdrawals/spk_uA_01/w1.webm", "images/ent_u_abc.jpg", "avatars/uA/avatar.jpg", "prompts/intro.tour.what.webm"])
      assert.ok(byName[f], f);
  });
  it("timestamps become ISO dates", () => {
    assert.equal(lines("entries.jsonl").find(e => e.entryId === "ent_u_abc").createdAt, "2026-10-01T10:00:00.000Z");
    assert.equal(plain({ a: [ts("2026-01-01T00:00:00Z")] }).a[0], "2026-01-01T00:00:00.000Z");
  });
  it("instance.json names the language by its own code, and the local concepts are listed", () => {
    const i = JSON.parse(byName["instance.json"]);
    assert.equal(i.language.code, "qhk");
    assert.ok(lines("concepts.jsonl").some(c => c.conceptId === "local:hakli/barber"));
  });
  it("a checksum that doesn't match the one on record is reported", async () => {
    const bad = { ...OBJ, "afd/uA/r_pub.webm": Buffer.from("changed") };
    const p = await buildPackage({ db: fakeDb(DOCS), bucket: fakeBucket(bad), instance: readInstance(), concepts: {}, now: new Date() });
    assert.ok(p.warnings.some(w => /checksum differs/.test(w) && /r_pub/.test(w)));
  });
});

describe("the zip", () => {
  it("opens cleanly in Python's zipfile with every file intact", () => {
    const out = execFileSync("python3", ["-c",
      "import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(sorted(z.namelist())))", zipPath]).toString();
    assert.deepEqual(JSON.parse(out), pkg.files.map(f => f.name).sort());
  });
  it("unzips, and every checksum in checksums.sha256 verifies", () => {
    const x = join(dir, "x");
    execFileSync("unzip", ["-q", zipPath, "-d", x]);
    const out = execFileSync("sha256sum", ["-c", "checksums.sha256"], { cwd: x }).toString();
    assert.ok(!/FAILED/.test(out) && out.trim().split("\n").length === pkg.files.length - 1, out);
  });
});

describe("large packages", () => {
  it("past 65,535 files the zip switches to ZIP64 and still opens", () => {
    const p = join(mkdtempSync(join(tmpdir(), "afdz64-")), "big.zip");
    const z = new ZipWriter(p);
    for(let i = 0; i < 70000; i++) z.add(`audio/r${i}.webm`, Buffer.from(String(i)));
    z.close();
    const out = execFileSync("python3", ["-c",
      "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); n=z.namelist(); print(len(n), z.read(n[-1]).decode())", p]).toString().trim();
    assert.equal(out, "70000 69999");
  });
});

// ---- archive deposit --------------------------------------------------------
describe("archive deposit", () => {
  // a second speaker who did NOT grant archiving, with a public take
  const DOCS2 = { ...DOCS,
    "afd_entries/ent_sun/recordings/r_other": { uid: "uB", speakerId: "spk_uB_01", consent: "public", allowPlayback: true, storagePath: "afd/uB/r_other.webm" },
    "afd_speakers/spk_uB_01": { stewardUid: "uB", consent: "public", grant: { archivalDeposit: false } },
    "afd_speakers/spk_uB_01/private/profile": { origin: { town: "Mirbat", tribe: "Q" } },
    // ticked "archive" but never recorded spoken consent
    "afd_entries/ent_sun/recordings/r_nospoken": { uid: "uC", speakerId: "spk_uC_01", consent: "public", allowPlayback: true, storagePath: "afd/uC/r_ns.webm" },
    "afd_speakers/spk_uC_01": { stewardUid: "uC", consent: "public", grant: { version: "cv_2026_10", archivalDeposit: true } },
  };
  const OBJ2 = { ...OBJ, "afd/uB/r_other.webm": Buffer.from("other"), "afd/uC/r_ns.webm": Buffer.from("nospoken") };
  let a, A;
  const SA = archiveSpeakerCode("hakli", "spk_uA_01");
  const L = (n) => A[n].toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  before(async () => {
    a = await buildPackage({ db: fakeDb(DOCS2), bucket: fakeBucket(OBJ2), instance: readInstance(), profile: "archive",
      concepts: JSON.parse(readFileSync(new URL("../data/concepts.json", import.meta.url), "utf8")),
      now: new Date("2026-10-13T12:00:00Z"), depositor: "Marty Heaton",
      toWav: async (bytes) => Buffer.concat([Buffer.from("RIFF"), bytes]) });
    A = Object.fromEntries(a.files.map(f => [f.name, f.data]));
  });
  it("only speakers who granted archiving, only their shared takes", () => {
    assert.deepEqual(L("speakers.jsonl").map(s => s.speakerId), [SA]);
    assert.deepEqual(L("recordings.jsonl").map(r => r.recordingId), ["r_pub"]);   // r_wd withdrawn, r_del erased, r_other not granted
    assert.ok(!A["audio/r_wd.webm"] && !A["audio/r_other.webm"] && !A["audio/r_del.webm"]);
  });
  it("a speaker who ticked archive but has no spoken consent is left out, and named", () => {
    assert.deepEqual(a.noSpokenConsent, ["spk_uC_01"]);
    assert.equal(a.summary.speakersNoSpokenConsent, 1);
    assert.ok(!A["audio/r_ns.webm"]);
    assert.ok(!a.files.some(f => f.data.toString("utf8").includes("spk_uC_01")));
  });
  it("speaker details come in a block marked restricted", () => {
    const s = L("speakers.jsonl")[0];
    assert.equal(s.restricted.access, "restricted");
    assert.deepEqual(s.restricted.origin, { town: "Taqah", tribe: "T" });
    assert.equal(s.restricted.ageBand, "60s");
    assert.match(JSON.parse(A["manifest.json"]).access.speakerDetails, /RESTRICTED/);
  });
  it("the spoken consent comes along", () => {
    assert.equal(L("speakers.jsonl")[0].grant.audioFile, `consent/${SA}/g1.webm`);
    assert.ok(A[`consent/${SA}/g1.webm`]);
  });
  it("no account ids, steward identities, withdrawal proofs, avatars, prompts or embeddings", () => {
    const all = Object.keys(A);
    assert.ok(!all.some(f => /^(withdrawals|avatars|prompts)\//.test(f)), all.join());
    assert.ok(!A["stewards.jsonl"] && !A["prompts.jsonl"]);
    const text = ["recordings.jsonl", "speakers.jsonl", "entries.jsonl"].map(n => A[n].toString()).join("\n");
    for(const k of ['"uid"', '"stewardUid"', '"createdBy"', '"embeddingModel"', '"storagePath"', '"audioPath"']) assert.ok(!text.includes(k), k);
    assert.ok(!text.includes("uA"), "an account id leaked: " + text.match(/.{20}uA.{20}/));
  });
  it("speakers have deposit codes: stable, and with no account-id fragment", () => {
    assert.match(SA, /^S[0-9A-F]{8}$/);
    assert.equal(SA, archiveSpeakerCode("hakli", "spk_uA_01"));
    assert.equal(L("recordings.jsonl")[0].speakerId, SA);
    assert.ok(!Object.keys(A).some(f => f.includes("spk_")), "an app speaker code in a file name");
  });
  it("only the words those takes are of", () => {
    assert.deepEqual(L("entries.jsonl").map(e => e.entryId), ["ent_sun"]);
  });
  it("each take gets a WAV copy beside the original", () => {
    const r = L("recordings.jsonl")[0];
    assert.equal(r.wavFile, "wav/r_pub.wav");
    assert.ok(A["wav/r_pub.wav"]);
  });
  it("olac.xml is well-formed and names the depositor, speakers by code, and restricted access", () => {
    const x = A["olac.xml"].toString();
    execFileSync("python3", ["-c", "import sys,xml.dom.minidom as m; m.parseString(sys.stdin.buffer.read())"], { input: x });
    assert.match(x, /olac:code="depositor">Marty Heaton</);
    assert.ok(x.includes(`olac:code="speaker">${SA}<`));
    assert.match(x, /accessRights>[^<]*RESTRICTED/);
    assert.match(x, /private use/);                   // qhk is ours, not ISO
  });
  it("a real Opus take converts to a playable WAV (ffmpeg)", { skip: !makeWavConverter() && "ffmpeg not installed" }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "afdwav-")), src = join(dir, "t.webm");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libopus", src]);
    const wav = await makeWavConverter()(readFileSync(src), "webm");
    assert.equal(wav.subarray(0, 4).toString(), "RIFF");
    assert.equal(wav.subarray(8, 12).toString(), "WAVE");
    assert.equal(wav.readUInt16LE(34), 16);           // 16-bit PCM
    assert.ok(wav.length > 48000 * 2 * 0.9, String(wav.length));   // about a second of audio
  });
});
