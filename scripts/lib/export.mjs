/*  Export package — what goes into an .afd.zip, decided without touching the
 *  network or the disk. scripts/export-package.mjs hands it a Firestore and a
 *  Storage bucket (Admin SDK) and writes the files it returns into a zip.
 *  Tests hand it small fakes with the same few methods.
 *
 *  Package layout and field meanings: "AFD Export Manifest Spec" (Claude Doc).
 *  Field names follow Firestore, so a backup restores without translation.
 *
 *  Profiles:
 *    community  everything needed to restore this dictionary: every word card,
 *               every recording except erased ones (consent "deleted", waiting
 *               for the purge), withdrawn ones included so they can be shown
 *               again; speakers with their private details (town, tribe, age,
 *               gender); spoken consent and withdrawal proofs; photos, avatars
 *               and the recorded interface prompts. Embedding vectors are left
 *               out (they can be recomputed: scripts/backfill-embeddings.mjs).
 *               Private by nature — never publish it.
 *    archive    a deposit for a language archive (ELAR, PARADISEC, AILLA). Only
 *               speakers who granted archiving (grant.archivalDeposit), only
 *               their takes still shared (consent "public" — withdrawn and
 *               erased ones stay out), with each speaker's spoken consent grant.
 *               Speaker details at the dialect-reader level (town, tribe, age
 *               band, gender), marked RESTRICTED access. No account ids, no
 *               steward identities, no withdrawal proofs, no avatars, no
 *               interface prompts, no embeddings. With an uncompressed WAV copy
 *               of each take beside the original when a converter is given
 *               (ffmpeg on the laptop). Metadata: olac.xml (Dublin Core / OLAC).
 */
import { createHash } from "node:crypto";

export const MANIFEST_VERSION = "afd-manifest/1.0";
export const PROFILES = ["community", "archive"];

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
export async function buildPackage(opts){
  const profile = opts.profile || "community";
  if(!PROFILES.includes(profile)) throw new Error(`unknown profile "${profile}" (have: ${PROFILES.join(", ")})`);
  if(profile === "archive") return buildArchive(opts);
  return buildCommunity(opts);
}

async function buildCommunity({ db, bucket, instance, concepts, profile = "community", now = new Date(), generator = "" }){
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


/* ---- archive deposit ---------------------------------------------------------
   toWav(bytes, ext) → Promise<Buffer|null>: an uncompressed copy (null to skip).
   depositor: who deposits (named in olac.xml); empty leaves it for the archive form. */
const ACCOUNT_FIELDS = ["uid", "stewardUid", "createdBy", "by", "ownerUid"];
const strip = (o) => { const x = { ...o }; for(const k of ACCOUNT_FIELDS) delete x[k]; return x; };
// Speaker codes in the app (spk_<first 6 of the account id>_01) carry a fragment
// of an account id, so a deposit names speakers by its own code instead: stable
// across deposits (the same speaker always gets the same code) and traceable
// back only by someone holding the private backup, which keeps the originals.
export function archiveSpeakerCode(instanceId, speakerId){
  return "S" + createHash("sha256").update(`afd:${instanceId}:${speakerId}`).digest("hex").slice(0, 8).toUpperCase();
}
const xmlEsc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));

async function buildArchive({ db, bucket, instance, concepts, now = new Date(), generator = "", toWav = null, depositor = "" }){
  const code = (id) => archiveSpeakerCode(instance.instanceId, id);
  const files = [], warnings = [], checksums = [];
  const add = (name, data) => { files.push({ name, data }); checksums.push(`${sha256(data)}  ${name}`); };
  const counts = { speakers: 0, speakersNotGranted: 0, entries: 0, recordings: 0, recordingsNotShared: 0,
                   audio: 0, wav: 0, consentAudio: 0, images: 0 };
  const noSpokenConsent = [];                 // granted archiving but no spoken consent on file: left out, listed
  async function fetchFile(storagePath, name, expectSha){
    const f = bucket.file(storagePath);
    const [exists] = await f.exists();
    if(!exists){ warnings.push(`missing in Storage: ${storagePath}`); return null; }
    const [bytes] = await f.download();
    if(expectSha && expectSha !== sha256(bytes)) warnings.push(`checksum differs from the one on record: ${storagePath}`);
    add(name, bytes);
    return bytes;
  }

  // ---- which speakers: granted archiving, card not erased ----
  const spk = new Map();                      // speakerId → { card, private }
  const spkSnap = await db.collection("afd_speakers").get();
  for(const s of spkSnap.docs){
    const d = s.data() || {};
    if(!(d.grant && d.grant.archivalDeposit === true) || d.consent !== "public"){ counts.speakersNotGranted++; continue; }
    // A deposit promises each speaker's spoken consent: no recording, no deposit.
    const proof = d.grant.audioPath ? (await bucket.file(d.grant.audioPath).exists())[0] : false;
    if(!proof){ noSpokenConsent.push(s.id); continue; }
    const priv = await s.ref.collection("private").doc("profile").get();
    spk.set(s.id, { card: d, private: priv.exists ? plain(priv.data() || {}) : null });
  }

  // ---- their shared takes ----
  const recordings = [], usedEntries = new Set(), usedSpeakers = new Set();
  const recSnap = await db.collectionGroup("recordings").get();
  for(const s of recSnap.docs){
    const entryRef = s.ref.parent.parent;
    if(!entryRef || entryRef.parent.id !== "afd_entries") continue;
    const d = s.data() || {};
    if(!spk.has(d.speakerId)) continue;
    if(d.consent !== "public"){ counts.recordingsNotShared++; continue; }
    const r = strip(recordingRecord(s.id, entryRef.id, d));
    r.speakerId = code(d.speakerId);
    delete r.embeddingModel;                 // nothing about our matcher in a deposit
    delete r.allowPlayback;                  // an app setting, not archive metadata
    if(r.capture) delete r.capture.device;
    if(d.storagePath){
      const ext = (d.storagePath.match(/\.(\w+)$/) || [, "webm"])[1];
      const bytes = await fetchFile(d.storagePath, `audio/${s.id}.${ext}`, d.sha256);
      if(bytes){
        r.audioFile = `audio/${s.id}.${ext}`; counts.audio++;
        if(toWav){
          const wav = await toWav(bytes, ext).catch(e => { warnings.push(`WAV conversion failed for ${s.id}: ${e.message}`); return null; });
          if(wav){ add(`wav/${s.id}.wav`, wav); r.wavFile = `wav/${s.id}.wav`; counts.wav++; }
        }
      }
    }
    delete r.storagePath;
    recordings.push(r); counts.recordings++;
    usedEntries.add(entryRef.id); usedSpeakers.add(d.speakerId);
  }

  // ---- the speakers those takes belong to ----
  const speakers = [];
  for(const id of [...usedSpeakers].sort((x, y) => code(x).localeCompare(code(y)))){
    const { card, private: priv } = spk.get(id);
    const sp = { speakerId: code(id), viaAgent: card.viaAgent === true, grant: strip(plain(card.grant || {})) };
    delete sp.grant.audioPath;
    if(card.grant && card.grant.audioPath){
      const name = `consent/${code(id)}/${base(card.grant.audioPath)}`;
      if(await fetchFile(card.grant.audioPath, name)){ sp.grant.audioFile = name; counts.consentAudio++; }
    }
    if(priv) sp.restricted = { access: "restricted", origin: priv.origin || null, ageBand: priv.ageBand || "", gender: priv.gender || "" };
    speakers.push(sp); counts.speakers++;
  }

  // ---- the word cards those takes are of ----
  const entries = [];
  for(const id of [...usedEntries].sort()){
    const snap = await db.collection("afd_entries").doc(id).get();
    if(!snap.exists) continue;
    const d = snap.data() || {};
    const e = strip({ entryId: id, ...plain(d) });
    for(const k of ["reviewedAt", "hiddenAt", "removedAt", "seededAt"]) delete e[k];
    if(d.image && d.source === "user" && d.createdBy){
      if(await fetchFile(`afd_pics/${d.createdBy}/${id}.jpg`, `images/${id}.jpg`)){ e.imageFile = `images/${id}.jpg`; counts.images++; }
      delete e.image;
    }
    entries.push(e); counts.entries++;
  }
  const local = Object.entries((concepts && concepts.local) || {}).map(([conceptId, c]) => ({ conceptId, ...c }));

  add("entries.jsonl", jsonl(entries));
  add("recordings.jsonl", jsonl(recordings));
  add("speakers.jsonl", jsonl(speakers));
  add("concepts.jsonl", jsonl(local));
  const inst = { instanceId: instance.instanceId, language: instance.language, contactLanguages: instance.contactLanguages,
                 consentVersions: [...new Set(speakers.map(s => s.grant.version).filter(Boolean))] };
  add("instance.json", Buffer.from(JSON.stringify(inst, null, 1) + "\n"));
  const access = {
    recordings: "Open, as each speaker granted (grant.archivalDeposit); attribution per grant.attribution.",
    speakerDetails: "RESTRICTED: the `restricted` block in speakers.jsonl (town, tribe, age band, gender) is for dialect research only; not for public display.",
    consent: "Each speaker's consent is recorded as flags (grant) and as their own spoken audio (consent/)."
  };
  const manifest = { version: MANIFEST_VERSION, profile: "archive", instanceId: instance.instanceId,
                     generatedAt: now.toISOString(), generator, counts, warnings, access };
  add("manifest.json", Buffer.from(JSON.stringify(manifest, null, 1) + "\n"));
  add("olac.xml", Buffer.from(olac(instance, now, counts, speakers, depositor, access), "utf8"));
  add("README.txt", Buffer.from(archiveReadme(instance, now, counts, access, !!toWav), "utf8"));
  files.push({ name: "checksums.sha256", data: Buffer.from(checksums.join("\n") + "\n") });
  return { files, summary: { ...counts, speakersNoSpokenConsent: noSpokenConsent.length }, warnings, noSpokenConsent };
}

function olac(instance, now, c, speakers, depositor, access){
  const L = instance.language || {}, name = L.name || instance.instanceId;
  const iso = L.crosswalk && L.crosswalk.iso639_3, glotto = L.crosswalk && L.crosswalk.glottocode;
  const date = now.toISOString().slice(0, 10);
  const lang = [
    `  <dc:subject xsi:type="olac:linguistic-field" olac:code="lexicography"/>`,
    iso ? `  <dc:subject xsi:type="olac:language" olac:code="${xmlEsc(iso)}">${xmlEsc(name)}</dc:subject>`
        : `  <dc:subject>${xmlEsc(name)} (${xmlEsc(L.endonym || "")}) — language code in this deposit: ${xmlEsc(L.code || "")} (private use)${glotto ? `; Glottocode ${xmlEsc(glotto)}` : ""}</dc:subject>`,
    ...((instance.contactLanguages || []).map(x => `  <dc:language xsi:type="olac:language" olac:code="${xmlEsc(x.code === "ar" ? "ara" : x.code === "en" ? "eng" : x.code)}"/>`)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<olac:olac xmlns:olac="http://www.language-archives.org/OLAC/1.1/"
           xmlns:dc="http://purl.org/dc/elements/1.1/"
           xmlns:dcterms="http://purl.org/dc/terms/"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xsi:schemaLocation="http://www.language-archives.org/OLAC/1.1/ http://www.language-archives.org/OLAC/1.1/olac.xsd">
  <dc:title>${xmlEsc(name)} audio-first dictionary: word recordings (${date})</dc:title>
  <dc:description>${xmlEsc(`${c.recordings} recordings of ${c.entries} words by ${c.speakers} speakers, each with the speaker's spoken consent. Recorded with the Audio First Dictionary (hakli.app).`)}</dc:description>
${lang.join("\n")}
  <dc:type xsi:type="olac:linguistic-type" olac:code="lexicon"/>
  <dc:type xsi:type="dcterms:DCMIType">Sound</dc:type>
  <dcterms:created>${date}</dcterms:created>
${depositor ? `  <dc:contributor xsi:type="olac:role" olac:code="depositor">${xmlEsc(depositor)}</dc:contributor>\n` : ""}${speakers.map(s => `  <dc:contributor xsi:type="olac:role" olac:code="speaker">${xmlEsc(s.speakerId)}</dc:contributor>`).join("\n")}
  <dcterms:accessRights>${xmlEsc(access.recordings + " " + access.speakerDetails)}</dcterms:accessRights>
</olac:olac>
`;
}

function archiveReadme(instance, now, c, access, wav){
  const name = (instance.language && instance.language.name) || instance.instanceId;
  return [
    `${name} audio-first dictionary — archive deposit, ${now.toISOString().slice(0, 10)}`,
    `إيداع أرشيفي لقاموس ${name} الصوتي — ${now.toISOString().slice(0, 10)}`,
    "",
    `${c.recordings} recordings of ${c.entries} words by ${c.speakers} speakers.`,
    "Only speakers who agreed to archiving are here, and only recordings they still share.",
    "",
    "Access",
    `  ${access.recordings}`,
    `  ${access.speakerDetails}`,
    `  ${access.consent}`,
    "",
    "Files",
    "  olac.xml           catalogue record (Dublin Core / OLAC)",
    "  manifest.json      version, counts, access conditions",
    "  instance.json      the language and contact languages",
    "  entries.jsonl      the words (glosses, concepts), one per line",
    "  recordings.jsonl   the recordings (audioFile → audio/" + (wav ? ", wavFile → wav/" : "") + ")",
    "  speakers.jsonl     speakers by deposit code (S…), their consent, and RESTRICTED details",
    "  concepts.jsonl     concepts defined by this dictionary (others are Concepticon ids)",
    "  audio/             recordings as made (WebM/Opus or M4A)",
    ...(wav ? ["  wav/               uncompressed copies, 16-bit PCM"] : []),
    "  consent/           each speaker's spoken consent",
    "  checksums.sha256   check with:  sha256sum -c checksums.sha256",
    "",
  ].join("\n");
}
