/**
 * Withdrawal-proof storage rules — Storage emulator test suite
 * ============================================================================
 * Guards afd_withdrawals/{uid}/… — the spoken-Hakli consent-withdrawal proof.
 * It is EVIDENCE: owner-write-once, owner-read-only, immutable, audio-only.
 *
 * RUN (needs Java for the emulator):
 *
 *     cd test && npm install && cd ..
 *     firebase emulators:exec --only storage "node --test test/withdrawal.storage.test.mjs"
 *
 * emulators:exec starts the Storage emulator and sets the discovery env var so
 * initializeTestEnvironment finds it, runs the tests, then tears down.
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { ref, uploadBytes, getBytes, deleteObject } from "firebase/storage";

let testEnv;

const AUDIO = new Uint8Array([1, 2, 3, 4]);          // stand-in for a short clip
const asAudio = { contentType: "audio/webm" };
const asText  = { contentType: "text/plain" };

// owner = the steward who captured the utterance; stranger = anyone else.
const owner    = () => testEnv.authenticatedContext("uOwner").storage();
const stranger = () => testEnv.authenticatedContext("uOther").storage();
const anon     = () => testEnv.authenticatedContext("uAnon", { firebase: { sign_in_provider: "anonymous" } }).storage();
const publik   = () => testEnv.unauthenticatedContext().storage();

const P = "afd_withdrawals/uOwner/wd_spk_elder_1.webm";

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "afd-dev",
    storage: { rules: readFileSync(new URL("../afd-storage.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearStorage(); });

describe("withdrawal proof — create", () => {
  it("owner uploads their own audio proof", async () => {
    await assertSucceeds(uploadBytes(ref(owner(), P), AUDIO, asAudio));
  });
  it("cannot upload under someone else's uid", async () => {
    await assertFails(uploadBytes(ref(stranger(), P), AUDIO, asAudio));
  });
  it("anonymous sign-in cannot upload a proof", async () => {
    await assertFails(uploadBytes(ref(anon(), "afd_withdrawals/uAnon/x.webm"), AUDIO, asAudio));
  });
  it("non-audio content is rejected", async () => {
    await assertFails(uploadBytes(ref(owner(), P), AUDIO, asText));
  });
});

describe("withdrawal proof — read (evidence, not public)", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), P), AUDIO, asAudio);
    });
  });
  it("owner reads their own proof back", async () => {
    await assertSucceeds(getBytes(ref(owner(), P)));
  });
  it("a stranger cannot read the proof", async () => {
    await assertFails(getBytes(ref(stranger(), P)));
  });
  it("the public cannot read the proof", async () => {
    await assertFails(getBytes(ref(publik(), P)));
  });
});

describe("withdrawal proof — immutability", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), P), AUDIO, asAudio);
    });
  });
  it("cannot overwrite an existing proof", async () => {
    await assertFails(uploadBytes(ref(owner(), P), AUDIO, asAudio));
  });
  it("cannot delete a proof from the client", async () => {
    await assertFails(deleteObject(ref(owner(), P)));
  });
});
