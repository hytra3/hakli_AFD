# AFD — Roadmap & TODO

The running list of what's shipped, what's next, and the context behind each item,
so nothing lives only in chat scrollback. Grouped by kind, roughly in priority order
within each group.

---

## ✅ Shipped (recent)

- **Shared core** — `afd-core.js` (entry identity, display tiers, the one mic-capture
  protocol) and `afd-words.js` (the 40-entry wordlist). Both `index.html` and
  `find.html` load them; `seed-entries.mjs` reads the wordlist from `afd-words.js`.
- **Dictionary surface** — `dictionary.html`: scrolling list of every entry, live
  per-type counts from Firestore, display-tier aware. Card opens the entry in find;
  chips deep-link to the recorder to add.
- **Entry drill-down** — `find.html#ent_xxx` renders a chosen entry's full card
  (voices, sentence/meaning slots, playback) with no search.
- **Consent loop, end to end** — Withdraw/Restore (reversible hide), Erase (two-tap →
  `consent:"deleted"`), and the scheduled **purge** Cloud Function that actually
  deletes the bytes 24h after erasure. Daily Cloud Scheduler tick.
- **Recorder** — returning-speaker fast path (skip setup when signed in + speaker
  saved), wordless "sound" tier (English hidden, icon buttons, dot cue), find icon
  back to the dictionary, type-aware "how others said it", visible build stamp.
- **Reset tooling** — `scripts/reset-corpus.mjs` (dry-run default) clears test
  recordings + audio while keeping entry shells, wordlist, UI audio, and legacy.

---

## Polish / small fixes

- **Lead-card "closest match" marker** — in the wordless sound/script tiers nothing
  shows *which* result is the top acoustic match, and an expanded mid-list card can
  read as if it were singled out as "best." Add a subtle, unlabeled cue on the lead
  card only (a faint ring or amber dot), and make sure only the lead auto-expands.
  No visible ranking or number — a felt order, not a stated one.
- **Sound-mode chips still read in English** — the dictionary's `word / sentence /
  meaning` chips show English text even in the wordless "sound" tier. Should be
  icon-only there, like the recorder's audio buttons.
- **Recorder "reps/repetitions" wording** — already type-gated in most places; sweep
  once more to be sure sentence/meaning never show a rep count anywhere.
- **Favicon on `prompts/`** and any other stray pages (main three are done).
- **Soundwave on find, like create** — the recorder draws a real amplitude sparkline
  after capture; find shows waveform *tiles* but not the per-take envelope. The
  `envelope` array is already stored on each recording and returned by
  `listPlayable`, so render it as a sparkline on find's voice rows / tiles to match
  the recorder's treatment. Mostly a rendering reuse.

## Features designed, not yet built

- **Rep-splitting** *(this is the "two-soundwave tile")* — the word tile shows the
  full say-it-twice envelope with a dead gap. Plan: keep the 2-rep clip as ONE
  immutable atom, store burst boundaries as timestamps, and *derive* a single clean
  rep for the tile / playback / embedding. Split only on a real pause; tag both
  derived reps with the shared recordingId so one recording = one contribution.
  Touches `analyse()`, storage, the embed service, and rendering.
- **Distinct Sentence / Meaning icons** — speech-bubble (sentence) and open-book
  (meaning), used consistently across recorder, find, and dictionary.
- **Agent-mediated Withdraw / Erase** — needs the spoken-withdrawal audio artifact so
  it satisfies the Firestore rule for takes recorded via an agent (self-recorded
  takes already work).
- **Speaker-profile screen** — custom avatar upload + masking choice + spoken consent;
  requires image support in `afd-storage.rules`. Deferred.
- **Profile / user card with avatar** — a viewable contributor card: default
  (nature/wildlife combinatorial) avatar, changeable to a chosen/uploaded one. Pairs
  with the speaker-profile screen above (that's the *setup*; this is the *card* others
  and the contributor see). Keep masking/consent front-and-centre.
- **Share an entry (to recruit new users)** — the infrastructure already exists: an
  entry is a shareable URL (`find.html#ent_xxx`). Add a share affordance (copy link /
  native share sheet), ideally with a friendly preview, so a speaker can send "here's
  *sun* in Hakli" to family. Directly serves the diaspora-reach goal.
- **Bulk withdraw** at word/speaker level, and a **proxy/speaker roster** (one device,
  many speakers) — the roster also makes speaker-level bulk actions possible.
- **Immediate purge** (optional) — a Firestore-onUpdate trigger variant if the daily
  sweep's latency ever feels too slow. Current scheduled sweep is the safe default.

## Ordering / legibility (design decision, not yet built)

- **Dictionary order** — currently plain wordlist order. Decide a *felt, unlabeled*
  order (no visible metric — visible rankings would wrongly signal whose words
  "matter"). Candidate signals: coverage-need (thinnest entries first, to channel
  effort to gaps), completeness (all three groups filled), freshness, or distinct-
  speaker diversity. Leaning coverage-need or completeness. Search stays acoustic.
- Pairs with the lead-card marker above — both are "make the order legible without
  labeling it."

## Architecture / consolidation

- **Front door + naming** — make the dictionary the index/landing surface and demote
  the recorder to the "add" module, completing the one-surface-two-verbs vision.
  A deliberate routing/renaming move.

## Housekeeping / refactor notes

- **Cache-bust the shared files** — `afd-core.js` and `afd-words.js` load with
  `?v=b0821a`. Bump that query whenever either file changes, or browsers serve a
  stale copy. (Worth tying to BUILD so it can't be forgotten.)
- **`entrySlug` lives twice on purpose** — `afd-core.js` (browser) and
  `seed-entries.mjs` (Node, can't read the browser global). They MUST stay
  byte-identical: a drift silently orphans recordings under mismatched entryIds.
  Worth a tiny test that both produce the same id for every wordlist entry.
- **`prompts/` recorder is intentionally independent** — it records UI narration
  (`afd_ui/`) with mic processing ON, which is correct for playback. Do NOT migrate
  it to the corpus's processing-off protocol.
- **`.bak` files** (`index.html.bak`, `find.html.bak`) are pre-refactor backups —
  safe to `rm`; now gitignored so they won't be committed.

## Multi-language / adding a new language

**Principle: shared codebase, isolated data.** Almost nothing in the hard parts is
Hakli-specific — the consent model, immutable-atom data model, record/find/dictionary
loop, purge, and audio-first UX are all language-agnostic. Expansion is isolation +
configuration, not a rewrite.

- **One Firebase project per language** (not one project with role-gated access).
  Each corpus is a distinct community's cultural property — its own consent,
  governance, archival deposit, funders. Data isolation is non-negotiable here, and
  per-project ownership means a community can take their corpus and walk if they ever
  want to. Same call already made for AFD-vs-tawq.in; it scales.
- **Same code, deployed against different configs.** Fix a bug once, every language
  benefits; no fork drift. "New language" should become "new cartridge."

**Concrete refactors this implies (none built yet):**
- **Per-language config file** — pull the last Hakli-specific bits out of the code:
  `firebaseConfig` (currently inline in each HTML), the wordlist (already isolated in
  `afd-words.js`), and the **bridge script** setting.
- **Bridge script becomes config, not a hardcode** — today Arabic gloss + the
  auto/sound/script tiers assume a script exists. For another language the bridge
  might be Spanish, Swahili, Tok Pisin… or nothing. Config should say whether a
  bridge exists and what it is; when none, the tier toggle collapses to
  picture-and-sound only. The "sound" tier already runs with zero text, so a fully
  unwritten language is just "sound tier as the only tier" — the architecture is
  already there.
- **Opaque entry ids** — `entryIdFor` currently slugs an English id. With no written
  form, use stable opaque ids (`ent_0001`) with the *picture* + a *reference audio*
  as the human-facing identity. Entries are already mutable labels over immutable
  audio atoms, so an opaque id is fine.
- **Audio-promptable wordlist** — for a truly unwritten language the recorder prompt
  can't be text. Emoji pictographs carry a lot but not the whole lexicon (kinship,
  abstractions, local flora/fauna). Deeper move: the *prompt itself becomes a
  recording* — a trusted speaker records "the word for X," and that audio is the
  prompt. Largely already built as the `prompts/` + `afd_ui` spoken-interface pattern;
  generalize it so the whole app is promptable by audio, not text.
- **Archive gloss stays optional metadata** — even an unwritten language usually needs
  a written anchor in a contact language for the ELAR/PARADISEC deposit and for
  researchers. Keep it as metadata never surfaced in the non-reader UI. "Unwritten in
  the app" and "has a catalogue gloss for the archive" don't conflict.

**Non-technical (matters more than the code):** each new language is a new
*relationship* — community, consent framework, authoritative speakers, governance
over what's canonical, and IP that belongs to them. The consent-as-living-control
model is the right foundation but must be re-grounded per community, not assumed to
transfer. The years of fieldwork behind Hakli are the part that doesn't copy-paste.

## External (non-AFD)

- **Scott's `tawq.in` `server.js`** — the expired-token string-mismatch auth bypass
  (`"Expired Token"` vs `"Expired"`). Fix written; still needs sending to Scott.
