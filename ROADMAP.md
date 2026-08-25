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

- **✅ Lead-card "closest match" marker** — in the wordless sound/script tiers nothing
  shows *which* result is the top acoustic match, and an expanded mid-list card can
  read as if it were singled out as "best." Add a subtle, unlabeled cue on the lead
  card only (a faint ring or amber dot), and make sure only the lead auto-expands.
  No visible ranking or number — a felt order, not a stated one.
- **✅ Sound-mode chips → icons (dictionary)** — the dictionary's `word / sentence /
  meaning` chips show English text even in the wordless "sound" tier. Should be
  icon-only there, like the recorder's audio buttons.
- **✅ Recorder "reps" wording** — word-gated everywhere; session row now localized. — already type-gated in most places; sweep
  once more to be sure sentence/meaning never show a rep count anywhere.
- **✅ Favicon on `prompts/`** and any other stray pages (main three are done).
- **✅ Soundwave on find** — per-take envelope sparkline on voice rows (amber while playing). — the recorder draws a real amplitude sparkline
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
- **Allosaurus phonetic order (candidate approach)** — Allosaurus is a universal
  (language-independent) phone recognizer; run it over each entry's recordings and
  it yields an IPA-ish phone string with no orthography required. Sorting entries by
  that phone sequence gives a *phonetic* order — the unwritten-language equivalent of
  alphabetical: stable, neutral, and, crucially, it ranks **sounds, not people**, so
  it sidesteps the "whose words matter" problem that engagement metrics carry. Fits
  the audio-first ethos (order emerges from the audio itself) and doubles as a
  browsing spine an elder can learn by ear. Open questions: which phone gets the sort
  key when voices differ (pick the lead/nearest recording, consistent with the
  matching policy), how to collapse phones into a coarse sort order that feels natural
  rather than IPA-pedantic, and whether it's the primary order or a tiebreaker under
  coverage-need. Note: we already ran Allosaurus on the legacy corpus during the
  matching study, so the toolchain is known.

## Architecture / consolidation

- **✅ Entry-card unified / find IS the dictionary** — `entryCard` is now lazy (cheap
  header, detail on expand); `find.html` lists every entry as a collapsed card that
  expands in place, carries voice counts collapsed, and has a back-to-all control.
  One card renderer, reached by speaking or scrolling. `dictionary.html` retired into
  a redirect to `find.html`.
- **Front door + naming (remaining)** — `find.html` is now the main surface and the
  recorder (`index.html`) is the "add" module, but the *filenames* still say
  otherwise (index = recorder). Completing the vision means renaming so the landing
  page is `index` and the recorder becomes e.g. `add`/`record` — a routing/rename
  move (deep-links use `index.html#ent` for add, so do it deliberately). Not urgent.

## Housekeeping / refactor notes

- **✅ Cache-bust drift fixed + made drift-proof (08-25)** — the audit found pages at
  `BUILD=b0825a` still loading `afd-core.js?v=b0822b`, with index/find disagreeing on
  the `afd-words` version (b0821a vs b0822b) — they could run different cached
  wordlists. All `?v=` unified to b0825a, and a new `scripts/sync-stamp.sh` now
  propagates the canonical BUILD (read from `find.html`) to every `?v=` and to
  `index.html`'s BUILD; `publish-site.sh` runs it automatically. Workflow unchanged
  (bump BUILD in find.html, publish). Trade: shared files re-fetch every publish even
  if unchanged — tiny files, and "always fresh" is the right call.
- **`entrySlug` lives twice on purpose** — `afd-core.js` (browser) and
  `seed-entries.mjs` (Node, can't read the browser global). They MUST stay
  byte-identical: a drift silently orphans recordings under mismatched entryIds.
  Worth a tiny test that both produce the same id for every wordlist entry.
- **`prompts/` recorder is intentionally independent** — it records UI narration
  (`afd_ui/`) with mic processing ON, which is correct for playback. Do NOT migrate
  it to the corpus's processing-off protocol.
- **✅ `.gitignore` added + cruft untracked (08-25)** — the audit found last session's
  `.gitignore` was never pushed, so `node_modules/` (~5,600 files), both `.bak` files,
  and three debug logs were all tracked (a clone pulled ~15k files). `.gitignore` is
  back, and the one-time untrack command was verified (removes from index, keeps files
  on disk). Since `publish-site.sh` uses `git add -A`, the `.gitignore` now stops any
  of it creeping back. **Manual step (run once in local repo):**
  `git rm -r --cached node_modules && git rm --cached index.html.bak find.html.bak firestore-debug.log test/firebase-debug.log test/firestore-debug.log`,
  then commit alongside the `.gitignore`.

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

## i18n chrome + spoken prompts (reconcile into one inventory)

The display tier switches the *word gloss* but NOT the *chrome* — in script mode you
get the Arabic word wrapped in English scaffolding ("Hold to record", "THE WORD",
"Say it yourself", "Withdraw/Erase", "Speaker doesn't know this word", tab labels,
session controls, find's slot labels). Don't fix these piecemeal — half-localized
chrome reads worse than all-English. Do it as one pass, in this order:

1. **Build the i18n mechanism in `afd-core`** — a keyed string table `{ en, ar, … }`
   the display tier reads, so chrome renders in the tier's language (Arabic in
   script; icon/wordless where possible in sound; English in auto). The *mechanism*
   is shared code; the *strings* are per-language config (ties into Multi-language
   above).
2. **That table IS the canonical current chrome inventory** — every user-facing
   string, keyed.
3. **Reconcile with the existing prompt list** (`prompts/index.html` — spoken-Hakli
   narration for `afd_ui/`). It already uses dotted keys (`voice.takeback`,
   `record.hold`, `consent.truth.*`…), so it's nearly the same artifact. But it has
   drifted: it's ahead in places (`voice.bulk.*`, `voice.mask` — not built) and
   behind in others — **missing keys for what shipped**: Erase / "Erase for good?"
   (only takeback/shareagain exist), the dictionary browse, the tier toggle
   ("change how words are shown"), the find-loop nav. Merge to the union, prune to
   what actually exists.
4. **Regenerate the Hakli prompt list from the reconciled keys**, so friends record
   narration for exactly what the app now shows — nothing stale, nothing missing —
   and wire the sound tier to prefer those recorded prompts where present.

5. **Mute / quiet mode (bake into the prompt-audio system).** Distinguish INTERFACE
   audio (spoken prompts, cue chimes, English TTS, auto-play — scaffolding, noise
   once the pattern is learned) from CONTENT audio (the Hakli recordings — always
   wanted). A "mute" toggle silences interface audio only; content playback ignores
   it. It's a SEPARATE axis from the display tier (display = how words are shown;
   mute = whether the app speaks to you), so it's its own small speaker/mute control,
   not a fourth tier. Every interface sound must check the flag from day one. Optional
   later: narration that auto-fades after a speaker completes the pattern a few times.
   Persist the setting shared (afd-core), like the display mode.
   UI (Marty): long-press the sound/Hakli mode on the display toggle to arm
   mute; show a small mute bubble attached to the soundwave (sound-tier) circle
   when it's active — discoverable, wordless, and tied to the tier it belongs to.

Net: one keyed inventory drives (a) English chrome, (b) Arabic chrome, (c) the
spoken-Hakli prompts, and (d) the next language's chrome — all from the same source.

## External (non-AFD)

- **Scott's `tawq.in` `server.js`** — the expired-token string-mismatch auth bypass
  (`"Expired Token"` vs `"Expired"`). Fix written; still needs sending to Scott.
