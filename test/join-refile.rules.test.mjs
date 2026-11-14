/**
 * Join, refile and the provenance ledger (#6) — Firestore emulator suite
 * ============================================================================
 * Steward corrections, all non-destructive:
 *   • JOIN — a steward marks a card `mergedInto` a survivor (reversible,
 *     chain-proof, survivor must exist); nobody else may.
 *   • REFILE copy — a steward re-homes a take by creating a copy that MUST
 *     mirror the source exactly (uid, speaker, audio, consent, playback). A
 *     copy that elevates, re-attributes or borrows other audio is refused.
 *   • REFILE tombstone — the source take leaves its card (allowPlayback off,
 *     refiledTo) with consent untouched.
 *   • LEDGER — steward-only, append-only; no edits, no deletes.
 *
 * RUN:  firebase emulators:exec --only firestore "cd test && node --test join-refile.rules.test.mjs"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteField, serverTimestamp,
         collection, setLogLevel } from "firebase/firestore";

setLogLevel("error");
let testEnv;

const A = "ent_u_a", B = "ent_u_b", C = "ent_u_c";   // A merges into B; C is a second survivor
const ent = (db, id) => doc(db, "afd_entries", id);
const rec = (db, e, id) => doc(db, "afd_entries", e, "recordings", id);
const led = (db, e, id) => doc(db, "afd_entries", e, "ledger", id);

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const asStew = () => as("uStew"), asOwner = () => as("uOwner"), asOther = () => as("uOther");
const asAnon = () => testEnv.authenticatedContext("uAnon", { firebase: { sign_in_provider: "anonymous" } }).firestore();

// a recording as the recorder/upload writes it
const baseRec = (over = {}) => ({ uid: "uOwner", speakerId: "spk_owner", consent: "public", allowPlayback: true,
  entryId: A, gloss: "word", capture: { sampleRate: 48000 }, storagePath: "afd/uOwner/rA1.webm", ...over });

// a faithful refile copy of source take `src` onto entry `to`, as the steward tool builds it
const copyOf = (src, to, from, srcId, over = {}) => ({
  uid: src.uid, speakerId: src.speakerId, consent: src.consent, allowPlayback: src.allowPlayback,
  storagePath: src.storagePath, gloss: src.gloss, capture: src.capture,
  entryId: to, recordingId: "refileNew",
  refiledFrom: { entryId: from, recordingId: srcId }, refiledBy: "uStew", refiledAt: serverTimestamp(),
  ...over });

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "afd_admins", "uStew"), { at: 1 });
    await setDoc(doc(db, "afd_speakers", "spk_owner"), { stewardUid: "uOwner", viaAgent: false, consent: "public", masked: false });
    await setDoc(ent(db, A), { source: "user", createdBy: "uOwner", gloss: "word" });
    await setDoc(ent(db, B), { source: "user", createdBy: "uOwner", gloss: "word" });
    await setDoc(ent(db, C), { source: "user", createdBy: "uOwner", gloss: "word" });
    await setDoc(rec(db, A, "rA1"), baseRec());
    await setDoc(rec(db, A, "rA2"), baseRec({ consent: "withdrawn", allowPlayback: false, storagePath: "afd/uOwner/rA2.webm" }));
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

const mergeInto = (db, from, to) => updateDoc(ent(db, from), { mergedInto: to, mergedAt: serverTimestamp(), mergedBy: "uStew" });

describe("join — mergedInto", () => {
  it("a steward joins a card into an existing survivor", async () => {
    await assertSucceeds(mergeInto(asStew(), A, B));
  });
  it("a non-steward cannot", async () => {
    await assertFails(mergeInto(asOwner(), A, B));
    await assertFails(mergeInto(asOther(), A, B));
  });
  it("cannot merge a card into itself", async () => {
    await assertFails(mergeInto(asStew(), A, A));
  });
  it("the survivor must exist", async () => {
    await assertFails(mergeInto(asStew(), A, "ent_u_missing"));
  });
  it("cannot chain: the survivor must not itself be merged", async () => {
    await assertSucceeds(mergeInto(asStew(), B, C));          // B is now merged into C
    await assertFails(mergeInto(asStew(), A, B));             // so A may not merge into B
  });
  it("cannot set mergedInto without the stamp", async () => {
    await assertFails(updateDoc(ent(asStew(), A), { mergedInto: B }));
  });
  it("cannot sneak another field in with the merge", async () => {
    await assertFails(updateDoc(ent(asStew(), A), { mergedInto: B, mergedAt: serverTimestamp(), mergedBy: "uStew", gloss: "x" }));
  });
  it("mergedBy must be the acting steward", async () => {
    await assertFails(updateDoc(ent(asStew(), A), { mergedInto: B, mergedAt: serverTimestamp(), mergedBy: "uSomeoneElse" }));
  });
  it("a steward can undo a join (clear mergedInto)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      setDoc(ent(ctx.firestore(), A), { source: "user", createdBy: "uOwner", gloss: "word", mergedInto: B, mergedAt: new Date(0), mergedBy: "uStew" }));
    await assertSucceeds(updateDoc(ent(asStew(), A), { mergedInto: deleteField(), mergedAt: deleteField(), mergedBy: deleteField() }));
  });
});

describe("refile — copy half (create under the destination)", () => {
  it("a steward copies a take, mirroring the source exactly", async () => {
    const src = baseRec();
    await assertSucceeds(setDoc(rec(asStew(), B, "refileNew"), copyOf(src, B, A, "rA1")));
  });
  it("a non-steward cannot create a refile copy", async () => {
    const src = baseRec();
    await assertFails(setDoc(rec(asOwner(), B, "refileNew"), copyOf(src, B, A, "rA1")));
  });
  it("the copy cannot ELEVATE playback above the source", async () => {
    const src = baseRec({ consent: "withdrawn", allowPlayback: false, storagePath: "afd/uOwner/rA2.webm" });
    await assertFails(setDoc(rec(asStew(), B, "refileNew"),
      copyOf(src, B, A, "rA2", { allowPlayback: true })));          // source is hidden; copy claims playable
  });
  it("the copy cannot RE-ATTRIBUTE the owner", async () => {
    const src = baseRec();
    await assertFails(setDoc(rec(asStew(), B, "refileNew"), copyOf(src, B, A, "rA1", { uid: "uStew" })));
  });
  it("the copy cannot borrow other audio (storagePath must match source)", async () => {
    const src = baseRec();
    await assertFails(setDoc(rec(asStew(), B, "refileNew"), copyOf(src, B, A, "rA1", { storagePath: "afd/uOwner/rA2.webm" })));
  });
  it("the copy cannot change the speaker", async () => {
    const src = baseRec();
    await assertFails(setDoc(rec(asStew(), B, "refileNew"), copyOf(src, B, A, "rA1", { speakerId: "spk_other" })));
  });
  it("the source take must exist", async () => {
    const src = baseRec();
    await assertFails(setDoc(rec(asStew(), B, "refileNew"), copyOf(src, B, A, "rNope")));
  });
  it("refiledFrom cannot point at the destination itself", async () => {
    const src = baseRec();
    await assertFails(setDoc(rec(asStew(), B, "refileNew"), copyOf(src, B, B, "rA1")));
  });
});

describe("refile — tombstone half (retire the source)", () => {
  const tombstone = (db, extra = {}) => updateDoc(rec(db, A, "rA1"),
    { refiledTo: { entryId: B, recordingId: "refileNew" }, refiledBy: "uStew", refiledAt: serverTimestamp(), allowPlayback: false, ...extra });
  it("a steward tombstones the moved take", async () => {
    await assertSucceeds(tombstone(asStew()));
  });
  it("a non-steward cannot", async () => {
    await assertFails(tombstone(asOwner()));
  });
  it("the tombstone cannot leave the take playable", async () => {
    await assertFails(updateDoc(rec(asStew(), A, "rA1"),
      { refiledTo: { entryId: B, recordingId: "refileNew" }, refiledBy: "uStew", refiledAt: serverTimestamp(), allowPlayback: true }));
  });
  it("the tombstone must not touch consent", async () => {
    await assertFails(tombstone(asStew(), { consent: "withdrawn" }));
  });
});

describe("provenance ledger", () => {
  const event = (over = {}) => ({ type: "join", at: serverTimestamp(), by: "uStew", entryId: B, from: A, ...over });
  it("a steward appends an event", async () => {
    await assertSucceeds(setDoc(led(asStew(), B, "e1"), event()));
  });
  it("a non-steward cannot append", async () => {
    await assertFails(setDoc(led(asOwner(), B, "e1"), event({ by: "uOwner" })));
  });
  it("only a steward may read the ledger", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => setDoc(led(ctx.firestore(), B, "e1"), { type: "join", at: new Date(0), by: "uStew", entryId: B }));
    await assertSucceeds(getDoc(led(asStew(), B, "e1")));
    await assertFails(getDoc(led(asOwner(), B, "e1")));
  });
  it("by must be the acting steward", async () => {
    await assertFails(setDoc(led(asStew(), B, "e1"), event({ by: "uOwner" })));
  });
  it("an unknown field is refused", async () => {
    await assertFails(setDoc(led(asStew(), B, "e1"), event({ bogus: 1 })));
  });
  it("the ledger is append-only (no edits, no deletes)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => setDoc(led(ctx.firestore(), B, "e1"), { type: "join", at: new Date(0), by: "uStew", entryId: B }));
    await assertFails(updateDoc(led(asStew(), B, "e1"), { type: "edited" }));
  });
});
