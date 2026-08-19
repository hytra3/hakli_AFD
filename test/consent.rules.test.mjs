/**
 * Consent rules — Firestore emulator test suite
 * ============================================================================
 * Proves the guarantees in afd-consent-design.md §9 before the rules are
 * trusted in the field. Written offline; it first *runs* on your machine.
 *
 * RUN (needs Java for the emulator):
 *
 *     cd test && npm install && cd ..
 *     firebase emulators:exec --only firestore "cd test && node --test"
 *
 * NB: `node --test test` does NOT scan the folder in Node 22 — it tries to run
 * a file literally named `test` and dies with MODULE_NOT_FOUND. Run node --test
 * from *inside* the folder (as above), or name the file directly:
 *     firebase emulators:exec --only firestore "node --test test/consent.rules.test.mjs"
 *
 * emulators:exec starts the Firestore emulator, sets FIRESTORE_EMULATOR_HOST so
 * initializeTestEnvironment auto-discovers it, runs the tests, then tears down.
 * If discovery ever fails, pass it explicitly in the `firestore` block:
 *     firestore: { rules, host: "127.0.0.1", port: 8080 }
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, setLogLevel } from "firebase/firestore";

setLogLevel("error"); // the permission-denied logs are expected; keep output clean

let testEnv;

// ---- ref helpers -----------------------------------------------------------
const rec  = (db, id) => doc(db, "afd_entries", "ent_sun", "recordings", id);
const spk  = (db, id) => doc(db, "afd_speakers", id);
const priv = (db, id) => doc(db, "afd_speakers", id, "private", "profile");

const baseRec = (over = {}) => ({
  uid: "uSelf", speakerId: "spk_self",
  consent: "public", allowPlayback: true,
  domain: "nature", gloss: "sun", entryId: "ent_sun",
  capture: { sampleRate: 48000 },
  ...over,
});

// ---- auth contexts ---------------------------------------------------------
// uSelf  — a self-representing speaker (holds their own account)
// uAgent — a bilingual assistant stewarding the elder spk_elder (viaAgent)
// uOther — an unrelated signed-in stranger
// uAnon  — anonymous sign-in (the prompt tool); must never reach the corpus
const asSelf   = () => testEnv.authenticatedContext("uSelf").firestore();
const asAgent  = () => testEnv.authenticatedContext("uAgent").firestore();
const asOther  = () => testEnv.authenticatedContext("uOther").firestore();
const asAnon   = () => testEnv.authenticatedContext("uAnon", { firebase: { sign_in_provider: "anonymous" } }).firestore();
const asPublic = () => testEnv.unauthenticatedContext().firestore();

const WITHDRAW     = { consent: "withdrawn", allowPlayback: false };
const WITHDRAW_ART = { consent: "withdrawn", allowPlayback: false, withdrawal: { at: 1, byUid: "uAgent", audioPath: "afd/withdraw/x.webm" } };
const DELETE_ART   = { consent: "deleted",   allowPlayback: false, withdrawal: { at: 1, byUid: "uAgent", audioPath: "afd/withdraw/x.webm" } };

// ---- seed (rules disabled) -------------------------------------------------
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(spk(db, "spk_self"),  { stewardUid: "uSelf",  viaAgent: false, consent: "public", masked: false });
    await setDoc(spk(db, "spk_elder"), { stewardUid: "uAgent", viaAgent: true,  consent: "public", masked: false });
    await setDoc(priv(db, "spk_elder"), { origin: { town: "Rakhyut", tribe: "Ackak" } });
    await setDoc(rec(db, "rec_self"),   baseRec());
    await setDoc(rec(db, "rec_elder"),  baseRec({ uid: "uAgent", speakerId: "spk_elder" }));
    await setDoc(rec(db, "rec_hidden"), baseRec({ consent: "withdrawn", allowPlayback: false }));
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "afd-dev",
    firestore: { rules: readFileSync(new URL("../afd-firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });

describe("recording consent — who may withdraw (design §9)", () => {
  it("self-speaker withdraws their own recording", async () => {
    await assertSucceeds(updateDoc(rec(asSelf(), "rec_self"), WITHDRAW));
  });
  it("self-speaker restores their own recording — no artifact needed", async () => {
    await assertSucceeds(updateDoc(rec(asSelf(), "rec_hidden"), { consent: "public", allowPlayback: true }));
  });
  it("agent withdraws elder's recording WITH the spoken artifact", async () => {
    await assertSucceeds(updateDoc(rec(asAgent(), "rec_elder"), WITHDRAW_ART));
  });
  it("agent withdraws elder's recording WITHOUT artifact — BLOCKED (the crux)", async () => {
    await assertFails(updateDoc(rec(asAgent(), "rec_elder"), WITHDRAW));
  });
  it("stranger cannot withdraw someone else's recording", async () => {
    await assertFails(updateDoc(rec(asOther(), "rec_self"), WITHDRAW));
  });
  it("agent may delete only with the spoken artifact", async () => {
    await assertFails(updateDoc(rec(asAgent(), "rec_elder"), { consent: "deleted", allowPlayback: false }));
    await assertSucceeds(updateDoc(rec(asAgent(), "rec_elder"), DELETE_ART));
  });
});

describe("recording immutability — only the consent label moves", () => {
  it("cannot change gloss alongside consent", async () => {
    await assertFails(updateDoc(rec(asSelf(), "rec_self"), { ...WITHDRAW, gloss: "moon" }));
  });
  it("cannot reassign uid or speakerId", async () => {
    await assertFails(updateDoc(rec(asSelf(), "rec_self"), { uid: "uOther" }));
    await assertFails(updateDoc(rec(asSelf(), "rec_self"), { speakerId: "spk_elder" }));
  });
  it("no client hard-delete (deletion is a server purge on 'deleted')", async () => {
    await assertFails(deleteDoc(rec(asSelf(), "rec_self")));
  });
});

describe("recording create — archival gate + ownership", () => {
  it("owner creates a public recording", async () => {
    await assertSucceeds(setDoc(rec(asSelf(), "rec_new"), baseRec()));
  });
  it("cannot create under someone else's uid", async () => {
    await assertFails(setDoc(rec(asSelf(), "rec_bad"), baseRec({ uid: "uOther" })));
  });
  it("rejects sub-archival sample rate", async () => {
    await assertFails(setDoc(rec(asSelf(), "rec_lofi"), baseRec({ capture: { sampleRate: 8000 } })));
  });
  it("anonymous sign-in cannot create in the corpus", async () => {
    await assertFails(setDoc(rec(asAnon(), "rec_anon"), baseRec({ uid: "uAnon" })));
  });
});

describe("recording read — public vs. steward", () => {
  it("anyone reads a public recording", async () => {
    await assertSucceeds(getDoc(rec(asPublic(), "rec_self")));
  });
  it("stranger cannot read a withdrawn recording", async () => {
    await assertFails(getDoc(rec(asOther(), "rec_hidden")));
  });
  it("manager reads their own withdrawn recording", async () => {
    await assertSucceeds(getDoc(rec(asSelf(), "rec_hidden")));
  });
});

describe("speaker profile — steward only", () => {
  it("steward updates their own consent / masking", async () => {
    await assertSucceeds(updateDoc(spk(asSelf(), "spk_self"), { masked: true, consent: "withdrawn" }));
  });
  it("non-steward cannot touch a speaker card", async () => {
    await assertFails(updateDoc(spk(asOther(), "spk_self"), { masked: true }));
  });
  it("steward cannot be silently reassigned", async () => {
    await assertFails(updateDoc(spk(asSelf(), "spk_self"), { stewardUid: "uOther" }));
  });
  it("private origin is steward-only (agent yes; stranger + public no)", async () => {
    await assertSucceeds(getDoc(priv(asAgent(), "spk_elder")));
    await assertFails(getDoc(priv(asOther(), "spk_elder")));
    await assertFails(getDoc(priv(asPublic(), "spk_elder")));
  });
});
