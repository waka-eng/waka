# Goal: make every space own its three layers

Status: **plan (2026-08-17).** Not started. Decision:
`docs/decisions/every-space-owns-its-stack.md`.

**Read the starting point below before the phases.** An earlier draft of this
plan was written against `goal/frontend-you-can-read` and described its files as
though they were the product. Several are not.

## Where this actually starts

Checked against `origin/dev`, not against the working branch.

**Already built and working — more than it looks:**

- Your own space runs the whole chain: memories → signals → top of mind.
- The distilling engine itself — match-or-mint by cosine distance on embeddings,
  with a model call only as a tie-breaker inside the band between two
  thresholds. This is reusable as-is and is the expensive part.
- **A room's way of deciding together.** `groups-proposals.ts` implements
  proposals, affirmations, a strict majority (`carriesMajority`), and a tally
  that joins current membership so a departed member's vote stops counting. This
  is the hardest social part of layer 3 and it is done. It simply has nothing to
  act on.

**Missing:**

- A room has no ground. `loadGroupField` exists only on
  `goal/frontend-you-can-read` (introduced by `5188af6`, not an ancestor of
  `origin/dev`).
- A signal can only belong to a profile. A room's signals have nowhere to live.
- Nothing distils from a *space's* ground. Derivation is triggered per save, for
  the saver.
- `refreshTopOfMindForGroup` is a stub returning `not_implemented` — while the
  queue enqueues refresh jobs for it on every membership change and share, which
  run, log, and discard.

**Branch-only files this plan mentions.** These came from splitting large files
on `goal/frontend-you-can-read` today and are not on `origin/dev`:
`groups-field.ts`, `groups-wall.ts`, `groups-proposals.ts`,
`signal-match-or-mint.ts`, `signal-lifecycle.ts`, `model-budget.ts`. The code is
on `dev` inside `groups.ts`, `signal-derivation.ts` and `queue.ts`; only the
filenames differ. **Whether that branch merges first changes where this work
lands, not what it is.**

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
