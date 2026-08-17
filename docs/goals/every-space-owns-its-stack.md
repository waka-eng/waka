# Goal: make every space own its three layers

Status: **plan (2026-08-17).** Not started. Decision recorded in
`docs/decisions/every-space-owns-its-stack.md`; the four open questions there
are now answered and folded in below.

## What was decided

| question | answer |
|---|---|
| sharing a personal signal into a group | **removed** — a group's wall is purely derived |
| when a group re-derives | **on a daily schedule**, not on save and not on membership change |
| who pays | **nobody new** — see below; the schedule removes the threat a budget guards |
| may an entry name which memory fed it | **yes** — everything in a group's stack is public by construction |

### Why there is no group budget

`lib/model-budget.ts` says what it is for: *"a burst is the attack."* It is a
sliding window rather than a fixed bucket because a fixed bucket has a seam a
burst can exploit. A cron that derives each group once a day cannot burst.

Charging a member instead would be actively wrong. `background_jobs.profile_id`
is `NOT NULL` and is what the budget keys on, so a group job already borrows a
member through `resolveJobOwnerProfileId` — chosen so the row is not orphaned
when its requester leaves, which makes it an arbitrary billing target. A
scheduled job that member did not trigger would then eat the budget for their
own saves.

So: the sweep gets a bounded batch size and spreads across the day, under one
global ceiling so growth in group count cannot quietly spike spend.

**The condition that reverses this, and it goes in the code beside the sweep:**
the moment group derivation is triggered by a member action — a public save, a
membership change — a member can burst it by churning, and a real per-group
budget becomes necessary. Whoever adds a trigger must meet that reason.

## The shape

Four phases. Each ends green and is independently revertible. The restructuring
is not a separate pass: every phase moves code that is already being rewritten,
which is the only time a move is free.

---

### Phase 1 — Amend the canon first

Nothing is built before the document says what is true. `docs/data-model.md`
line 78 currently states the opposite of this plan, and lines 214 and 219 say
raw captures never appear on a group surface — which the shipped
`loadGroupField` already contradicts.

- Rewrite the pipeline paragraph: **every space distils its own signals from
  the inspirations visible in it.** Personal = all yours, public and private.
  Group = every public inspiration of every current member.
- State that `visibility` is global and two-valued, and that per-group
  visibility is deliberately out of scope: one flag a person can hold in their
  head beats a matrix they cannot.
- Replace the "never which one" rule for groups, and say why it is safe: a
  group's ground holds only what its owners deliberately made public.
  **Personal top of mind keeps the old rule** — this relaxation is scoped to
  groups and must not be written as a global change.
- Record that `signal_shares` is being removed and what replaces it.

**Gate:** `data-model.md` describes the system this goal builds, with the
personal/group asymmetry stated explicitly rather than implied.

---

### Phase 2 — Give a group a real layer 2

The substance. `refreshTopOfMindForGroup` is a stub returning
`not_implemented`, and the queue enqueues refresh jobs on every membership
change that run, log, and discard — so this phase begins by deleting work that
was never doing anything.

- **Derive per group.** A new job type reads a group's ground — the query
  `loadGroupField` already runs — and distils signals scoped to that group.
  Reuse `signal-match-or-mint.ts` rather than writing a second matcher: the
  match-or-mint decision is cosine distance on embeddings, and that is not a
  thing to have two of.
- **Scope signals to a space.** Today `signals.profile_id` says who owns one. A
  group's signals belong to the group. Decide between a nullable `group_id` and
  a polymorphic owner, and write down which and why. **This is the schema
  decision the phase turns on — do it first and get it reviewed before
  building on it.**
- **The daily sweep**, bounded batch, spread across the day, under one global
  ceiling, with the reversal condition written beside it.
- **Restructure as it lands:** `signal-derivation.ts` was split this week into
  five modules. Per-space derivation belongs in that shape from birth — a
  `signal-derivation-group.ts` beside the existing five, not a branch inside
  the personal path. A conditional on space type inside the existing pass would
  undo the split.

**Gate:** a group with public inspirations on its ground has signals in its sky
that were derived from them, and a test proves a signal's evidence rows point
at memories on that group's own ground.

---

### Phase 3 — Give a group a real layer 3, and remove what it replaces

- **Build `refreshTopOfMindForGroup`** on the group's own signals. The personal
  path in `top-of-mind-synthesis.ts` is the model; the group version differs in
  what it reads and in being allowed to name its evidence.
- **Entries may name the memory that fed them.** New in this goal, permitted by
  the canon amendment in Phase 1, and the thing that finally makes the group
  page explain itself.
- **Remove `signal_shares`** — the route at `signals.ts:393`, the delete at
  `:409`, the wall query's join, the share UI, and the table. A forward
  migration, the way `0010` dropped the verification table.
- **Verify the group synthesis stub is gone**, not merely bypassed, and that
  no enqueue path still creates jobs nothing consumes.

**Gate:** a group's top of mind is generated, versioned, and attributes real
evidence; nothing in the repo refers to `signal_shares`; no job type is
enqueued that no handler implements.

---

### Phase 4 — Make the page say what is now true

The original symptom was a page implying causation it did not have. With the
chain real, the layout stops lying — but only if the frontend is told.

- **The ground explains the sky.** A group's peek row and provenance should
  reach the group's own evidence, which is the mechanism `poster.provenance`
  already implements for a personal space.
- **The empty state says why.** A group whose members have made nothing public
  should say that, not show blank ground under a full sky.
- **Restructure as it lands:** `space-kinds/group.ts` and `space/` hold this
  code. A group space stops being the special case that starts at layer 2, so
  the per-kind branching that exists to paper over the asymmetry should shrink.
  Measure it with `scripts/measure-blocks.mjs` before and after and report the
  number — if it does not shrink, the model did not actually unify.

**Gate:** the page that produced the original question — five signals, zero
inspirations — either shows evidence beneath its signals or says plainly why
there is none.

---

## Out of scope, deliberately

- Per-group `visibility`. Named and rejected in the decision doc.
- Changing the personal space's pipeline. It already works and this goal must
  not disturb it.
- The "never which one" rule for **personal** top of mind. Unchanged.
- Retroactivity beyond the next sweep: making a memory public folds it into the
  next daily derivation, not into an immediate re-run.

## Risks worth naming before starting

1. **The schema decision in Phase 2 is load-bearing.** Everything after it
   depends on how a signal names its space. Getting it reviewed before building
   is cheaper than migrating it later.
2. **Removing `signal_shares` is destructive and irreversible.** Real rows mean
   real member decisions. The migration should be written knowing whether any
   deployed database holds them.
3. **A group of five with 400 public memories is a real derivation.** The daily
   sweep's batch size should be chosen against that number, not a guess.
4. **This plan deletes a feature people may be using.** Sharing a signal into a
   room is a capability today. The decision to remove it is recorded; the
   consequence is that whatever anyone shared stops being visible.
