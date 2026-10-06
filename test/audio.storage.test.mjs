/**
 * Corpus + UI audio storage rules — Storage + Firestore emulator suite
 * ============================================================================
 * afd/{uid}/…  listening follows the recording doc's consent (cross-service
 *              firestore.get), the uploader can always fetch their own.
 * afd_ui/…     writes follow the afd_ui_config/recording window, or a steward.
 *
 * RUN (needs Java; BOTH emulators — the Storage rules read Firestore):
 *
 *     firebase emulators:exec --only firestore,storage "cd test && node --test audio.storage.test.mjs"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { ref, uploadBytes, getBytes } from "firebase/storage";
import { doc, setDoc, Timestamp, setLogLevel } from "firebase/firestore";

setLogLevel("error");

let testEnv;

const AUDIO = new Uint8Array([1, 2, 3, 4]);
const owner    = () => testEnv.authenticatedContext("uOwner").storage();
const stranger = () => testEnv.authenticatedContext("uOther").storage();
const steward  = () => testEnv.authenticatedContext("uSteward").storage();
const anon     = () => testEnv.authenticatedContext("uAnon", { firebase: { sign_in_provider: "anonymous" } }).storage();
const publik   = () => testEnv.unauthenticatedContext().storage();

const recDoc = (db, id) => doc(db, "afd_entries", "ent_sun", "recordings", id);

// Seed one Storage object + its recording doc, with rules off.
async function seedTake(id, { allowPlayback = true, storagePath, meta } = {}) {
  const path = `afd/uOwner/${id}.webm`;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(recDoc(ctx.firestore(), id), {
      uid: "uOwner", entryId: "ent_sun", recordingId: id,
      consent: allowPlayback ? "public" : "withdrawn", allowPlayback,
      storagePath: storagePath ?? path,
    });
    await uploadBytes(ref(ctx.storage(), path), AUDIO, {
      contentType: "audio/webm",
      customMetadata: meta ?? { entryId: "ent_sun", recordingId: id },
    });
  });
  return path;
}

async function setWindow(openUntil) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "afd_ui_config", "recording"), { openUntil });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "afd-dev",
    firestore: { rules: readFileSync(new URL("../afd-firestore.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../afd-storage.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => {
  await testEnv.clearStorage();
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "afd_admins", "uSteward"), { grantedAt: 1 });
  });
});

describe("corpus audio — listening follows consent", () => {
  it("anyone can fetch a public take", async () => {
    const p = await seedTake("rec_pub");
    await assertSucceeds(getBytes(ref(publik(), p)));
    await assertSucceeds(getBytes(ref(stranger(), p)));
  });
  it("a withdrawn take can't be fetched by the public or a stranger", async () => {
    const p = await seedTake("rec_wd", { allowPlayback: false });
    await assertFails(getBytes(ref(publik(), p)));
    await assertFails(getBytes(ref(stranger(), p)));
  });
  it("the uploader can still fetch their own withdrawn take", async () => {
    const p = await seedTake("rec_wd", { allowPlayback: false });
    await assertSucceeds(getBytes(ref(owner(), p)));
  });
  it("metadata can't borrow another take's public doc", async () => {
    await seedTake("rec_pub");
    const p = await seedTake("rec_wd", { allowPlayback: false,
      meta: { entryId: "ent_sun", recordingId: "rec_pub" } });
    await assertFails(getBytes(ref(publik(), p)));
  });
  it("a take with no metadata, or no doc, isn't publicly readable", async () => {
    const p = await seedTake("rec_nometa", { meta: {} });
    await assertFails(getBytes(ref(publik(), p)));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "afd/uOwner/rec_orphan.webm"), AUDIO, {
        contentType: "audio/webm", customMetadata: { entryId: "ent_sun", recordingId: "rec_orphan" } });
    });
    await assertFails(getBytes(ref(publik(), "afd/uOwner/rec_orphan.webm")));
  });
  it("anonymous sign-in gets no owner access", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), "afd/uAnon/x.webm"), AUDIO, { contentType: "audio/webm" });
    });
    await assertFails(getBytes(ref(anon(), "afd/uAnon/x.webm")));
  });
});

describe("UI prompt audio — writes follow the recording window", () => {
  const P = "afd_ui/find_hint.webm";
  const up = (s) => uploadBytes(ref(s, P), AUDIO, { contentType: "audio/webm" });
  it("window open: the anonymous prompt tool can record", async () => {
    await setWindow(Timestamp.fromMillis(Date.now() + 3600_000));
    await assertSucceeds(up(anon()));
  });
  it("window lapsed: anonymous writes are refused", async () => {
    await setWindow(Timestamp.fromMillis(Date.now() - 1000));
    await assertFails(up(anon()));
  });
  it("no window doc: anonymous and ordinary accounts are refused", async () => {
    await assertFails(up(anon()));
    await assertFails(up(stranger()));
  });
  it("a steward can always record", async () => {
    await assertSucceeds(up(steward()));
  });
  it("still public to play, still no delete-by-anyone, still audio-only", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), P), AUDIO, { contentType: "audio/webm" });
    });
    await assertSucceeds(getBytes(ref(publik(), P)));
    await assertFails(uploadBytes(ref(steward(), "afd_ui/x.txt"), AUDIO, { contentType: "text/plain" }));
  });
});
