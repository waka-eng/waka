# Goal: lighting a room

Status: blocked at phase 3 — phases 1–2 passed 2026-08-28; phase 3's gate needs a working GEMINI_API_KEY (see Log)
Branch: `goal/lighting-a-room`
Depends on: nothing structural. Touches the join consent sheet
(`a-room-you-can-trust` made joining an asked question; this goal keeps that
sheet the moment of disclosure and gives it sight, not new powers).
Decided by founder, 2026-08-28: the whole loop is in scope (maker, invitee,
stranger, and the room's first week); a review-and-open pass runs at create
and at join; solo creation stands, with the dark room rendered as staged
states; this document is the plan of record.

## Why

Making a room is one line — a name, an owner seat, an invite link. Everything
after that line is untold on the surface. A newborn room is structurally
silent by design: its ground is its members' *public* captures and private is
the default; a wall statement is served only once memories from two different
members stand under it (`GROUP_SIGNAL_MIN_VOICES`); the first reading waits
for affirmed statements (`GROUP_DRAFT_MIN_AFFIRMED_SMALL` in a small room —
bars and values live in `docs/generation.md`). A room of one, or of members
whose captures are all private, is dark, and today it says one sentence about
all of that: "Forming — nothing read together yet."

The silence is designed. The illegibility is not. Nothing tells the maker the
room is waiting, in order, for a second voice, public memories, a pattern
under two voices, an affirmation. Nothing shows the invitee what they are
about to put on the table. And the person for whom an invite link is their
first contact with WAKA — the growth loop, and the room with the longest dark
period, since the join backfill finds nothing of theirs to read — walks the
same path as everyone else, untold.

Three people, one loop: the maker, the invitee already here, the stranger.
This goal makes each next-needed act obvious from inside the room, and makes
the room's brightening literal — light is the only meaning channel, and a
room getting lit is the product working.

## Load-bearing decisions

- **The switch stays global.** Public means visible to every room you are in
  — the pass says exactly that sentence, and per-room visibility stays out of
  scope (`docs/data-model.md`). Opening a memory is per-capture and explicit:
  bulk-assisted, never inferred.
- **The consent sheet stays the ask.** A link-click joins nothing; the sheet
  keeps its question and gains only sight of what the joiner already owns.
- **Solo creation stands.** Paired birth — a room that materializes on the
  second voice — is rejected: a dark room rendered honestly teaches the same
  truth without blocking the maker.
- **States render, numerals never.** Every stage sentence is a state, not a
  count. The mechanics already withdraw and re-admit voices at serve time
  (`packages/api/src/lib/room-visibility.db.test.ts`); the surface only has
  to say where things stand.

## Phases

### Phase 1 — the maker lands in what they made

"make it" travels to the new room's wall. The empty room's first object is
its invite — copy-the-invite as the primary verb where you land, not a row in
settings. The creation sheet carries one plain line about what a room does:
it reads what its members keep public, and says only what stands under more
than one of them.

**Gate:** an e2e walk makes a room, arrives at it without a further tap, and
copies the invite from where it landed.

### Phase 2 — the dark room speaks in stages

The one forming line becomes stage-honest states. The room reports the first
missing thing, in a fixed order, and each stage names the single act that
advances it (sentences below are drafts; the phase settles the copy):

1. No second voice → the invite is the way in.
2. Voices, bare ground → nothing public stands here yet; open a memory and
   it will.
3. Ground, nothing two-voiced → nothing stands under two voices yet; what
   you keep open keeps feeding it.
4. A statement waiting → something is forming; say whether it is true of
   you.

The stage is read from data the room already loads — roll, ground, wall,
proposals — no new endpoint. Light renders the stage; motion happens only
when an act lands.

**Gate:** the offline fixture renders every stage; each sentence passes the
mom test; nothing on the stage surface is a count.

### Phase 3 — review-and-open

At create and after join consent, a pass over your own captures: choose what
to open. The honest sentence is fixed — opening a memory makes it public to
every room you are in. The pass is also reachable any time from stage 2's
verb: a door back, not a birth-only ceremony. Mechanics exist end to end:
the switch fans out on open, withdraws at serve time on close, and the join
backfill (`GROUP_JOIN_BACKFILL_LIMIT`) already reads what is public when a
member arrives.

**Gate:** the pass writes the same per-capture acts the editor writes; the
room's ground shows them on the next read; an e2e walk takes a dark
two-person room to a lit wall through the pass alone.

### Phase 4 — the invitee sees what they bring

The consent sheet gains "look first": your public captures, listed as what
the room will see of you — your own data, no new disclosure. Joining then
lands you at the room, where your memories visibly take their place on its
ground: the consequence of joining, shown rather than described.

**Gate:** e2e — arrive on a link, look first, join, and find your own orbs
standing on the room's ground.

### Phase 5 — the stranger's walk

The login page reads the preserved destination and says so: you were invited
to a room — sign in and we'll take you there. No room details leak pre-auth.
After the name step, the consent sheet as today, then Phase 3's pass — which
for a stranger doubles as the first-capture teacher, because there is
nothing to open until they keep something.

**Gate:** a cold browser walks link → account → consent → room without a
dead end, and the join code never lands in history or a referrer (true
today, kept true).

## Open ruling (founder): the pre-join preview

Whether the consent sheet may name the room and its roll *before* joining.
Anyone holding the link can join and look, so a preview arguably discloses
nothing new — but it would disclose without an act on the record, to whoever
a link leaks to. Until ruled, the sheet stays nameless, as today.

## What this goal will not do

- Per-room visibility, or any third value for the switch.
- Auto-join on click, email invitations, notification channels.
- Seeded or placeholder room content — an empty room reads as empty, staged.
- Disclose the room's name or roll pre-join (see the open ruling).
- Growth numbers on any surface.

## Budget

No new model calls: stages derive from reads the room already makes, the
pass writes visibility edits, and fan-out and backfill derivation already
exist and are budgeted. E2e walks spend the standard derivation pennies.

## Acceptance

- A maker goes make → invite → open → second voice → first statement → first
  reading, with each step told by the room itself in stage sentences.
- An invitee sees what they bring before joining, and sees it land after.
- A stranger reaches the room from a cold link without a dead end.
- Every stage sentence passes the mom test; no counts anywhere on the loop.

## Log

**2026-08-28 — Phase 1, the maker lands in what they made. PASS (4/4, from a
measured baseline of 0/4).**

Gate: `pnpm e2e:lighting` (new — `tools/e2e/lighting.ts`), a browser walk that
signs up, makes a room, and touches nothing else.

| Step | Baseline | After |
|---|---|---|
| the make form says what a room does | FAIL — prose found: `"·"` | PASS — "A room reads what its people keep open, and says only what more than one of you stands behind." |
| making it takes you to the room, with no further tap | FAIL — "still standing on ME" | PASS — standing on the new room |
| the invite is what greets you there | FAIL — nothing offers it | PASS — the room's panel, naming it |
| the invite copies from where it landed | FAIL — no such control | PASS — clipboard holds `/?join=…` |

Baseline measured in this run, by stashing the `Home.tsx` change and
rebuilding — not remembered. The gate discriminates: every step fails on the
unchanged product, and step 2's failure prints the defect the phase was
written against.

Also checked: `pnpm --filter @waka/web typecheck` clean; `pnpm --filter
@waka/web test` 222/222 with vocabulary and seams clean.

Two things worth carrying forward:

- **The vocabulary checker caught the first draft.** `landedRoom` /
  `setLandedRoom` were refused — identifiers speak canon (`group`), only
  screen text says "room". Renamed to `landedGroup`. The rule in
  `docs/architecture.md` is enforced, not aspirational.
- **The gate's first version passed while proving less than it claimed.** It
  read the whole form's `innerText`, and the tab labels ("Make a room", "Join
  with a link") carry no full stop, so they joined the note into one run and
  counted toward its eight-word minimum — a form with no sentence at all
  would have cleared the bar on furniture alone. It now removes every
  `<button>` before reading, which makes "prose, not furniture" structural
  rather than a guess about wording. Caught by reading the PASS line's own
  output, which is why the steps print what they found.

Joining travels the same way (both paths land through one function), but that
is asserted by Phase 4's steps, not this one.

**2026-08-28 — Phase 2, the dark room speaks in stages. PASS (3/3, from a
measured baseline of 0/3).**

Gate: `pnpm e2e:lighting --fixture <vite dev url>`, walking the axis with the
traveller's own ArrowRight and reading each wall's line; plus
`packages/web/test/group-stage.test.ts` (6 cases) over the pure function.

| Step | Baseline | After |
|---|---|---|
| every wall says where it stands | FAIL — 5 walls walked, not one said anything | PASS — 6 walls, 5 said something |
| all four stages stand on the axis | FAIL — 4 of 4 missing | PASS — alone, bare, one-voiced, unanswered |
| no wall's line prints a number | FAIL — nothing read, so nothing proved | PASS — 5 walls read, not a digit |

Baseline measured in this run by stashing the two source files; the vite dev
server reloaded the old code, so it is this run's number and not a memory.

The sentences, all four:

- **alone** — "Nobody else is here yet — the invite is the way in."
- **bare** — "Nothing is open here yet — a memory you open stands on this ground."
- **one-voiced** — "Nothing here stands under more than one of you yet."
- **unanswered** — "Something is forming — say whether it is true of you."

Also checked: `typecheck` clean, full web suite 228/228 (40 suites), and the
live Phase 1 gate still 4/4 after the change.

**The baseline turned out to be worse than the phase assumed, and that is the
real finding.** The phase was written as "one sentence describes four
situations". Offline it was not even that: the fixture set no room chrome AND
never marked its rooms ready, so no fixture room ever woke, and every room
wall rendered *nothing at all* — the dark stages were the one part of a room
that could not be looked at without a session. Both halves are fixed here
(`groupChromeRef` and `groupCacheRef` are filled for every fixture room), and
a fifth room, `fx-bare`, was added for the stage the fixture had no shape for:
people in the room and nothing open.

Three instrument defects found by reading the walk's own output, each of which
had produced a green or plausible line while proving less than it claimed:

- **`.jar-forming` first() reads the leftmost wall, not yours.** Every wall
  renders at once, positioned in the world's coordinate space, so all six
  walls reported the identical sentence. The walk now reads the
  `.jar-wallcol` the viewport's centre falls inside.
- **A numeral check over an empty set passes.** "0 walls read, not a digit
  among them" is a green line reporting an unplugged instrument. It now fails
  when nothing was read.
- **Filtering rows by the name just read finds nothing** — `innerText` returns
  the CSS-uppercased paint, `hasText` matches the DOM's own text. The repo
  documents this trap in `first-sixty`; the walk hit it anyway.

**Finding, recorded and not fixed (out of this phase's scope):** on the
fixture, the walls-list menu cannot be clicked. Measured with
`elementFromPoint`: `.jar-dial-track` is what actually sits under the pointer
at every row's centre, though the list's z-index (8) is above the dial's (5) —
they are in different stacking contexts. Playwright refuses the click and is
right to; a person could not click those rows either. Not forced past, and the
walk travels by keyboard instead. Whether this reaches a real account with
many walls is unmeasured — the live stack's shorter axis did not reproduce it.

**2026-08-28 — Phase 3, review-and-open. HALTED BEFORE IMPLEMENTATION — the
gate cannot be measured in this environment.**

Phase 3's gate has three clauses. The third — *"an e2e walk takes a dark
two-person room to a lit wall through the pass alone"* — needs a **lit wall**,
and a wall is layer 2: the room must derive a statement from its members'
pooled public memories and serve it past the two-voices gate. That is
extraction plus embeddings, which needs a real `GEMINI_API_KEY`.

Measured rather than assumed. A capture was saved against the local stack and
the queue was read:

```
      type      | status  | attempts |                    err
----------------+---------+----------+-------------------------------------------
 derive_signals | pending |        1 | Error: Gemini embedding failed: HTTP 400
                                       Bad Request providerCode=INVALID_ARGUMENT
```

The other two clauses (*the pass writes the same per-capture acts the editor
writes*; *the room's ground shows them on the next read*) are layer 1 and are
measurable here — the room's ground is its members' public captures, no model
call involved. **They are not enough on their own, and the bar was not
lowered to fit what this machine can run.**

Stopped before writing the phase rather than after: a surface built against a
gate that cannot be run would land unverified code on the branch, which is the
one thing the gate discipline exists to prevent.

To unblock, one of:

1. **A working `GEMINI_API_KEY` in `.env.local`**, and the phase runs as
   written. Expected spend for the gate: one derivation per opened memory
   (each is one extraction, one capture embedding, up to three candidate
   embeddings and up to three judge calls — at most eight model calls per
   memory, per `docs/generation.md`), plus one group synthesis. A two-person
   room lit through the pass is a few dozen calls: cents, well inside the
   figure in this goal's Budget.
2. **A ruling that clause 3 belongs to a later phase** — the pass and the
   ground are layer 1 and stand on their own; "and then the room speaks" is
   arguably the room's first week (the acceptance list's first bullet) rather
   than this phase's. That is a change to the plan, and it is the founder's to
   make, not the runner's.

Phases 4 and 5 do not need a key — their gates are the join walk and the cold
link walk, both layer 1 — but they sit behind Phase 3 in the plan, and the
`--phase N` flag that would skip a gate is the caller's to give, not the
runner's to assume.
