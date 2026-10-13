/*  Concept links — pure helpers for scripts/apply-concepts.mjs (no I/O).
 *  ------------------------------------------------------------------
 *  A link names concepts as "concepticon:<ID>" (Concepticon's numeric ID) or
 *  "local:<instanceId>/<slug>" for a concept Concepticon doesn't have. One word
 *  card may link to several concepts; one concept may be linked from several
 *  cards. Empty is fine: a card is never forced onto a concept.
 */

const CONCEPTICON = /^concepticon:(\d+)$/;
const LOCAL = /^local:[a-z0-9_-]+\/[a-z0-9_-]+$/;

/** Is this a well-formed concept id? */
export function isConceptId(id){
  return CONCEPTICON.test(id) || LOCAL.test(id);
}

/** A readable line for one concept id: "1343 SUN — The physical world". */
export function describe(id, index, local){
  const m = CONCEPTICON.exec(id);
  if(m){
    const c = index[m[1]];
    return c ? `${m[1]} ${c[0]} — ${c[1]}` : `${m[1]} (not in this Concepticon copy)`;
  }
  const l = local && local[id];
  return l ? `${id} — local: ${(l.glosses && l.glosses.en) || ""}` : `${id} — local (not described yet)`;
}

/**
 * Turn a reviewer's answer into a decision.
 *   "" / "s"            → skip (decide later)
 *   "y"                 → confirm the proposal
 *   "n"                 → no concept fits this card
 *   "857" / "559 560"   → these Concepticon IDs instead
 *   "local:hakli/x"     → a local concept (mixable with numbers)
 * Returns { action: "skip" | "confirm" | "none", concepts? } or { error }.
 */
export function parseAnswer(answer, proposal, index){
  const a = String(answer || "").trim();
  if(a === "" || a.toLowerCase() === "s") return { action: "skip" };
  if(a.toLowerCase() === "y") return { action: "confirm", concepts: [...proposal] };
  if(a.toLowerCase() === "n") return { action: "none", concepts: [] };
  const ids = [];
  for(const tok of a.split(/[\s,]+/).filter(Boolean)){
    const id = /^\d+$/.test(tok) ? "concepticon:" + tok : tok;
    if(!isConceptId(id)) return { error: `"${tok}" isn't a Concepticon number or a local:<instance>/<name> id` };
    const m = CONCEPTICON.exec(id);
    if(m && !index[m[1]]) return { error: `${m[1]} isn't a current Concepticon concept` };
    if(!ids.includes(id)) ids.push(id);
  }
  return { action: "confirm", concepts: ids };
}

/** The Firestore writes needed: confirmed links whose card doesn't already match. */
export function planWrites(links, current){
  const out = [];
  for(const [entryId, l] of Object.entries(links)){
    if(l.status !== "confirmed" && l.status !== "none") continue;
    const want = l.status === "none" ? [] : (l.concepts || []);
    const have = current[entryId];
    if(have === undefined) continue;                       // no such card (yet)
    const same = Array.isArray(have) && have.length === want.length && have.every((x, i) => x === want[i]);
    if(!same) out.push({ entryId, concepts: want });
  }
  return out;
}
