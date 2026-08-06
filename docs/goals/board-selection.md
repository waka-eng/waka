# Goal: the wall is chosen, not accumulated

Status: proposed 2026-08-02. Not started.
Follows: `group-top-of-mind-synthesis.md`, `ambition-reading.md`

## Why

The board is currently whatever survived, in the order it happened to be judged.
`generateGroupTopOfMind` judges one trigger at a time, persists each accepted
note immediately, and stops at `TARGET_NOTES`. Nothing anywhere looks at the
six notes together and asks whether they are the best six.

So "the best set of top of minds" is not something the system fails at. It is
something it never attempts. Order of arrival decides the wall.

Measured on Waka, 2026-08-02: ten triggers produced three readings — *"Building
agency through physical rituals and data loops"*, *"Building as a physical
ritual beyond the screen"*, *"Building spaces where human agency meets AI"*.
One idea, three times, and no stage in the pipeline was ever in a position to
notice.

## What failed first, and why this is different

The obvious fix — let each note see the notes already on the board and refuse
to repeat them — was built and tested on 2026-08-02. It made things **worse**:
3 notes became 9, three of them character-for-character identical, collapse
excess 0.46 → 0.71, refusals 7 → 1. Prior outputs act as exemplars. A model
shown five notes writes a sixth that looks like them.

The lesson is not "diversity is impossible". It is that **the awareness cannot
live inside generation.** Each note must stay blind to the others so it stays
honestly grounded in its own evidence. The awareness belongs to a stage above
them that sees every candidate at once — and that stage should be arithmetic,
not a model.

Writers draft independently. An editor picks the wall.

## Shape

```
  triggers ──> judge ──> two-owner gate ──> restatement gate ──> CANDIDATES (~15)
                                                                      │
                                                          ┌───────────┘
                                                          ▼
                                                    SELECT k=6
                                            coverage × distinctness
                                                          │
                                                          ▼
                                                   persist, retire rest
```

Everything left of CANDIDATES is unchanged. The judge still decides whether a
reading is *true*; selection decides which true readings make the best *board*.

## Decisions

**Selection ranks, it never thresholds.** Both distinctness measures failed on
this board — lexical called it distinct at 0.08, embedding cosine ranked a
collapsed board and a plural one backwards. Neither can answer "is this board
collapsed?". Both can answer "is A further from B than from C?", which is all
greedy selection needs. Every absolute threshold in this design is a bug.

**Selection is pure and model-free.** Given candidates with embeddings and
owners, choosing k is a function. That makes it the first change in this area
that is unit-testable without a model call — everything tonight required a live
eval to learn anything.

**Generation stops being persistence.** Today `persistGroupNote` runs inside
the trigger loop. It moves after selection. This is the only structural change
and it is what makes a set exist at all.

**k stays 6, and the board always fills if it can.** Showing fewer when a room
genuinely has one idea is the right end state, and it needs a calibrated
"how different is different enough" that nobody has. Deferred deliberately —
see non-goals. Shipping selection without it is still strictly better than
arrival order.

## Phases

### Phase 0 — Separate generating from persisting

Pure refactor, no behaviour change, own commit. The trigger loop collects
surviving judgments into an array instead of writing each one; the writes
happen after the loop, in the same order, still stopping at `TARGET_NOTES`.

**Gate:** a pass produces a byte-identical board to today's on the same input.

### Phase 1 — The selection function

`selectBoard(candidates, k)` in its own module. Pure, no db, no model.

Each candidate carries: the judgment, its evidence owners, and one embedding of
`title + beliefStatement`.

Greedy, seeded by the strongest candidate, then repeatedly taking the candidate
that maximises

```
  gain(c) = w_new_member × (owners(c) not yet on the board)
          + w_distance   × (rank of c's distance from the selected set)
```

Distance uses **within-pass rank**, not raw cosine, so a tight room and a loose
room behave the same way — the same reasoning that makes `redundancyAgainst`
relative to `groupBaseline` rather than absolute.

Weights land in `scoring/` as named constants with rationale, and are pinned in
`algorithm-integrity.test.ts` like every other tuned number.

**Gate:** unit tests, no model calls —
- five near-identical candidates plus one distant one → the distant one is
  selected second, not sixth;
- a candidate covering an unrepresented member outranks a marginally more
  distant one that does not;
- selection is deterministic and order-independent: shuffling the candidate
  array yields the same board.

### Phase 2 — Wire it, and measure it for free

`generateGroupTopOfMind` runs its triggers to a candidate budget rather than
stopping at 6, embeds the candidates, selects, then persists.

The eval gains `--select first|best`, so one generation pass can be selected
**both ways** and the two boards printed side by side. Same candidates, same
judge calls, no extra model spend — the comparison is arithmetic.

**Gate:** on Waka, the selected board is read by the founder as covering more
distinct ideas than the arrival-order board built from the identical candidate
set. If it does not, the room is narrow and that is the finding — see below.

### Phase 3 — Honest fewer (deferred, needs Phase 2's evidence)

When the best available board is still one idea said six ways, the truthful
output is one reading plus the forming state `ambition-reading.md` already
specifies — not six padded notes. This needs a calibrated "different enough"
that does not exist yet. Phase 2 produces the labelled boards to calibrate it.

## Cost

Today a pass stops as soon as it has 6 notes, so it may run ~10 triggers.
Selection needs a pool, so it runs the full budget: roughly **2× the judge calls
per pass**, plus ~15 embedding calls (negligible next to a judge call).

Partly offset already: the audibility gate removes triggers that cannot produce
a note, and on Waka that was 10 of them.

If the cost bites, the lever is the candidate budget, not the selection — and
`MAX_TRIGGERS` already exists to turn it.

## What this does NOT claim

It does not explain why Waka's board is narrow. Three explanations were tested
and rejected on 2026-08-02: notes not seeing each other (made it worse), one
member being semantically central (Yunji ranks 4th of 6 at 0.801), and members
being inaudible (enrichment had already run).

Selection is worth building whether the room is narrow or not, because it is
correct in both cases: a room with four ideas gets four on the wall, and a room
with one gets the strongest expression of that one instead of the first six
attempts at it. **It removes arrival order from the answer, which is a defect
independent of everything above.**

The remaining untested explanation for the narrowness: the surprise-similarity
term peaks at 0.55 and reaches zero above 0.80, while Waka's pool sits at 0.804
— so the one mechanism designed to surface non-obvious pairings may be switched
off by this room's data. That is a separate goal, and it belongs to whoever
tuned those constants.

## Against agikee's and Q00's work

Checked deliberately, because this changes a loop they designed.

**Untouched:** `judgeGroupWowMoment` and the whole judge contract (agikee);
`wow-score.ts` constants (agikee); `activation.ts` and the spark engine (Q00).
Selection runs strictly after judgment and reads none of them.

**Complementary, not conflicting:** `diversifyAcrossMembers` (agikee) caps how
many *candidate signals* one member contributes to a single judgment. Selection
spreads *notes* across members. Different axis, same intent — theirs makes one
note fair, this makes the board fair. Their per-member cap comment already
names the failure mode this inherits: a member who seeds notes and appears in
none of them.

**Consistent with Q00's stance, with one caveat:** the spark engine's division
is "arithmetic proposes, judgment disposes." Selection has arithmetic disposing
— choosing among readings the judge already accepted. The precedent exists
(`restatesASingleMember` and the two-owner rule both reject judged notes on
non-model grounds), but Q00's stronger line is "only decisions become memory,"
and a discarded candidate would be a decision that never becomes anything.

**Resolution, and it improves the design:** persist every candidate, and mark
the unselected ones retired rather than dropping them. Phase 0 of
`room-timeline` already made retirement a first-class state, so this costs
nothing new. Every judged reading becomes memory; the wall shows the chosen
ones; the timeline gains the readings the room considered and did not keep,
which is a truer record than one that only remembers what won.

### The real regression risk: re-confirmed notes

`refreshGroupTopOfMind` retires the previous generation *except* notes this
pass re-derived (`reconfirmedNoteIds`), because a reading reached again has
been confirmed, not superseded. The comment records what it cost to learn:
"Refresh took the board from six notes to four that way."

Selection breaks this if written naively. A re-confirmed note that selection
does not pick would fall out of `reconfirmedNoteIds`, be treated as stale, and
be retired — reintroducing exactly that bug, and worse, making the board churn
between refreshes for reasons no one can see.

**Required:** a re-confirmed note stays on the board. Either selection seeds
its board with re-confirmed notes before choosing the rest, or the retirement
step keeps them regardless of selection. The first is better — it means a
stable reading holds its place and selection fills the remainder, which also
makes the wall calmer between passes.

### The one real cost regression

`MAX_TRIGGERS` and `TARGET_NOTES` exist to bound model calls per pass, and
stopping at 6 notes is part of that bound. Selection needs a pool, so it spends
the fuller budget — roughly 2× the judge calls. That is a deliberate reversal of
a cost decision agikee made, it is the only one here, and it should be their
call rather than assumed.

## Non-goals

- Weakening the two-owner rule, the restatement filter, or any judge refusal —
  selection runs strictly after them and can only choose among readings those
  gates already accepted.
- Telling the judge about other notes. Tested, rejected, documented above.
- Re-tuning `SURPRISE_SIMILARITY_*` or anything else in `scoring/` as part of
  this work.
- Showing fewer than k. Phase 3, and only with calibration.
