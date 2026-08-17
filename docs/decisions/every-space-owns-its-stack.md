# Decision: every space derives its own signals

Status: **decided (2026-08-17).** Not built. This amends `docs/data-model.md`,
which currently says the opposite. The plan is
`docs/goals/every-space-owns-its-stack.md`.

## The question this answers

A group showed five signals in its sky and zero inspirations on its ground.
Nothing was broken. The two halves of that page answer two unrelated queries:

- the sky reads `signal_shares` — signals an owner distilled **in their own
  space** and then chose to share here
- the ground reads `inspirations` where `visibility = 'public'` — a different
  set, chosen by a different flag, which defaults to private

So the ground can never explain the sky. Even full, it would not hold the
evidence behind what is overhead. A page whose vertical grammar says *this came
from that* delivers no such relationship.

## What the canon says today

`docs/data-model.md` line 78 is explicit, and it is a deliberate design, not an
oversight:

> The pipeline, per profile: inspirations accumulate → WAKA distills signals →
> signals synthesize into the top of mind. **The group flow reuses the middle
> layer**: members share signals to a group wall, and the group's top of mind is
> generated from those shared signals.

Reinforced twice: "Raw captures are no longer shareable at all" (line 214), and
"Group wall … shows members' **shared signals**, never raw captures" (line 219).

**So a group, by the canon, has two layers and starts at the second one.**

## What is actually built

| layer | group space today | feeds |
|---|---|---|
| ground | public inspirations of current members (`loadGroupField`) | nothing |
| sky | signals shared from personal spaces (`loadGroupWall`) | nothing |
| top of mind | `refreshTopOfMindForGroup` returns `not_implemented` | — |

Two things follow. First, the group ground is a surface the canon does not
describe — the frontend gave a group a layer 1 that the data model withholds.
Second, the one thing the canon *does* promise a group — a top of mind
generated from shared signals — is a stub, while the queue enqueues refresh
jobs on every membership change and share that run, log, and discard.

**The chain the whole product is built on exists only in a personal space.**

## The decision

**Every space derives its own signals, from the inspirations visible in it.**

| | personal space | group space |
|---|---|---|
| ground | every inspiration you own, public and private | every **public** inspiration of every current member |
| sky | signals derived from all of them | signals derived **per group**, from that ground |
| top of mind | synthesized from your signals | synthesized from that group's signals |

`visibility` stays **global and two-valued**. Public means public: it appears on
the ground of every group you are in. Private means it never leaves your own
space. There is no per-group visibility, and adding one is explicitly out of
scope — one flag a person can hold in their head beats a matrix they cannot.

### Why this is worth changing the canon for

**It produces something the current design cannot.** The same public memory,
read alongside a different set of people's memories, yields different patterns
in different rooms. Four of us distil one reading; a different four distil
another from partly the same material. Under "reuse the middle layer" a group
can only ever mirror patterns one person found alone — the room adds nothing
that was not already in somebody's head.

**It makes `space` mean one thing.** The frontend already calls a space "a thing
owning a full three-layer stack". Today that is true of personal spaces and
false of groups, which is why the group page reads as broken: it draws three
layers over a data model that has two.

## What this costs, and what has to be decided with it

1. **`signal_shares` loses its job. DECIDED: removed.** A group's wall is
   purely derived. One kind of signal on a wall, one origin, and the page
   explains itself. The cost is real and should be said out loud: bringing a
   privately-derived insight into a room without exposing the memories behind
   it stops being possible.

2. **The privacy rule inverts for groups. DECIDED: yes, and scoped.** Today: a member sees
   *that* a shared signal fed an entry, never which one. Under this decision a
   group's evidence is visible, because every memory in a group's ground was
   deliberately made public by its owner. That is simpler and more honest than
   the current rule, and it is what makes the page explain itself. It is still a
   change to a stated canon rule and must be written into `data-model.md`, not
   left implied.

3. **Model spend multiplies by group count. DECIDED: a daily sweep, and no new
   spender.** `lib/model-budget.ts` exists because "a burst is the attack"; a
   cron deriving each group once a day cannot burst. Charging a member would be
   worse than nothing — `background_jobs.profile_id` is NOT NULL, so a group job
   already borrows an arbitrary member through `resolveJobOwnerProfileId`, and
   that member would lose budget for their own saves to a job they never
   triggered. The sweep gets a bounded batch and one global ceiling instead.
   **The reversal condition:** the day group derivation fires on a member action
   rather than a clock, churn becomes a burst and a per-group budget becomes
   necessary.

4. **Retroactivity.** Making a memory public must fold it into the ground of
   every group the owner is in, and that ground's next derivation. Making it
   private again must withdraw it, and should retire signals left standing on
   nothing — machinery `signal-lifecycle.ts` already has for the delete path.

5. **The group ground already leaks by the current canon.** Whatever is decided
   here, `loadGroupField` today serves raw captures on a group surface, which
   line 219 says never happens. If this decision is rejected, that query should
   be removed rather than left contradicting the document.

## What happens if this is rejected

Then the group ground goes. A group becomes the two layers the canon designed —
a wall of shared signals and a top of mind generated from them — and
`refreshTopOfMindForGroup` still has to be built, because it is a stub either
way. The page stops implying a relationship it does not have.

**Either path requires work. Doing neither leaves a page that reads as broken
because it is describing a chain that does not exist.**
