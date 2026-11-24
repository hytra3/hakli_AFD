/**
 * Steward promote / dismiss of a scanned candidate spelling (D-B) — emulator tests
 * ============================================================================
 * A seeded card may carry a review-only `spellingCandidate` (Fatma's written Hakli
 * from the glossing sheet). A steward can PROMOTE it — write the real spelling
 * under the reserved `seed` writer (by:'seed', project-attributed, never a person)
 * and clear the candidate — or DISMISS it (clear the candidate, no spelling). A
 * promoted spelling is otherwise an ordinary spelling; a steward may also remove
 * the seed one. Nobody but a steward can do any of this, and the candidate clear
 * can't piggyback other entry changes.
 *
 *     firebase emulators:exec --only firestore "node --test test/spelling-candidate.rules.test.mjs"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, setLogLevel } from "firebase/firestore";

setLogLevel("error");
let testEnv;

const ENT = "ent_sun";
const entry = (db) => doc(db, "afd_entries", ENT);
const spell = (db, writer) => doc(db, "afd_entries", ENT, "spellings", writer);
const seedSpell = () => ({ text: "بَعِير", searchKey: "بعير", lang: "qhk-Arab", by: "seed", at: serverTimestamp() });

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
    await setDoc(entry(db), { gloss: "sun", glossAr: "الشمس", spellingCandidate: "بَعِير", spellingCandidatePl: "رؤوس" });
  });
});

describe("a steward promotes a candidate", () => {
  it("writes the real spelling under the reserved 'seed' writer", async () => {
    await assertSucceeds(setDoc(spell(asStew(), "seed"), seedSpell()));
  });
  it("clears the candidate fields on the entry", async () => {
    await assertSucceeds(updateDoc(entry(asStew()), { spellingCandidate: deleteField(), spellingCandidatePl: deleteField() }));
  });
  it("a steward can remove a promoted seed spelling again", async () => {
    await assertSucceeds(setDoc(spell(asStew(), "seed"), seedSpell()));
    await assertSucceeds(deleteDoc(spell(asStew(), "seed")));
  });
});

describe("a steward dismisses a candidate", () => {
  it("clears the candidate without writing a spelling", async () => {
    await assertSucceeds(updateDoc(entry(asStew()), { spellingCandidate: deleteField() }));
  });
});

describe("…and nobody else, and nothing else", () => {
  it("only a steward writes a 'seed' spelling", async () => {
    await assertFails(setDoc(spell(asOwner(), "seed"), seedSpell()));
    await assertFails(setDoc(spell(asAnon(), "seed"), seedSpell()));
  });
  it("a 'seed' spelling must be attributed to 'seed', not a uid", async () => {
    await assertFails(setDoc(spell(asStew(), "seed"), { ...seedSpell(), by: "uStew" }));
  });
  it("only a steward clears the candidate", async () => {
    await assertFails(updateDoc(entry(asOwner()), { spellingCandidate: deleteField() }));
  });
  it("clearing the candidate can't piggyback another entry change", async () => {
    await assertFails(updateDoc(entry(asStew()), { spellingCandidate: deleteField(), gloss: "moon" }));
  });
  it("a steward can't delete someone else's real spelling via the seed path", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "afd_entries", ENT, "spellings", "uOwner"),
        { text: "x", searchKey: "x", lang: "qhk-Arab", by: "uOwner", at: new Date() });
    });
    await assertFails(deleteDoc(spell(asStew(), "uOwner")));
  });
  it("a regular user's own spelling still works (unchanged)", async () => {
    await assertSucceeds(setDoc(spell(asOwner(), "uOwner"),
      { text: "بَعِير", searchKey: "بعير", lang: "qhk-Arab", by: "uOwner", at: serverTimestamp() }));
  });
});
