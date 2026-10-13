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
  // `code` is this dictionary's own identifier for the language, stamped on
  // every record. It is a BCP 47 private-use code (qaa–qtz are reserved for
  // local use), chosen so that no record carries a contested external code.
  // If an official code is ever issued for Hakli, it replaces this one in a
  // single backfill.
  language: {
    code: "qhk",
    name: "Hakli",
    endonym: "Əḥklí",

    // External crosswalks — consulted only at archive-deposit time, never
    // written onto records. Left empty on purpose; fill in only by deliberate
    // decision for a specific deposit.
    crosswalk: {
      iso639_3: "",
      glottocode: ""
    }
  },

  // Languages glosses are written in, in display priority. `glosses` maps on
  // word cards are keyed by these codes, and the Firestore rules allow exactly
  // these keys (keep afd-firestore.rules in step).
  contactLanguages: [
    { code: "ar", script: "Arab", dir: "rtl" },
    { code: "en", script: "Latn", dir: "ltr" }
  ],

  // The Firebase project this instance's data lives in. One copy for every
  // page (index, add, recorder, welcome, steward, prompts, prompts/admin).
  // Web keys identify a project; they are not secrets — access is governed
  // by the security rules and the API key's HTTP-referrer allowlist.
  // NB: afd-firestore.rules also names the bucket (the word-photo URL check);
  // rules can't read this file, so change it there too.
  firebase: {
    apiKey:            "AIzaSyDsLxppuVNGLdJGcF85irDxepVL36RaqiY",
    authDomain:        "afd-dev.firebaseapp.com",
    projectId:         "afd-dev",
    storageBucket:     "afd-dev.firebasestorage.app",
    messagingSenderId: "454829954488",
    appId:             "1:454829954488:web:c83d6d16ab17e106956b4d"
  },

  // The speak-to-find embedding service (Cloud Run). Shared across instances
  // in future; per-instance for now.
  embedUrl: "https://afd-embed-454829954488.europe-west1.run.app"
};
