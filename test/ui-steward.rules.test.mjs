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

describe("afd_admins — closed to every client", () => {
  it("the steward cannot read the list", async () => {
    await assertFails(getDoc(doc(asSteward(), "afd_admins", "uSteward")));
  });
  it("a contributor cannot add themselves", async () => {
    await assertFails(setDoc(doc(asContrib(), "afd_admins", "uContrib"), { note: "me too" }));
  });
  it("the steward cannot add someone else", async () => {
    await assertFails(setDoc(doc(asSteward(), "afd_admins", "uContrib"), { note: "helper" }));
  });
});
