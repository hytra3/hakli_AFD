/**
 * Spellings — Firestore emulator test suite
 * ============================================================================
 * afd_entries/{entryId}/spellings/{writer}: the word itself written in letters.
 *   • any number per card, ONE per writer: the doc id is the writer's uid, and
 *     `by` must say the same — attribution can't be forged;
 *   • no canonical spelling: no flag a writer or steward can set to rank one;
 *   • a writer may change or remove their own; nobody else's;
 *   • a steward may hide one and show it again, never edit its words;
 *   • anyone may read, including every card's at once (collection group).
 *
 * RUN (needs Java for the emulator):
 *
 *     cd test && npm install && cd ..
 *     firebase emulators:exec --only firestore "node --test test/spellings.rules.test.mjs"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collectionGroup, deleteField,
         serverTimestamp, setLogLevel } from "firebase/firestore";

setLogLevel("error");

let testEnv;
const ID = "ent_sun";

const ctx = (uid, anon) => anon
  ? testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } })
  : testEnv.authenticatedContext(uid);
const fsAs   = (uid, anon) => ctx(uid, anon).firestore();
const publik = () => testEnv.unauthenticatedContext().firestore();
const sp = (db, writer, id = ID) => doc(db, "afd_entries", id, "spellings", writer);
const good = (uid, text = "شُوم") =>
  ({ text, searchKey: "شوم", lang: "qhk-Arab", by: uid, at: serverTimestamp() });

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "afd-dev",
    firestore: { rules: readFileSync(new URL("../afd-firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "afd_admins", "uSteward"), { grantedAt: 1 });
    await setDoc(doc(db, "afd_entries", ID), { gloss: "sun", glossAr: "الشمس" });
  });
});
const seedSpelling = async (uid, extra = {}) => testEnv.withSecurityRulesDisabled(async (c) =>
  setDoc(sp(c.firestore(), uid), { text: "شُوم", searchKey: "شوم", lang: "qhk-Arab", by: uid, at: new Date(), ...extra }));

describe("writing a spelling", () => {
  it("a named account writes its own spelling", async () => {
    await assertSucceeds(setDoc(sp(fsAs("uA"), "uA"), good("uA")));
  });
  it("two people each write their own on the same card", async () => {
    await assertSucceeds(setDoc(sp(fsAs("uA"), "uA"), good("uA")));
    await assertSucceeds(setDoc(sp(fsAs("uB"), "uB"), good("uB", "شمس")));
  });
  it("not under someone else's id", async () => {
    await assertFails(setDoc(sp(fsAs("uA"), "uB"), good("uB")));
  });
  it("not attributed to someone else", async () => {
    await assertFails(setDoc(sp(fsAs("uA"), "uA"), { ...good("uA"), by: "uB" }));
  });
  it("not by the anonymous prompt-tool key, nor signed out", async () => {
    await assertFails(setDoc(sp(fsAs("uA", true), "uA"), good("uA")));
    await assertFails(setDoc(sp(publik(), "uA"), good("uA")));
  });
  it("no ranking or extra fields", async () => {
    await assertFails(setDoc(sp(fsAs("uA"), "uA"), { ...good("uA"), canonical: true }));
    await assertFails(setDoc(sp(fsAs("uA"), "uA"), { ...good("uA"), hiddenAt: serverTimestamp() }));
  });
  it("text must be 1–60 characters, with a search key and a language tag", async () => {
    await assertFails(setDoc(sp(fsAs("uA"), "uA"), { ...good("uA"), text: "" }));
    await assertFails(setDoc(sp(fsAs("uA"), "uA"), { ...good("uA"), text: "ش".repeat(61) }));
    await assertFails(setDoc(sp(fsAs("uA"), "uA"), { ...good("uA"), lang: "Hakli!" }));
    const { searchKey, ...noKey } = good("uA");
    await assertFails(setDoc(sp(fsAs("uA"), "uA"), noKey));
  });
  it("the time is the server's", async () => {
    await assertFails(setDoc(sp(fsAs("uA"), "uA"), { ...good("uA"), at: new Date(2020, 0, 1) }));
  });
  it("only on a card that exists", async () => {
    await assertFails(setDoc(sp(fsAs("uA"), "uA", "ent_nope"), good("uA")));
  });
});

describe("changing or removing", () => {
  it("the writer changes their words", async () => {
    await seedSpelling("uA");
    await assertSucceeds(updateDoc(sp(fsAs("uA"), "uA"),
      { text: "شُوْم", searchKey: "شوم", lang: "qhk-Arab", at: serverTimestamp() }));
  });
  it("a second save of the whole doc is an edit (a retry can't double up)", async () => {
    await seedSpelling("uA");
    await assertSucceeds(setDoc(sp(fsAs("uA"), "uA"), good("uA", "شوم")));
  });
  it("nobody else changes them — a steward neither", async () => {
    await seedSpelling("uA");
    await assertFails(updateDoc(sp(fsAs("uB"), "uA"), { text: "x", at: serverTimestamp() }));
    await assertFails(updateDoc(sp(fsAs("uSteward"), "uA"), { text: "x", at: serverTimestamp() }));
  });
  it("the writer can't reassign it or unhide it", async () => {
    await seedSpelling("uA");
    await assertFails(updateDoc(sp(fsAs("uA"), "uA"), { by: "uB" }));
    await seedSpelling("uA", { hiddenAt: new Date() });
    await assertFails(updateDoc(sp(fsAs("uA"), "uA"), { hiddenAt: deleteField() }));
    // an edit that leaves "hidden" alone still goes through
    await assertSucceeds(updateDoc(sp(fsAs("uA"), "uA"), { text: "شم", searchKey: "شم", at: serverTimestamp() }));
  });
  it("the writer removes their own; nobody else can", async () => {
    await seedSpelling("uA");
    await assertFails(deleteDoc(sp(fsAs("uB"), "uA")));
    await assertFails(deleteDoc(sp(fsAs("uSteward"), "uA")));
    await assertSucceeds(deleteDoc(sp(fsAs("uA"), "uA")));
  });
});

describe("steward: hide and show", () => {
  it("a steward hides a spelling and shows it again", async () => {
    await seedSpelling("uA");
    await assertSucceeds(updateDoc(sp(fsAs("uSteward"), "uA"), { hiddenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(sp(fsAs("uSteward"), "uA"), { hiddenAt: deleteField() }));
  });
  it("only a steward, and only to now", async () => {
    await seedSpelling("uA");
    await assertFails(updateDoc(sp(fsAs("uB"), "uA"), { hiddenAt: serverTimestamp() }));
    await assertFails(updateDoc(sp(fsAs("uSteward"), "uA"), { hiddenAt: new Date(2020, 0, 1) }));
  });
});

describe("reading", () => {
  it("anyone reads one card's spelling, and every card's at once", async () => {
    await seedSpelling("uA");
    await assertSucceeds(getDoc(sp(publik(), "uA")));
    await assertSucceeds(getDocs(collectionGroup(publik(), "spellings")));
  });
});
