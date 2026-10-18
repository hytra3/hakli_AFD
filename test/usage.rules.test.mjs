/**
 * Usage counts and totals — Firestore emulator test suite
 * ============================================================================
 * afd_events/{id} is written by afd-core's track() from any visitor, signed in
 * or not. The rule holds the SHAPE, so a count can never carry who made it:
 * no uid, no session id, no words — only what happened, short labels, a
 * number, the page, the display mode, build, online, OS family, the server's
 * time and an expiry ≤ 92 days. Stewards read; nobody edits or deletes.
 * afd_stats/{id}: "public" is readable by anyone (Help's counter); the rest
 * (day totals, the watch state) by stewards; only the server writes.
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
  ev: "search", v: "here", n: 2100, page: "index.html", mode: "sound",
  build: "b1017b", online: true, os: "android",
  at: serverTimestamp(), expireAt: inDays(90), ...extra,
});
const col = db => collection(db, "afd_events");

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
    await setDoc(doc(db, "afd_admins", "uSteward"), { note: "steward" });
    await setDoc(doc(db, "afd_events", "e1"), { ev: "play", v: "word", page: "index.html" });
    await setDoc(doc(db, "afd_stats", "public"), { words: 3, voices: 9, speakers: 2 });
    await setDoc(doc(db, "afd_stats", "day_2026-10-17"), { counts: { "search|here": 4 } });
    await setDoc(doc(db, "afd_stats", "watch"), { recent: [] });
  });
});

describe("afd_events — writing", () => {
  it("a visitor who never signed in can add one", async () => {
    await assertSucceeds(addDoc(col(asPublic()), good()));
  });
  it("the minimum: ev, page, at, expireAt", async () => {
    await assertSucceeds(addDoc(col(asContrib()), {
      ev: "help", page: "help.html", at: serverTimestamp(), expireAt: inDays(90) }));
  });
  it("refuses anything that could say who: a uid, a session, an email, a word", async () => {
    for (const extra of [{ uid: "uContrib" }, { session: "abc123" }, { email: "f@example.org" }, { word: "camel" }]) {
      await assertFails(addDoc(col(asPublic()), good(extra)));
    }
  });
  it("refuses long labels, and a too-long ev", async () => {
    await assertFails(addDoc(col(asPublic()), good({ v: "x".repeat(25) })));
    await assertFails(addDoc(col(asPublic()), good({ x: "x".repeat(25) })));
    await assertFails(addDoc(col(asPublic()), good({ ev: "x".repeat(25) })));
  });
  it("n must be a whole number from 0 to 10,000,000", async () => {
    await assertFails(addDoc(col(asPublic()), good({ n: -1 })));
    await assertFails(addDoc(col(asPublic()), good({ n: 1.5 })));
    await assertFails(addDoc(col(asPublic()), good({ n: 10000001 })));
    await assertFails(addDoc(col(asPublic()), good({ n: "12" })));
  });
  it("refuses an unknown display mode or OS label", async () => {
    await assertFails(addDoc(col(asPublic()), good({ mode: "dark" })));
    await assertFails(addDoc(col(asPublic()), good({ os: "Pixel 7" })));
  });
  it("refuses a client-chosen time, and an expiry past 92 days", async () => {
    await assertFails(addDoc(col(asPublic()), good({ at: Timestamp.fromMillis(Date.now() - 864e5) })));
    await assertFails(addDoc(col(asPublic()), good({ expireAt: inDays(120) })));
  });
});

describe("afd_events — reading", () => {
  it("the steward reads and lists them", async () => {
    await assertSucceeds(getDoc(doc(asSteward(), "afd_events", "e1")));
    await assertSucceeds(getDocs(col(asSteward())));
  });
  it("nobody else does", async () => {
    await assertFails(getDocs(col(asContrib())));
    await assertFails(getDocs(col(asPublic())));
  });
  it("nobody edits or deletes, not even the steward", async () => {
    await assertFails(updateDoc(doc(asSteward(), "afd_events", "e1"), { v: "x" }));
    await assertFails(deleteDoc(doc(asSteward(), "afd_events", "e1")));
  });
});

describe("afd_stats", () => {
  it("anyone reads the public totals", async () => {
    await assertSucceeds(getDoc(doc(asPublic(), "afd_stats", "public")));
  });
  it("only stewards read the day totals and the watch state", async () => {
    await assertFails(getDoc(doc(asPublic(), "afd_stats", "day_2026-10-17")));
    await assertFails(getDoc(doc(asContrib(), "afd_stats", "watch")));
    await assertFails(getDocs(collection(asContrib(), "afd_stats")));
    await assertSucceeds(getDocs(collection(asSteward(), "afd_stats")));
  });
  it("no client writes them, not even the steward", async () => {
    await assertFails(setDoc(doc(asSteward(), "afd_stats", "public"), { words: 9999 }));
    await assertFails(setDoc(doc(asPublic(), "afd_stats", "public"), { words: 9999 }));
  });
});

describe("afd_ui_config/watch — the field-week switch", () => {
  it("the steward sets openUntil; nobody else; no other field", async () => {
    await assertSucceeds(setDoc(doc(asSteward(), "afd_ui_config", "watch"), { openUntil: inDays(14) }));
    await assertFails(setDoc(doc(asContrib(), "afd_ui_config", "watch"), { openUntil: inDays(14) }));
    await assertFails(setDoc(doc(asSteward(), "afd_ui_config", "watch"), { openUntil: inDays(14), mailTo: "x@y.z" }));
  });
});
