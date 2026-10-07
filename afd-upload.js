/* ============================================================================
   afd-upload.js — the ONE way a take reaches the corpus.

   Used by the full recorder (recorder.html) and the simple "add a word" page
   (add.html), so both write exactly the same recording doc, speaker card and
   private subdoc. The recording-doc field list here is the client half of the
   allowlist in afd-firestore.rules (afd_entries/{id}/recordings create) — keep
   the two in step.

   ctx = { db, store, uid } — the page's own Firestore / Storage handles and the
   signed-in, NON-anonymous account's uid (the rules refuse anonymous writes).
   rec = a kept take (see keepBtn in recorder.html for its shape).
   speaker = that take's speaker + consent snapshot (speakerRecord()).

   Bump the ?v= on every import when this file changes.
   ============================================================================ */
import { doc, getDoc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getMetadata }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

export async function uploadClip({ db, store, uid }, rec, speaker){
  if(!db || !store) throw new Error("Firebase not configured");
  if(!uid) throw new Error("not signed in");
  const speakerId = speaker.speakerId;
  if(!speakerId) throw new Error("no speaker code");

  // Read the speaker card FIRST. Two things it can tell us that the form can't:
  //  • the card belongs to another steward → this code isn't ours to record
  //    under (a collision or a mistyped code). Stop; the take stays on the phone.
  //  • the speaker has since withdrawn (or erased). Withdrawal is the speaker's
  //    own act, so a later take — or an old one uploading after signal returns —
  //    must NOT quietly flip them back to public. It uploads hidden, and the card
  //    keeps its state. Restoring is still the roster's deliberate "share again".
  const cardSnap = await getDoc(doc(db, "afd_speakers", speakerId));
  const card = cardSnap.exists() ? (cardSnap.data() || {}) : null;
  if(card && card.stewardUid && card.stewardUid !== uid)
    throw new Error("speaker code "+speakerId+" belongs to another account");
  const cardHidden = !!card && (card.consent === "withdrawn" || card.consent === "deleted");
  const allowPlayback = !cardHidden && speaker.consent.publicPlayback === true;

  // Idempotent retries. Audio is write-once in Storage and a recording doc can't
  // be re-set, so a take whose first attempt got partway (bytes up, then the
  // signal dropped) would otherwise fail every retry forever. On a refused
  // write, check whether the earlier attempt already landed and carry on.
  if(rec.blob){
    const ext = /mp4/.test(rec.capture.codec) ? "m4a" : "webm";
    const path = `afd/${uid}/${rec.recordingId}.${ext}`;
    try{
      await uploadBytes(ref(store, path), rec.blob, {
        contentType: rec.blob.type || "audio/webm",
        customMetadata: { entryId: rec.entryId, gloss: rec.gloss, recordingId: rec.recordingId }
      });
    }catch(e){
      let landed = false;
      try{ const m = await getMetadata(ref(store, path)); landed = !!m && m.size === rec.blob.size; }catch(_){}
      if(!landed) throw e;
    }
    rec.storagePath = path;
  }

  // Explicit field allowlist — NOT a blind {...rec} spread. Recording docs are
  // world-readable whenever allowPlayback is true, so only corpus-meaningful,
  // non-identifying fields belong here. Anything not named below stays on-device
  // (IndexedDB) and can never leak: a field added to the local rec later cannot
  // silently become public just by existing.
  const cap = rec.capture || {};
  const recRef = doc(db, "afd_entries", rec.entryId, "recordings", rec.recordingId);
  try{
    await setDoc(
      recRef,
      {
        recordingId:     rec.recordingId,
        entryId:         rec.entryId,
        gloss:           rec.gloss,
        domain:          rec.domain,
        speakerId:       rec.speakerId,
        phase:           rec.phase,
        type:            rec.type,
        promptTier:      rec.promptTier,
        repetitionIndex: rec.repetitionIndex,
        // capture WITHOUT `device` (navigator.userAgent): a UA fingerprint has no
        // place in a world-readable doc. The QC-relevant capture fields are kept.
        capture: {
          sampleRate:        cap.sampleRate,
          codec:             cap.codec,
          durationMs:        cap.durationMs,
          bluetoothDetected: cap.bluetoothDetected === true
        },
        qc:              rec.qc,
        envelope:        rec.envelope,
        // storagePath is set above only when there was a blob; omit it otherwise
        // rather than writing undefined (which Firestore rejects).
        ...(rec.storagePath ? { storagePath: rec.storagePath } : {}),
        recordedAt:      rec.recordedAt,
        uid,
        // Three-state per-recording consent label; withdrawal flips this to
        // "withdrawn"/"deleted". Public at create — the recording isn't withdrawn.
        consent: "public",
        // Provenance: recorded on the speaker's behalf by an agent (assistant).
        // Lets find/rules require the speaker's spoken artifact before an agent
        // may withdraw — never a silent third-party lever.
        viaAgent: speaker.viaAgent === true,
        // Denormalised "currently public" flag that rules/queries filter on: the
        // recording's own consent AND the speaker's bulk consent must both allow
        // (and a withdrawn/erased card, read above, always wins).
        allowPlayback,
        uploadedAt: serverTimestamp()
      }
    );
  }catch(e){
    // Refused because an earlier attempt already wrote it? Then it's done.
    let mine = false;
    try{ const sn = await getDoc(recRef); mine = sn.exists() && (sn.data()||{}).uid === uid; }catch(_){}
    if(!mine) throw e;
  }

  // Speaker profile — consent model (afd-consent-design.md):
  //   stewardUid = the account managing this speaker's consent
  //   consent    = the three-state bulk switch (public | withdrawn)
  //   grant      = the recorded consent flags (archival / ML / attribution)
  // viaAgent + masked default off until the agent and masking flows exist.
  // Keyed by the globally-unique speaker code (not uid): one doc PER SPEAKER, so a
  // steward recording several people no longer overwrites a single per-account doc.
  // This is also the key the rules already look up by (speaker()/speakerExists()).
  // A hidden card keeps its consent AND its grant untouched (see above).
  await setDoc(doc(db, "afd_speakers", speakerId), {
    uid,
    stewardUid: uid,
    speakerId,
    viaAgent: speaker.viaAgent === true,
    ...(card ? {} : { masked: false }),
    ...(cardHidden ? {} : {
      consent: speaker.consent.publicPlayback === true ? "public" : "withdrawn",
      grant: speaker.consent
    }),
    updatedAt: serverTimestamp()
  }, { merge: true });

  // Town/tribe, age, and gender all identify a speaker, so they live in a
  // steward-only /private subdoc, never the world-readable card. Written AFTER
  // the parent so the subdoc rule (which get()s the parent's stewardUid)
  // resolves; skipped only when every private field is empty.
  const org = speaker.origin || {};
  const hasOrigin = (org.town && org.town.trim()) || (org.tribe && org.tribe.trim());
  const hasDemog  = (speaker.ageBand && String(speaker.ageBand).trim())
                 || (speaker.gender && String(speaker.gender).trim());
  if(hasOrigin || hasDemog){
    await setDoc(doc(db, "afd_speakers", speakerId, "private", "profile"),
      { origin: { town: org.town || "", tribe: org.tribe || "" },
        ageBand: speaker.ageBand || "", gender: speaker.gender || "",
        updatedAt: serverTimestamp() },
      { merge: true });
  }

  return true;
}
