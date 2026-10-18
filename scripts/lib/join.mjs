/*  Joining two word cards that are the same word (10-17) — the logic behind
 *  scripts/join-words.mjs, kept here so it can be tested without Firebase.
 *
 *  A join moves every voice on one card (FROM — a contributed word) onto the
 *  card it duplicates (INTO), then hides FROM and stamps it `joinedInto`, so:
 *    · nobody's consent changes — each voice keeps its consent, playback,
 *      speaker and owner exactly as they were; only the word it hangs on moves;
 *    · the audio file is not copied or moved. Its Storage label (custom
 *      metadata entryId) is pointed at the new word, because the Storage rule
 *      finds a take's consent through that label;
 *    · every moved voice carries `joinedFrom` { entryId, gloss, at, by }, and
 *      the hidden card keeps its picture and `joinedInto`, so a join can be
 *      undone (undoJoin) — the purge never reaps a joined card;
 *    · INTO keeps its own face. A card with a picture (emoji or photo) keeps it;
 *      only a card with none takes FROM's. Names likewise, one by one;
 *    · Hakli spellings written on FROM are copied to INTO (one per writer; a
 *      writer who already wrote one on INTO keeps theirs).
 *  Every step is safe to re-run: a join cut off halfway finishes on the next run.
 *
 *  db / bucket: firebase-admin Firestore and a Storage bucket (or test fakes
 *  with the same small surface: doc(path).get/set/update/delete,
 *  collection(path).get / .where(f,'==',v).get, bucket.file(p).setMetadata). */

const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ًͯ-ٰٟ]/g, "")
  .replace(/[آأإٱ]/g, "ا").replace(/[ىی]/g, "ي").replace(/ة/g, "ه").toLowerCase().trim();

/* Find a word by id ("ent_water"), by its picture ("💧"), or by what it's
   called (English, Arabic; diacritics and letter variants folded). An exact
   name wins; failing that, any card whose name contains it. */
export function findWords(q, entries){
  const k = norm(q), pic = String(q || "").trim();
  const exact = entries.filter(e => e.id === q);
  if(exact.length) return exact;
  const names = (d) => [d.gloss, d.glossAr, d.glosses && d.glosses.en, d.glosses && d.glosses.ar].filter(Boolean).map(norm);
  const byPic = entries.filter(e => (e.data || {}).pic && (e.data.pic === pic || e.data.pic.replace(/\uFE0F/g, "") === pic.replace(/\uFE0F/g, "")));
  const byName = entries.filter(e => names(e.data || {}).includes(k));
  const found = [...new Map([...byName, ...byPic].map(e => [e.id, e])).values()];
  if(found.length || !k) return found;
  return entries.filter(e => names(e.data || {}).some(n => n.includes(k)));
}

/* Everything a join would do, and anything that should stop it. Writes nothing. */
export async function planJoin(db, fromId, intoId){
  const problems = [];
  const [fs, is] = await Promise.all([db.doc(`afd_entries/${fromId}`).get(), db.doc(`afd_entries/${intoId}`).get()]);
  const from = fs.exists ? (fs.data() || {}) : null, into = is.exists ? (is.data() || {}) : null;
  if(fromId === intoId) problems.push("a word can't be joined into itself");
  if(!from) problems.push(`no word ${fromId}`);
  if(!into) problems.push(`no word ${intoId}`);
  if(from && from.source !== "user") problems.push(`${fromId} is one of the built-in words — join the other one into it instead`);
  if(from && from.joinedInto && from.joinedInto !== intoId) problems.push(`${fromId} is already joined into ${from.joinedInto}`);
  if(into && into.joinedInto) problems.push(`${intoId} was itself joined into ${into.joinedInto} — join into that one`);
  if(into && (into.removedAt || into.hiddenAt)) problems.push(`${intoId} is hidden or removed`);
  const recs = from ? (await db.collection(`afd_entries/${fromId}/recordings`).get()).docs.map(d => ({ id: d.id, ref: d.ref, data: d.data() || {} })) : [];
  const clashes = [];
  for(const r of recs){
    const there = await db.doc(`afd_entries/${intoId}/recordings/${r.id}`).get();
    if(there.exists && !((there.data() || {}).joinedFrom && there.data().joinedFrom.entryId === fromId)) clashes.push(r.id);
  }
  if(clashes.length) problems.push(`recording id already on ${intoId}: ${clashes.join(", ")}`);
  const spells = from ? (await db.collection(`afd_entries/${fromId}/spellings`).get()).docs.map(d => ({ id: d.id, data: d.data() || {} })) : [];
  const intoSpells = into ? new Set((await db.collection(`afd_entries/${intoId}/spellings`).get()).docs.map(d => d.id)) : new Set();
  // Emoji and photo are one thing — the card's picture (a photo shows instead of
  // the emoji). A kept card with either keeps it and takes neither; names are
  // filled one by one.
  const face = {};
  if(from && into){
    if(!into.pic && !into.image){ if(from.pic) face.pic = from.pic; if(from.image) face.image = from.image; }
    for(const f of ["glossAr", "gloss"]) if(!into[f] && from[f]) face[f] = from[f];
  }
  return {
    fromId, intoId, from, into, problems,
    recs, spells: spells.filter(s => !intoSpells.has(s.id)), keptSpells: spells.filter(s => intoSpells.has(s.id)),
    face
  };
}

export async function applyJoin(db, bucket, plan, by, now){
  if(plan.problems.length) throw new Error("join refused: " + plan.problems.join("; "));
  const { fromId, intoId, into } = plan, at = now || new Date();
  const notes = [];
  for(const r of plan.recs){
    const dst = db.doc(`afd_entries/${intoId}/recordings/${r.id}`);
    if(!(await dst.get()).exists){
      await dst.set({ ...r.data, entryId: intoId, gloss: into.gloss || r.data.gloss || "",
        joinedFrom: { entryId: fromId, gloss: r.data.gloss || "", at, by } });
    }
    if(r.data.storagePath){
      try{ await bucket.file(r.data.storagePath).setMetadata({ metadata: { entryId: intoId } }); }
      catch(e){ if(e && (e.code === 404 || /No such object|not found/i.test(e.message || ""))) notes.push(`${r.id}: no audio file in Storage (moved the record anyway)`); else throw e; }
    }
    await r.ref.delete();
  }
  for(const s of plan.spells)
    await db.doc(`afd_entries/${intoId}/spellings/${s.id}`).set({ ...s.data, joinedFrom: fromId });
  if(Object.keys(plan.face).length){
    const upd = { ...plan.face };
    if(upd.glossAr) upd["glosses.ar"] = upd.glossAr;
    if(upd.gloss) upd["glosses.en"] = upd.gloss;
    await db.doc(`afd_entries/${intoId}`).update(upd);
  }
  await db.doc(`afd_entries/${fromId}`).update({
    hiddenAt: at, joinedInto: intoId, joinedAt: at, joinedBy: by, joinedFace: Object.keys(plan.face) });
  return notes;
}

/* Put a join back: the voices return to FROM, its copied spellings and face
   fields leave INTO (face only where INTO still shows what was copied), and
   FROM shows again. */
export async function undoJoin(db, bucket, fromId, by, del, now){
  const fs = await db.doc(`afd_entries/${fromId}`).get();
  const from = fs.exists ? (fs.data() || {}) : null;
  if(!from || !from.joinedInto) throw new Error(`${fromId} isn't a joined word`);
  const intoId = from.joinedInto, at = now || new Date();
  const moved = (await db.collection(`afd_entries/${intoId}/recordings`).where("joinedFrom.entryId", "==", fromId).get()).docs;
  for(const d of moved){
    const x = d.data() || {}, { joinedFrom, ...rest } = x;
    const back = db.doc(`afd_entries/${fromId}/recordings/${d.id}`);
    if(!(await back.get()).exists) await back.set({ ...rest, entryId: fromId, gloss: (joinedFrom && joinedFrom.gloss) || rest.gloss || "" });
    if(x.storagePath){
      try{ await bucket.file(x.storagePath).setMetadata({ metadata: { entryId: fromId } }); }
      catch(e){ if(!(e && (e.code === 404 || /No such object|not found/i.test(e.message || "")))) throw e; }
    }
    await d.ref.delete();
  }
  const sp = (await db.collection(`afd_entries/${intoId}/spellings`).where("joinedFrom", "==", fromId).get()).docs;
  for(const d of sp) await d.ref.delete();
  const is = await db.doc(`afd_entries/${intoId}`).get(), into = is.exists ? (is.data() || {}) : {};
  const back = {};
  for(const f of (from.joinedFace || [])) if(into[f] === from[f]) back[f] = del;
  if(back.glossAr) back["glosses.ar"] = del;
  if(back.gloss) back["glosses.en"] = del;
  if(Object.keys(back).length) await db.doc(`afd_entries/${intoId}`).update(back);
  await db.doc(`afd_entries/${fromId}`).update({ hiddenAt: del, joinedInto: del, joinedAt: del, joinedBy: del, joinedFace: del,
    unjoinedAt: at, unjoinedBy: by });
  return { intoId, voices: moved.length, spellings: sp.length };
}
