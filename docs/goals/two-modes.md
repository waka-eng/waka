# Goal: two modes — the board you return to, the ambition you say out loud

Status: proposed 2026-08-08. Not started.
Branch: `goal/two-modes`
Follows: `wall-that-evolves.md`, `room-timeline.md` (phases 0–1 shipped),
ambition-reading (reader built, gate unpassed)
Decided by founder, 2026-08-08: auto-post room-level stickies · endorsement as
mode 1's verb · no-objection adoption with vote fallback · opt-in publish per
version

## Why

The founder's words, which this goal is judged against:

> You can talk yourself into almost anything. For years, I called my ambition a
> choice. But what you can't talk yourself into is a quickened pulse. So I
> stopped deciding what I should want and started noticing what makes my heart
> race before I can explain why. Pulse by pulse, my ambitions reveal
> themselves, including ones I never knew I had. My priority is to place myself
> where my pulse still races after the novelty wears off.

Every room — including your own wall — has two modes:

1. **The board** (daily): stickies are the main experience. Each sticky is an
   ambition the AI revealed from the *merged* signals of everyone in the room —
   the same ten signals reveal different ambitions in your solo room, room A,
   and room B, because the same signal means different things beside different
   hearts. Everyone in a room sees the same stickies. You come back to see what
   the merge revealed today and what the room affirmed.
2. **The ambition** (proud): one main ambition per room — the synthesis of the
   stickies, the thing you'd say out loud: "this is my biggest ambition as of
   now" / "this is this group's biggest ambition as of now." Discussed,
   AI-assisted, democratically adopted, and published a version at a time.

Stickies are ingredients; the ambition is the dish. Mode 1's engagement
(endorsing which stickies still race the room's pulse) is the evidence mode 2's
synthesis stands on.

## Where things stand — read this before writing code

**Most of this exists.** The one-surface rewrite, the room direction flow, and
the collaborative review machinery are recent, deliberate work (largely
agikee's — ~220 commits, including the entire direction surface and its review
policy). This goal connects and evolves that work. Re-implementing any of it is
the failure mode `AGENTS.md` warns about.

What each mode already has:

- **Mode 1 is the wall.** Top-of-mind notes are generated per room from merged
  member signals (`group-top-of-mind-synthesis.ts`); rooms already produce
  different notes from the same signals. Notes auto-post — there is no
  confirmation gate, by the standing no-gatekeeping rule. Per-person feedback
  exists (`true/partly/not_true/important/not_important`, pin, dismiss,
  correction) and feeds the graph. The room timeline (phases 0–1 shipped,
  phase 2 largely built — see `room-timeline.md`) is the "watch it change"
  half of the daily pull.
- **Mode 2 is the direction.** `/rooms/:id/direction` already holds: one
  current reading, an immutable adopted-history chain
  (`combination_readings` + `previousReadingId`), attributed shaping notes
  (`group_direction_contributions`: take / feels_true / missing / change) that
  help WAKA write the next proposal, exactly one open proposal at a time
  (serialized on purpose — see the locking comment in `group-direction.ts`),
  and one review response per member (`accept` / `keep_current`).
- **The generator is the ambition reader** (`ambition-reading.md`), whose
  Phase 1 gate is honestly unpassed: the board it reads from is semantically
  collapsed while passing the lexical collapse test. Mode 2 can only be as
  good as mode 1's ingredients. That gate is upstream of everything here.

What the vision adds — the actual deltas:

| Vision | Today | Delta |
|---|---|---|
| Two named modes, every room | Wall + direction views exist for groups; solo wall has no direction page | Naming/navigation; solo parity |
| Endorsement as mode 1's verb, room-visible | Feedback is per-person calibration, not a shared act | New: shared endorsement layer |
| Endorsement weight feeds the proposal | Proposals draw on contributions only | Wire board evidence into the proposer |
| No-objection adoption, vote as fallback | Majority acceptance always required | **Policy change — agikee's call, see below** |
| Opt-in publish per adopted version | Nothing public per room; `PublicProfile` exists for people | New: per-version publish |

## The design bar

Founder priority, stated 2026-08-08: **beautiful design is the highest
priority**, and the founder's verdict on the current surface is *ugly and
complex*. So this goal replaces the skin deliberately — the system stays
(mechanics, data, agikee's surfaces and review machinery), the rendering
goes. What is lost and named: the pastel palette, the tilt, the borrowed
post-it decoration. Minimalist, elegant, quiet.

The design language, decided by founder 2026-08-08 (revised same day after
studying clipo.one and bleibtgleich.dev — the serif register from the morning
session was overturned by the founder for poster-bold; recorded here so the
reversal is a decision, not drift):

- **Mode 1 material: quiet paper, in orbit.** Flat, barely-tinted tiles — no
  tilt, no texture, no shadow — arranged in a shallow 3D ring that orbits the
  room's main ambition at the center. Depth renders as ink: near stickies
  crisp, far ones ghosted and blurred. Drag anywhere spins the ring with
  inertia; drawing near a sticky reveals its preview; click expands it to the
  front while the rest recede. The geometry says the thesis: ingredients
  circling the dish. Post-it mechanics survive intact (`docs/craft/
  post-it.md`): peel, ink-fade-then-curl ageing, the size limit.
- **Motion: the pulse, and mechanics.** Revising the morning's "still at
  rest": the room is quietly alive — the ring orbits slowly, each sticky
  breathes on its own faint phase — because a room with a pulse should read
  as having one. Everything else stays mechanics-only: no decorative
  animation; a burst of motion always means something changed (arrival, peel,
  adoption, scrub).
- **Color: ink + paper on the board; the room's hue on the poster.** Mode 1
  stays near-monochrome — warm paper white, dark ink; the only color is a
  member's hue on the faces a sticky wears. Mode 2 goes full-bleed in the
  room's chosen hue (the room's, changeable — a room is people, its page
  wears their color); the share card inherits it.
- **Type: poster-bold ambition, quiet sans machinery.** The ambition is set
  huge in a heavy display sans, uppercase, clipo-register — the words
  themselves are the playful, proud object. Everything that is interface is
  a small quiet sans. The board's stickies stay in the quiet register; the
  poster shouts, the board murmurs.
- **The character: the pulse.** Behind mode 2's ambition lives an abstract
  beating heart-form — calm, slow at rest; it quickens when the room is
  active. Built as a Rive state machine (clipo's technique), not video: it
  reacts, it doesn't loop. It is why the page is *felt* and not only read.
  It is not a mascot and appears nowhere else.

Reference recipes, measured from source 2026-08-08 (full analysis in the
session that authored this doc):

- **clipo.one**: `--ink #131313 / --paper #f7f7f6 / one accent`; 2 box-shadows
  and radius 0 across the whole site; two type voices (display sans +
  PhonkSansHeavy poster); chrome enacts the product metaphor (selection
  handles on every button); motion concentrated in a typer and mask-reveals;
  character = Rive state machine via `data-rive-src`.
- **bleibtgleich.dev** (`assets.slater.app/slater/20419/62015.js`): the
  floating-tiles motion. `initOrbitTiles` — the ring: per-item progress,
  `x=sin(θ)·w`, scale/opacity/blur interpolated by ring position, idle
  rotation ~24s, active item = nearest to front. `initInfiniteCanvas` — the
  free-fly variant: three.js planes in seeded chunks, inertia drag
  (GSAP Draggable+Inertia), distance-squared opacity falloff, per-tile sine
  breathing, click-to-focus lerps the mesh to camera. Mode 1 takes the orbit
  recipe with the canvas's depth-fade and focus-lerp; three.js lazy-loaded
  the way `MeaningGraph` already is.

Process rules, from decisions already made the hard way: settle content
structure before motion; endorsement renders as faces, never numbers;
complexity is the enemy named by the founder — every element on either mode
must justify itself against "could this fold away?" Every phase gate below
includes the craft question: *does this screen make someone want to come back
(mode 1) or want to share it (mode 2)?* A phase that ships working machinery
on an ugly surface has not passed.

## Phases

### Phase 0 — every room has both modes

The solo wall is a room with one member and must not be a special case: same
board, same direction page, same machinery — `requiredDirectionContributors`
and `requiredDirectionResponses` already return 1 for a single member, so the
solo flow is confirm-your-own-proposal with no ceremony. Surface work: the two
modes become the room's two named places, each named in its destination's own
words (agikee's naming rule at `Surface.tsx` — the word on the button must be
the word on the page). Personal ambition language already exists in
`ambition-synthesis.ts`; reuse its vocabulary, don't invent a parallel one.

**Gate:** browser-verified on localhost: solo wall and a group room each reach
both modes by the same gesture, and the founder can say which mode they are in
without reading the URL.

### Phase 1 — endorsement: the board's shared verb

A member endorses a sticky: *this races my pulse too.* Room-visible, one per
member per sticky, revocable. Distinct from the existing private feedback
(which stays — calibration and endorsement answer different questions:
"did the AI read us right?" vs "does this still quicken us?").

Display rule: endorsements render as member faces on the sticky, never as
numbers — the standing no-counts/badges/streaks rule. The weight exists for
the proposer, not for scoreboard-watching.

Fading, not deleting: a sticky nobody endorses recedes visually but is kept —
same keep-everything principle the timeline is built on, and the receded ones
are what scrubbing back should show the room once considered.

**Gate:** in a real room, a week of endorsements separates the stickies the
founder would call load-bearing from the ones they'd call noise — checked
against the load-bearing grades when ambition-reading Phase 2 lands.

### Phase 2 — the board feeds the proposal

The proposer (WAKA writing the next direction draft) currently reads
contributions. Add the board's endorsement state as evidence: which stickies
the room affirmed, which faded unendorsed, endorsement recency (the
"still races after the novelty wears off" test is *endorsement that persists
across weeks*, and `pulse_profile` / `evidence_span` on readings already store
the raw material for it). Contributions gain a thread: replies under a
contribution, so "how should this ambition change" is a discussion, not a
stack of disconnected notes. The one-open-proposal rule is kept as is.

**Gate:** founder rubric, same shape as ambition-reading Phase 1: given the
same room, a proposal written with board evidence reads as *more theirs* than
one written without it, stable across 3 runs. Refusal to propose when the
board is thin is a pass.

### Phase 3 — adoption: quiet consent, loud objection

Today a proposal is adopted only when a majority explicitly accepts —
`directionReviewDecision`, and its comment says the strictness is intentional.
The founder's decided rule inverts the default: a proposal that sits with its
thread for a quiet window (N days, N decided at build time) is adopted unless
someone objects; an objection escalates to exactly today's majority vote. The
existing `accept` / `keep_current` responses survive unchanged — the window
only adds a clock that treats silence as consent instead of as a veto.

The argument for loosening: with Phase 4, adoption becomes internal and
low-stakes — the public moment moves to the explicit publish act, which is
where legitimacy is actually spent. The main ambition should update at the
tempo of a living document, not a constitutional amendment.

**This reverses a policy agikee set on purpose, and is theirs to approve
before this phase starts** — same protocol as the early-stop reversal in
`wall-that-evolves.md`. If they hold the line, the fallback is keeping
explicit majority and shortening the path to it (e.g. proposal notifications —
the groundwork of "a proposal arrives for everyone" is already theirs).

**Gate:** in a real multi-member room, an uncontested update adopts without
anyone chasing votes, and a contested one demonstrably falls back to the vote.

### Phase 4 — opt-in publish per version

An adopted version can be published to a public URL — a deliberate act,
separate from adoption; drafts and internal history stay inside. Solo: the
owner publishes. Group: publishing is the one act that always takes the
explicit majority (this is where the ceremony belongs). Follow the existing
sharing grammar — per-entity flag, the "say what going public cannot undo"
confirmation agikee already built for saves, and `PublicProfile`'s rendering
language for the public page. Unpublishing hides the page but does not
unsay it; the confirmation copy must say so.

**Gate:** browser-verified: a published ambition is readable signed-out at a
stable URL naming only what was published (the version's text, the room's
chosen face — no evidence layer, no member signals); unpublish removes it;
nothing else about the room leaks.

## What this goal will not do

- Rebuild the wall, the direction surface, or the review machinery — it
  extends them in place.
- Gate the board: stickies auto-post; endorsement is curation-after, never
  approval-before. (Confirm-before-visible was considered 2026-08-08 and
  rejected: the surprise of an unasked-for revelation *is* the product.)
- Add counts, badges, or streaks anywhere — endorsement weight is for the
  proposer; people see faces.
- Weaken save ownership: capture stays the person's, sharing stays the
  per-signal flag every room reads.
- Delete anything: unendorsed stickies fade and are kept; unpublished
  versions remain in the room's history.
- Substitute for the ambition-reading gate. If the reader's output is five
  phrasings of one idea, both modes faithfully display a narrow room; fixing
  that lives in `ambition-reading.md`, not here.

## Budget

Endorsements and adoption are human acts — no model cost. The proposer already
runs; board evidence adds prompt tokens, not calls. Publish is a read path.
The only new recurring cost is proposal-refresh tempo if the window makes
updates more frequent; bounded by the existing one-open-proposal rule.

## Log

### 2026-08-09 — the orbit prototype, and four design rulings

Slice 1 built on this branch: the wall renders as the orbit behind the
internal Debug-pill toggle, read-only expand, no new dependencies (CSS
perspective, not three.js). Founder rulings while judging it live, which
refine the design bar's mode 1 paragraph:

- **The kernel.** Mode 1 centers ONE quiet line of the ambition (✳ + first
  words + →, a door to mode 2) — never the full statement. The board is the
  page's subject; the ambition has its own page.
- **The halo.** The ring passes below and behind the kernel, never across
  it. Reading and orbiting must not compete.
- **Two attentions.** At rest the kernel is the page and the ring recedes;
  a hand on the board (drag, coasting throw) brings it forward and the
  kernel steps back. Eased, not switched.
- **Convergence on arrival.** Sheets swing in past the kernel once and
  settle — derivation shown as a moment, not a permanent diagram.
- Also ruled: sheets are landscape; ambient source-glyphs rejected as noise;
  per-sheet random 3D tilts rejected ("subtle chaos") — every sheet hangs
  parallel and the skew belongs to the camera.

### 2026-08-08 — proposed

Decisions locked with the founder (see decision line at top). Repo read
confirmed both modes substantially exist; deltas are the table above. The
Phase 3 policy reversal was flagged as agikee's decision, not assumed.
