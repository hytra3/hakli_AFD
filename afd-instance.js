/* ============================================================================
   afd-instance.js — what makes this AFD *this* language's dictionary.

   Everything instance-specific lives here as data: the language being
   documented, the contact languages its glosses are written in, and (later)
   the speaker-metadata schema and access protocol. Code reads these values;
   it never names Hakli, Arabic or Dhofar itself. A second language's AFD
   starts from a copy of this file.

   Loaded as a plain classic script before page scripts (like afd-words.js),
   available as window.AFDInstance. Node scripts read it the same way
   afd-words.js is read: see readInstance() in scripts/seed-entries.mjs.
   The export manifest's instance.json is generated from this file.

   Bump the ?v= query on the <script src> when this file changes.
   ============================================================================ */
window.AFDInstance = {
  instanceId: "hakli",

  // The language every recording and word card belongs to unless marked
  // otherwise. One default, on purpose: speakers who can't read can't be asked
  // to pick a language per take. A take in another language is the rare
  // exception and gets corrected later, not chosen at record time.
  // CONFIRM before the backfill runs: ISO 639-3 "shv" (Shehri / Jibbali).
  language: {
    code: "shv",
    name: "Hakli",
    endonym: "Əḥklí",
    glottocode: ""            // to confirm
  },

  // Languages glosses are written in, in display priority. `glosses` maps on
  // word cards are keyed by these codes, and the Firestore rules allow exactly
  // these keys (keep afd-firestore.rules in step).
  contactLanguages: [
    { code: "ar", script: "Arab", dir: "rtl" },
    { code: "en", script: "Latn", dir: "ltr" }
  ]
};
