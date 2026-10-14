#!/usr/bin/env node
/*  Audio First Dictionary — find voices other people can't hear
 *  ----------------------------------------------------------------------
 *  "A speaker recorded it but it isn't on my phone" — this lists every take
 *  whose allowPlayback is false, newest first, with the reason in plain words:
 *
 *    · never-shared   uploaded private: the speaker left "Let other people
 *                     listen" unticked (or their card was already closed).
 *                     Fix: the speaker opens the word and taps Share.
 *    · card-closed    the speaker card is withdrawn, so new takes arrive hidden
 *                     even with the box ticked. Fix: "share again" on the
 *                     speaker (recorder roster), or Share on one take.
 *    · withdrawn      the take was public and someone withdrew it. Leave it
 *                     alone unless the speaker asks.
 *    · erased         consent "deleted", waiting for the nightly purge
 *                     (only with --all).
 *
 *  It also flags a take whose WORD is hidden by a steward or removed by its
 *  creator — the voice may be public but nobody sees the word.
 *
 *  READ-ONLY. It never changes consent: making a voice public is the
 *  speaker's (or their steward's) act in the app, never this script's. The
 *  Firestore rules keep private takes out of the steward page on purpose;
 *  this is the admin view for finding one when someone asks.
 *
 *  Run:
 *    gcloud auth application-default login
 *    node scripts/find-hidden-voices.mjs                 # last 30 days
 *    node scripts/find-hidden-voices.mjs --days 7
 *    node scripts/find-hidden-voices.mjs --days 0        # all time
 *    node scripts/find-hidden-voices.mjs --speaker spk_ab12cd_01
 *    node scripts/find-hidden-voices.mjs --who           # add contributor emails
 *    node scripts/find-hidden-voices.mjs --all           # include erased
 *
 *  Env:
 *    AFD_PROJECT_ID   (default afd-dev)
 */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt  = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; };

const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const DAYS       = Number(opt("--days", "30"));
const SPEAKER    = opt("--speaker", "");
const WHO        = flag("--who");
const ALL        = flag("--all");

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getAuth }      = await import("firebase-admin/auth");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

// A Firestore Timestamp, an ISO string (recordedAt is written by the phone) or nothing.
const ms = (v) => !v ? 0 : typeof v.toMillis === "function" ? v.toMillis()
               : (Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0);
const day = (t) => t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "?";
const since = DAYS > 0 ? Date.now() - DAYS * 86400e3 : 0;

// Whole collection group, filtered here: the corpus is small, and a filtered
// collection-group query would need its own index set up first.
const snaps = await db.collectionGroup("recordings").get();

const entries = new Map(), cards = new Map(), emails = new Map();
const cached = (map, key, load) => { if (!map.has(key)) map.set(key, load()); return map.get(key); };
const entryOf = (id) => cached(entries, id, async () => {
  const sn = await db.doc(`afd_entries/${id}`).get(); return sn.exists ? sn.data() : null; });
const cardOf  = (id) => cached(cards, id, async () => {
  if (!id) return null; const sn = await db.doc(`afd_speakers/${id}`).get(); return sn.exists ? sn.data() : null; });
const emailOf = (uid) => cached(emails, uid, async () => {
  try { const u = await getAuth().getUser(uid); return u.email || u.phoneNumber || "(no email)"; }
  catch { return "(unknown account)"; } });

const rows = [];
for (const s of snaps.docs) {
  const r = s.data() || {};
  if (r.allowPlayback === true) continue;
  if (SPEAKER && r.speakerId !== SPEAKER) continue;
  const t = ms(r.uploadedAt) || ms(r.recordedAt);
  if (since && t && t < since) continue;
  if (r.consent === "deleted" && !ALL) continue;
  const entryId = s.ref.parent.parent.id;
  const [entry, card] = await Promise.all([entryOf(entryId), cardOf(r.speakerId)]);
  const reason = r.consent === "deleted" ? "erased"
               : r.consent === "withdrawn" ? "withdrawn"
               : card && card.consent && card.consent !== "public" && card.grant && card.grant.publicPlayback === true ? "card-closed"
               : "never-shared";
  const g = entry ? ((entry.glosses && entry.glosses.en) || entry.gloss || (entry.glosses && entry.glosses.ar) || entry.glossAr || "") : "";
  const wordNote = !entry ? "word missing"
                 : entry.removedAt ? "word removed by creator"
                 : entry.hiddenAt ? "word hidden by steward" : "";
  rows.push({ t, reason, entryId, word: g || r.gloss || "(no gloss)", type: r.type || r.phase || "word",
              speakerId: r.speakerId || "?", uid: r.uid || "", viaAgent: r.viaAgent === true, wordNote,
              path: s.ref.path });
}
rows.sort((a, b) => b.t - a.t);

console.log(`find-hidden-voices · project=${PROJECT_ID} · ${DAYS > 0 ? `last ${DAYS} days` : "all time"}` +
            `${SPEAKER ? ` · speaker ${SPEAKER}` : ""} · ${rows.length} hidden take(s)\n`);
for (const r of rows) {
  const who = WHO && r.uid ? `  ${await emailOf(r.uid)}` : "";
  console.log(`${day(r.t)}  ${r.reason.padEnd(12)}  ${r.word} (${r.type})`);
  console.log(`                  speaker ${r.speakerId}${r.viaAgent ? " (recorded by proxy)" : ""}` +
              `  account ${r.uid.slice(0, 6)}…${who}${r.wordNote ? `  ⚠ ${r.wordNote}` : ""}`);
  console.log(`                  ${r.path}  https://hakli.app/#${encodeURIComponent(r.entryId)}`);
}
const by = rows.reduce((m, r) => (m[r.reason] = (m[r.reason] || 0) + 1, m), {});
if (rows.length) console.log("\n" + Object.entries(by).map(([k, v]) => `${k}: ${v}`).join(" · "));
