/*  Export package — what goes into an .afd.zip, decided without touching the
 *  network or the disk. scripts/export-package.mjs hands it a Firestore and a
 *  Storage bucket (Admin SDK) and writes the files it returns into a zip.
 *  Tests hand it small fakes with the same few methods.
 *
 *  Package layout and field meanings: "AFD Export Manifest Spec" (Claude Doc).
 *  Field names follow Firestore, so a backup restores without translation.
 *
 *  Profiles (only "community" so far):
 *    community  everything needed to restore this dictionary: every word card,
 *               every recording except erased ones (consent "deleted", waiting
 *               for the purge), withdrawn ones included so they can be shown
 *               again; speakers with their private details (town, tribe, age,
 *               gender); spoken consent and withdrawal proofs; photos, avatars
 *               and the recorded interface prompts. Embedding vectors are left
 *               out (they can be recomputed: scripts/backfill-embeddings.mjs).
 *               Private by nature — never publish it.
 */
import { createHash } from "node:crypto";

export const MANIFEST_VERSION = "afd-manifest/1.0";
export const PROFILES = ["community"];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const base = (p) => String(p).split("/").pop();

/** Firestore values → plain JSON: Timestamps become ISO strings, recursively. */
export function plain(v){
  if(v == null) return v;
  if(typeof v.toDate === "function") return v.toDate().toISOString();
  if(Array.isArray(v)) return v.map(plain);
  if(typeof v === "object"){
    const o = {};
    for(const [k, x] of Object.entries(v)) o[k] = plain(x);
    return o;
  }
  return v;
}

/** A recording as it goes into the package (vectors dropped, model kept). */
export function recordingRecord(id, entryId, d){
  const { embedding, reps, ...rest } = d;
  const r = { recordingId: id, entryId, ...plain(rest) };
  if(embedding || reps) r.embeddingModel = { model: d.embedModel, layer: d.embedLayer, pooling: d.embedPooling,
                                             nReps: d.nReps, repOffsets: (reps || []).map(x => [x.start, x.end]) };
  delete r.embedModel; delete r.embedLayer; delete r.embedPooling;
  return r;
}

const jsonl = (rows) => Buffer.from(rows.map(r => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");

/**
 * Build the package. Returns { files: [{ name, data }], summary, warnings }.
 *   db      Firestore: collection(n).get(), collectionGroup(n).get(),
 *           doc snapshots with .id, .data(), .ref (ref.parent.parent, ref.collection(n).doc(id).get())
 *   bucket  Storage: file(p).exists(), file(p).download(), getFiles({ prefix })
 *   instance  window.AFDInstance (afd-instance.js)
 *   concepts  data/concepts.json (for local concepts)
 */
export async function buildPackage({ db, bucket, instance, concepts, profile = "community", now = new Date(), generator = "" }){
  if(!PROFILES.includes(profile)) throw new Error(`unknown profile "${profile}" (have: ${PROFILES.join(", ")})`);
  const files = [], warnings = [], checksums = [];
  const add = (name, data) => { files.push({ name, data }); checksums.push(`${sha256(data)}  ${name}`); };
  const counts = { entries: 0, recordings: 0, recordingsWithdrawn: 0, recordingsErasedSkipped: 0, audio: 0,
                   speakers: 0, consentAudio: 0, withdrawalAudio: 0, images: 0, avatars: 0, stewards: 0, prompts: 0, promptAudio: 0 };
  const fetched = new Set();                         // storage paths already in the package
  async function fetchFile(storagePath, name, expectSha){
    if(!storagePath || fetched.has(storagePath)) return null;
    const f = bucket.file(storagePath);
    const [exists] = await f.exists();
    if(!exists){ warnings.push(`missing in Storage: ${storagePath}`); return null; }
    const [bytes] = await f.download();
    const sum = sha256(bytes);
    if(expectSha && expectSha !== sum) warnings.push(`checksum differs from the one on record: ${storagePath}`);
    fetched.add(storagePath);
    add(name, bytes);
    return { file: name, sha256: sum, bytes: bytes.length };
  }

  // ---- word cards ----
  const entries = [];
  const entrySnap = await db.collection("afd_entries").get();
  for(const s of entrySnap.docs){
    const d = s.data() || {};
    const e = { entryId: s.id, ...plain(d) };
    if(d.image && d.source === "user" && d.createdBy){
      const got = await fetchFile(`afd_pics/${d.createdBy}/${s.id}.jpg`, `images/${s.id}.jpg`);
      if(got){ e.imageFile = got.file; counts.images++; }
    }
    entries.push(e); counts.entries++;
  }

  // ---- recordings ----
  const recordings = [];
  const recSnap = await db.collectionGroup("recordings").get();
  for(const s of recSnap.docs){
    const entryRef = s.ref.parent.parent;
    if(!entryRef || entryRef.parent.id !== "afd_entries") continue;
    const d = s.data() || {};
    if(d.consent === "deleted"){ counts.recordingsErasedSkipped++; continue; }
    const r = recordingRecord(s.id, entryRef.id, d);
    if(d.storagePath){
      const ext = (d.storagePath.match(/\.(\w+)$/) || [, "webm"])[1];
      const got = await fetchFile(d.storagePath, `audio/${s.id}.${ext}`, d.sha256);
      if(got){ r.audioFile = got.file; if(!d.sha256) r.sha256 = got.sha256; counts.audio++; }
    }
    if(d.withdrawal && d.withdrawal.audioPath){
      const got = await fetchFile(d.withdrawal.audioPath, `withdrawals/${d.speakerId || "unknown"}/${base(d.withdrawal.audioPath)}`);
      if(got){ r.withdrawal.audioFile = got.file; counts.withdrawalAudio++; }
    }
    if(d.consent === "withdrawn") counts.recordingsWithdrawn++;
    recordings.push(r); counts.recordings++;
  }

  // ---- speakers: the public card, the steward-only private details, the spoken grant ----
  const speakers = [];
  const spkSnap = await db.collection("afd_speakers").get();
  for(const s of spkSnap.docs){
    const d = s.data() || {};
    const sp = { speakerId: s.id, ...plain(d) };
    const priv = await s.ref.collection("private").doc("profile").get();
    if(priv.exists) sp.private = plain(priv.data() || {});   // community: town, tribe, age, gender
    if(d.grant && d.grant.audioPath){
      const got = await fetchFile(d.grant.audioPath, `consent/${s.id}/${base(d.grant.audioPath)}`);
      if(got){ sp.grant.audioFile = got.file; counts.consentAudio++; }
    }
    speakers.push(sp); counts.speakers++;
  }

  // ---- stewards (how each contributor chose to appear) and their avatars ----
  const stewards = [];
  const stwSnap = await db.collection("afd_stewards").get();
  for(const s of stwSnap.docs){ stewards.push({ uid: s.id, ...plain(s.data() || {}) }); counts.stewards++; }
  const [avatarFiles] = await bucket.getFiles({ prefix: "afd_avatars/" });
  for(const f of avatarFiles){
    const got = await fetchFile(f.name, f.name.replace(/^afd_avatars\//, "avatars/"));
    if(got) counts.avatars++;
  }

  // ---- the interface prompts recorded in Hakli ----
  const prompts = [];
  const prSnap = await db.collection("afd_ui_prompts").get();
  for(const s of prSnap.docs){
    const d = s.data() || {};
    const p = { key: s.id, ...plain(d) };
    if(d.storagePath){
      const got = await fetchFile(d.storagePath, `prompts/${base(d.storagePath)}`);
      if(got){ p.audioFile = got.file; counts.promptAudio++; }
    }
    prompts.push(p); counts.prompts++;
  }

  // ---- local concepts (Concepticon ones are referenced by id) ----
  const local = Object.entries((concepts && concepts.local) || {}).map(([conceptId, c]) => ({ conceptId, ...c }));

  add("entries.jsonl", jsonl(entries));
  add("recordings.jsonl", jsonl(recordings));
  add("speakers.jsonl", jsonl(speakers));
  add("stewards.jsonl", jsonl(stewards));
  add("prompts.jsonl", jsonl(prompts));
  add("concepts.jsonl", jsonl(local));

  const inst = {
    instanceId: instance.instanceId, language: instance.language, contactLanguages: instance.contactLanguages,
    speakerSchema: instance.speaker || null, firebaseProject: instance.firebase && instance.firebase.projectId,
    consentVersions: [...new Set(speakers.map(s => s.grant && s.grant.version).filter(Boolean))],
    accessProtocol: null,
  };
  add("instance.json", Buffer.from(JSON.stringify(inst, null, 1) + "\n"));

  const manifest = { version: MANIFEST_VERSION, profile, instanceId: instance.instanceId,
                     generatedAt: now.toISOString(), generator, counts, warnings,
                     note: "Field names follow Firestore. Private: contains withdrawn voices and speakers' private details. Do not publish." };
  add("manifest.json", Buffer.from(JSON.stringify(manifest, null, 1) + "\n"));
  add("README.txt", Buffer.from(readme(instance, profile, now, counts), "utf8"));

  // checksums last, covering everything above
  files.push({ name: "checksums.sha256", data: Buffer.from(checksums.join("\n") + "\n") });
  return { files, summary: counts, warnings };
}

function readme(instance, profile, now, c){
  const name = (instance.language && instance.language.name) || instance.instanceId;
  return [
    `${name} audio-first dictionary — ${profile} backup, ${now.toISOString().slice(0, 10)}`,
    `نسخة احتياطية كاملة لقاموس ${name} الصوتي — ${now.toISOString().slice(0, 10)}`,
    "",
    "PRIVATE. This is the whole dictionary, including voices their speakers have",
    "withdrawn from public listening and speakers' private details (town, tribe,",
    "age, gender). It exists so the dictionary can be restored or moved. Keep it",
    "somewhere safe; never publish or share it.",
    "خاصّ. تحتوي هذه النسخة على القاموس كاملًا، بما فيه أصواتٌ سحبها أصحابها من الاستماع",
    "العامّ وتفاصيل المتحدّثين الخاصّة. لا تنشرها ولا تشاركها.",
    "",
    `Word cards: ${c.entries}   Recordings: ${c.recordings} (${c.recordingsWithdrawn} withdrawn)   Speakers: ${c.speakers}`,
    "",
    "Files",
    "  manifest.json      version, profile, counts, any warnings",
    "  instance.json      the language, contact languages, speaker form",
    "  entries.jsonl      word cards, one per line",
    "  recordings.jsonl   recordings, one per line (audioFile → audio/)",
    "  speakers.jsonl     speakers with private details and consent grant (audioFile → consent/)",
    "  stewards.jsonl     how each contributor chose to appear (avatars/)",
    "  prompts.jsonl      the app's spoken prompts recorded in the language (prompts/)",
    "  concepts.jsonl     concepts this dictionary defined itself (others are Concepticon ids)",
    "  checksums.sha256   check with:  sha256sum -c checksums.sha256",
    "",
  ].join("\n");
}
