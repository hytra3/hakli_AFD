/**
 * Steward-only controls — Firestore emulator test suite
 * ============================================================================
 * Guards the three things that used to be open to ANY real (non-anonymous)
 * account and are now the steward's alone (afd_admins/{uid}, Admin SDK only):
 *
 *   afd_ui_config/{name}     — opening/closing the recording + suggestion windows
 *   afd_ui_prompts/{key}     — publishing a prompt OUTSIDE the recording window
 *   afd_ui_suggestions/{id}  — reading the suggestion queue
 *
 * plus afd_admins itself, which no client may read or write.
 *
 * RUN (needs Java for the emulator):
 *
 *     cd test && npm install && cd ..
 *     firebase emulators:exec --only firestore "cd test && npm test"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, collection, Timestamp, setLogLevel,
} from "firebase/firestore";

setLogLevel("error"); // expected permission-denied logs; keep output clean

let testEnv;

// uSteward — listed in afd_admins; uContrib — an ordinary Google contributor;
// uAnon — the prompts tool's anonymous sign-in.
const asSteward = () => testEnv.authenticatedContext("uSteward").firestore();
const asContrib = () => testEnv.authenticatedContext("uContrib").firestore();
const asAnon    = () => testEnv.authenticatedContext("uAnon", { firebase: { sign_in_provider: "anonymous" } }).firestore();
const asPublic  = () => testEnv.unauthenticatedContext().firestore();

const inHours = h => Timestamp.fromMillis(Date.now() + h * 3600e3);
const cfg = (db, name) => doc(db, "afd_ui_config", name);

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
  });
});

describe("afd_ui_config — the windows", () => {
  it("the steward opens the suggestion window", async () => {
    await assertSucceeds(setDoc(cfg(asSteward(), "suggestions"), { openUntil: inHours(2) }, { merge: true }));
  });
  it("the steward closes a window (openUntil in the past)", async () => {
    await assertSucceeds(setDoc(cfg(asSteward(), "recording"), { openUntil: Timestamp.fromMillis(0) }, { merge: true }));
  });
  it("an ordinary signed-in contributor CANNOT open a window", async () => {
    await assertFails(setDoc(cfg(asContrib(), "suggestions"), { openUntil: inHours(8) }, { merge: true }));
  });
  it("an ordinary contributor cannot close one either", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(cfg(ctx.firestore(), "recording"), { openUntil: inHours(24) });
    });
    await assertFails(setDoc(cfg(asContrib(), "recording"), { openUntil: Timestamp.fromMillis(0) }, { merge: true }));
  });
  it("anonymous sign-in cannot touch a window", async () => {
    await assertFails(setDoc(cfg(asAnon(), "recording"), { openUntil: inHours(1) }, { merge: true }));
  });
  it("even the steward can't add other fields (e.g. the retired `open` boolean)", async () => {
    await assertFails(setDoc(cfg(asSteward(), "suggestions"), { openUntil: inHours(2), open: true }, { merge: true }));
  });
  it("a leftover field on an old doc doesn't lock the steward out", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(cfg(ctx.firestore(), "suggestions"), { openUntil: Timestamp.fromMillis(0), open: true });
    });
    await assertSucceeds(setDoc(cfg(asSteward(), "suggestions"), { openUntil: inHours(2) }, { merge: true }));
  });
  it("openUntil must be a timestamp, not a number", async () => {
    await assertFails(setDoc(cfg(asSteward(), "suggestions"), { openUntil: Date.now() + 3600e3 }, { merge: true }));
  });
  it("anyone can still read the window state (the tools need it)", async () => {
    await assertSucceeds(getDoc(cfg(asPublic(), "suggestions")));
  });
});

describe("afd_ui_prompts — publishing outside the recording window", () => {
  const prompt = db => doc(db, "afd_ui_prompts", "howto.find");
  const body = { status: "recorded", storagePath: "afd_ui/howto.find.webm" };

  it("window closed: the steward may still publish", async () => {
    await assertSucceeds(setDoc(prompt(asSteward()), body));
  });
  it("window closed: an ordinary contributor may NOT (was the old notAnon bypass)", async () => {
    await assertFails(setDoc(prompt(asContrib()), body));
  });
  it("window closed: the anonymous prompts tool may not", async () => {
    await assertFails(setDoc(prompt(asAnon()), body));
  });
  it("window open: the anonymous prompts tool may publish (unchanged)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(cfg(ctx.firestore(), "recording"), { openUntil: inHours(24) });
    });
    await assertSucceeds(setDoc(prompt(asAnon()), body));
  });
});

describe("afd_ui_prompts — append-only take manifest (decision #1, Ship 1)", () => {
  // Each prompt doc carries a takes[] ledger. A write may ADD takes but never
  // drop or shrink the list, so no take is ever erased from the record — even
  // though a re-record points storagePath at a newer clip, and even for a
  // steward (byte immutability itself lives in Storage: afd_ui/** is write-once).
  const prompt = db => doc(db, "afd_ui_prompts", "howto.find");
  const take = id => ({ id, path: "afd_ui/howto.find/" + id + ".webm" });
  const bodyWith = (takes, extra = {}) =>
    ({ status: "recorded", storagePath: takes[takes.length - 1].path, takes, ...extra });
  const seed = (takes) => testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(prompt(ctx.firestore()), bodyWith(takes));
  });
  const openRecording = () => testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(cfg(ctx.firestore(), "recording"), { openUntil: inHours(24) });
  });

  it("the steward may ADD a take (list grows)", async () => {
    await seed([take("t1")]);
    await assertSucceeds(setDoc(prompt(asSteward()), bodyWith([take("t1"), take("t2")])));
  });
  it("NOBODY may drop a take (list shrinks) — not even the steward", async () => {
    await seed([take("t1"), take("t2")]);
    await assertFails(setDoc(prompt(asSteward()), bodyWith([take("t1")])));
  });
  it("a same-length write is allowed (a steward pointing at which take plays — Ship 2)", async () => {
    await seed([take("t1"), take("t2")]);
    await assertSucceeds(setDoc(prompt(asSteward()),
      bodyWith([take("t1"), take("t2")], { storagePath: take("t1").path, canonicalTakeId: "t1" })));
  });
  it("window open: the anonymous tool may append a take, but never clear the list", async () => {
    await openRecording();
    await assertSucceeds(setDoc(prompt(asAnon()), bodyWith([take("t1")])));             // first take (create)
    await assertSucceeds(setDoc(prompt(asAnon()), bodyWith([take("t1"), take("t2")]))); // append (grows)
    await assertFails(setDoc(prompt(asAnon()), { status: "recorded", storagePath: take("t2").path, takes: [] })); // clear → refused
  });
  it("a legacy doc with no takes[] can still receive its first take", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(prompt(ctx.firestore()), { status: "recorded", storagePath: "afd_ui/howto.find.webm" });
    });
    await assertSucceeds(setDoc(prompt(asSteward()), bodyWith([take("t1")])));
  });
});

describe("afd_ui_suggestions — reading the queue", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "afd_ui_suggestions", "s1"),
        { key: "screen:hdr.display", arSeen: "العرض", arSuggested: "الشكل", note: "" });
    });
  });
  it("the steward reads the queue", async () => {
    await assertSucceeds(getDocs(collection(asSteward(), "afd_ui_suggestions")));
  });
  it("an ordinary contributor cannot read the queue", async () => {
    await assertFails(getDocs(collection(asContrib(), "afd_ui_suggestions")));
  });
  it("anonymous cannot read the queue", async () => {
    await assertFails(getDocs(collection(asAnon(), "afd_ui_suggestions")));
  });
});

describe("afd_admins — closed to every client (but you may see if you're on it)", () => {
  it("the steward can read their OWN doc (to show steward controls)", async () => {
    await assertSucceeds(getDoc(doc(asSteward(), "afd_admins", "uSteward")));
  });
  it("a contributor can check their own (absent) doc", async () => {
    await assertSucceeds(getDoc(doc(asContrib(), "afd_admins", "uContrib")));
  });
  it("nobody can read someone else's", async () => {
    await assertFails(getDoc(doc(asContrib(), "afd_admins", "uSteward")));
  });
  it("nobody can list the stewards", async () => {
    await assertFails(getDocs(collection(asSteward(), "afd_admins")));
  });
  it("a contributor cannot add themselves", async () => {
    await assertFails(setDoc(doc(asContrib(), "afd_admins", "uContrib"), { note: "me too" }));
  });
  it("the steward cannot add someone else", async () => {
    await assertFails(setDoc(doc(asSteward(), "afd_admins", "uContrib"), { note: "helper" }));
  });
});
