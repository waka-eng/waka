# Goal: a room you can trust

Status: proposed 2026-08-22, from the founder's ruling that **groups is a
priority feature**.
Strategy: `docs/craft/agent-memory-wedge.md` (the addendum is this goal's
argument; the evidence base is `agent-memory-ecosystem-2026.md`).
Branch: `goal/a-room-you-can-trust` (code phases; doc phases may land on
the strategy branch).
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

_(phases append numbers and verdicts here)_
