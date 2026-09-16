/**
 * Speaker profile rules — Firestore emulator test suite
 * ============================================================================
 * Guards afd_speakers/{speakerId} — the PUBLIC, world-readable speaker card —
 * and its steward-only /private/{doc} subdoc.
 *
 * The load-bearing guarantee: identifying data (town, tribe, age, gender) must
 * NEVER appear on the public card. The client routes it to /private, but this
 * suite proves the RULE forbids it too — an allowlist on the card, closed by
 * default, so no client bug or future edit can leak origin onto a doc that
 * `allow read: if true` hands to anyone.
 *
 * RUN (needs Java for the emulator):
 *
 *     cd test && npm install && cd ..
 *     firebase emulators:exec --only firestore "node --test test/speakers.rules.test.mjs"
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

setLogLevel("error"); // expected permission-denied logs; keep output clean

let testEnv;

const card    = (db, sid) => doc(db, "afd_speakers", sid);
const priv    = (db, sid) => doc(db, "afd_speakers", sid, "private", "profile");

// uSelf — the steward; uOther — a stranger; uAnon — anonymous (prompt tool).
const asSelf   = () => testEnv.authenticatedContext("uSelf").firestore();
const asOther  = () => testEnv.authenticatedContext("uOther").firestore();
const asAnon   = () => testEnv.authenticatedContext("uAnon", { firebase: { sign_in_provider: "anonymous" } }).firestore();
const asPublic = () => testEnv.unauthenticatedContext().firestore();

// A well-formed public card owned by uSelf (exactly the writer's field set).
const cleanCard = {
  uid: "uSelf", stewardUid: "uSelf", speakerId: "spk_uSelf0_01",
  viaAgent: false, masked: false, consent: "public",
  grant: { archivalDeposit: true, mlTraining: true, publicPlayback: true },
  updatedAt: 1,
};

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "afd-dev",
    firestore: { rules: readFileSync(new URL("../afd-firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

describe("public speaker card — create", () => {
  it("steward creates a clean public card", async () => {
    await assertSucceeds(setDoc(card(asSelf(), "spk_uSelf0_01"), cleanCard));
  });

  it("the grant stub (steward, speakerId, consent, grant) is accepted", async () => {
    await assertSucceeds(setDoc(card(asSelf(), "spk_uSelf0_01"), {
      stewardUid: "uSelf", speakerId: "spk_uSelf0_01", consent: "withdrawn",
      grant: { audioPath: "afd_consents/uSelf/gr_x.webm", grantedAt: 1 },
    }));
  });

  it("a TOWN field on the card is rejected (the core guarantee)", async () => {
    await assertFails(setDoc(card(asSelf(), "spk_uSelf0_01"), { ...cleanCard, town: "Mirbat" }));
  });

  it("a TRIBE field on the card is rejected", async () => {
    await assertFails(setDoc(card(asSelf(), "spk_uSelf0_01"), { ...cleanCard, tribe: "self-identified" }));
  });

  it("an ORIGIN map on the card is rejected", async () => {
    await assertFails(setDoc(card(asSelf(), "spk_uSelf0_01"), { ...cleanCard, origin: { town: "Taqah", tribe: "x" } }));
  });

  it("age/gender on the card are rejected", async () => {
    await assertFails(setDoc(card(asSelf(), "spk_uSelf0_01"), { ...cleanCard, ageBand: "40-60" }));
    await assertFails(setDoc(card(asSelf(), "spk_uSelf0_01"), { ...cleanCard, gender: "f" }));
  });

  it("an unknown consent value is rejected", async () => {
    await assertFails(setDoc(card(asSelf(), "spk_uSelf0_01"), { ...cleanCard, consent: "deleted" }));
  });

  it("cannot create a card claiming another account as steward", async () => {
    await assertFails(setDoc(card(asSelf(), "spk_uSelf0_01"), { ...cleanCard, stewardUid: "uOther" }));
  });

  it("anonymous sign-in cannot create a card", async () => {
    await assertFails(setDoc(card(asAnon(), "spk_anon_01"), { ...cleanCard, uid: "uAnon", stewardUid: "uAnon" }));
  });
});

describe("public speaker card — update", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(card(ctx.firestore(), "spk_uSelf0_01"), cleanCard);
    });
  });

  it("steward may flip consent on a clean card", async () => {
    await assertSucceeds(updateDoc(card(asSelf(), "spk_uSelf0_01"), { consent: "withdrawn" }));
  });

  it("cannot ADD an identifying field via update", async () => {
    await assertFails(updateDoc(card(asSelf(), "spk_uSelf0_01"), { town: "Mirbat" }));
  });

  it("cannot reassign the steward", async () => {
    await assertFails(updateDoc(card(asSelf(), "spk_uSelf0_01"), { stewardUid: "uOther" }));
  });

  it("a stranger cannot update the card", async () => {
    await assertFails(updateDoc(card(asOther(), "spk_uSelf0_01"), { consent: "withdrawn" }));
  });

  it("the card cannot be deleted from the client", async () => {
    await assertFails(deleteDoc(card(asSelf(), "spk_uSelf0_01")));
  });
});

describe("public speaker card — read", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(card(ctx.firestore(), "spk_uSelf0_01"), cleanCard);
    });
  });
  it("anyone may read the public card", async () => {
    await assertSucceeds(getDoc(card(asPublic(), "spk_uSelf0_01")));
  });
});

describe("steward-only /private origin subdoc", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(card(ctx.firestore(), "spk_uSelf0_01"), cleanCard);
    });
  });

  it("the steward may write origin/age/gender to /private", async () => {
    await assertSucceeds(setDoc(priv(asSelf(), "spk_uSelf0_01"), {
      origin: { town: "Mirbat", tribe: "self-identified" }, ageBand: "40-60", gender: "f",
    }));
  });

  it("the steward may read back their own /private subdoc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(priv(ctx.firestore(), "spk_uSelf0_01"), { origin: { town: "Mirbat", tribe: "" } });
    });
    await assertSucceeds(getDoc(priv(asSelf(), "spk_uSelf0_01")));
  });

  it("a stranger cannot read the /private subdoc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(priv(ctx.firestore(), "spk_uSelf0_01"), { origin: { town: "Mirbat", tribe: "" } });
    });
    await assertFails(getDoc(priv(asOther(), "spk_uSelf0_01")));
  });

  it("a stranger cannot write the /private subdoc", async () => {
    await assertFails(setDoc(priv(asOther(), "spk_uSelf0_01"), { origin: { town: "x", tribe: "y" } }));
  });

  it("the public cannot read the /private subdoc", async () => {
    await assertFails(getDoc(priv(asPublic(), "spk_uSelf0_01")));
  });
});
