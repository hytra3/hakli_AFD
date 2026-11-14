/**
 * Help voice-message channel (#7) — Firestore emulator suite
 * ============================================================================
 * The "leave a voice message" channel on the Help page (afd_help):
 *   • anyone signed in may leave one — including an anonymous sign-in (the Help
 *     page signs the person in anonymously), since a stuck non-reader has no
 *     account; audio must sit in their OWN folder, or it's text.
 *   • steward-only read; never public, never the corpus.
 *   • a steward marks one handled (resolvedAt/resolvedBy); nothing else, and no
 *     client delete (the TTL ages it out).
 *
 * RUN:  firebase emulators:exec --only firestore "cd test && node --test afd-help.rules.test.mjs"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, setLogLevel } from "firebase/firestore";

setLogLevel("error");
let testEnv;

const help = (db, id) => doc(db, "afd_help", id);
const soon = () => Timestamp.fromMillis(Date.now() + 179 * 864e5);   // within the 180-day cap

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const asUser = () => as("uUser"), asStew = () => as("uStew"), asOther = () => as("uOther");
const asAnon = () => testEnv.authenticatedContext("uAnon", { firebase: { sign_in_provider: "anonymous" } }).firestore();
const asPublic = () => testEnv.unauthenticatedContext().firestore();

// Build a message; a key set to undefined in `over` is DROPPED (the Firestore
// SDK rejects an undefined field value before the request reaches the rules),
// so `{ text: undefined }` means "no text", not "text = undefined".
const msg = (uid, over = {}) => {
  const m = { uid, at: serverTimestamp(), expireAt: soon(), page: "help", text: "please help", ...over };
  for(const k of Object.keys(m)) if(m[k] === undefined) delete m[k];
  return m;
};

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "afd-dev",
    firestore: { rules: readFileSync(new URL("../afd-firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "afd_admins", "uStew"), { at: 1 }));
});

describe("afd_help — leaving a message", () => {
  it("a signed-in person leaves a written message", async () => {
    await assertSucceeds(setDoc(help(asUser(), "m1"), msg("uUser")));
  });
  it("an anonymous person leaves a voice message in their own folder", async () => {
    await assertSucceeds(setDoc(help(asAnon(), "m1"), msg("uAnon", { text: undefined, audioPath: "afd_help/uAnon/m1.webm" })));
  });
  it("…but not pointing at someone else's folder", async () => {
    await assertFails(setDoc(help(asAnon(), "m1"), msg("uAnon", { text: undefined, audioPath: "afd_help/uOther/m1.webm" })));
  });
  it("the audio path must match the doc id", async () => {
    await assertFails(setDoc(help(asAnon(), "m1"), msg("uAnon", { text: undefined, audioPath: "afd_help/uAnon/other.webm" })));
  });
  it("a message must carry audio or text", async () => {
    await assertFails(setDoc(help(asUser(), "m1"), msg("uUser", { text: undefined })));
  });
  it("uid must be the signed-in account", async () => {
    await assertFails(setDoc(help(asUser(), "m1"), msg("uSomeoneElse")));
  });
  it("the time is the server's, not the client's", async () => {
    await assertFails(setDoc(help(asUser(), "m1"), msg("uUser", { at: Timestamp.fromMillis(Date.now()) })));
  });
  it("the expiry can't be more than 180 days out", async () => {
    await assertFails(setDoc(help(asUser(), "m1"), msg("uUser", { expireAt: Timestamp.fromMillis(Date.now() + 200 * 864e5) })));
  });
  it("over-long text is refused", async () => {
    await assertFails(setDoc(help(asUser(), "m1"), msg("uUser", { text: "x".repeat(601) })));
  });
  it("an unknown field is refused", async () => {
    await assertFails(setDoc(help(asUser(), "m1"), msg("uUser", { secret: 1 })));
  });
});

describe("afd_help — reading, resolving, deleting", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      setDoc(help(ctx.firestore(), "m1"), { uid: "uAnon", at: new Date(0), expireAt: soon(), page: "help", audioPath: "afd_help/uAnon/m1.webm" }));
  });
  it("only a steward reads the queue", async () => {
    await assertSucceeds(getDoc(help(asStew(), "m1")));
    await assertFails(getDoc(help(asOther(), "m1")));
    await assertFails(getDoc(help(asPublic(), "m1")));
  });
  it("even the sender can't read it back once filed", async () => {
    await assertFails(getDoc(help(asAnon(), "m1")));
  });
  it("a steward marks it handled", async () => {
    await assertSucceeds(updateDoc(help(asStew(), "m1"), { resolvedAt: serverTimestamp(), resolvedBy: "uStew" }));
  });
  it("a non-steward cannot resolve it", async () => {
    await assertFails(updateDoc(help(asOther(), "m1"), { resolvedAt: serverTimestamp(), resolvedBy: "uOther" }));
  });
  it("resolving can't smuggle another change", async () => {
    await assertFails(updateDoc(help(asStew(), "m1"), { resolvedAt: serverTimestamp(), resolvedBy: "uStew", text: "edited" }));
  });
  it("no client delete (the TTL ages it out)", async () => {
    await assertFails(deleteDoc(help(asStew(), "m1")));
  });
});
