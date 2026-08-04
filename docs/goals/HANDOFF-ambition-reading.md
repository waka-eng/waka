# Handoff — ambition-reading session → timeline/divergence session

Written 2026-08-01 for whoever picks up the other half of this branch. We were
both on `goal/ambition-reading` at the same time; this is what changed under
you, what I found that affects your work, and what still needs reconciling.

## What I touched that you own

**I renamed one of your files.** `0039_group_member_events.sql` →
`0040_group_member_events.sql`. Two migrations both claimed the `0036` prefix
(your `signal_reading_divergences`, my `combination_readings`), so journal tag
order stopped matching filename order — which `migrations.test.ts` asserts.
Mine moved to `0039`, yours to `0040`. Yours had not been applied anywhere, so
nothing re-ran; verified against dev.

**Your `bee9f17` swept up my uncommitted work.** It committed my
`export * from "./schema-combinations"` line while the file it points at was
still untracked, so that commit in isolation references something git did not
have. Fixed forward in `e89bdef`; flagging in case you wondered where it came
from.

**I nearly "fixed" a file you were mid-edit on.** A typecheck error in
`group-top-of-mind.ts` (`groupMemberEvents` unresolved) turned out to be a
snapshot of your work in flight. Re-running showed clean. Worth knowing that
this branch had two writers and one of them was reading half-written files.

## Three findings that bear on your work

**1. Your divergence pass has never run on Waka — 0 scored rows.** I wired
`divergenceScore` into the reader's evidence ranking (a signal that reads
differently here than alone is the strongest possible evidence for a
combination-only reading) and it is currently inert for want of data. Running
it on Waka would light up both your surface and mine.

**2. The distinctness metric in `tools/group-reading-eval.ts` is lexical, and
it misses semantic collapse.** Waka's five active notes:

```
Deployment as the new product frontier
The shift from model performance to context-rich rituals
Evolutionary loops: from screen-bound AI to physical reality
Beyond optimization: shifting from racing on roads to building new environments
Building the future through physical rituals rather than just digital interfaces
```

Mean pairwise word overlap: **0.08** — the eval calls that "readings are
distinct from one another." Read them: they are five phrasings of *physical
versus screen*. The board is semantically collapsed while passing the collapse
test, because the test counts shared words and these share none.

This matters for the timeline especially. A succession of notes that all say
one thing will replay as a room that never changed its mind, and the metric
guarding against that cannot see it. The fix is embedding cosine between note
titles rather than token overlap.

**3. The reader is faithful; the board is narrow.** My ambition reader kept
producing domain-level sentences ("moving beyond screen-bound software to build
physical, context-rich rituals"). I assumed thin inputs and widened its evidence
from 8 signals to all 63 — *identical output*. It was not underfed. It was
accurately reading five notes that mean one thing. Any work downstream of these
notes inherits that ceiling.

## What I dropped because you shipped it

**Phase 3 of `ambition-reading` — the signature reveal.** Your `fddc247` +
`signal-readings.ts` already does it, and better than I had planned: it
*generates nothing*, just arranges belief statements the judge already wrote,
and enforces the room-membership visibility contract inside the module rather
than at the route. Removed from my goal doc. Keep yours.

## What still needs reconciling — please do not build further on this alone

`docs/goals/room-timeline.md` (yours) and `docs/goals/combination-as-an-act.md`
(mine) both want to key history to a set of hearts. Yours is time-based on
rooms; mine makes the set of members first-class (`combinations`, with rooms as
one `origin`, plus `subset` and `handshake` origins later).

These will collide a third time if we each build. My `combinations` table
already exists and is applied. Two options worth a decision before either of us
continues: the timeline keys to `combination_id` instead of `group_id`, or
`combinations` is reduced to a lookup and the timeline stays group-keyed.

I have no strong preference beyond wanting it settled once.

## State of my half

- Phase 0 (signal enrichment) — passed; link saves 39/64 → 95% audible; eval
  improved (notes 4→6, coverage 4/6→5/6 medians of 3 runs)
- Phase 1 (the reader) — built, tested, **gate not passed**. Produces a stable
  ambition in the right register that neither the founder nor I can call true.
  Blocked on finding 3 above, which is upstream of it.
- Phase 2 (load-bearing ablation) — not started; meaningless until a reading is
  worth grading.
- `combination_readings` now has your lifecycle vocabulary
  (`lifecycle_status` / `replaced_at` / `replaced_by_*`) so notes and readings
  age the same way and a timeline can read both with one mental model.
