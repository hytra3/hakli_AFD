/**
 * Search vectors (10-19) — afd_vectors/{recordingId} is server-only.
 * The embed trigger writes it and the matcher reads it, both with the Admin
 * SDK. No client — signed in, steward or not — may read or write a vector.
 *   firebase emulators:exec --only firestore "cd test && npm test"
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, collection, setLogLevel } from "firebase/firestore";

setLogLevel("error");
let testEnv;
before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: "afd-dev",
    firestore: { rules: readFileSync(new URL("../afd-firestore.rules", import.meta.url), "utf8") } });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "afd_admins", "uSteward"), { note: "steward" });
    await setDoc(doc(ctx.firestore(), "afd_vectors", "rec1"), { recordingId: "rec1", entryId: "ent_sun", reps: [{ vector: [1, 0] }] });
  });
});

describe("afd_vectors — closed to every client", () => {
  for (const [who, ctx] of [["visitor", () => testEnv.unauthenticatedContext()],
                            ["contributor", () => testEnv.authenticatedContext("uA")],
                            ["steward", () => testEnv.authenticatedContext("uSteward")]]) {
    it(`a ${who} can't read, list or write a vector`, async () => {
      const db = ctx().firestore();
      await assertFails(getDoc(doc(db, "afd_vectors", "rec1")));
      await assertFails(getDocs(collection(db, "afd_vectors")));
      await assertFails(setDoc(doc(db, "afd_vectors", "rec2"), { reps: [] }));
    });
  }
});
