/**
 * Field error log — Firestore emulator test suite
 * ============================================================================
 * afd_client_errors/{id} is written by afd-core's report() from any visitor,
 * signed in or not, so the rule has to hold the SHAPE: no extra fields (no
 * uid, no user agent, no words), short strings, the server's own time, and an
 * expiry no more than 31 days out. Only stewards (afd_admins) read or clear.
 *
 * RUN:  firebase emulators:exec --only firestore "cd test && npm test"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection,
  serverTimestamp, Timestamp, setLogLevel,
} from "firebase/firestore";

setLogLevel("error");

let testEnv;
const asSteward = () => testEnv.authenticatedContext("uSteward").firestore();
const asContrib = () => testEnv.authenticatedContext("uContrib").firestore();
const asPublic  = () => testEnv.unauthenticatedContext().firestore();

const inDays = d => Timestamp.fromMillis(Date.now() + d * 864e5);
const good = (extra = {}) => ({
  page: "index.html", where: "search", code: "http 503", msg: "http 503",
  build: "b1016d", online: true, os: "android",
  at: serverTimestamp(), expireAt: inDays(30), ...extra,
});
const col = db => collection(db, "afd_client_errors");

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
    await setDoc(doc(ctx.firestore(), "afd_admins", "uSteward"), { note: "steward" });
    await setDoc(doc(ctx.firestore(), "afd_client_errors", "e1"), { page: "add.html", where: "add.share.word", code: "x" });
  });
});

describe("afd_client_errors — writing", () => {
  it("a visitor who never signed in can add one", async () => {
    await assertSucceeds(addDoc(col(asPublic()), good()));
  });
  it("a signed-in contributor can add one", async () => {
    await assertSucceeds(addDoc(col(asContrib()), good()));
  });
  it("the minimum: page, where, code, at, expireAt", async () => {
    await assertSucceeds(addDoc(col(asPublic()), {
      page: "recorder.html", where: "recorder.upload", code: "unavailable",
      at: serverTimestamp(), expireAt: inDays(30) }));
  });
  it("refuses an extra field (a uid, a user agent…)", async () => {
    await assertFails(addDoc(col(asPublic()), good({ uid: "uContrib" })));
    await assertFails(addDoc(col(asPublic()), good({ ua: "Mozilla/5.0" })));
  });
  it("refuses a missing required field", async () => {
    const d = good(); delete d.code;
    await assertFails(addDoc(col(asPublic()), d));
  });
  it("refuses long strings", async () => {
    await assertFails(addDoc(col(asPublic()), good({ msg: "x".repeat(301) })));
    await assertFails(addDoc(col(asPublic()), good({ where: "x".repeat(61) })));
  });
  it("refuses an unknown OS label and a non-boolean online", async () => {
    await assertFails(addDoc(col(asPublic()), good({ os: "Pixel 7 / Android 14" })));
    await assertFails(addDoc(col(asPublic()), good({ online: "yes" })));
  });
  it("refuses a client-chosen time", async () => {
    await assertFails(addDoc(col(asPublic()), good({ at: Timestamp.fromMillis(Date.now() - 864e5) })));
  });
  it("refuses an expiry more than 31 days out, or no expiry", async () => {
    await assertFails(addDoc(col(asPublic()), good({ expireAt: inDays(60) })));
    const d = good(); delete d.expireAt;
    await assertFails(addDoc(col(asPublic()), d));
  });
});

describe("afd_client_errors — reading and clearing", () => {
  it("the steward reads and lists them", async () => {
    await assertSucceeds(getDoc(doc(asSteward(), "afd_client_errors", "e1")));
    await assertSucceeds(getDocs(col(asSteward())));
  });
  it("nobody else reads them", async () => {
    await assertFails(getDoc(doc(asContrib(), "afd_client_errors", "e1")));
    await assertFails(getDocs(col(asContrib())));
    await assertFails(getDocs(col(asPublic())));
  });
  it("only the steward deletes; nobody edits", async () => {
    await assertFails(deleteDoc(doc(asContrib(), "afd_client_errors", "e1")));
    await assertFails(updateDoc(doc(asSteward(), "afd_client_errors", "e1"), { code: "y" }));
    await assertSucceeds(deleteDoc(doc(asSteward(), "afd_client_errors", "e1")));
  });
});
