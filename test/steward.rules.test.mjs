/**
 * Contributor (steward) profile rules — Firestore emulator test suite
 * ============================================================================
 * Guards afd_stewards/{uid} — a steward's OWN opt-in public identity.
 * Public-readable; owner-only, non-anonymous write; delete closed. The rule
 * enforces the presence model: a displayName may exist ONLY while "known", so
 * switching back to "obscure" cannot leave a name behind for others to read.
 *
 * RUN (needs Java for the emulator):
 *
 *     cd test && npm install && cd ..
 *     firebase emulators:exec --only firestore "node --test test/steward.rules.test.mjs"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, setLogLevel } from "firebase/firestore";

setLogLevel("error"); // expected permission-denied logs; keep output clean

let testEnv;

const stw = (db, uid) => doc(db, "afd_stewards", uid);

// uSelf — the account holder; uOther — a stranger; uAnon — anonymous sign-in.
const asSelf   = () => testEnv.authenticatedContext("uSelf").firestore();
const asAnon   = () => testEnv.authenticatedContext("uAnon", { firebase: { sign_in_provider: "anonymous" } }).firestore();
const asPublic = () => testEnv.unauthenticatedContext().firestore();

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "afd-dev",
    firestore: { rules: readFileSync(new URL("../afd-firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

describe("steward profile — write", () => {
  it("owner creates an obscure profile (no name)", async () => {
    await assertSucceeds(setDoc(stw(asSelf(), "uSelf"), { visibility: "obscure" }));
  });
  it("owner becomes known with a display name", async () => {
    await assertSucceeds(setDoc(stw(asSelf(), "uSelf"), { visibility: "known", displayName: "Ali al-Shahri" }));
  });
  it("obscure WITH a name is rejected (presence rule)", async () => {
    await assertFails(setDoc(stw(asSelf(), "uSelf"), { visibility: "obscure", displayName: "Ali" }));
  });
  it("switching to obscure with an empty name is allowed", async () => {
    await assertSucceeds(setDoc(stw(asSelf(), "uSelf"), { visibility: "obscure", displayName: "" }));
  });
  it("an unknown visibility value is rejected", async () => {
    await assertFails(setDoc(stw(asSelf(), "uSelf"), { visibility: "public" }));
  });
  it("an over-long display name is rejected", async () => {
    await assertFails(setDoc(stw(asSelf(), "uSelf"), { visibility: "known", displayName: "x".repeat(81) }));
  });
  it("cannot write another account's profile", async () => {
    await assertFails(setDoc(stw(asSelf(), "uOther"), { visibility: "known", displayName: "Not mine" }));
  });
  it("anonymous sign-in cannot write a profile", async () => {
    await assertFails(setDoc(stw(asAnon(), "uAnon"), { visibility: "known", displayName: "Anon" }));
  });
});

describe("steward profile — read + delete", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(stw(ctx.firestore(), "uSelf"), { visibility: "known", displayName: "Ali al-Shahri" });
    });
  });
  it("the public can read a profile (a known name is meant to be seen)", async () => {
    await assertSucceeds(getDoc(stw(asPublic(), "uSelf")));
  });
  it("the profile doc cannot be deleted from the client", async () => {
    await assertFails(deleteDoc(stw(asSelf(), "uSelf")));
  });
});
