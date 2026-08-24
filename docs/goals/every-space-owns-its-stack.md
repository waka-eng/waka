# Goal: make every space own its three layers

Status: **plan (2026-08-17), and its survey is now four months of work out
of date — RESTATED 2026-08-24 against the branch rather than against
`origin/dev`. Phases 2 to 4 propose an architecture the product has since
deliberately built the opposite of. The fork below is the founder's and
nothing is built past it.** Decision:
`docs/decisions/every-space-owns-its-stack.md`.

**Read the starting point below before the phases.** The original plan said
that of itself, about an earlier draft written against a branch whose files
were not the product. It is true again, of the plan itself, for the same
reason — so the survey is redone here rather than patched.

## Where this actually starts — restated 2026-08-24

Checked against this branch, by reading the code, not by inspection of the
older survey.

**Built since the plan was written, and load-bearing:**

- **A room HAS a ground.** `routes/groups-field.ts` serves every current
  member's public memories; the world fetches it on arrival and pours the
  room's orbs. The plan lists this under "Missing" and as the first bullet
  of Phase 3. It is done.
- **`refreshTopOfMindForGroup` is NOT a stub.** `lib/top-of-mind-synthesis.ts`
  implements it in full: the first-draft gate (`GROUP_DRAFT_MIN_AFFIRMED`),
  members' affirmations counted newest-first with the owner's own reaction
  excluded, unapplied proposals folded in, versioning with reasons, dropped
  citations counted. The plan's Phase 4 is "build" it. It is built, and the
  queue's jobs for it are neither logged nor discarded.
- **The room's history is served AND wound.** The chain, the door's ledger,
  a versioned read of any past board, and a dial that winds it.
- **`signal_shares` is the room's spine.** The wall reads it, the synthesis
  reads it, the export carries it, the contested pairs and the counted
  stances stand on it. The plan's Phase 4 removes it by forward migration.

**Still true as the plan describes it:**

- A signal belongs to a profile. A room-owned signal has nowhere to live.
- Nothing distils from a room's GROUND. A room's board is synthesized from
  the signals its members shared in, not from the memories underneath them.

## The fork this plan is now sitting on

The plan and the product answer the same question two incompatible ways, and
both answers are written down as rules rather than as accidents.

**(A) What shipped — a room reuses the second layer.** `data-model.md`: "the
group flow reuses the second layer: members share signals to a group wall,
and the group's top of mind is generated from those shared signals". The code
says it in the same voice: *a room never generates a signal — every statement
here was formed on some member's own wall out of their own inspirations and
then shared in*. Every statement in a room therefore belongs to a person, by
construction, which is what makes "who agreed, who declined, who has not
answered" nameable without any attribution machinery at all.

**(B) What this plan proposes — a room distils its own.** A room's ground
feeds a room's own signals, owned by the room and by no member, and
`signal_shares` is deleted.

They cannot both be true. B is not an increment on A: it removes the wall's
source, the synthesis's input, a table the export publishes, and the object
the proposals and affirmations act on — all of it currently green and all of
it in the founder's hands this week.

**The recommendation, and the reason.** Keep A. A room's statements being
*someone's* is not a limitation the design is working around; it is the thing
that makes a room legible — a shared statement carries a name, a stance
against it carries a name, and nothing in the room is an unattributed claim
about the people in it. B's room-owned signal is precisely an unattributed
claim about the people in it, and every surface that currently says who
thinks what would need a new answer for it.

What A genuinely lacks is the thing B was reaching for: **a room's ground has
no signals of its own overhead, so the memories that members made public in a
room feed nothing.** That is a real gap and it does not need B to close it —
the same ground can suggest to each member, on their own wall, in their own
name, which keeps every statement attributed. That is a smaller, additive
change and it is what a Phase 2 should be if the founder keeps A.

## The shape

Four phases. Each ends green and is independently revertible. The restructuring
is not a separate pass: every phase moves code that is already being rewritten,
which is the only time a move is free.

---

### Phase 1 — Amend the canon first

Nothing is built before the document says what is true. `docs/data-model.md`
line 78 currently describes the design being replaced.

- Rewrite the pipeline paragraph so the three rules are stated once and apply to
  every space: a space's ground is what is visible in it; a space's signals are
  distilled from its own ground; a space's top of mind is those signals after
  people have acted on them — alone in your own space, together in a room.
- State that `visibility` is global and two-valued, and that per-room visibility
  is deliberately out of scope.
- Scope the evidence change: **a room's** entries may name the memory that fed
  them, because a room's ground is public by construction. **Your own top of
  mind keeps "that, never which."** Write the asymmetry explicitly; it will be
  read as a global relaxation otherwise.
- Record that `signal_shares` is being removed and what replaces it.
- Amend lines 214 and 219, which say raw captures never reach a group surface.
  Under this decision they do — as a room's ground, by their owner's choice.

**Gate:** `data-model.md` describes the system this goal builds, with the
personal/room asymmetry stated rather than implied.

---

### Phase 2 — Let a signal belong to a room

The schema decision everything else rests on, done alone so it can be reviewed
before anything is built on top of it.

- Today a signal is stamped with one `profile_id`. A room's signals need an
  owner that can be a room. Choose between a nullable `group_id` and a
  polymorphic space reference, and **write down which and why** — including what
  each does to the existing per-profile queries, which are numerous.
- Whatever is chosen must keep this true: a room's signal is not any member's
  signal. It does not appear in their own sky, and it does not feed their own
  top of mind.

**Gate:** the migration is written, reviewed, and applied, and every existing
per-profile query still returns exactly what it did — proven by the API suite,
not by inspection.

---

### Phase 3 — Distil a room's sky from its own ground

The substance. Begins by deleting work that was never doing anything.

- **A room's ground.** Merge `loadGroupField` if this branch lands, or write it
  if not: every public memory of every current member.
- **Derive per space.** A new job type reads a room's ground and distils signals
  scoped to that room. **Reuse `signal-match-or-mint`** rather than writing a
  second matcher — one match-or-mint rule, not two.
- **A daily sweep**, bounded batch, spread across the day, under one global
  ceiling, with the reversal condition from the decision doc written beside it:
  the day this fires on a member action rather than a clock, a per-room budget
  becomes necessary.
- **Restructure as it lands.** Per-space derivation belongs beside the existing
  derivation modules as its own file, not as a branch inside the personal path.
  A conditional on space type inside the existing pass would undo the split that
  made these files readable.

**Gate:** a room with public memories on its ground has signals overhead that
were distilled from them, and a test proves a signal's evidence rows point at
memories on that room's own ground.

---

### Phase 4 — Give a room its top of mind, and connect what already exists

- **Build `refreshTopOfMindForGroup`** on the room's own signals. The personal
  path is the model; the room version differs in what it reads and in being
  allowed to name its evidence.
- **Connect it to the deciding machinery.** Proposals, affirmations and majority
  are already implemented — this is the artifact they have been waiting to act
  on. Expect this to be smaller than it sounds, and check that assumption early.
- **Remove `signal_shares`**: the share and unshare routes, the wall query's
  join, the share UI, and the table, by forward migration.
- **Verify no job type is enqueued that no handler implements** — the stub's
  jobs are being scheduled and discarded today, and that must not survive.

**Gate:** a room's top of mind is generated, versioned, attributes real evidence,
and changes when members affirm a proposal. Nothing refers to `signal_shares`.

---

### Phase 5 — Make the page say what is now true

The original symptom was a layout implying causation it did not have.

- **The ground explains the sky.** A room's peek row and provenance reach the
  room's own evidence — the mechanism a personal space already implements.
- **The empty state says why.** A room whose members have made nothing public
  says so, rather than showing blank ground under a full sky.
- **Restructure as it lands.** A room stops being the special case that begins
  at layer 2, so the per-kind branching that exists to paper over the asymmetry
  should shrink. Measure it before and after and report the number — **if it
  does not shrink, the model did not actually unify** and that is worth knowing.

**Gate:** the page that produced the original question — five signals, nothing
beneath — either shows evidence under its signals or says plainly why there is
none.

---

## Out of scope, deliberately

- Per-room `visibility`. Named and rejected.
- Changing your own space's pipeline. It works; this goal must not disturb it.
- "That, never which" for **your own** top of mind. Unchanged.
- Retroactivity beyond the next sweep.

## Risks worth naming before starting

1. **Phase 2 is load-bearing.** Everything depends on how a signal names its
   space. Review it before building on it; migrating it later is expensive.
2. **Removing `signal_shares` is destructive and irreversible.** Real rows are
   real member decisions. Check whether any deployed database holds them before
   writing the migration.
3. **A room of five with 400 public memories is a real derivation.** Choose the
   sweep's batch size against that number, not a guess.
4. **This deletes a capability people may be using.** Sharing a signal into a
   room works today; afterwards whatever anyone shared stops being visible.
5. **The branch question.** If `goal/frontend-you-can-read` does not merge, the
   file layout this plan assumes does not exist and Phase 3 includes writing the
   room's ground from scratch.
