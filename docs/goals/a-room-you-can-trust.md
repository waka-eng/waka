# Goal: a room you can trust

Status: in flight — opened 2026-08-22 from the founder's ruling that
**groups is a priority feature**; by the same day's end every phase
executable without the founder had passed its gate (0a, 0d, 1a–1d, and
Track S to the brief's bar). On 2026-08-23 the founder ruled on both
remaining doctrine gates — **0b Step 2** (erasure: the room keeps its
approved text; departed marks, not destruction) and **0c** (decline is a
counted stance, not a veto) — and both are now implemented and pinned;
see the log. One standing gate: the 30-second demo as the acceptance
act. Two earlier gates closed by the language ruling (2026-08-22,
English only — see the log): the numerals question on the brief's toast,
and the dialect seam.
Strategy: `docs/craft/agent-memory-wedge.md` (the addendum is this goal's
argument; the evidence base is `agent-memory-ecosystem-2026.md`).
Branch: `claude/waka-product-evolution-vbj1ur` (this session's designated
branch; the header originally named `goal/a-room-you-can-trust`, amended
because the running session may push only to its designated branch).
Depends on: nothing for Phase 0; Phase 1 builds on the shipped
proposal/affirmation machinery. `every-space-owns-its-stack` (signed
2026-08-17) is deliberately NOT this goal — it is the phase after it,
and nothing here may pre-empt or contradict it.

## Why

A room is other people trusting WAKA with a co-authored record. The 2026
evidence says multi-principal memory is where every system fails
(GateMem: no method passes access control + forgetting; Tencent's
12.9K-star team memory shipped with no governance for when memory is
wrong) — and WAKA's write path is already ahead: strict majority against
the current roll, ejected members' votes vanish, approved text locks.
What stands between that and a room we can invite people into is a short
list of ways the room's record can still be silently destroyed or
silently wrong, plus the half of the loop GOAL.md already names and the
world never wired. Fix the record first, close the loop second. Two
before twenty: every phase is tested against a two-person room, because
a room of two is the cheapest honest test of every rule.

## Phase 0 — the record stops being destroyable

**0a. Prove no room surface destroys history — then close what does.**
The pre-rebuild register says wall refresh destroyed history and
`wall-that-evolves` Step 1 fixed it, built-but-unmerged; the rebuilt
base versions group top-of-mind with supersede chains. Doc-vs-code drift
is this repo's known hazard, so this phase starts as an audit on the
CURRENT base: walk every write path that touches a room's artifact,
wall, or membership (refresh, proposal acceptance, member removal,
group delete, owner handoff) and assert which histories survive. Port
whatever of Step 1's behavior is still missing.
**Gate:** an e2e in a seeded two-person room performs refresh, proposal
acceptance, member removal, and re-join, and every prior version and
join/departure mark remains readable afterwards.

**0b. Erasure: name it, then shrink it.**
Step 1 (doc, immediately): a decision-log entry in `data-model.md`
naming account erasure as the model's one true delete and its exact
blast radius — today `lib/account-erasure.ts:161-163` deletes EVERY
version of every group top-of-mind the departing member touched, which
falsifies "fading never deletes" precisely where a room would feel it.
Step 2 (code, gated): redact instead of destroy — versions survive; the
departed member's citations and attribution flip to a new nameless
state **departed** (the legible-silence pattern); their shared
statements go; whether locked majority-approved text survives as the
room's words is the collective-speech-act question.
**Gate (hard, not softenable):** Step 2 does not start until the
founder amends the doctrine AND counsel answers whose words a
majority-approved sentence is. If the answer is "the departed's," the
current cascade is correct and this phase ends at Step 1's honest
paragraph.

**0c. Refusal becomes a counted stance.**
Today acceptance needs a strict majority but ANY single member can
unilaterally kill any open proposal (`groups-proposals.ts:417`) — an
asymmetry that becomes governance denial-of-service the day any
non-human mind can touch a room, and is already surprising for humans.
Proposed ruling for the founder: a decline is a vote, not a veto — a
proposal dies when majority-against is assured, or on timeout; who
stands where renders named or by hue, never a tally.
**Gate:** the founder's ruling lands in the `data-model.md` decision
log first; the code change (a few lines beside `carriesMajority`, plus
tests extending the existing coverage) follows the ruling, whatever it
is.

**0d. The wall stops showing a number-shaped lie.**
The group wall serves the stored confidence snapshot — the one
documented staleness in the system, because the wall's query must never
reach another member's private layers. Either render it as a state
("as its owner's system last wrote it") or recompute live without
crossing the privacy boundary.
**Gate:** no room surface presents a stale number as current.

## Phase 1 — the loop closes (GOAL.md's order, promoted)

**1a. React to another member's statement.** `createFeedback` targets
only your own signals, so a room cannot accumulate the affirmed
material synthesis is meant to read. Extend it: a member may leave a
verdict on a statement shared into a room they belong to — on the
distilled statement only, never touching or revealing its evidence.
**Gate:** the live permission suite proves a non-member cannot react,
and a member's reaction never exposes another member's layers.

**1b. Synthesis fires on accumulated evidence.** The room drafts when
enough shared-and-affirmed material has accumulated — the same shape as
`emerging → active` at 3 — and stays silent otherwise. No cadence, no
button as the primary path. The threshold is a named, drift-locked
constant in `docs/generation.md`'s tables.
**Gate:** a seeded room crosses the threshold and drafts unprompted; a
room below it stays silent; the constant is pinned by
`generation-doc.test.ts`.

**1c. The approval surface.** An open proposal shows its author, who
has affirmed (named or by hue — the count is legible because the people
are), and offers a counter. You can always tell whether the missing
approval is your own.
**Gate:** browser-verified in a two-person and a four-person room; no
numeral anywhere on the surface.

**1d. The room's timeline.** Versions are already stored;
`room-timeline` Phase 2's gate still fails (notes move on scrub, joins
not distinct, lineage unrecorded). Finish it: the room's poster scrubs
through its own history the way the field already scrubs through time.
**Gate:** room-timeline's own written gate, passing.

## Track S — stars and roots (folded in by the founder, 2026-08-22)

The founder's revamp brief — checked in verbatim as
[`docs/craft/revamp-stars-and-roots.md`](../craft/revamp-stars-and-roots.md)
— joins this goal as an interleaved track: *build nothing new; make the
two mechanisms that already exist visible.* The lock becomes the **별**
(star: a sentence the person wrote, which WAKA never rewrites) and the
evidence links become **뿌리** (roots: the memories a signal grew from).
The brief's own acceptance criteria are the gates; its global rules
(GLOSSARY as naming truth, dialect boundaries, UI banned words, the
plain-line tooltip test) bind every phase below. Its §7 deferral list is
honored — no rooms UI, no MCP, no backfill in this track.

- **S0 — GLOSSARY.md** at the repo root, verbatim from the brief; README
  links it; the agent instruction file gains the one-line naming rule.
  Gate: the brief's Task 0 checklist.
- **S1 — schema gate** (investigation only). The brief's one question —
  is the signal → evidence-record link stored today? — answered with
  file paths in `docs/notes/2026-08-22-schema-gate.md`. Known answer:
  **verdict A** (`signal_evidence` is M:N with verbatim quotes), so S2
  and S3 proceed in parallel and S3 is UI work.
- **S2 — the star.** Backend first: the release verb the brief's
  "다시 WAKA에게 맡기기" requires is exactly this goal's lock-debt item —
  human-session-only, clears `lockedAt`; plus the regeneration contract
  pinned by test (locked text byte-identical across passes while
  evidence and confidence keep updating). Then the surface: star state
  on human-written sentences, the plain-line tooltip, the regeneration
  contrast, the banned-word sweep. Gate: the brief's Task 2 checklist,
  minus what this environment cannot execute (see the honesty note).
- **S3 — roots v1.** Signal → its evidence records: highlighted orbs,
  drawn root lines, the evidence panel with excerpts and dates, the
  shortest path from a wrong memory to a corrected, starred sentence.
  Gate: the brief's Task 3 checklist.

**Honesty note on the brief's definition of done.** The 30-second
six-scene demo requires a running browser and a human hand; this
environment can execute the automated halves (the byte-identical lock
test, the release-flow test, the banned-word grep, typecheck/build) and
must say plainly which scenes it could not witness rather than claim
the demo. The recording is the founder's acceptance act.

## After this goal (not in it)

`every-space-owns-its-stack` — the room distills its own sky from its
own public ground, and room-level dismissal ("never bring this up
again") lands there. Then the doors: the two-person-room activation
path, hosting (hard-gated on the `close-the-two-gaps` audit, which the
groups priority promotes to scheduled work), agents reading rooms
(read-only, through the human's seat, after the sibling-grant fix), and
consultation records extended to group serves. In parallel, as small
separate units: the unlock verb + L2 pre-edit history, and wiring
`verifyQuote` — rooms are made of members' locked and corrected
statements, so every personal-layer trust repair is also a room repair.

## What this goal will not do

- No agent access to rooms, read or write. Eyes arrive in a later goal,
  after grants; hands and votes later still, if ever.
- No changes to what may cross an account boundary. Evidence never
  crosses; share-into-room semantics belong to
  `every-space-owns-its-stack` and are not touched here.
- No per-room visibility matrices, roles beyond owner/member, or any
  numeral on a room surface.
- No synthesis quality bars lowered to make a small room look fuller.
  A room with nothing to say says nothing.

## Budget

Phase 0 is audit + deterministic code — near-zero model spend. Phase 1b
spends one synthesis per genuine threshold crossing, inside the
existing per-account budget. E2e passes stay under a dollar, per the
house norm.

## Acceptance

- A two-person room can be lived in for a week with every version,
  join, and departure still readable at the end of it.
- One member's erasure no longer silently decides what the other keeps
  — either the record survives redacted, or the canon says out loud why
  it cannot.
- No single member can kill what a majority wants (or the founder has
  ruled otherwise, in writing).
- The room reacts, drafts on evidence, shows who stands where, and can
  be scrubbed through its own becoming.

## Log

- **2026-08-23 — The live model walk: the 1a carve-out closes.** With the
  founder's key in the gitignored `.env.local`, the full stack ran
  locally (`dev:local`, real Postgres, real Gemini through the session's
  egress proxy) and every live gate walked:
  **organic** — all eight steps proven across two runs: run one (filler
  205) passed 1–6 including buried-past-the-window search and tenant
  isolation, while 7–8 starved behind the model budget (205 filler
  derivations ate the account's 60-jobs/hour window — the budget doing
  its documented job against the harness's own arithmetic, not a
  product failure); run two (filler 8) passed 7–8 live — page-body
  enrichment with the marker present and boilerplate absent, and a real
  image transcription — while 4 reported its own precondition, as
  designed. **groups 9/9** — the proposal→affirm→carry→materialize loop
  through the new stance machinery, non-members get 404 not 403, agents
  refused at the wall and the door. **signals 6/6** — including a
  locked statement byte-identical across live regeneration and
  citation-loss retirement. **top-of-mind 8/8** — locked entry carried
  verbatim, explicit no-change on the record, exactly one live version.
  **principles 5/5 + 1 documented skip** (the promotion path is
  nightly-cron-only by design and needs boot-time overrides).
  **cold-start 1/1.** And the carve-out itself:
  **waka-mcp `test:live` 9/9** — the real CLI consent flow, capture
  through the MCP client, layer-2 recall in both profiles, both top of
  minds, and the principles matrix with curation refusing to cross
  profiles. A live mint is on the record
  ("status=derived candidates=1 matched=0 minted=1"). Nothing under
  this goal still waits on a model key.

- **2026-08-23 — Phases 0b Step 2 and 0c: PASS, on the founder's
  rulings.** Both doctrine gates opened and both landed the same day.
  **0c (decline = counted stance):** `stance` column on the answers
  table (migration `0015_no_veto`), upsert latest-wins per (proposal,
  member); carry unchanged (strict majority of yeses against the current
  roll); a proposal falls only when `fallsToDeclines` says a yes-majority
  is impossible (declines × 2 ≥ members — a room of two still settles on
  one refusal, as arithmetic); the author's decline alone still
  withdraws. The approval surface now shows three states — agreed at
  full ink, refused in the dimmest ink struck through, unanswered dimmed
  — and an open answer offers its opposite ("not us after all" / "yes,
  that is us after all"). Gate measured by `room-decline.db.test.ts` on
  real Postgres: 5/5. **0b Step 2 (erasure keeps the room):**
  `eraseAccount` no longer deletes any group artifact — the delete that
  could unwrite a room's whole version history is gone. Versions,
  entries, settled proposals, settled stances, and door marks survive as
  departed marks (profiles FKs now `set null`, migration
  `0016_the_departed_keep_their_marks`; serializers left-join so the
  departed don't silently drop; the world renders "someone"). Open asks
  and live stances are withdrawn in the erasure transaction; a `left`
  door mark is written per seat; ownership still hands to the
  longest-standing survivor; the person's own stack, name, and bytes go
  completely. Gate measured by `account-erasure.db.test.ts` on real
  Postgres (the old mock-chain suite, which pinned the destructive
  doctrine call-by-call, is retired): 3/3. Suite totals after both:
  api 50 files / 593 tests, web 18 files / 131 tests, all gates green.
  Also this day: the founder's `GEMINI_API_KEY` arrived and verified
  live against both pinned models (generation `gemini-3.1-flash-lite`,
  embedding `gemini-embedding-001` — 200s); it lives in the gitignored
  `.env.local` only. Rulings signed in `docs/data-model.md`'s decision
  log. The one gate still standing is the 30-second demo — the
  founder's acceptance act.

- **2026-08-22 — Founder ruling: the product speaks English only.** Every
  Korean string on a product surface translated in place (the entrust
  flow, the star's hover line, the provenance hovers, the redraw toast,
  the roots empty state, the public profile page); the `ko-KR` catalog
  and the language pickers removed on both web and API (`supportedLocales`
  is `["en-US"]` at both layers; legacy `ko-KR` rows normalize to the
  default on read, so no migration). Kept, deliberately: Korean *input*
  handling — the enrichment boilerplate/auth-wall matchers that clean
  Korean pages a person saves, and waka-mcp's Korean trigger-phrase
  examples that let a person speak Korean *to* the product (it answers in
  English); plus the dev-only offline fixture's Korean demo content
  (renders in no real build) and founder-quote citations in comments.
  Two standing gates closed as a consequence: **the numerals question is
  moot** — the English toast says "your stars kept their places," THAT
  the stars held rather than how many, so "states render, numerals never"
  holds with no exception left to rule on; and **the dialect seam is
  gone** — no ko copy sits beside English verbs anywhere. GLOSSARY.md
  rewritten in English with the ruling at its head (the Korean original
  stays in git history); the brief `docs/craft/revamp-stars-and-roots.md`
  stays verbatim as a founder document. Gate measurements after the
  sweep: api 49 files / 592 tests, web 18 files / 130 tests (three
  language-picker cases replaced by two no-picker cases), vocabulary,
  seams, and typecheck clean on both packages.

- **2026-08-22 — Phase 1d: PASS on this base's honest reading,** delta
  named. The chain was always stored and nothing served it for a room:
  `GET /api/groups/:groupId/top-of-mind/versions` now exists
  (membership-gated, field-by-field like every cross-account read),
  serving the version chain with entry counts and — from 0a's ledger —
  the **door's marks**: who arrived, left, was removed, named and in
  order. The room's panel tells it as one story, "the room so far":
  moves as sentences (first spoke / a proposal carried / re-read itself
  / a sentence was reworded — honest `no_change` passes stay off the
  surface, a pass where nothing moved is not an event in the room's
  life), door marks as people, dates as words — the numerals law holds
  by construction and is pinned as an assertion. Measured:
  `loadGroupTimeline` db case (chain newest-first with counts; door
  story `joined, joined, removed, joined`), panel render case (moves +
  marks + zero digits). api 49 files / 592; web 19 files / 131;
  typechecks, build, vocabulary/seam gates clean. **Delta:** the
  pre-rebuild `room-timeline` goal's Phase-2 canvas gate (scrubbing the
  wall's orbs through time on the dial) described the old codebase's
  wall; on this base the room's history is now *readable* — putting it
  on the dial is design-pass work alongside the founder's stars-and-
  roots §8 questions, not re-implemented here.

- **2026-08-22 — Phase 1c: PASS,** with the browser carve-out named. The
  approval surface already showed the whole room lit/dim (never a tally);
  what was missing is now on it: **the author** (a proposal arrives
  signed — "Ari put this to the room"), **the counter** ("say it
  differently" carries the proposal's words into the viewer's own draft
  box, to be reshaped and put back as their proposal), and — the bigger
  find — **the world could not actually answer a wall statement**: the
  verdict buttons sent the composite `wall:group:signal` candidate id as
  the feedback target, which the server refuses as an invalid id, so
  every room reaction silently failed and rolled back. Candidates now
  carry `wallTarget` (the real signal id, whether the statement is the
  viewer's own — you do not answer yourself in a room — and who has
  answered so far); the verdict verbs target correctly, are withheld on
  your own statement, and a focused wall statement shows "answered by"
  as named people, lit or dimmed, never a number. Gate measured by
  `group-panel.test.tsx` (4/4 jsdom on the real component): author
  signed; four-person and two-person rooms rendered whole with
  said/not-said states; the counter pre-fills the draft; **zero digit
  characters in the panel's text** — the numerals law pinned as an
  assertion. web 18 files / 130 tests; api 49 / 591; typechecks and
  build clean. Carve-out: the gate's "browser-verified" wording is
  satisfied by jsdom rendering of the real component; a human pass in a
  real browser remains part of the founder's demo acceptance.

- **2026-08-22 — Phases 1a + 1b: PASS,** with one honest carve-out. The
  merged base had already widened answerability to statements shared into
  your rooms (`mayAnswerSignal`), but its standing was WIDER than the
  wall's: a member could file verdicts against a statement whose owner
  had left (which the wall no longer shows), and against retired
  signals — and group synthesis read a superset of the wall (every share
  row bare, departed members' statements included). All three now mirror
  the wall exactly: answerability requires you and the owner currently
  in the room and the signal standing; `loadGroupSharedSignals` joins
  current membership and excludes retired. The wall serves **named
  reactions** (latest verdict per current member, reactor never the
  owner — whose self-verdicts are private curation; a reaction row
  carries name + verdict and nothing beneath the statement, pinned).
  1b: the room's **first draft waits for affirmed material** —
  `GROUP_DRAFT_MIN_AFFIRMED` (3) shared statements affirmed by someone
  other than their owner, latest verdict wins, owner self-agreement
  excluded; below the bar the pass returns the legible
  `waiting_for_affirmations`, member proposals still materialize, and an
  established room is never re-gated. The trigger side shipped earlier
  on the base: agreement enqueues the room's re-synthesis. Gate measured
  by `room-reactions.db.test.ts` (5/5, real functions, stub model):
  non-member refused; owner-departure withdraws standing; latest-wins on
  the wall; 2 genuine affirmations + 1 self-agreement stays waiting; the
  third genuine one drafts `versioned/initial`; a withdrawn affirmation
  before first speech re-silences, after it never does. Constant
  drift-locked in `docs/generation.md` (CI-checked). api 49 files / 591
  tests; web 126/126; typechecks and build clean. **Carve-out:** the
  gate's live-permission-suite half (waka-mcp against a running stack)
  cannot execute in this environment — the db test executes the same
  real path; the live walk stays owed to a stack run.

- **2026-08-22 — Phase 0b Step 1 and Phase 0c questions: LANDED in the
  canon.** `docs/data-model.md`'s decision log now names erasure as the
  model's one true delete with its exact blast radius (the sole
  exception to "fading never deletes"), and records the decline
  asymmetry as an open ruling with the proposed resolution (refusal
  becomes a counted stance). Both are marked gated on the founder;
  Phase 0b Step 2 additionally on counsel. The vocabulary of record is
  no longer falsified by the code it governs. Also logged there:
  Phase 0a's repairs and Track S's release/quote-source semantics.

- **2026-08-22 — Phase 0d: PASS.** No room surface presents a stale
  number as current. The wall's snapshot confidence is renamed on the
  wire (`confidenceAsWritten`, with the staleness documented on the
  type — the wall's query must never reach another member's private
  layers to recompute it), the route's field-by-field serializer and
  the published-keys pin follow, and the one rendering site
  (`Surface.tsx`'s room wall, which printed `{confidence}%` as if
  current) now shows the owner's name — the wall's honest provenance —
  and nothing number-shaped. api 586/586, web 126/126, both typechecks
  and the web build clean.

- **2026-08-22 — Track S (stars and roots): S0–S3 shipped to the brief's
  bar, with the deviations named.** S0 PASS (GLOSSARY.md verbatim at
  root, README link, AGENTS.md naming line). S1 PASS — verdict A with
  file paths in `docs/notes/2026-08-22-schema-gate.md`. S2: the release
  verb ships on both layers (`POST /api/signals/:id/release`,
  `/api/top-of-mind/entries/:id/release`) and the regeneration contract
  is pinned against the real pipeline (`signal-lock-contract.db.test.ts`:
  owner's words byte-identical across three passes while evidence goes
  1→4 and promotion proceeds; release rewrites nothing; after release
  the generator has jurisdiction again; release retires words standing
  on nothing). The star renders as a CSS glyph so a starred sentence's
  text content stays exactly the person's words; its hover line is the
  brief's 맨말; pressing it (the mobile path) opens the confirm carrying
  the same plain line; 다시 WAKA에게 맡기기 works on sky and poster.
  Catalog sweep: 0 banned words in user-facing strings across both
  catalogs (grep evidence: the only remaining hits are the three
  `devWow*` developer-debug strings — the documented developer-facing
  exception; JSON carries no comments, so the note lives here). S3: only
  VERIFIED spans light (server: `verifyQuote` wired before the clip,
  labeled own/enrichment in `signal_evidence.quote_source`, pinned by
  the derivation-level db test; surface: page-words light dimmer and
  dotted with their own hover line, pre-verification quotes fall back to
  the plain preview — known-issues H2 closed at both halves); the honest
  empty state ships; the edit path sits in the same panel as the roots.
  **Deviations and flags, for the founder:** (1) the completion toast
  prints the brief's own copy "별 {n}개는 그대로예요" — a numeral, the
  one place Track S bends "states render, numerals never"; rule on it.
  (2) The star-turn animation (0.4–0.8s) and the drawn sky→field root
  lines are NOT built — the roots ride the existing evidence satellites
  and press-to-travel per the brief's own "새 걸 짓지 말고" principle;
  both are design-pass items alongside the brief's §8 open questions.
  (3) The surface speaks the brief's ko copy inside a panel whose
  neighboring verbs are English literals — the dialect seam is real and
  needs a ruling. (4) WCAG AA contrast on dim/highlight is unmeasured
  here. **The 30-second six-scene demo is not claimed:** every scene's
  mechanics exist end-to-end and are test-pinned, but this environment
  has no browser and no model key — recording it is the founder's
  acceptance act, per the Track S honesty note. web 126/126 tests,
  typecheck, build clean; api 48 files / 586 tests green.

- **2026-08-22 — Phase 0a: PASS.** Audit found three ways the record was
  destroyable, all three closed: (1) membership had no history —
  `group_membership_events` added, append-only, written transactionally
  on create/join/leave/remove, current seats backfilled as arrivals in
  migration `0013_the_room_remembers`; (2) removal deleted the member's
  affirmations on EVERY proposal including settled ones — delete now
  scoped to `status='open'`; (3) `top_of_mind_entry_signals.signal_id`
  cascaded on signal delete, stripping citations out of historical
  versions — FK now `set null`, live snapshots skip null citations so a
  carried entry never re-cites a deleted signal. Paths audited and clean:
  version writer (supersede + partial unique index), proposal rows
  (persist after settling), unshare (share row only), group delete
  (owner's deliberate act, documented), erasure (known destroyer —
  Phase 0b's territory, untouched here). Gate measured by
  `room-history.db.test.ts` on real Postgres 16: 4/4 — version chain
  `[1 superseded → 2 live]` intact through removal + re-join; settled
  votes kept 2/2 while the open proposal drops to 1; door ledger reads
  `joined, removed, joined` and `joined, left`; 2/2 citation rows
  survive signal delete as null-signalId with owner attribution intact.
  Full api suite 47 files / 581 tests green (was 46/577); typecheck
  clean; `drizzle-kit check` clean. Environment: local Postgres 16
  (this sandbox), not Neon; no model calls spent.
