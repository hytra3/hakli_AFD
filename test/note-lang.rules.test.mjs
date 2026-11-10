/**
 * A voice note's language (11-10) — Firestore emulator tests
 * ============================================================================
 * The account that uploaded a voice note may correct the language it picked on
 * Keep, and nothing else. Word / sentence / meaning takes stay frozen; nobody
 * else (not a stranger, not the speaker's agent if they didn't upload it) can
 * change it; only `lang` may move, and only to a language code.
 *
 *     firebase emulators:exec --only firestore "node --test test/note-lang.rules.test.mjs"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, setLogLevel } from "firebase/firestore";

setLogLevel("error");
let testEnv;

const rec = (db, id) => doc(db, "afd_entries", "ent_father", "recordings", id);
const base = (over = {}) => ({
  uid: "uSelf", speakerId: "spk_self", consent: "public", allowPlayback: true,
  entryId: "ent_father", gloss: "father", capture: { sampleRate: 48000 }, ...over,
});
const asSelf  = () => testEnv.authenticatedContext("uSelf").firestore();
const asOther = () => testEnv.authenticatedContext("uOther").firestore();
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
    await setDoc(doc(db, "afd_speakers", "spk_self"), { stewardUid: "uSelf", viaAgent: false, consent: "public", masked: false });
    await setDoc(rec(db, "n1"), base({ type: "note", phase: "note", lang: "ar" }));
    await setDoc(rec(db, "n_old"), base({ phase: "note", lang: "ar" }));          // moved by the script before `type` was set
    await setDoc(rec(db, "w1"), base({ type: "word", phase: "word", lang: "qhk" }));
    await setDoc(rec(db, "m1"), base({ type: "definition", phase: "definition", lang: "qhk" }));
    await setDoc(rec(db, "n_del"), base({ type: "note", lang: "ar", consent: "deleted", allowPlayback: false }));
  });
});

describe("a voice note's language — its uploader may change it", () => {
  it("the uploader changes their note to English", async () => {
    await assertSucceeds(updateDoc(rec(asSelf(), "n1"), { lang: "en" }));
  });
  it("…to Hakli, and to a mix", async () => {
    await assertSucceeds(updateDoc(rec(asSelf(), "n1"), { lang: "qhk" }));
    await assertSucceeds(updateDoc(rec(asSelf(), "n1"), { lang: "mul" }));
  });
  it("a note marked only by phase counts too", async () => {
    await assertSucceeds(updateDoc(rec(asSelf(), "n_old"), { lang: "en" }));
  });
});

describe("…and nothing else", () => {
  it("someone else can't change it", async () => {
    await assertFails(updateDoc(rec(asOther(), "n1"), { lang: "en" }));
  });
  it("an anonymous (prompts tool) sign-in can't", async () => {
    await assertFails(updateDoc(rec(asAnon(), "n1"), { lang: "en" }));
  });
  it("a word take's language stays frozen", async () => {
    await assertFails(updateDoc(rec(asSelf(), "w1"), { lang: "ar" }));
  });
  it("a meaning take's language stays frozen", async () => {
    await assertFails(updateDoc(rec(asSelf(), "m1"), { lang: "ar" }));
  });
  it("only the language moves — not the slot", async () => {
    await assertFails(updateDoc(rec(asSelf(), "n1"), { lang: "en", type: "word" }));
  });
  it("…not the gloss or the speaker", async () => {
    await assertFails(updateDoc(rec(asSelf(), "n1"), { lang: "en", gloss: "mother" }));
    await assertFails(updateDoc(rec(asSelf(), "n1"), { lang: "en", speakerId: "spk_x" }));
  });
  it("it must be a language code", async () => {
    await assertFails(updateDoc(rec(asSelf(), "n1"), { lang: "English!" }));
    await assertFails(updateDoc(rec(asSelf(), "n1"), { lang: 7 }));
  });
  it("not on an erased note", async () => {
    await assertFails(updateDoc(rec(asSelf(), "n_del"), { lang: "en" }));
  });
});
