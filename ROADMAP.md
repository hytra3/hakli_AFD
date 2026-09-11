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
- **✅ Mobile "Couldn't create the entry"** *(fixed 09-08, commit 6c12fac)* — root
  cause was a client gate out of step with the rules, not a network flake. The phone
  held an **anonymous** session (enough to read, so search/display worked), but
  `startNewEntry` gated on `if(!currentUser)` — an anonymous user is a user, so it
  skipped the Google sign-in and called `setDoc`, which `afd_entries` create denies
  via `notAnon()` (`sign_in_provider != 'anonymous'`). The account checkmark used the
  same weak check, so it falsely showed "signed in" and hid the problem. Fix: added
  `isRealUser()` (present AND not anonymous, mirroring `notAnon()`); create now forces
  Google sign-in for anon users, re-checks the live user after the popup, and nudges
  "sign in with Google to add a word" instead of failing into permission-denied; the
  account indicator + button now reflect a *real* account. Verified on the phone.
  *Watch:* if `signInWithPopup` ever misbehaves on a mobile browser, the fallback is
  `signInWithRedirect` on mobile (deeper mobile-auth item, not yet needed). If anon
  contribution is ever wanted, that's a rules change with consent implications.
- **Confidence wording is action-dependent (by design — not a bug)** — spoken *search*
  hedges: `render()` picks "Here it is / ها هو" only when `confident` (distance ≤
  `AUTOPLAY_MAX` AND margin ≥ `MARGIN_MIN`), else "Did you mean… / هل تقصد…".
  *Opening* an entry (dictionary tap / `#ent_xxx` deep link) always says "Here it is"
  because the user chose it — distance 0, nothing to hedge. The 09-08 mobile
  screenshot showing "Here it is" at 0.2033 was an opened entry (or a stale build),
  not the search path misfiring. So there is no wording code to change; the only lever
  on search wording is `AUTOPLAY_MAX`, and that's the threshold-calibration work
  blocked on recording more words. Leave the copy as-is until the corpus can set the
  threshold from real cross-session distances.

## Features designed, not yet built

- **Rep-splitting** *(this is the "two-soundwave tile")* — the word tile shows the
  full say-it-twice envelope with a dead gap. Design settled 09-05; **service + find
  shipped and verified on live Hakli audio 09-08**. The 2-rep clip stays ONE
  immutable atom in Storage; only the embedding and rendering change.

  *Why (so the decisions don't get relitigated):* mean pooling averages MMS frames
  **within one utterance**; silence frames carry a consistent "silence" vector, so a
  whole-atom pool is ~(word + word + pause)/3 and pause length becomes a confound.
  Pooling is order-invariant, so once silence is out, word+word ≈ word — repetition
  buys almost nothing for the match itself. Its value is QC (do the two reps agree?),
  threshold calibration (fresh intra-clip pairs), and redundancy (one rep clipped, the
  other survives). Silence trimming is the fix; "use rep 2" is not.

  1. ✅ **`embed_service/app.py`** — VAD/energy split (`find_reps`), mean-pool
     *each rep over its own frames*, L2-normalise. `/embed` returns
     `{ embedding, vectors, n_reps, rep_distance, rep_offsets }`; `embedding` =
     pool over ALL voiced frames (single-vector view / compat). Firestore forbids
     nested arrays, so the doc stores `reps: [{start,end,vector}, …]` + `nReps` +
     `repDistance` (not `vectors`/`repOffsets`). Trigger writes those; corpus
     loader reads them (nearest-rep per entry) with a legacy `embedding` fallback.
     Synthetic-clip VAD tests pass; `n_reps=2` confirmed on real audio.
  2. **Recorder: two-rep elicitation + soft QC gate** — *(now the active build —
     see below)*. Prompt asks for exactly two reps. `nReps ≠ 2` *or* `repDistance`
     over threshold → one confirm screen, never a refusal. Speaker confirms → atom
     saved, flag left on the doc. VAD will misfire on real speech (lost glottal
     onsets, short pauses merging reps, stop closures splitting a word), so the flag
     doubles as misfire telemetry. Spoken prompt `review.reps.unsure` is **written
     and deployed** (73→74 prompts) — still needs Dhofari review + recording. Wording
     must never imply the speaker got it wrong.
  3. ✅ **Find: single utterance, nearest-rep match** — query vs. every rep vector,
     nearest rep per entry. Contribute-from-find routes into the recorder; query
     audio is never reused as an atom. Verified end-to-end on desktop + mobile 09-08.
  4. **Threshold calibration** *(open — needs many more atoms)* — derive the
     acceptance band from real intra-clip rep pairs. **First live data points:**
     intra-clip `repDistance` **0.0632** (two reps, one voice, one session — tighter
     than expected, as predicted); cross-session find query landed **0.2033** from
     the stored reps of the same word (inside the old 0.14–0.25 self-repeat band).
     Track the VAD misfire rate on Hakli to tune the split threshold too.

  **Match-decision thresholds** (`index.html`: `AUTOPLAY_MAX 0.15`, `MAYBE_MAX 0.25`,
  `MARGIN_MIN 0.03`) are first estimates off a near-empty corpus. The 09-08 query at
  0.2033 correctly showed as "maybe" (past `AUTOPLAY_MAX`) — *reasonable behaviour,
  not a bug*, but with a one-entry corpus the margin is ∞ so only the absolute gate
  fires, which isn't convincing yet. Do NOT retune on single data points; let
  `repDistance` values accumulate across many atoms first, then set `AUTOPLAY_MAX`
  from the observed cross-session distribution.
- **Word silhouette (manner-class strip)** *(the "phonetic rhythm line")* — a
  horizontal strip, one block per segment, left→right in time, encoding the *shape*
  of the sound rather than its spelling. **shape** = manner class (block = stop,
  wavy = fricative, rounded = nasal, open circle = vowel); **width** = duration;
  **raised block** = stress; **colour** reinforces manner, never replaces it.

  *Why manner, not phones or spectrograms (so it doesn't get relitigated):* IPA is a
  new alphabet; spectrograms are speaker-variable and differ between the stored take
  and the user's own query; **manner class is the most robustly recognised dimension**
  — the matching study got exact phone identity wrong constantly but "that was a
  fricative" is far more recoverable. The glyph is therefore built on the sturdy part
  of the signal and degrades gracefully. Same derive-from-audio machinery as the
  Allosaurus ordering candidate below.

  **Rule: store the manner sequence as data, render the strip at display time.** When
  the recogniser improves after fine-tuning, every silhouette updates automatically —
  no stale PNGs. Computed **per recording** (per immutable atom, in the same
  upload/embed pass that writes `reps`), *not* at add-to-dictionary time (a new label
  has no audio to derive from). The card shows **one entry-level strip** = a *view*
  over those per-recording sequences (cleanest take, or consensus across speakers),
  getting better as atoms arrive. Two other homes where per-utterance strips earn
  their keep as separate strips: the **QC/confirm screen** (does what I just recorded
  match the entry?) and **find results** (query strip on top, candidates below — a
  discrimination task, not recall, since the user already said the word).
- **Navigable context sentence (word-level tap-to-entry)** — make the *USED IN A
  SENTENCE* take a navigable object: segment it into word-units rendered as silhouette
  chunks; tapping a chunk isolates that word and follows a hyperlink to its dictionary
  entry. Turns a running context sentence into a browsable map of the flat corpus.

  *The mechanism is disambiguation by context.* The acoustic matcher returns a fuzzy
  candidate set — {bounced, ran, slept} — and the visible frame "the ball ___" kills
  the implausible ones instantly. Same family as the syllable-count trick, but a much
  richer discriminator because it carries selectional meaning. **Crucially: for a big
  language a language model does the "not slept" step; Hakli has no n-gram / selectional
  model and can't cheaply get one, so the *human reading the card* does it — and that's
  correct, not a compromise.** Same division of labour as everywhere else: machine
  carries the acoustics, human carries the semantics. Showing the sentence hands
  disambiguation to the only party who can currently do it.

  **Two hard parts — both argue for capturing links at *contribute* time, not
  reconstructing them later:**
  1. *Segmentation.* A context sentence is connected speech — words coarticulate, no
     clean silences for per-rep VAD to split on (this is exactly why the old
     phrase-length tawq.in corpus matched so poorly). So don't auto-segment; let the
     *add-a-sentence / say-it-yourself* flow capture word boundaries (or the words
     individually) from someone who knows where they are.
  2. *Domain mismatch on the link.* Even once "bounced" is cut out, it's
     connected-speech "bounced" (reduced, coarticulated) matched against a
     *citation-form* entry — the August failure mode. So automatic word→entry
     resolution inside a sentence is noisier than the isolated-word find already
     calibrated; prefer contributor tap-and-tag.

  **Phasing** — *build the framework early, but it won't be "useful" until significant
  data.* v1: contributor tags just the **single word being used** in the sentence at
  record time (captures the boundary *and* the entry link for free). Later: tagging the
  *other* entries in the sentence. Later still — the honest place the machine could earn
  back the "not slept" step: as the corpus grows, accumulate **real Hakli word
  co-occurrence** into a corpus-derived collocation prior (the language's own data, not
  borrowed English intuitions about balls and bouncing), upgrading human-side
  disambiguation into machine-assisted. Not for v1.
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

## Welcome onboarding — narrated walkthrough (decision; built, pending deploy)

**Split of labour: the animation carries the "how"; the intro text carries the "why".**
The animated walkthrough (`hakli-welcome-walkthrough.html`) demonstrates the mechanics —
find, record (×2), review/keep, sentence, meaning — so the intro lines that used to
restate those same mechanics (`intro.tour.min1/min2/min3/more`) were dropped as
redundant. The intro is trimmed to the spine the animation *cannot* convey — purpose and
trust: `what → new → yours → (waits) → why`. Rationale recorded so it isn't relitigated:
a silent-looping animation shows the steps better than words for a non-reader, but it
cannot say *why this matters* or *your voice stays yours* — that is the text's job.

- **Single shared listen button** drives one narrated arc: openers (`what`, `new`) play
  while the animation is held at its first frame → the animation runs once, posting a
  per-scene cue so the parent plays the matching `howto.*` clip as each scene lands →
  closers (`yours`, `waits`, `why`) play as it finishes → silent looping resumes. One
  `<audio>` element in the parent, so the intro and scene narrations never collide.
- **`howto.types` retired** — the animation has no "choose word / sentence / meaning"
  screen (it switches tabs inline), so that clip had no playback surface. Narration set
  is now 5 intro + 5 howto = 10 clips: `intro.tour.{what,new,yours,waits,why}` and
  `howto.{find,record,review,sentence,meaning}`.
- Scene beats are 8–9 s and clips ~3–5 s, so cues never overlap; a late clip is simply
  cut off by the next scene, which matches the visuals. The standalone (non-embedded)
  walkthrough still loops silently — narration only runs when embedded in `welcome.html`.
- `waits` kept for now (fieldwork connectivity reassurance); one-line drop if trimmed.
- Copy (Arabic + English) is draft — **not yet reviewed by local speakers.**

## Speaker origin visibility — hidden by default, dialect-scoped, opt-in public (decision; not yet built)

**The point of collecting town/tribe is dialect derivation, not public display** — so
origin/tribe/pseudonym should reach the people doing linguistic work, not the open
public. Three tiers, decided:

1. **Steward-only (default).** The managing steward always sees the origin they entered.
   This is the current design intent — origin lives in the steward-only
   `afd_speakers/{speakerId}/private/{doc}` subdoc.
2. **Qualified readers (the dialect-work tier).** A limited set of authorised users may
   read origin across speakers for variety analysis. This needs a role mechanism that
   does NOT exist yet: `isManager()` is per-recording consent authority (creator or that
   speaker's steward), not a global research role. Options — (a) Firebase **custom auth
   claims** set by an admin: cheap in rules (token-carried, no extra read) but needs an
   admin process to grant; (b) an **allowlist doc / members collection** checked in
   rules: self-serve to manage but costs a `get()` per read. Leaning custom claims.
3. **Fully public — opt-in per speaker.** Only if the speaker/steward elects it, via a
   `showOriginPublic` flag on the subdoc, enforced in its read rule
   (`allow read: if steward || qualifiedReader || resource.data.showOriginPublic == true`).

**Live gap (fix before any public share).** The app currently writes `origin`/`ageBand`/
`gender` into the *world-readable* public `afd_speakers` doc (recorder.html), contradicting
the rules' own comment that town/tribe belong in the private subdoc. Not yet exploitable —
the site hasn't been shared, still collecting prompts — but it must be closed before launch.

**Interim step (no role mechanism needed):** stop writing origin into the public doc and
put it in the existing steward-only `/private` subdoc, matching what the rules and the
consent test already assume. That alone delivers "hidden by default" and closes the leak;
the qualified-reader tier and opt-in-public promotion follow with the role design above.
Ties into the pending `afd_speakers` `{uid}` → `{speakerId}` re-key, where the origin move
was already slated to happen at the rules-deploy cutover.

## External (non-AFD)

- **Scott's `tawq.in` `server.js`** — the expired-token string-mismatch auth bypass
  (`"Expired Token"` vs `"Expired"`). Fix written; still needs sending to Scott.
