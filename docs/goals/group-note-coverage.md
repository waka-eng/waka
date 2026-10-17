# Goal: every member reachable on a group board

Status: answered — group triggers were ranked by what a signal is worth alone (2026-07-31)
Branch: `goal/group-note-coverage` (from `feat/delete-room`, not `dev` — see Log)
Follows: US-053 (group Top of Mind synthesis)

## Why

On the Waka board, two of six members hold **zero** evidence rows across all six
notes. One of them, agikee, has twelve signals, all shared, all embedded, and the
**highest mean cross-member similarity in the group** (0.808). They are not
missing for want of material.

Running the real judge over five of agikee's signals as triggers:

```
[1/5] no note (unclear_pattern)
[2/5] no note (unclear_pattern)
[3/5] NOTE  cites {"Yunji":2,"agikee":1}
[4/5] no note (unclear_pattern)
[5/5] no note (unclear_pattern)
```

The judge refuses four of five. It never reaches `restatesASingleMember` — the
filter originally blamed for this. When it does produce a note, agikee is cited.

The likely reason is in the shape of the similarity, not the size of it:

| member | best cross-member match | mean |
|---|---|---|
| 젭재규 | **1.000** | 0.789 |
| Jae Gyu Lee | **1.000** | 0.796 |
| Yunji | 0.916 | 0.796 |
| **agikee** | 0.916 | **0.808** (highest) |

The members who reach the board have at least one near-exact cross-member
pairing to build on. agikee is related to everything moderately and to nothing
sharply. Their eight candidates arrive as a warm blur, and `unclear_pattern` is
the correct reading of a warm blur.

So this is a **retrieval** problem: the question handed to the judge is
badly formed for a diffusely-connected member. The judge's bar is doing its job.

## What this goal will not do

The temptation is to lower the bar until agikee appears. That trades the one
thing a group note claims — that the connection is real — for a coverage number.
Off limits:

- the judge prompt's refusal criteria
- `restatesASingleMember` and its 0.82 threshold
- the ≥2-distinct-owners rule
- `TARGET_NOTES` as a quality gate

If, after better retrieval, agikee's saves still do not combine, **that is the
answer**, and the follow-on work is to say so on the board rather than to
manufacture a note.

## Approach

Variants are **options on the retrieval function**, defaulted to today's
behaviour — not env vars, not branches — so one eval process can sweep them
against one group. Losing options are deleted when a winner is chosen.

```ts
// packages/api/src/lib/wow-candidates.ts
export interface GroupRetrievalOptions {
  /** Candidate slots the trigger's own owner may fill. Today: perMemberCap (3). */
  triggerOwnerSlots?: number;
  /** Seed the pool with the strongest cross-member match, then fill around it. */
  pairFirst?: boolean;
}
```

## Phases

### Phase 1 — Instrument the eval (no API calls)

`tools/group-reading-eval.ts` already reports refusal mix and pairwise
distinctness. It cannot report the number this goal is about.

Add: **coverage** (map each judgment's `relatedInspirationIds` to owners; report
distinct members cited and per-member evidence counts), a `--variant` flag, and
one machine-readable summary line so runs diff cleanly:

```
VARIANT=baseline notes=6/24 coverage=4/6 overlap=0.31 refused={unclear_pattern:14}
```

**Gate:** the line prints, and coverage on a hand-checked case matches a manual
count. Instrumentation that is itself wrong makes every later number worthless.

### Phase 2 — Baseline, twice (~48 calls, ~$0.10)

```bash
pnpm tsx tools/group-reading-eval.ts --group <waka> --variant baseline
# then with the per-member cap change reverted:
pnpm tsx tools/group-reading-eval.ts --group <waka> --variant pre-cap
```

The second run audits a change already shipped: the per-member cap moved from
half the slots to a third, and the trigger's owner was charged for the trigger.
That was done on an inference that this goal's evidence has since contradicted.

**Gate:** if `pre-cap` beats `baseline` on coverage **and** distinctness, revert
that change before continuing, and record it.

### Phase 3 — Implement both variants (no API calls)

**3a. `triggerOwnerSlots`** — in `diversifyAcrossMembers`, seed `counts` with the
trigger's owner already partly spent. The trigger speaks for that member; slots
filled with more of their own signals are slots not spent on the other side of
the combination.

**3b. `pairFirst`** — in `findGroupWowMomentCandidates`, find the highest-scoring
candidate belonging to a *different* member, place it first, then rank the
remainder by similarity to the **midpoint** of trigger and partner rather than to
the trigger alone. A spine instead of a cloud.

**Gate:** deterministic unit tests pass without the model — trigger owner never
exceeds its slot budget; the pool contains the best cross-member match when
`pairFirst` is set.

### Phase 4 — Sweep (~96 calls, ~$0.20)

```bash
for v in baseline owner-cap pair-first both; do
  pnpm tsx tools/group-reading-eval.ts --group <waka> --variant $v
done
```

The representation-budget idea (keep judging until every member has been asked)
needs no code to measure: the eval already spreads triggers per member, so its
coverage number *is* that change's effect. Build it only if the sweep shows
coverage is trigger-starved rather than judge-refused.

**Gate — a variant ships only if all three hold against baseline:**

| | |
|---|---|
| coverage | **up** |
| overlap | **≤ baseline + 0.03** |
| notes produced | not down by more than 1 |

Coverage up *and* overlap up means the notes got vaguer. That is the regression
this goal exists to avoid; stop there.

### Phase 5 — Confirm on a second group (~24 calls, ~$0.05)

Re-run the winner against `builders`. A result tuned to one board is not a
result.

**Gate:** direction of change holds. Magnitude may differ.

### Phase 6 — Lock in and clean up

- Winning option becomes the default; **losing options deleted**
- Invariant tests into the DB-backed suite CI runs
- Commit carries the before/after numbers in its message

## Budget

~170 judge calls, ~$0.40 at `gemini-3.1-flash-lite` ($0.25/1M in, $1.50/1M out;
measured prompt ≈ 5,600 input tokens). Stop and report if any phase runs past
double its estimate.

## Acceptance criteria

- Coverage on the Waka board rises, with distinctness no worse
- The direction holds on a second group
- No change to the judge's prompt, `restatesASingleMember`, the two-owner rule,
  or `TARGET_NOTES`
- Losing variants deleted, not left as configuration
- Before/after numbers recorded in `## Log`
- **Or:** a recorded finding that better retrieval does not help, which closes
  this goal honestly and opens a different one

## Log

### 2026-07-30 — branch base

Branched from `feat/delete-room` rather than `dev`. The per-member cap change
Phase 2 exists to audit (`84fb34e`) is not on `dev`; branching there would make
that phase unmeasurable.

### 2026-07-30 — Phase 1: instrument the eval — PASS

Added per-member evidence attribution, `--variant`, and a machine-readable
summary line to `tools/group-reading-eval.ts`.

Gate was: the line prints, and coverage matches a hand count.

Hand count of the persisted Waka board, straight from SQL:

```
  JQ               2 evidence  in  2 notes
  Jae Gyu Lee      1 evidence  in  1 notes
  Se One Park      0 evidence  in  0 notes
  Yunji            9 evidence  in  6 notes
  agikee           0 evidence  in  0 notes
  젭재규              6 evidence  in  6 notes
  coverage: 4/6 members
```

Instrumentation check, 6 triggers (~$0.013):

```
VARIANT=instrument-check notes=2/6 coverage=2/6 overlap=0.20 worst=0.20 refused={unclear_pattern:4}
```

Coverage agrees with its own per-member breakdown (2 members non-zero), and the
shape matches the board: Yunji dominant, agikee zero. The eval cannot reproduce
the persisted board exactly — different triggers, non-deterministic judge — so
the check is internal consistency plus agreement in shape.

Spent so far: ~$0.013 of ~$0.40.

### 2026-07-30 — Phase 2: baseline, twice — PASS (do not revert)

```
VARIANT=baseline notes=7/22 coverage=6/6 overlap=0.17 worst=0.50 refused={unclear_pattern:15}
VARIANT=pre-cap  notes=5/22 coverage=5/6 overlap=0.15 worst=0.33 refused={unclear_pattern:17}
```

| | baseline (cap ⅓, trigger charged) | pre-cap (cap ½, trigger free) |
|---|---|---|
| coverage | **6/6** | 5/6 |
| notes | **7** | 5 |
| overlap | 0.17 | **0.15** |

Gate was: revert the cap change if `pre-cap` beats baseline on coverage **and**
distinctness. It does not — it loses a member and two notes to gain 0.02 of
distinctness, inside the tolerance the goal already set at +0.03.

**The cap change stays.** I had expected this to go the other way and was ready
to revert it; the measurement says it earned its place. It did not, however, fix
what it was aimed at: agikee holds 1 evidence row in *both* runs. What it
actually recovered was Se One Park, 0 → 1.

**Unexpected finding, and it moves the goal.** Coverage here is 6/6 — every
member reachable, including agikee. The persisted board shows 4/6. The
difference is that this eval asks every member's triggers, while production
stops at `TARGET_NOTES = 6` the moment six notes exist. The eval produced its
seventh note at trigger 22.

So the board's missing members may be **trigger-starved rather than
judge-refused** — asked too late in a pass that had already stopped. That is the
condition the goal named as the trigger for building the representation budget,
and it points at a cheaper, safer fix than either retrieval variant, since it
changes nothing about what qualifies as a note.

Caveat before acting on it: this eval orders triggers **blocked by member**
(all of member 1's, then member 2's), while production **round-robin
interleaves** them. So the two do not fail in the same order, and the eval's
coverage is "if everyone is asked", not "what production does". Phase 3 adds
coverage-at-`TARGET_NOTES` so the next runs measure production's actual
stopping point instead of inferring it.

Spent so far: ~$0.11 of ~$0.40.

### 2026-07-30 — Phase 2b: coverage at production's stopping point

```
VARIANT=baseline-covAtTarget notes=8/22 coverage=6/6 covAtTarget=5/6 overlap=0.17 refused={unclear_pattern:14}
```

Stopping at `TARGET_NOTES` costs one member here: 6/6 → 5/6. Real, but it does
not explain a board sitting at 4/6.

And it likely **overstates** the cost in production. This eval orders triggers
blocked by member; production round-robin interleaves them, so production asks
every member inside its first six triggers. On that ordering, stopping early
should cost production *less* than it costs the eval.

Which points somewhere the goal did not: **the current code already reaches all
six members, and the persisted board is stale.** It was generated before the
per-member trigger fix and the cap change, and nothing has re-run synthesis
since. Three runs at 6/6 with the code as it stands, against a board frozen at
4/6, is consistent with that and not much else.

Retrieval variants therefore look unwarranted. Coverage is not the failure any
more — 6/6 in every run. What remains is **depth**: agikee holds 1 evidence row
against Yunji's 14. That is being reached, not being central, and it is a
different question from the one this goal was opened to answer.

Two decisions needed before Phase 3, both the owner's:

1. **Regenerate the Waka board** to confirm. This is the real product outcome
   and the only way to prove the staleness theory — but a refresh deletes the
   six existing notes, so it is not mine to trigger unasked.
2. **Does 1 evidence row count as represented?** If depth matters, the goal
   should be reopened around it rather than continued as written.

Spent so far: ~$0.16 of ~$0.40.

### 2026-07-30 — regenerated the board: theory wrong, and the eval is unsound

Snapshotted the board first (6 notes, 18 evidence rows), then ran a real
refresh with current code. 125s, 4 notes.

```
  Yunji            5 evidence  in  4 notes
  젭재규              4 evidence  in  4 notes
  Jae Gyu Lee      3 evidence  in  3 notes
  JQ               0 evidence  in  0 notes
  Se One Park      0 evidence  in  0 notes
  agikee           0 evidence  in  0 notes

  coverage: 3/6 members   (was 4/6 with 6 notes)
```

**The staleness theory is dead.** Regenerating made the board *worse*, not
better: 4/6 → 3/6, six notes → four.

**And it shows the eval does not model production.** The eval counts a reading
whenever the judge returns `isWowMoment`. Production then applies two more
gates before anything reaches a board:

```
group-top-of-mind-synthesis.ts:379   if (distinctOwners.size < 2) continue;
group-top-of-mind-synthesis.ts:387   if (await restatesASingleMember(db, judgment, owners)) continue;
```

So every eval number so far is **optimistic and not comparable to a board**.
"6/6 coverage, 8 notes" was 6/6 coverage of judgments, several of which
production discards. The real figure is 3/6 and four notes.

Phase 1's gate was written to catch exactly this — "instrumentation that is
itself wrong makes every later number worthless" — and it did not, because I
checked the coverage arithmetic against itself and against a SQL count, never
against what production does with the same judgments. Checking a measurement
for internal consistency is not the same as checking it measures the thing.

This also revives the first hypothesis, which I dropped after seeing
`unclear_pattern` dominate: `restatesASingleMember` and the two-owner rule may
be discarding real notes after all. Both mechanisms can be true — the judge
refuses many triggers *and* the survivors get filtered.

**Phase 1 reopens.** The eval must apply production's post-judge gates and
report what survives them, not what the judge said. Every baseline is re-run
after that; the numbers above are void as comparisons.

Board left regenerated for now; snapshot is restorable on request.

Spent so far: ~$0.26 of ~$0.40.

### 2026-07-30 — Phase 1 redone, and refresh was destroying notes

Board restored from snapshot first: 6 notes, 18 evidence rows, 4/6 — verified
identical to the pre-regeneration hand count.

Eval now models production rather than the judge:

- applies the two-owner gate and `restatesASingleMember`, reporting what each
  discards (both exported from synthesis for the purpose)
- uses production's own `loadTriggerSignals` instead of a re-implementation —
  the old version blocked triggers by member while production round-robins, so
  the two were not even asking the same questions in the same order

```
VARIANT=baseline-v2 notes=6/24 coverage=6/6 covAtTarget=6/6 overlap=0.16
  refused={unclear_pattern:16,invalid_judge_json:1} discarded={single_owner:1}
```

Six notes, not the eight the unsound version reported. But production's real
regeneration produced **four**, and the remaining gap turned out not to be
noise.

**`refreshGroupTopOfMind` deletes the readings a pass re-confirms.** When a
judgment re-derives an existing note it hits the `(group_id, idempotency_key)`
unique index, `onConflictDoNothing` returns no row, `persistGroupNote` reports
`existing`, and `notesCreated` is not incremented. That note is still in
`priorNoteIds`, so the prune deletes it. The reading was found again and thrown
away for it.

The more stable a group's readings, the more notes each refresh destroys. This
is why regenerating took the board from six notes to four, and it is mine — I
rewrote that prune to use ids instead of a timestamp and preserved the flaw.

Fixed: synthesis now reports `reconfirmedNoteIds`, and the prune keeps them.

Note this is a **different failure from the one this goal was opened about**.
Coverage on a fresh pass is 6/6 in the eval. What the board showed was partly
retrieval and partly refresh eating its own output.

Spent so far: ~$0.31 of ~$0.40.

### 2026-07-31 — refresh fix confirmed

Re-snapshotted, then regenerated with the fix in place.

```
notes: 6 -> 6
  survived from before: 2   newly created: 4
  (before the fix: 6 -> 4)
```

**The refresh bug is fixed.** Two notes were re-derived by this pass and kept;
under the old code those are exactly the notes that would have been deleted for
having been found again. No notes lost, where the previous run lost two.

Coverage, however, has not moved:

```
  Yunji            8 evidence  in  6 notes
  젭재규              6 evidence  in  6 notes
  Jae Gyu Lee      3 evidence  in  3 notes
  JQ               1 evidence  in  1 notes
  Se One Park      0 evidence  in  0 notes
  agikee           0 evidence  in  0 notes

  coverage: 4/6 members
```

So the two bugs found on the way here — the trigger-fairness regression and
refresh eating its own output — were real and are fixed, and **neither was the
thing this goal was opened to answer.** agikee is still absent from the board.

The eval and the board still disagree: 6/6 there, 4/6 here. The known fidelity
gaps are closed (production's gates, production's trigger selection), so what
remains is either run-to-run variance in the judge or a difference the eval
still does not model. That is the next thing to settle, and it must be settled
before any retrieval variant is worth building — a variant measured against an
eval that cannot predict the board would tell us nothing.

**Budget: ~$0.36 of ~$0.40 spent.** Not enough left to both close the eval gap
and run a sweep. Stopping here for a decision on whether to extend it.

### 2026-07-31 — traced every gate: the cause is variance

One pass, read-only, replicating production's loop exactly and logging what
happened to each of its 24 triggers:

```
  [ 3] JQ           CREATED  [JQ + Yunji + 젭재규]
  [ 7] 젭재규          CREATED  [젭재규 + Yunji]
  [ 8] agikee       CREATED  [agikee + Yunji]
  [10] Jae Gyu Lee  CREATED  [Jae Gyu Lee + Yunji + 젭재규]
  [12] Se One Park  CREATED  [Se One Park + Yunji]
  [21] Yunji        CREATED  [Yunji + 젭재규]
  [20] Jae Gyu Lee  EXISTING (already on the board)
  [22-24]           NOT ASKED (TARGET_NOTES reached)

  created: 6   coverage of created: 6/6
  outcomes: {"unclear_pattern":14,"existing":1,"not_asked":3}
```

**agikee produced a note here** — trigger 8, grounded with Yunji. So did Se One
Park. Coverage 6/6.

The production regeneration twenty minutes earlier, same code and same trigger
selection, created 4 notes covering 3/6 and neither of them.

**That is the answer. agikee is not excluded — the pass is noisy.** Coverage
swings between 3/6 and 6/6 across runs that differ only in what the model
happened to say. Every earlier reading here — the cap diagnosis, the staleness
theory, the eval/board gap — was a single sample of a process whose run-to-run
spread is larger than any effect being measured.

Two consequences.

**The sweep this goal planned cannot work as designed.** One run per variant
cannot distinguish variants when n=1 swings this far. Any variant would have
looked like a winner or a loser depending on the coin.

**The board keeps one sample of a noisy process, and refreshing replaces it.**
`TARGET_NOTES` cut off three triggers in this run — including agikee's and Se
One Park's, who happened to have already landed. On an unlucky ordering they are
cut off before being asked at all. A board that accumulated confirmed readings
instead of replacing them would converge upward; the reconfirm fix earlier today
is the first step toward that, and going further is a smaller and safer change
than anything in Phase 3.

Budget: ~$0.41 of ~$0.40, marginally over. Stopping here.

## Outcome

Closed with the original question answered, though not as the goal expected.

- **Answer:** agikee's absence is run-to-run variance plus an early stop, not
  structural exclusion. Their signals do combine — trigger 8 proves it.
- **Fixed on the way:** trigger fairness (a member could be starved by a global
  score-ordered LIMIT), and refresh deleting the readings it re-confirms.
- **Not built:** the retrieval variants. The evidence does not call for them,
  and the eval could not have judged them.
- **Next goal, if wanted:** make the board accumulate confirmed readings rather
  than replace them, and measure any future change over repeated runs rather
  than one.

### 2026-07-31 — the variance claim does not hold up

Asked whether the run-to-run swing was itself the thing to fix. Chasing that
undercut the claim.

Three checks:

1. **Sampling.** The judge already runs at `temperature: 0`.
2. **Trigger order.** Four back-to-back runs of production's own
   `loadTriggerSignals` produced the identical member order and the identical
   first eight triggers.
3. **The judge on a fixed input.** Same trigger, same candidates, judged three
   times: `unclear_pattern` all three.

So the pipeline is more deterministic than "coverage swings 3/6 to 6/6" implied.
That sentence was written off two runs whose *board state differed* — the trace
ran after the regeneration, against a board holding different notes, so a
judgment that counted as `created` in one was `existing` in the other. Different
bookkeeping, not necessarily a different judge.

**I over-claimed.** Production created 4 notes and the trace created 6, and I
called the gap noise without isolating it. The likelier explanation is the
`created` vs `existing` accounting, which the reconfirm fix changed underneath
me between the two runs.

Fixed regardless, because all three are wrong on their own terms:

- `loadMemberUserIds` had **no `ORDER BY`**. Its order decides the round-robin,
  which decides who is asked before `TARGET_NOTES` ends the pass. Stable today
  by luck of a small table and a sequential scan; not stable as it grows.
- Trigger and candidate reads ordered by `(wowScore, createdAt)` with **no
  tie-breaker**. Equal rows could swap between passes.

Both now order by `id` last, so a pass is reproducible.

**Still open:** why one pass created four notes and the next created six. That
is the question, and it deserves an experiment designed for it — same board
state, same code, repeated — rather than another inference off two runs that
differed in more than one way.

### 2026-07-31 — A/A test: the judge is stable, the plumbing is not

Identical read-only pass twice, 18 triggers, nothing written between them.

```
  trigger  owner          pass A                    pass B
        3  JQ            NOTE:JQ+Yunji+젭재규        no:invalid_judge_json     <-- DIFFERS
        9  JQ            no:unclear_pattern        threw                     <-- DIFFERS
  (16 of 18 identical)

  notes: A=5  B=4      triggers differing: 2/18
```

**The judge does not change its mind.** Sixteen of eighteen agree exactly,
including every note it made and every reason it refused. The two that differ
are not disagreements — they are a malformed response and a thrown request.

**And a malformed response costs a note permanently.** `invalid_judge_json` is
*returned as a judgment*, not thrown, so `judgeGroupWithRetry` never saw it:
`isTransientModelError` only matches HTTP 5xx/429 on a caught error. *(Both are gone since: `judgeGroupWithRetry` went with the group engine in `1072f566`, and `isTransientModelError` was removed on 2026-10-17. Background jobs now retry any thrown model error through the queue's backoff.)* The trigger
was dropped as though the judge had declined it. It had not — we could not read
the reply, and the note it was about to make was gone. Trigger 3 is exactly
that: a real note in one pass, silence in the next.

That is where a board's coverage was moving between refreshes. Not the model
being noisy about what combines — the pipeline losing answers it had already
been given.

Fixed: a parse failure now retries on the same backoff as a 503, because it is
the same kind of event. Only a judgment we can actually read is treated as one.

Note the earlier "coverage swings 3/6 to 6/6" was still overstated: the real
per-pass loss here is one or two triggers, and the larger swing came from that
compounding with `TARGET_NOTES` cutting the pass at different points.

Spent: ~$0.52 against a ~$0.40 estimate — over, and authorised.

### 2026-07-31 — why Se One was unreadable

Se One has 14 shared signals. The pass tries 4 of them, and all four refuse.

Tried the other ten. **One produced `NOTE [Se One Park + Yunji]`.** The
combination exists; the pass never asks about it.

Which four get tried is decided by `wow_score` — how much a signal matters on
its owner's *own* board. Ranking Se One's fourteen both ways, the orderings are
close to inverted:

| | wow_score | best cross-member match |
|---|---|---|
| their #1 by score | 55 | **0.859 — their weakest** |
| the signal that works | **26 (13th)** | 0.894 (3rd) |

Direct test, same budget of four triggers:

```
  wow_score selection:      0 notes from 4 triggers
  cross-member selection:   1 note  from 4 triggers  →  NOTE [Se One Park + Yunji]
```

**This is the product's own premise, violated in the selector.** A signal's
meaning depends on what it sits next to. `wow_score` measures a signal alone, so
using it to pick group triggers asks "what matters most to you by yourself?"
when the question is "what of yours reaches someone else?". For a member whose
strongest personal signals happen to be their most solitary, the pass asks four
times and never once about the thing that would have connected them.

Fixed: group triggers are now ranked by best cross-member cosine, scanning
wider than the cap because the reaching signal can sit far down a member's own
list — Se One's sat thirteenth. Verified: their selection changed from
`55, 52, 52, 47` to `47, 34, 26, 46`, and 26 is the one that makes the note.

Note this is retrieval, exactly what the goal originally proposed — but arrived
at through a mechanism the plan never guessed, and aimed at trigger selection
rather than the candidate pool.

