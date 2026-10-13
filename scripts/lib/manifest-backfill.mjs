/*  What the manifest-fields backfill adds to one doc — pure functions, no I/O.
 *  ------------------------------------------------------------------
 *  Each plan* function returns ONLY the fields a doc is missing. It never
 *  changes a value that is already there: a field present with any value
 *  (even one that looks wrong) is left for a person to fix, not overwritten.
 *  That keeps the backfill safe to re-run, and safe against docs written
 *  after #35 by the app itself.
 */

// Pre-#35 entries stored glosses in two fixed fields. Map each contact
// language to the legacy field that held it. Only Hakli has legacy docs, so
// this list is the whole history; a new instance starts with `glosses`.
const LEGACY_GLOSS_FIELDS = { en: "gloss", ar: "glossAr" };

const isStr = (v) => typeof v === "string" && v.trim().length > 0;

/** Fields a word card (afd_entries/{id}) is missing. */
export function planEntry(doc, instance){
  const d = doc || {};
  const patch = {};
  if(!("lang" in d)) patch.lang = instance.language.code;
  if(!("concepts" in d)) patch.concepts = [];
  if(!("glosses" in d)){
    const glosses = {};
    for(const { code } of instance.contactLanguages || []){
      const legacy = LEGACY_GLOSS_FIELDS[code];
      if(legacy && isStr(d[legacy])) glosses[code] = d[legacy].trim();
    }
    if(Object.keys(glosses).length) patch.glosses = glosses;
  }
  // `access` is reserved: absent means "no protocol yet", so nothing is written.
  return patch;
}

/** Fields a recording doc is missing, plus whether its audio needs a checksum. */
export function planRecording(doc, instance){
  const d = doc || {};
  const patch = {};
  // One default language for every take (no per-take guessing). A take in
  // another language is corrected by hand later.
  if(!("lang" in d)) patch.lang = instance.language.code;
  // Checksum the stored bytes when there are bytes and they aren't on their
  // way out: an erased take ("deleted") is waiting for the purge. Withdrawn
  // takes keep their bytes on purpose, so they get a checksum too.
  const needsHash = !("sha256" in d) && isStr(d.storagePath) && d.consent !== "deleted";
  return { patch, needsHash };
}
