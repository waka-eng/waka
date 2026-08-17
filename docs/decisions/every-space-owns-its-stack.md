# Decision: every space owns all three layers

Status: **decided (2026-08-17).** Not built. This amends `docs/data-model.md`,
which describes a different design. The plan is
`docs/goals/every-space-owns-its-stack.md`.

## The question this answers

A group showed five signals overhead and nothing on the ground beneath them,
and it was not obvious how signals could exist with no memories under them.

They can, because those two halves of the page answer unrelated questions. The
signals were distilled by individuals **in their own spaces** and then shared
here. The ground shows a different set entirely — public memories of current
members — chosen by an unrelated flag that defaults to private.

So the ground could never explain the sky. Even full, it would not hold the
evidence behind what is overhead. A layout whose vertical grammar says *this
came from that* delivers no such relationship, and a reader is right to be
confused by it.

## What is true today, checked against `origin/dev`

**A group has two layers, and the second one is imported.**

| layer | a group today | works? |
|---|---|---|
| ground | **does not exist** | — |
| sky | signals distilled elsewhere, then shared in | yes |
| top of mind | `refreshTopOfMindForGroup` returns `not_implemented` | **no — a stub** |

This matches `docs/data-model.md` line 78, which is deliberate and says so:

> The pipeline, per profile: inspirations accumulate → WAKA distills signals →
> signals synthesize into the top of mind. **The group flow reuses the middle
> layer**: members share signals to a group wall, and the group's top of mind is
> generated from those shared signals.

Reinforced twice more: raw captures are "no longer shareable at all" (line 214),
and a group wall shows shared signals "never raw captures" (line 219).

**A correction, because an earlier draft of this document got it wrong.** That
draft said the shipped code contradicted its own canon by serving raw captures
on a group surface. It does not. `loadGroupField` was introduced by `5188af6`,
which is **not an ancestor of `origin/dev`** — it is unmerged work on
`goal/frontend-you-can-read`, alongside the ground-switching feature. On
`origin/dev`, `groups.ts` states the opposite in two places: `inspirations` and
`signal_evidence` are not reachable from the group module. There is no
contradiction to repair. There is a design to change.

**What IS shipped and broken:** the group's top of mind is a stub, and the queue
enqueues refresh jobs for it on every membership change and every share. Those
jobs run, log a line, and discard themselves. A group's third layer has never
worked.

## The decision

**Every space owns all three layers, and the layers relate the same way in each.**

| | your own space | a room |
|---|---|---|
| **ground** — what is visible here | every memory you own, public and private | every **public** memory of every current member |
| **sky** — distilled from that ground, in this space | your signals | the room's signals |
| **top of mind** — signals shaped by interaction | you alone: adopt, lock, let go | members together: propose, affirm, majority carries |

Three rules make it one model rather than two:

1. **A space's ground is whatever is visible in it.** Nothing else.
2. **A space's signals are distilled from its own ground.** Not imported.
3. **A space's top of mind is its signals after people have acted on them** —
   alone in your own space, together in a room. Generation proposes; interaction
   decides.

`visibility` stays **global and two-valued**. Public means public: the memory
appears on the ground of every room you are in. Private means it never leaves
your own space. Per-group visibility is deliberately out of scope — one flag a
person can hold in their head beats a matrix they cannot.

### Why this is worth changing the canon for

**It produces something the current design cannot.** The same public memory,
read alongside a different set of people's memories, yields different patterns
in different rooms. Four of us distil one reading; a different four distil
another from partly the same material. Under "reuse the middle layer" a room can
only ever mirror patterns one person already found alone — the room adds nothing
that was not already in somebody's head.

**It makes `space` mean one thing.** The frontend already defines a space as "a
thing owning a full three-layer stack". Today that is true of your own space and
false of a room. That gap is why the page reads as broken.

**And more of it is built than it appears.** The hardest social part of layer 3
— proposals, affirmations, a strict majority, and a tally that only counts
current members — is implemented and working in `groups-proposals.ts`. It simply
has nothing to act on, because a room has no signals of its own and no top of
mind to co-edit.

## What this costs

1. **Sharing a personal signal into a room goes away.** A room's sky is purely
   what the room distilled. One kind of signal, one origin. The cost, said out
   loud: bringing a privately-derived insight into a room without exposing the
   memories behind it stops being possible.

2. **The evidence rule inverts for rooms, and only for rooms.** Today a member
   sees *that* a signal fed an entry, never which one. In a room, evidence
   becomes visible — every memory on a room's ground was deliberately made
   public by its owner, so the link exposes nothing new. **Your own top of mind
   keeps the old rule.** This is scoped, and must be written that way.

3. **Model spend scales with room membership.** A memory made public is read
   once in your own space and once per room you are in. That is the point rather
   than waste — but the bill grows with how many rooms people join.
   **Decided: a daily sweep and no new spender.** `lib/model-budget.ts` exists
   because "a burst is the attack", and a cron deriving each room once a day
   cannot burst. Charging a member would be worse than nothing:
   `background_jobs.profile_id` is `NOT NULL`, so a room's job already borrows an
   arbitrary member via `resolveJobOwnerProfileId` — picked so the row is not
   orphaned when its requester leaves — and that member would lose budget for
   their own saves to a job they never triggered.
   **The reversal condition:** the day a room's derivation fires on a member
   action rather than a clock, churn becomes a burst and a per-room budget
   becomes necessary.

4. **Retroactivity.** Making a memory public folds it into every relevant room's
   next daily sweep. Making it private again must withdraw it and retire signals
   left standing on nothing — machinery `signal-lifecycle.ts` already has for the
   delete path.

## What happens if this is rejected

A room stays two layers. The ground built on this branch is dropped rather than
merged, and `refreshTopOfMindForGroup` still has to be written, because it is a
stub either way and the queue is already scheduling work for it.

**Either path requires work. Doing neither leaves a room whose third layer has
never worked and whose page implies a chain that does not exist.**
