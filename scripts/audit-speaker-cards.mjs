#!/usr/bin/env node
/*  Audio First Dictionary — audit (and optionally fix) public speaker cards
 *  ----------------------------------------------------------------------
 *  The afd_speakers rule now allows ONLY these fields on the world-readable
 *  card (see afd-firestore.rules → speakerCardFieldsOK):
 *
 *      uid  stewardUid  speakerId  viaAgent  masked  consent  grant  updatedAt
 *
 *  Because the update rule checks the FULL merged doc, any legacy card that
 *  still carries a stray field (e.g. a pre-fix `origin`/`town`/`tribe`) is
 *  FROZEN once the rule deploys — even a plain consent flip is denied — until
 *  the stray field is removed. This script finds those cards, and with --fix
 *  cleans them WITHOUT losing data:
 *
 *    · identifying fields (origin / town / tribe / ageBand / gender) are first
 *      MOVED to the steward-only /private/profile subdoc where they belong
 *      (only filling gaps — an existing /private value is never overwritten),
 *      then removed from the public card;
 *    · any other unexpected key is simply removed from the card.
 *
 *  Read-only by default (a dry run). It NEVER deletes a speaker doc, never
 *  touches recordings, stewards, or Storage. Runs with the Admin SDK, which
 *  bypasses security rules — that's how it can see a leaked field at all.
 *
 *  Gate your deploy on it:
 *    node scripts/audit-speaker-cards.mjs && firebase deploy --only firestore:rules
 *  (audit mode exits non-zero if any card would be frozen, so the deploy only
 *   runs when the collection is clean.)
 *
 *  Run:
 *    gcloud auth application-default login        # or GOOGLE_APPLICATION_CREDENTIALS
 *    node scripts/audit-speaker-cards.mjs         # dry run — report only
 *    node scripts/audit-speaker-cards.mjs --fix   # migrate origin → /private, strip card
 *
 *  Env:
 *    AFD_PROJECT_ID   (default afd-dev)
 */

const FIX        = process.argv.includes("--fix");
const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const tag        = FIX ? "" : "(dry run) ";

// Keep in exact step with speakerCardFieldsOK() in afd-firestore.rules.
const ALLOWED   = ["uid","stewardUid","speakerId","viaAgent","masked","consent","grant","updatedAt"];
// Fields worth preserving in /private rather than discarding.
const ORIGINISH = ["origin","town","tribe","ageBand","gender"];

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

console.log(`${tag}audit-speaker-cards · project=${PROJECT_ID}`);

const isEmpty = (v) => v === undefined || v === null || v === "" ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

// listDocuments() also surfaces "missing" parents that still hold a /private
// subcollection; getDoc().exists filters those out — a card with no data isn't
// a leaked card.
const refs = await db.collection("afd_speakers").listDocuments();
let scanned = 0, offenders = 0, fixed = 0;

for (const ref of refs) {
  const snap = await ref.get();
  if (!snap.exists) continue;
  scanned++;
  const data = snap.data() || {};
  const stray = Object.keys(data).filter((k) => !ALLOWED.includes(k));
  if (stray.length === 0) continue;

  offenders++;
  console.log(`\n  ${ref.id}  stray: [${stray.join(", ")}]`);

  if (!FIX) continue;

  // 1. Relocate identifying fields into /private/profile, filling gaps only.
  const privRef  = ref.collection("private").doc("profile");
  const privSnap = await privRef.get();
  const priv     = privSnap.exists ? (privSnap.data() || {}) : {};
  const privPatch = {};
  const curTown  = (priv.origin && priv.origin.town)  || "";
  const curTribe = (priv.origin && priv.origin.tribe) || "";

  for (const k of stray) {
    if (!ORIGINISH.includes(k)) continue;
    if (k === "origin" && data.origin && typeof data.origin === "object") {
      const o = {};
      if (isEmpty(curTown)  && !isEmpty(data.origin.town))  o.town  = data.origin.town;
      if (isEmpty(curTribe) && !isEmpty(data.origin.tribe)) o.tribe = data.origin.tribe;
      if (Object.keys(o).length) privPatch.origin = { town: curTown, tribe: curTribe, ...o };
    } else if (k === "town"  && isEmpty(curTown)  && !isEmpty(data.town)) {
      privPatch.origin = { town: data.town, tribe: curTribe };
    } else if (k === "tribe" && isEmpty(curTribe) && !isEmpty(data.tribe)) {
      privPatch.origin = { town: curTown, tribe: data.tribe };
    } else if ((k === "ageBand" || k === "gender") && isEmpty(priv[k]) && !isEmpty(data[k])) {
      privPatch[k] = data[k];
    }
  }
  if (Object.keys(privPatch).length) {
    privPatch.updatedAt = FieldValue.serverTimestamp();
    await privRef.set(privPatch, { merge: true });
    console.log(`    → moved to /private/profile: [${Object.keys(privPatch).filter((k)=>k!=="updatedAt").join(", ")}]`);
  }

  // 2. Strip every stray field from the public card.
  const del = {};
  for (const k of stray) del[k] = FieldValue.delete();
  await ref.update(del);
  fixed++;
  console.log(`    → removed from card: [${stray.join(", ")}]`);
}

console.log(`\n${tag}${scanned} card(s) scanned · ${offenders} with stray fields` +
            (FIX ? ` · ${fixed} cleaned.` : "."));

if (!FIX && offenders > 0) {
  console.log("Re-run with --fix to relocate origin to /private and strip the cards.");
  console.log("Do NOT deploy the rules until this reports 0 stray cards.");
  process.exit(1);   // gate: `audit && firebase deploy` won't deploy while dirty
}
