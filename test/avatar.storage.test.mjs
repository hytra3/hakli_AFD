/**
 * Contributor-avatar storage rules — Storage emulator test suite
 * ============================================================================
 * Guards afd_avatars/{uid}/… — a steward's OWN opt-in "known" profile picture.
 * Public-readable, owner-only raster-image write (2 MB), mutable + deletable.
 *
 * "Obscure" is enforced by PRESENCE, not by a rule that inspects a visibility
 * flag: the app deletes the file when the steward chooses obscure, so there is
 * nothing left to fetch. These tests therefore assert a plain public read on a
 * present file, an owner-only write, and that switching back to obscure (delete)
 * and changing the picture (overwrite) both work for the owner alone.
 *
 * RUN (needs Java for the emulator):
 *
 *     cd test && npm install && cd ..
 *     firebase emulators:exec --only storage "node --test test/avatar.storage.test.mjs"
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

const IMG    = new Uint8Array([1, 2, 3, 4]);         // stand-in for a tiny image
const asPng  = { contentType: "image/png" };
const asJpeg = { contentType: "image/jpeg" };
const asWebp = { contentType: "image/webp" };
const asSvg  = { contentType: "image/svg+xml" };     // must be rejected — script vector
const asAudio= { contentType: "audio/webm" };

// owner = the steward whose profile this is; stranger = anyone else.
const owner    = () => testEnv.authenticatedContext("uOwner").storage();
const stranger = () => testEnv.authenticatedContext("uOther").storage();
const anon     = () => testEnv.authenticatedContext("uAnon", { firebase: { sign_in_provider: "anonymous" } }).storage();
const publik   = () => testEnv.unauthenticatedContext().storage();

const P = "afd_avatars/uOwner/avatar.png";

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "afd-dev",
    storage: { rules: readFileSync(new URL("../afd-storage.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearStorage(); });

describe("avatar — write", () => {
  it("owner uploads their own png", async () => {
    await assertSucceeds(uploadBytes(ref(owner(), P), IMG, asPng));
  });
  it("jpeg and webp are allowed too", async () => {
    await assertSucceeds(uploadBytes(ref(owner(), "afd_avatars/uOwner/a.jpg"),  IMG, asJpeg));
    await assertSucceeds(uploadBytes(ref(owner(), "afd_avatars/uOwner/a.webp"), IMG, asWebp));
  });
  it("cannot write under someone else's uid", async () => {
    await assertFails(uploadBytes(ref(stranger(), P), IMG, asPng));
  });
  it("anonymous sign-in cannot write an avatar", async () => {
    await assertFails(uploadBytes(ref(anon(), "afd_avatars/uAnon/a.png"), IMG, asPng));
  });
  it("svg is rejected (script vector)", async () => {
    await assertFails(uploadBytes(ref(owner(), P), IMG, asSvg));
  });
  it("non-image content is rejected", async () => {
    await assertFails(uploadBytes(ref(owner(), P), IMG, asAudio));
  });
  it("oversize image is rejected (> 2 MB)", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 16);
    await assertFails(uploadBytes(ref(owner(), P), big, asPng));
  });
});

describe("avatar — read (public: a 'known' avatar is meant to be seen)", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), P), IMG, asPng);
    });
  });
  it("the public can read a present avatar", async () => {
    await assertSucceeds(getBytes(ref(publik(), P)));
  });
  it("a stranger can read it too", async () => {
    await assertSucceeds(getBytes(ref(stranger(), P)));
  });
});

describe("avatar — mutable + deletable (obscure = remove the file)", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), P), IMG, asPng);
    });
  });
  it("owner overwrites their avatar (change picture)", async () => {
    await assertSucceeds(uploadBytes(ref(owner(), P), IMG, asWebp));
  });
  it("owner deletes their avatar (switch back to obscure)", async () => {
    await assertSucceeds(deleteObject(ref(owner(), P)));
  });
  it("a stranger cannot delete someone's avatar", async () => {
    await assertFails(deleteObject(ref(stranger(), P)));
  });
});
