/**
 * Steward citation-form flag (D-C) — Firestore emulator tests
 * ============================================================================
 * A steward may put a reversible `register: 'citation'` label on a WORD-slot
 * take, and remove it. It is a pure label over the frozen atom: only `register`
 * moves, and only on a word take. It is NOT canonical — several takes on a card
 * may carry it. Nobody but a steward may set it; it never rides along with a
 * consent, playback or slot change; and the only value it may take is
 * 'citation'.
 *
 *     firebase emulators:exec --only firestore "node --test test/citation.rules.test.mjs"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteField, setLogLevel } from "firebase/firestore";

setLogLevel("error");
let testEnv;

const rec = (db, id) => doc(db, "afd_entries", "ent_sun", "recordings", id);
const base = (over = {}) => ({
  uid: "uOwner", speakerId: "spk_owner", consent: "public", allowPlayback: true,
  entryId: "ent_sun", gloss: "sun", capture: { sampleRate: 48000 }, ...over,
});
const asStew  = () => testEnv.authenticatedContext("uStew").firestore();
const asOwner = () => testEnv.authenticatedContext("uOwner").firestore();
const asAnon  = () => testEnv.authenticatedContext("uAnon", { firebase: { sign_in_provider: "anonymous" } }).firestore();

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "afd-dev",
    firestore: { rules: readFileSync(new URL("../afd-firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "afd_admins", "uStew"), { at: 1 });
    await setDoc(doc(db, "afd_speakers", "spk_owner"), { stewardUid: "uOwner", viaAgent: false, consent: "public", masked: false });
    await setDoc(rec(db, "w1"), base({ type: "word", phase: "word", lang: "qhk" }));
    await setDoc(rec(db, "w2"), base({ type: "word", phase: "word", lang: "qhk" }));
    await setDoc(rec(db, "w_old"), base({ phase: "word", lang: "qhk" }));             // phase only, pre-`type`
    await setDoc(rec(db, "w_cited"), base({ type: "word", phase: "word", register: "citation" }));
    await setDoc(rec(db, "s1"), base({ type: "context", phase: "context" }));
    await setDoc(rec(db, "m1"), base({ type: "definition", phase: "definition" }));
    await setDoc(rec(db, "n1"), base({ type: "note", phase: "note", lang: "ar" }));
  });
});

describe("a steward marks and unmarks a citation form", () => {
  it("marks a word take", async () => {
    await assertSucceeds(updateDoc(rec(asStew(), "w1"), { register: "citation" }));
  });
  it("unmarks one (removes the field)", async () => {
    await assertSucceeds(updateDoc(rec(asStew(), "w_cited"), { register: deleteField() }));
  });
  it("a word take marked only by phase counts too", async () => {
    await assertSucceeds(updateDoc(rec(asStew(), "w_old"), { register: "citation" }));
  });
  it("is not canonical — several takes on a card may carry it", async () => {
    await assertSucceeds(updateDoc(rec(asStew(), "w1"), { register: "citation" }));
    await assertSucceeds(updateDoc(rec(asStew(), "w2"), { register: "citation" }));
  });
});

describe("…and nothing else", () => {
  it("only a steward can set it — not the take's owner", async () => {
    await assertFails(updateDoc(rec(asOwner(), "w1"), { register: "citation" }));
  });
  it("an anonymous (prompts tool) sign-in can't", async () => {
    await assertFails(updateDoc(rec(asAnon(), "w1"), { register: "citation" }));
  });
  it("only on a word take — not a sentence, meaning or note", async () => {
    await assertFails(updateDoc(rec(asStew(), "s1"), { register: "citation" }));
    await assertFails(updateDoc(rec(asStew(), "m1"), { register: "citation" }));
    await assertFails(updateDoc(rec(asStew(), "n1"), { register: "citation" }));
  });
  it("the only value is 'citation'", async () => {
    await assertFails(updateDoc(rec(asStew(), "w1"), { register: "clean" }));
    await assertFails(updateDoc(rec(asStew(), "w1"), { register: 7 }));
  });
  it("only register moves — not consent, playback or the slot", async () => {
    await assertFails(updateDoc(rec(asStew(), "w1"), { register: "citation", allowPlayback: false }));
    await assertFails(updateDoc(rec(asStew(), "w1"), { register: "citation", consent: "withdrawn" }));
    await assertFails(updateDoc(rec(asStew(), "w1"), { register: "citation", type: "note" }));
    await assertFails(updateDoc(rec(asStew(), "w1"), { register: "citation", gloss: "moon" }));
  });
});
