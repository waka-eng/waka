# Goal: the legible loop

Status: in flight — Phases 1–4 passed; next is Phase 5 (the weather
report, and the antechamber).
Created 2026-08-23 on the founder's instruction to build
the whole loop-legibility experience as its own goal. Carved out of
`no-quiet-corners.md` (its Phase 9, plus Phase 4 — the suppression
substrate the receipts stand on); those phases now point here, so every
work item keeps exactly one owner. **This goal runs first**;
`no-quiet-corners` resumes at its Phase 2 when this one closes or
halts.
Strategy: `docs/craft/the-legible-loop.md` — the research is the
argument; this document is only the build.
Branch: `claude/waka-product-evolution-vbj1ur`.
Depends on: nothing outside itself. The consultation record
(`no-quiet-corners` Phase 1) already shipped and is this goal's read
substrate.

## Why

People will not read every signal, the way a GEPA practitioner does not
read every evolved candidate. They live at the poster and the
principles — and what they need underneath is not more inspection but
**trust in the loop**: to know how WAKA reads them, to see what it did
and refused to do, and to correct its behavior without auditing rows.
The research is unambiguous about how systems win or lose this: show
the delta the loop caused, not its internals; make explanation and
correction one gesture apart; treat gestures as laws and keep receipts
that the law held; scope what counts as *you* without deleting; and
never ship an explanation that is not mechanically true. Every phase
below is one of those findings, landed in WAKA's world. The loop's
world-name is **the weather**: the field is the ground, the sky holds
the patterns, the poster is what the season amounts to, and the loop
is the weather that moves between them — read, told as days, tended
rather than programmed.

## Laws that bind every phase

- Light is the only meaning channel; states render, numerals never
  (constants may arrive as words in prose, pinned — never as counters).
- The world never moves unless the person moved it; the loop never
  notifies — the reward for opening the world is seeing, and telling
  first spends that.
- Nothing here deletes anything; every silence this goal creates is a
  logged, legible silence.
- No new metaphors outside the field-and-sky universe; no dashboards,
  no knobs, no sliders. The GLOSSARY gains its rows before any surface
  ships a word.
- Explanations render from the same constants the drift tests pin, so
  the product is structurally incapable of describing itself wrongly.

## Phase 1 — the reading ("How WAKA reads you")

One page, one tap from the poster, in second person and present tense:
"When three of your memories say the same thing, WAKA says it back as
a pattern. A pattern nobody feeds begins to set. Your own words are
never rewritten. When two patterns disagree, both stand until you
settle it." Rendered FROM the drift-locked constants table — the same
values `generation-doc.test.ts` pins against code — with each constant
arriving as words. The same rendering ships in the wire format, because
the reading contract is one contract for every kind of mind; the
`waka` skill points agents at it.

**Gate:** the rendering is pinned BOTH directions against the constants
(a changed constant fails a test until the sentence changes); a web
test renders the page and finds zero numerals; the served markdown and
the world's panel derive from one rendering function, byte-identical in
content. What would make this phase fail: any hand-written sentence
about the loop that a constant does not back.

## Phase 2 — gesture receipts

Every existing gesture gains one line, at the moment of the act, naming
what it taught the loop — the star already does this ("your own words —
WAKA will not rewrite them"); it is the pattern to copy, not a new
invention. Dismiss → "the ground will refuse anything this close from
now on" (true only after Phase 3 — until then the line for dismiss
stays as it is today, because a receipt for a law that does not exist
yet is the advisory-button lie this goal exists to kill). Verdict →
"this weighs on whether the pattern is spoken." Release → "WAKA may
read this one again." No new controls anywhere.

**Gate:** web tests pin each line at its gesture; a doc audit confirms
every line's claim is enforced by a named test on the real pipeline
(the star's by the lock contract, the verdict's by promotion, the
dismissal's by Phase 3's suite). What would make this phase fail: a
receipt whose claim no test enforces.

## Phase 3 — the ground refuses, on the record

(The suppression substrate — register item 7, moved here from
`no-quiet-corners` Phase 4 because the receipts stand on it.) A
dismissed signal keeps its row and evidence, and its embedding becomes
a suppression anchor: a candidate at ≥ 0.86 cosine to it is dropped
instead of minted, and EVERY suppression writes a record naming the
anchor — the silence is legible. The word is dismissed, not tombstone.
Zero new model calls. The dismiss receipt from Phase 2 switches on
with this phase.

**Gate:** a db test with stub embeddings — a near candidate is dropped
and its suppression row names the anchor; a distant candidate mints
normally; dismissal deletes nothing. The threshold joins
`docs/generation.md`'s drift-locked table (and thereby Phase 1's
reading). What would make this phase fail: a suppression that leaves no
record, or a dismissal that mutates the signal's row.

## Phase 4 — ratified light on the poster

The poster's entries already carry roots; the light now tells whose
they are: grounds the person has answered (a verdict, a star) hold
full ink; grounds only the machine believes sit dimmer. One glance
separates "what we have agreed about me" from "what it currently
thinks," and recalibration becomes the obvious existing gesture —
answer the dim ones. The loop asks; you answer; the light moves.

**Gate:** the served entry payload carries the ratified standing per
cited ground (computed, never stored denormalized); a web test pins
both ink states and the absence of any badge, label, or numeral; the
verdict round-trip moves the light in a jsdom test. What would make
this phase fail: a third visual state creeping in, or standing computed
anywhere but from the feedback and lock records.

## Phase 5 — the weather report, and the antechamber

Each pass leaves one told sentence, assembled ONLY from records that
already exist (derivation summaries, explicit no-change versions,
consultations, Phase 3 suppressions): "read two new memories; the sky
held." · "a pattern grew a root." · "refused a candidate — too close
to something you dismissed." The world tells it on arrival, riding the
existing pan-the-edge return — never a notification, never a digest.
On request, **the antechamber**: the dim place where read-but-not-kept
candidates stand, built on the suppression log — the delta view the
folk-theory research names as the single most theory-correcting
surface.

**Gate:** a seeded fortnight renders as told sentences with zero
numerals and zero events that lack a backing record (the narration is
a VIEW of the record, pinned by a test that deletes a record and
watches its sentence vanish); the antechamber renders each suppression
with its anchor reachable; arrival tells only after the world has
drawn. What would make this phase fail: an invented sentence, a
notification, or a counter.

## Phase 6 — kept, not read (founder-gated)

The one genuinely new lever: mark a memory — later a source, an agent,
a season — as *kept but not evidence*. The row stays in the field
(fading never deletes); derivation stops reading the person from it;
the world renders it as a state the weather passes over; the exclusion
is logged like a suppression, and it is reversible. **Gated on the
founder before any code:** this changes what "evidence" means in the
canon, and the ruling is requested in the research document. On the
ruling, the phase lands as: an evidence-standing state on
inspirations, one derivation-side exclusion, one rendered state, one
GLOSSARY row.

**Gate (ruling): the founder.** Gate (build): a db test proves an
excluded memory feeds no candidate and no evidence while its row and
attachments stay whole and recall still finds it; reversal restores it
to the loop's sight on the next pass; the world state renders without
the words hide, mute, or archive anywhere near it.

## Acceptance

- A person who never opens a signal can still say, accurately, how
  WAKA reads them, what it did last week, what it refused to do and
  why, and what their own gestures taught it — every sentence of that
  answer backed by a record or a pinned constant.
- Every gesture is a law with a receipt; no control in the product is
  advisory.
- The founder looks at the loop surfaces live on their machine (the
  standing review ruling) and recognizes the thing they asked for on
  2026-08-23: the loop, understandable and recalibratable, without
  reading the rows.

## Budget

Zero new model calls in every phase (suppression is arithmetic above
generation; the reading and the diary are renderings of stored
records). Demo-seed runs for gates as needed (~10 derivations per
run). No new dependencies, no new infrastructure.

## Log

- **2026-08-24 — Phase 4: PASS.** Ratified light on the poster. The served
  entry payload's `citedSignals` now carry `answered` — true when the owner
  has spoken to that ground (any verdict on the signal, not_true included,
  or their own locked words), false while only the machine believes it —
  computed in `loadEntries` from the feedback and lock records at serve
  time, never stored, so a verdict given a second ago already moves the
  light on the next serve; the wire carries it to every kind of mind. The
  world: the poster's ask now opens a **standing on** band above "built
  from" — the grounds themselves, the layer the memory chain walks
  through — full ink (`jar-ground--answered`, the same half-step lift the
  quoted spans use) where answered, dim where machine-only, and light is
  the only difference: no badge, no label, no numeral. Pressing a ground
  opens the same yes/partly/not-true row the sky gives a pattern being
  read — explanation and correction one gesture apart, the existing verb
  at a new site rather than a new control (necessary, not convenient: only
  EMERGING signals hang in the sky, so an active ground had no answering
  site anywhere) — and the answer moves the light in the same beat through
  the session's own verdicts, with the verdict receipt printed at the act.
  GLOSSARY gained the agreed-light row. Gate measured:
  `ratified-light.db.test.ts` 4/4 on real Postgres (machine-only serves
  false; a verdict flips it with the entry row's `updated_at` untouched —
  computed, not stored; a star answers; another profile's verdict moves
  nothing; a structural case proves no artifact table even has a column to
  denormalize into), `home-poster` 10/10 (both ink states pinned with a
  no-digit sweep of the band; the round-trip case answers a dim ground and
  watches it light), api 53 files / 612 tests, web 20 files / 141 tests,
  vocabulary and seams clean. Deliberately excluded: any third visual
  state, and any standing on a room's board — a room's grounds are shared
  statements whose chain already names who said each.

- **2026-08-24 — Phase 3: PASS.** The ground refuses, on the record.
  Dismissing a signal now deletes nothing: the row keeps `status:
  retired` (which already excludes it from the match scan and the top of
  mind) plus a `dismissed_at` mark, and its embedding becomes a
  suppression anchor. In `applyCandidates` the refusal runs BEFORE the
  match — a candidate at or above `SIGNAL_SUPPRESSION_MIN_COSINE` (0.86,
  now a row in `generation.md`'s drift-locked table, with the
  refusal-before-match ordering pinned as a `[checked]` claim) to any
  dismissed anchor is dropped without minting, without attaching, and
  without ever reaching the judge — zero model calls, refusals included —
  and every refusal writes a `suppressions` row naming the anchor,
  snapshotting both statements and the deciding cosine (the antechamber's
  raw material for Phase 5; erasing the profile takes the record, deleting
  the anchor or the capture leaves a departed mark). Verbs:
  `POST /api/signals/:id/dismiss` and `/:id/restore` — restore clears the
  mark, recomputes standing from the untouched evidence, and re-promotes
  on the spot when the evidence clears the bar; ordinary retirement is not
  restore's business. The world: "then let it go" now dismisses instead of
  deleting, the sentence holds its place carrying the Phase 2-promised
  receipt ("the ground will refuse anything this close from now on",
  `RECEIPTS.groundRefuses`, enforced by the new suppression suite) with
  "put it back" in the same breath, and the star sinks on the next arrival
  rather than vanishing — fading never deletes, so the old hard-delete
  local filter is gone. The reading gained its refused-ground sentence
  (contract-backed by the same suite); GLOSSARY gained the refused-ground
  row; register item 7 (agent-memory-wedge, the forgetting axis) is marked
  shipped. Gate measured: `signal-suppression.db.test.ts` 5/5 on real
  Postgres through the real `applyCandidates` (near candidate dropped +
  row names anchor; distant mints with no refusal written; dismissal
  leaves row, evidence and vector whole; restore ends refusals and the
  same nearness attaches again; re-promotion follows evidence), api 53
  files / 608 tests, web 20 files / 139 tests, vocabulary and seams
  clean. DELETE stays for the person who truly wants the row gone.

- **2026-08-23 — Phase 2: PASS.** Every gesture now says what it taught,
  and may say only what a test enforces. `lib/receipts.ts` is the
  registry — seven receipts, each naming its enforcing test —
  and `receipts.test.ts` fails the suite when a named test disappears or
  a digit sneaks into a line. Wired: a verdict prints its receipt under
  the answered statement ("on the record" / "steps far back in the
  choosing — never erased" / for a group's statement, "answered — the
  room reads who stands where"); the pin speaks through the board's own
  status channel ("held at the front — rewrites keep it there"); the
  dismissal's receipt rides beside its undo ("set aside — it will not
  return to the poster · put it back") because reversible is part of the
  law being stated; and the star's standing line plus the release
  confirm now render FROM the registry, so their wording cannot fork.
  The dismiss receipt deliberately claims only the poster (its L3
  truth) — the ground-level claim waits for Phase 3, per the phase's
  own no-advisory rule. Gate measured: registry suite 2/2, verdict
  receipt pinned in `home-sky` (14/14), pin + dismiss receipts pinned
  in `home-poster` (8/8), api 602, web 20 files / 138 tests, vocabulary
  and seams clean.

- **2026-08-23 — Phase 1: PASS.** The reading exists and cannot lie.
  `lib/the-reading.ts` holds the registry — eight constant-backed
  sentences (each importing its LIVE value, worded: three, twelve, a
  month and a half, three quiet weeks…) and six law-backed sentences
  (each naming the contract test that enforces it) — and one rendering
  function serves both the world and the wire.
  `lib/the-reading.test.ts` is the both-directions drift lock: it holds
  its own value→words table, so a tuned constant fails the suite until
  the registry's words and the sentence are re-worded, a law sentence
  fails when its test file disappears, and the rendering is asserted to
  contain every sentence and not one digit. Served at
  `GET /api/reading.md` (session-authenticated, both kinds of mind, no
  consultation written — it serves the product, not anyone's memory).
  The world's door: "how it reads you" in the poster's ≡ menu opens
  `ReadingPanel`, which rewords nothing; its own suite pins verbatim
  sentences, the quieter coda, the fetch-pending state, and zero
  numerals. The waka skill now tells agents to QUOTE the reading rather
  than improvise a description of the loop (pushed to waka-mcp, same
  branch). Gate measured: the-reading suite 3/3, panel suite 2/2, api
  51 files / 602 tests, web 19 files / 133 tests, vocabulary and seams
  clean. Deliberately excluded: any sentence about contested pairs —
  the judge is binary today, and the reading speaks only today's truth.

- **2026-08-23 — Created on the founder's instruction** ("create /goal
  to build this all"), from the research in
  `docs/craft/the-legible-loop.md`. Owns what was `no-quiet-corners`
  Phase 9 (a/b/c) and Phase 4; those now point here. Queue position:
  first — `no-quiet-corners` resumes at its Phase 2 when this goal
  closes or halts. Phase 6 awaits the founder's evidence ruling;
  everything else is executable without them.
