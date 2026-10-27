/**
 * Reports, holds and steward decisions (10-26) — Firestore emulator suite
 * ============================================================================
 * Trust by default, hold after a report:
 *   • anyone signed in may report a voice or a contributed word, once; the
 *     report and the hold go in ONE batch (the hold needs the report to exist)
 *   • a held voice leaves public listening (allowPlayback false); its speaker
 *     can still withdraw or erase it, but can't make it playable
 *   • only a steward releases a hold: clear (show again, later reports no
 *     longer hold) or hide (stays out), and may send the contributor a note
 *   • moderation never touches consent/withdrawal
 *
 * RUN:  firebase emulators:exec --only firestore "cd test && node --test moderation.rules.test.mjs"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, serverTimestamp, deleteField,
         collection, query, where, setLogLevel } from "firebase/firestore";

setLogLevel("error");
let testEnv;

const E = "ent_u_word1", SEED = "ent_sun";
const rec   = (db, id, e = E) => doc(db, "afd_entries", e, "recordings", id);
const ent   = (db, id = E) => doc(db, "afd_entries", id);
const flag  = (db, id) => doc(db, "afd_flags", id);
const note  = (db, id) => doc(db, "afd_notices", id);
const vId   = (r, uid, e = E) => `${e}~${r}~${uid}`;
const cId   = (uid, e = E) => `${e}~card~${uid}`;

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const asOwner = () => as("uOwner"), asOther = () => as("uOther"), asThird = () => as("uThird"),
      asStew  = () => as("uStew"), asPublic = () => testEnv.unauthenticatedContext().firestore();
const asAnon  = () => testEnv.authenticatedContext("uAnon", { firebase: { sign_in_provider: "anonymous" } }).firestore();

const baseRec = (over = {}) => ({ uid: "uOwner", speakerId: "spk_owner", consent: "public", allowPlayback: true,
  entryId: E, gloss: "word", capture: { sampleRate: 48000 }, storagePath: "afd/uOwner/r1.webm", ...over });

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "afd_admins", "uStew"), { at: 1 });
    await setDoc(doc(db, "afd_speakers", "spk_owner"), { stewardUid: "uOwner", viaAgent: false, consent: "public", masked: false });
    await setDoc(ent(db), { source: "user", createdBy: "uOwner", gloss: "word" });
    await setDoc(ent(db, SEED), { gloss: "sun" });
    await setDoc(rec(db, "r1"), baseRec());
    await setDoc(rec(db, "r2"), baseRec({ storagePath: "afd/uOwner/r2.webm" }));
    await setDoc(rec(db, "rCleared"), baseRec({ modClearedAt: new Date(0) }));
    await setDoc(rec(db, "rWithdrawn"), baseRec({ consent: "withdrawn", allowPlayback: false }));
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "afd-dev",
    firestore: { rules: readFileSync(new URL("../afd-firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });

// report + hold, the way the app sends it
function reportVoice(db, r, uid, { hold = true, reason = "rude", extra = {} } = {}) {
  const b = writeBatch(db);
  b.set(flag(db, vId(r, uid)), { kind: "voice", entryId: E, recordingId: r, reason, by: uid,
                                 at: serverTimestamp(), held: hold, ...extra });
  if(hold) b.update(rec(db, r), { heldAt: serverTimestamp(), allowPlayback: false });
  return b.commit();
}
function reportCard(db, uid, { hold = true, e = E } = {}) {
  const b = writeBatch(db);
  b.set(flag(db, cId(uid, e)), { kind: "card", entryId: e, reason: "wrong", by: uid, at: serverTimestamp(), held: hold });
  if(hold) b.update(ent(db, e), { heldAt: serverTimestamp() });
  return b.commit();
}

describe("reporting a voice", () => {
  it("anyone signed in reports and holds it in one batch", async () => {
    await assertSucceeds(reportVoice(asOther(), "r1", "uOther"));
  });
  it("with a spoken reason in their own folder", async () => {
    await assertSucceeds(reportVoice(asOther(), "r1", "uOther", { extra: { audioPath: `afd_flags/uOther/${vId("r1","uOther")}.webm` } }));
  });
  it("…but not a spoken reason pointing anywhere else", async () => {
    await assertFails(reportVoice(asOther(), "r1", "uOther", { extra: { audioPath: "afd/uOwner/r1.webm" } }));
  });
  it("a hold without a report is refused", async () => {
    await assertFails(updateDoc(rec(asOther(), "r1"), { heldAt: serverTimestamp(), allowPlayback: false }));
  });
  it("a report under someone else's name is refused", async () => {
    const db = asOther(), b = writeBatch(db);
    b.set(flag(db, vId("r1", "uThird")), { kind: "voice", entryId: E, recordingId: "r1", reason: "rude", by: "uThird", at: serverTimestamp(), held: false });
    await assertFails(b.commit());
  });
  it("one report per person: a second is refused", async () => {
    await assertSucceeds(reportVoice(asOther(), "r1", "uOther"));
    await assertFails(reportVoice(asOther(), "r1", "uOther", { hold: false }));
  });
  it("a second person may still report a held voice (queued, no second hold)", async () => {
    await assertSucceeds(reportVoice(asOther(), "r1", "uOther"));
    await assertSucceeds(reportVoice(asThird(), "r1", "uThird", { hold: false }));
    await assertFails(reportVoice(asThird(), "r2", "uThird", { hold: false, reason: "spam" }));   // unknown reason
  });
  it("can't claim held:true without actually holding", async () => {
    await assertFails(reportVoice(asOther(), "r1", "uOther", { hold: false, extra: { held: true } }));
  });
  it("its own recorder can't report or hold it (they withdraw instead)", async () => {
    await assertFails(reportVoice(asOwner(), "r1", "uOwner"));
  });
  it("signed-out and anonymous can't report", async () => {
    await assertFails(reportVoice(asAnon(), "r1", "uAnon"));
  });
  it("a cleared voice can be reported but not held again", async () => {
    await assertFails(reportVoice(asOther(), "rCleared", "uOther"));
    await assertSucceeds(reportVoice(asOther(), "rCleared", "uOther", { hold: false }));
  });
  it("a hold can't sneak in other fields", async () => {
    const db = asOther(), b = writeBatch(db);
    b.set(flag(db, vId("r1", "uOther")), { kind: "voice", entryId: E, recordingId: "r1", reason: "rude", by: "uOther", at: serverTimestamp(), held: true });
    b.update(rec(db, "r1"), { heldAt: serverTimestamp(), allowPlayback: false, consent: "withdrawn" });
    await assertFails(b.commit());
  });
});

describe("a held voice", () => {
  beforeEach(async () => { await reportVoice(asOther(), "r1", "uOther"); });
  it("is no longer public", async () => {
    await assertFails(getDoc(rec(asPublic(), "r1")));
  });
  it("its owner and a steward can still read it", async () => {
    await assertSucceeds(getDoc(rec(asOwner(), "r1")));
    await assertSucceeds(getDoc(rec(asStew(), "r1")));
  });
  it("the public voice list still works (held ones simply aren't in it)", async () => {
    const snap = await assertSucceeds(getDocs(query(collection(asPublic(), "afd_entries", E, "recordings"), where("allowPlayback", "==", true))));
    if(snap.docs.some(d => d.id === "r1")) throw new Error("held voice listed");
  });
  it("its owner can't make it playable again", async () => {
    await assertFails(updateDoc(rec(asOwner(), "r1"), { consent: "public", allowPlayback: true }));
  });
  it("its owner can still withdraw or erase it (withdrawal stays theirs)", async () => {
    await assertSucceeds(updateDoc(rec(asOwner(), "r1"), { consent: "withdrawn", allowPlayback: false }));
    await assertSucceeds(updateDoc(rec(asOwner(), "r1"), { consent: "deleted", allowPlayback: false }));
  });
  it("only a steward releases the hold", async () => {
    await assertFails(updateDoc(rec(asOther(), "r1"), { heldAt: deleteField(), allowPlayback: true }));
    await assertFails(updateDoc(rec(asOwner(), "r1"), { heldAt: deleteField() }));
  });
});

describe("steward decides on a voice", () => {
  beforeEach(async () => { await reportVoice(asOther(), "r1", "uOther"); });
  it("looks fine → clear and play again", async () => {
    await assertSucceeds(updateDoc(rec(asStew(), "r1"),
      { heldAt: deleteField(), modClearedAt: serverTimestamp(), modBy: "uStew", allowPlayback: true }));
    await assertSucceeds(getDoc(rec(asPublic(), "r1")));
    // cleared: a later report queues but can't hold
    await assertFails(reportVoice(asThird(), "r1", "uThird"));
  });
  it("can't play a voice whose speaker withdrew it", async () => {
    await assertFails(updateDoc(rec(asStew(), "rWithdrawn"), { modClearedAt: serverTimestamp(), modBy: "uStew", allowPlayback: true }));
  });
  it("can't play a voice whose speaker card is withdrawn", async () => {
    await testEnv.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), "afd_speakers", "spk_owner"), { consent: "withdrawn" }));
    await assertFails(updateDoc(rec(asStew(), "r1"), { heldAt: deleteField(), modClearedAt: serverTimestamp(), modBy: "uStew", allowPlayback: true }));
    await assertSucceeds(updateDoc(rec(asStew(), "r1"), { heldAt: deleteField(), modClearedAt: serverTimestamp(), modBy: "uStew" }));
  });
  it("hide → stays out; its owner still can't play it; steward can show again", async () => {
    await assertSucceeds(updateDoc(rec(asStew(), "r1"), { heldAt: deleteField(), modHiddenAt: serverTimestamp(), modBy: "uStew" }));
    await assertFails(updateDoc(rec(asOwner(), "r1"), { consent: "public", allowPlayback: true }));
    await assertSucceeds(updateDoc(rec(asStew(), "r1"),
      { modHiddenAt: deleteField(), modClearedAt: serverTimestamp(), modBy: "uStew", allowPlayback: true }));
  });
  it("a steward can't touch consent or the audio", async () => {
    await assertFails(updateDoc(rec(asStew(), "r1"), { consent: "deleted", modBy: "uStew" }));
    await assertFails(updateDoc(rec(asStew(), "r1"), { storagePath: "afd/uStew/x.webm", modBy: "uStew" }));
  });
  it("a steward must stamp who decided", async () => {
    await assertFails(updateDoc(rec(asStew(), "r1"), { heldAt: deleteField(), modClearedAt: serverTimestamp() }));
  });
  it("a steward can't put a hold on (that's a report's job)", async () => {
    await assertFails(updateDoc(rec(asStew(), "r2"), { heldAt: serverTimestamp(), modBy: "uStew", allowPlayback: false }));
  });
});

describe("reporting a word card", () => {
  it("anyone signed in reports and holds a contributed word", async () => {
    await assertSucceeds(reportCard(asOther(), "uOther"));
  });
  it("its creator can't", async () => {
    await assertFails(reportCard(asOwner(), "uOwner"));
  });
  it("a seeded word can be reported but not held", async () => {
    await assertFails(reportCard(asOther(), "uOther", { e: SEED }));
    await assertSucceeds(reportCard(asOther(), "uOther", { e: SEED, hold: false }));
  });
  it("steward clears it → a later report can't hold it again", async () => {
    await reportCard(asOther(), "uOther");
    await assertSucceeds(updateDoc(ent(asStew()), { heldAt: deleteField(), modClearedAt: serverTimestamp(), modBy: "uStew", reviewedAt: serverTimestamp() }));
    await assertFails(reportCard(asThird(), "uThird"));
    await assertSucceeds(reportCard(asThird(), "uThird", { hold: false }));
  });
  it("steward hides it (hiddenAt)", async () => {
    await reportCard(asOther(), "uOther");
    await assertSucceeds(updateDoc(ent(asStew()), { heldAt: deleteField(), hiddenAt: serverTimestamp(), modBy: "uStew" }));
  });
  it("nobody else releases it", async () => {
    await reportCard(asOther(), "uOther");
    await assertFails(updateDoc(ent(asOwner()), { heldAt: deleteField() }));
    await assertFails(updateDoc(ent(asOther()), { heldAt: deleteField() }));
  });
});

describe("the reports themselves", () => {
  beforeEach(async () => { await reportVoice(asOther(), "r1", "uOther"); });
  it("the reporter reads back their own (and can tell one doesn't exist yet)", async () => {
    await assertSucceeds(getDoc(flag(asOther(), vId("r1", "uOther"))));
    await assertSucceeds(getDoc(flag(asThird(), vId("r1", "uThird"))));
  });
  it("nobody else reads them; stewards list them", async () => {
    await assertFails(getDoc(flag(asOwner(), vId("r1", "uOther"))));
    await assertFails(getDocs(collection(asOther(), "afd_flags")));
    await assertSucceeds(getDocs(collection(asStew(), "afd_flags")));
  });
  it("only a steward resolves one", async () => {
    const r = { resolvedAt: serverTimestamp(), resolution: "approved", resolvedBy: "uStew" };
    await assertFails(updateDoc(flag(asOther(), vId("r1", "uOther")), { ...r, resolvedBy: "uOther" }));
    await assertSucceeds(updateDoc(flag(asStew(), vId("r1", "uOther")), r));
  });
});

describe("a steward's note to the contributor", () => {
  const N = { to: "uOwner", from: "uStew", entryId: E, recordingId: "r1", reason: "rude" };
  it("a steward sends one, with a spoken note in their own folder", async () => {
    await assertSucceeds(setDoc(note(asStew(), "n1"), { ...N, at: serverTimestamp(), audioPath: "afd_notices/uStew/n1.webm", text: "شكراً" }));
  });
  it("nobody else can", async () => {
    await assertFails(setDoc(note(asOther(), "n1"), { ...N, from: "uOther", at: serverTimestamp() }));
  });
  it("only its recipient (and stewards) read it; the recipient marks it seen once", async () => {
    await setDoc(note(asStew(), "n1"), { ...N, at: serverTimestamp() });
    await assertSucceeds(getDoc(note(asOwner(), "n1")));
    await assertSucceeds(getDocs(query(collection(asOwner(), "afd_notices"), where("to", "==", "uOwner"))));
    await assertFails(getDoc(note(asOther(), "n1")));
    await assertSucceeds(updateDoc(note(asOwner(), "n1"), { seenAt: serverTimestamp() }));
    await assertFails(updateDoc(note(asOwner(), "n1"), { seenAt: serverTimestamp() }));
    await assertFails(updateDoc(note(asOwner(), "n1"), { text: "edited" }));
  });
});
