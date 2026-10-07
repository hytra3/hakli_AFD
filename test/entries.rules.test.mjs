/**
 * Word entries + word photos — Firestore & Storage emulator test suite
 * ============================================================================
 * Guards the "say it, show it" path (add.html):
 *   • afd_entries/{id} create — a named account may add a word, optionally with
 *     an emoji (pic) and a photo (image). The image may only be the account's
 *     own afd_pics/{uid}/{entryId}.jpg public URL — never someone else's
 *     picture, another entry's, or an outside site. Entries stay immutable.
 *   • afd_pics/{uid}/{entryId}.jpg — public read, owner-only write-once JPEG,
 *     steward-only delete.
 *
 * RUN (needs Java for the emulator):
 *
 *     cd test && npm install && cd ..
 *     firebase emulators:exec --only firestore,storage "node --test test/entries.rules.test.mjs"
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, setLogLevel } from "firebase/firestore";
import { ref, uploadBytes, getBytes, deleteObject } from "firebase/storage";

setLogLevel("error");

let testEnv;

const ID  = "ent_u_0123456789ab";
const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const asJpeg = { contentType: "image/jpeg" };
const asPng  = { contentType: "image/png" };

const ctx = (uid, anon) => anon
  ? testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } })
  : testEnv.authenticatedContext(uid);
const fsAs   = (uid, anon) => ctx(uid, anon).firestore();
const stAs   = (uid, anon) => ctx(uid, anon).storage();
const publik = () => testEnv.unauthenticatedContext();

const entry = (db, id = ID) => doc(db, "afd_entries", id);
const imageUrl = (uid, id = ID) =>
  `https://firebasestorage.googleapis.com/v0/b/afd-dev.firebasestorage.app/o/afd_pics%2F${uid}%2F${id}.jpg?alt=media`;
const base = (uid) => ({ source: "user", createdBy: uid, createdAt: serverTimestamp() });

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "afd-dev",
    firestore: { rules: readFileSync(new URL("../afd-firestore.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../afd-storage.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "afd_admins", "uSteward"), { grantedAt: 1 });
  });
});

describe("entry create — say it, show it", () => {
  it("a named account adds a bare word (identicon face)", async () => {
    await assertSucceeds(setDoc(entry(fsAs("uA")), base("uA")));
  });
  it("with an emoji picture and an Arabic meaning", async () => {
    await assertSucceeds(setDoc(entry(fsAs("uA")), { ...base("uA"), pic: "🐐", glossAr: "ماعز" }));
  });
  it("with a multi-codepoint emoji (ZWJ family)", async () => {
    await assertSucceeds(setDoc(entry(fsAs("uA")), { ...base("uA"), pic: "👨‍👩‍👧" }));
  });
  it("with its own photo", async () => {
    await assertSucceeds(setDoc(entry(fsAs("uA")), { ...base("uA"), image: imageUrl("uA") }));
  });
  it("an empty or over-long pic is refused", async () => {
    await assertFails(setDoc(entry(fsAs("uA")), { ...base("uA"), pic: "" }));
    await assertFails(setDoc(entry(fsAs("uA")), { ...base("uA"), pic: "x".repeat(33) }));
  });
  it("another account's photo is refused", async () => {
    await assertFails(setDoc(entry(fsAs("uA")), { ...base("uA"), image: imageUrl("uB") }));
  });
  it("a photo belonging to a different entry is refused", async () => {
    await assertFails(setDoc(entry(fsAs("uA")), { ...base("uA"), image: imageUrl("uA", "ent_u_ffffffffffff") }));
  });
  it("an outside image URL is refused", async () => {
    await assertFails(setDoc(entry(fsAs("uA")), { ...base("uA"), image: "https://example.com/x.jpg" }));
  });
  it("anonymous sign-in cannot add a word", async () => {
    await assertFails(setDoc(entry(fsAs("uAnon", true)), base("uAnon")));
  });
  it("cannot create on someone else's behalf", async () => {
    await assertFails(setDoc(entry(fsAs("uA")), base("uB")));
  });
  it("an unknown field is refused", async () => {
    await assertFails(setDoc(entry(fsAs("uA")), { ...base("uA"), ref: "my spelling" }));
  });
});

describe("entry — immutable once added, except remove-my-word and tags", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(entry(c.firestore()), { source: "user", createdBy: "uA", createdAt: 1 });
      await setDoc(entry(c.firestore(), "ent_sun"), { gloss: "sun", pic: "☀️" });   // a seeded word
    });
  });
  it("the creator cannot add a picture afterwards", async () => {
    await assertFails(updateDoc(entry(fsAs("uA")), { pic: "🐐" }));
  });
  it("nobody can delete it", async () => {
    await assertFails(deleteDoc(entry(fsAs("uA"))));
  });

  // remove my word
  it("the creator can mark their word removed", async () => {
    await assertSucceeds(updateDoc(entry(fsAs("uA")), { removedAt: serverTimestamp() }));
  });
  it("…only to now, not a chosen time", async () => {
    await assertFails(updateDoc(entry(fsAs("uA")), { removedAt: 5 }));
  });
  it("…only once", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await updateDoc(entry(c.firestore()), { removedAt: 1 });
    });
    await assertFails(updateDoc(entry(fsAs("uA")), { removedAt: serverTimestamp() }));
  });
  it("…and nothing else alongside it", async () => {
    await assertFails(updateDoc(entry(fsAs("uA")), { removedAt: serverTimestamp(), glossAr: "x" }));
  });
  it("someone else cannot remove it", async () => {
    await assertFails(updateDoc(entry(fsAs("uB")), { removedAt: serverTimestamp() }));
  });
  it("not even a steward (that's the creator's call; a steward hides instead)", async () => {
    await assertFails(updateDoc(entry(fsAs("uSteward")), { removedAt: serverTimestamp() }));
  });
  it("a seeded word can't be removed", async () => {
    await assertFails(updateDoc(entry(fsAs("uA"), "ent_sun"), { removedAt: serverTimestamp() }));
  });

  // tags
  it("the creator can tag their word", async () => {
    await assertSucceeds(updateDoc(entry(fsAs("uA")), { tags: ["Mehri", "loanword"] }));
  });
  it("a steward can tag any word, seeded ones too", async () => {
    await assertSucceeds(updateDoc(entry(fsAs("uSteward")), { tags: ["eastern dialect"] }));
    await assertSucceeds(updateDoc(entry(fsAs("uSteward"), "ent_sun"), { tags: ["Mirbat"] }));
  });
  it("tags can be cleared", async () => {
    await assertSucceeds(updateDoc(entry(fsAs("uA")), { tags: [] }));
  });
  it("someone else cannot tag it", async () => {
    await assertFails(updateDoc(entry(fsAs("uB")), { tags: ["spam"] }));
    await assertFails(updateDoc(entry(fsAs("uB"), "ent_sun"), { tags: ["spam"] }));
  });
  it("at most 6 tags of 1–40 characters", async () => {
    await assertFails(updateDoc(entry(fsAs("uA")), { tags: ["a","b","c","d","e","f","g"] }));
    await assertFails(updateDoc(entry(fsAs("uA")), { tags: [""] }));
    await assertFails(updateDoc(entry(fsAs("uA")), { tags: ["x".repeat(41)] }));
    await assertFails(updateDoc(entry(fsAs("uA")), { tags: [7] }));
    await assertFails(updateDoc(entry(fsAs("uA")), { tags: "Mehri" }));
  });
  it("tags ride alone — no sneaking other fields in", async () => {
    await assertFails(updateDoc(entry(fsAs("uA")), { tags: ["Mehri"], pic: "🐐" }));
  });
});

describe("entry — steward review (steward.html)", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(entry(c.firestore()),
        { source: "user", createdBy: "uA", createdAt: 1, pic: "🐐", image: imageUrl("uA") });
      await setDoc(entry(c.firestore(), "ent_sun"), { gloss: "sun", pic: "☀️" });   // a seeded word
    });
  });
  const steward = () => entry(fsAs("uSteward"));

  // reviewed
  it("a steward can mark a word reviewed, to now", async () => {
    await assertSucceeds(updateDoc(steward(), { reviewedAt: serverTimestamp() }));
  });
  it("…not to a chosen time", async () => {
    await assertFails(updateDoc(steward(), { reviewedAt: 5 }));
  });
  it("the creator can't mark their own word reviewed", async () => {
    await assertFails(updateDoc(entry(fsAs("uA")), { reviewedAt: serverTimestamp() }));
  });
  it("a new word can't arrive already reviewed or hidden", async () => {
    await assertFails(setDoc(entry(fsAs("uB"), "ent_u_new"), { ...base("uB"), reviewedAt: serverTimestamp() }));
    await assertFails(setDoc(entry(fsAs("uB"), "ent_u_new"), { ...base("uB"), hiddenAt: serverTimestamp() }));
  });

  // hide / show again
  it("a steward can hide a word, and show it again", async () => {
    await assertSucceeds(updateDoc(steward(), { hiddenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(steward(), { hiddenAt: deleteField() }));
  });
  it("…hidden only to now, and only once", async () => {
    await assertFails(updateDoc(steward(), { hiddenAt: 5 }));
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await updateDoc(entry(c.firestore()), { hiddenAt: 1 });
    });
    await assertFails(updateDoc(steward(), { hiddenAt: serverTimestamp() }));
  });
  it("nobody else can hide or unhide", async () => {
    await assertFails(updateDoc(entry(fsAs("uA")), { hiddenAt: serverTimestamp() }));
    await assertFails(updateDoc(entry(fsAs("uB")), { hiddenAt: serverTimestamp() }));
  });
  it("seeded words aren't hidden from here", async () => {
    await assertFails(updateDoc(entry(fsAs("uSteward"), "ent_sun"), { hiddenAt: serverTimestamp() }));
  });

  // picture takedown
  it("a steward can take the picture down (photo and emoji)", async () => {
    await assertSucceeds(updateDoc(steward(), { image: deleteField(), pic: deleteField() }));
  });
  it("…or just the photo", async () => {
    await assertSucceeds(updateDoc(steward(), { image: deleteField() }));
  });
  it("…but never put a different picture up", async () => {
    await assertFails(updateDoc(steward(), { image: imageUrl("uSteward") }));
    await assertFails(updateDoc(steward(), { pic: "🙂" }));
  });
  it("the creator can't take their picture off (or change it) this way", async () => {
    await assertFails(updateDoc(entry(fsAs("uA")), { image: deleteField() }));
  });
  it("seeded pictures aren't taken down from here", async () => {
    await assertFails(updateDoc(entry(fsAs("uSteward"), "ent_sun"), { pic: deleteField() }));
  });
  it("each action rides alone", async () => {
    await assertFails(updateDoc(steward(), { hiddenAt: serverTimestamp(), reviewedAt: serverTimestamp() }));
    await assertFails(updateDoc(steward(), { image: deleteField(), gloss: "x" }));
  });
});

describe("word photo — storage", () => {
  const P = (uid, name = `${ID}.jpg`) => `afd_pics/${uid}/${name}`;

  it("owner uploads a JPEG for their new word", async () => {
    await assertSucceeds(uploadBytes(ref(stAs("uA"), P("uA")), IMG, asJpeg));
  });
  it("only JPEG (the page re-encodes everything)", async () => {
    await assertFails(uploadBytes(ref(stAs("uA"), P("uA")), IMG, asPng));
  });
  it("only an ent_u_ name ending .jpg", async () => {
    await assertFails(uploadBytes(ref(stAs("uA"), P("uA", "ent_sun.jpg")), IMG, asJpeg));
    await assertFails(uploadBytes(ref(stAs("uA"), P("uA", "avatar.jpg")), IMG, asJpeg));
  });
  it("not under someone else's uid", async () => {
    await assertFails(uploadBytes(ref(stAs("uB"), P("uA")), IMG, asJpeg));
  });
  it("anonymous sign-in cannot upload", async () => {
    await assertFails(uploadBytes(ref(stAs("uAnon", true), P("uAnon")), IMG, asJpeg));
  });
  it("over 2 MB is refused", async () => {
    await assertFails(uploadBytes(ref(stAs("uA"), P("uA")), new Uint8Array(2 * 1024 * 1024 + 1), asJpeg));
  });
  it("write-once: even the owner can't replace it", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await uploadBytes(ref(c.storage(), P("uA")), IMG, asJpeg);
    });
    await assertFails(uploadBytes(ref(stAs("uA"), P("uA")), new Uint8Array([9, 9]), asJpeg));
  });
  it("anyone can see it", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await uploadBytes(ref(c.storage(), P("uA")), IMG, asJpeg);
    });
    await assertSucceeds(getBytes(ref(publik().storage(), P("uA"))));
  });
  it("only a steward can take it down", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await uploadBytes(ref(c.storage(), P("uA")), IMG, asJpeg);
    });
    await assertFails(deleteObject(ref(stAs("uA"), P("uA"))));
    await assertFails(deleteObject(ref(stAs("uB"), P("uA"))));
    await assertSucceeds(deleteObject(ref(stAs("uSteward"), P("uA"))));
  });
});
