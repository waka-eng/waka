# Goal: a combination names what it wants

Status: in progress — Phase 0 passed with one criterion amended (2026-08-01)
Branch: `goal/ambition-reading`
Follows: group-note-coverage (2026-07-31)
Decided by founder, 2026-08-01: ambition above notes · graded load-bearing

## Why

The board's output today is themes: "Deployment as the new product frontier."
That is a newsletter about what the signals discuss. The vision's output is an
ambition — *what impact you want to make, who you want to build it with, where
you need to be* — and it is singular: "this specific combination of four hearts
made **an** ambition visible that none of our collections could reveal alone."

The personal pipeline already speaks this language (`ambitionDimension`,
`matchedEnvironment`, `antiEnvironment`). The group pipeline — where the vision
locates the revelation — does not. The judge is asked what the signals have in
common that is non-obvious; it is never asked what the combination *wants*.

## Shape

Notes stay as the grounded evidence layer, unchanged in their integrity rules.
Above them, **one reading per combination**:

```
WHAT THIS COMBINATION WANTS
"To build physical rooms where AI meets ritual — together, offline."
  the pace · what it refuses     ▾ grounded in 5 readings
─────────────────────────────────────────────────────────
notes (evidence layer, exactly as today)
```

Introduces `combinations` as a first-class object now (a room is a combination
with `origin='room'`), so `combination-as-an-act` extends origins instead of
migrating tables twice.

```
combinations:          id, member_set_hash, origin, created_by, created_at
combination_readings:  combination_id,
                       -- the reading itself
                       ambition_text,                  -- ONE dissolved statement, their words
                       facets,                         -- OPTIONAL, 0-3, each {dimension, text}:
                                                       -- the reading NAMES its own dimension.
                                                       -- Absent facets flow into whats_missing,
                                                       -- never padded
                       away_from,                      -- the refusal half of a want
                       tension,                        -- combining ≠ agreeing; name it
                       next_question,                  -- "which actions are worth taking"
                       -- honesty layer
                       state(revealed|forming), whats_missing,
                       member_grades,                  -- load-bearing ablation
                       reconfirmed_count,              -- passes that re-derived this reading
                       -- texture layer
                       pulse_profile,                  -- reaction vs composition mix of evidence
                       evidence_span,                  -- earliest→latest grounding signal
                       -- grounding + provenance
                       grounded_note_ids, member_quotes,
                       locale, model, prompt_version, signal_set_hash,
                       created_at
```

Facet optionality is load-bearing: mandatory facets would recreate the stacking
anti-pattern the personal board already corrected — padded summaries instead of
one dissolved observation. So is facet OPENNESS, learned the hard way: the first
cut fixed three columns (impact / people / place), which asserted that every
want has an effect, a who and a where. Many do not — a combination can be after
a standard of craft, a pace, a material, an audience, a question nobody asks —
and a reading handed only three boxes stayed silent about the dimension it could
actually see, which then read as thin evidence rather than a wrong schema. And the vocabulary should rhyme
with `signal_packets` (impliedValues / worldviewClaims / tensions /
emotionalCharge / decisionRelevance) rather than invent a parallel one: packets
are the per-signal form of the same questions.

## Phases

### Phase 0 — Signals must be audible

Many saves are bare URLs. The heart reacted to something *inside* that link;
the pipeline embeds the wrapper. Se One was hard to read partly because their
heart's objects were never transcribed.

Enrichment worker: fetch title/description/og (oEmbed for YouTube), store as
enrichment text, re-embed as `user text + enrichment`. Backfill shared signals.

**Gate:** ≥90% of Waka's and builders' shared signals carry ≥120 chars of
audible text; re-run the eval — coverage and refusal mix must not regress
(3 runs, medians; A/A transport variance ≈ 1–2 triggers is known noise).

### Phase 1 — The ambition reader

A second judge stage over a combination's **accepted notes + owner-labeled
evidence** (not raw signals — the integrity layer feeds it):

- Returns `{ambition, facets, groundedNoteIds}` — or an honest
  `{state: "forming", whatsMissing}`. Forming is not silence: it names what is
  thin ("two hearts have combined; two haven't been readable yet").
- **In their words**: must quote or closely trace member signals; ≥2 members'
  evidence cited.
- **Trace test** (per the top-of-mind voice rule): the ambition must dissolve
  the notes, not stack them — enforced by a lexical-overlap cap against note
  titles.
- Pulse annotation: evidence saved fast (`captureElapsedMs`) is labeled a
  *reaction*, slow a *composition*, in the reader's payload. The heartbeat
  finally feeds the reading.

**Gate:** founder rubric on Waka + builders: does it read as "what we want,"
not "what our links discuss"? Stable in substance across 3 runs. Refusal to
publish junk is a pass, not a fail.

### Phase 2 — Load-bearing grades

Ablation on the reading (not per-note — bounded): re-run the reader once per
cited member with that member's evidence removed; the member is **load-bearing**
if the ambition collapses or materially changes. Store grades on the reading.

Cost: cited-members × 1 call per reading, capped at 8 ablations (sample beyond).

**Gate:** grades on Waka match founder intuition on the obvious cases; stable
across 2 runs.

### Phase 3 — Surfaces

- The reading renders above the wall; forming-state honest; member chips ●/○.
- ~~The signature reveal~~ — **dropped 2026-08-01: already shipped** by the
  concurrent session (`fddc247`, `signal-readings.ts`), and better than planned
  here: it generates nothing, only arranging belief statements the judge
  already wrote, and enforces the room-membership visibility contract inside
  the module rather than at the route.

**Gate:** browser-verified on localhost, both surfaces.

## What this goal will not do

- Weaken the two-owner rule, the restatement filter, or refusal criteria — the
  reading sits *on top of* the integrity layer, never instead of it.
- Add counts, badges, or streaks anywhere.

## Budget

Reader ≈ notes+evidence prompt ≈ judge-scale (~$0.003/call). Reading + 8-way
ablation ≈ $0.03. Development + repeated-run gates ≈ $1.50. Ongoing: +$0.03
per refresh on top of today's ~$0.05.

## Acceptance

- Waka's board shows an ambition reading grounded in its notes, in the group's
  own words, with load-bearing grades — or an honest forming state.
- The same-signal-two-readings surface exists.
- Every algorithm gate measured over ≥3 runs, medians, against the
  production-faithful eval.

## Log

### 2026-08-01 — branch base

Branched from `goal/hearts-roadmap` (not `dev`): the retrieval fixes and eval
this goal depends on are not on dev yet.

### 2026-08-01 — Phase 0: signals must be audible — PASS, criterion amended

Built: `signals.enrichment` + `enriched_at` (migration 0035), fetcher (og/
title/description, oEmbed+HTML for YouTube, browser UA after the honest bot UA
got stripped pages, 1.5MB read window after YouTube's og tags turned up 690KB
deep), wiring into the async save path, backfill tool. The no-regression
guarantee is byte-pinned: un-enriched rows produce a character-identical
canonical input, so nothing regenerates until a row gains words (test enforces
this by exact string equality).

**Audibility.** 39/64 (61%) → 52/64 (81%) as written — FAIL against the ≥90%
bar. But 11 of the 12 remaining are pure-text saves: the person's own complete
words ("Context is moat. Software is ephemeral.", 39 chars). The criterion's
stated rationale was bare URLs embedding as mute wrappers; padding a person's
own aphorism to 120 chars would violate the deeper rule that saving IS the
signal. **Link saves: 18/19 = 95%.** I amended the criterion to
*audibility applies to link saves* (95% ≥ 90% passes) and said so before
continuing; the founder replied "continue goal" rather than ruling on it
explicitly. Flagged here rather than banked as approval — the as-written
number (81%, FAIL) and the reason it mismeasures are both above, so the
amendment can be reversed on a word.

**No-regression (medians of 3 runs, identical frozen eval):**

| | pre-enrich | post-enrich |
|---|---|---|
| notes | 4 (5,2,4) | **6** (7,6,6) |
| coverage | 4/6 (4,3,4) | **5/6** (5,5,5) |
| unclear_pattern | 20 | **17** |
| overlap median | 0.08 | 0.18 |
| overlap worst pair | 0.25 | 0.71 |

Coverage and refusal mix improved; run-to-run stability improved sharply
(coverage variance collapsed to zero). Flagged honestly: distinctness moved the
wrong way — richer audible text on several similar YouTube saves produces
sibling readings, worst pair at 0.71. Below the 0.45-collapse threshold on
median, and the board read-path dedupes, but Phase 1's rubric watches this.

One member remains uncovered in all three post runs; the background capture
kept only summary lines, so identity goes unverified until the Phase 1 review
runs (eval summary gains `missing=` now that the frozen comparison is over —
also unfreezing the eval to route through `judgeGroupWithRetry`, so it stops
showing parse failures production retries away).

Spend this phase: ~48 baseline + ~72 post trigger-judgments ≈ $0.28.

### 2026-08-01 — Phase 1: the ambition reader — BUILT, GATE NOT PASSED

The reader works, is deterministic, and produces something in the right
register. Three defects were found and fixed by running it against Waka:

- It built the ambition out of **verbatim quotes** of members' saves. That is
  the voice rule one layer up — a top-of-mind must dissolve its saves, not
  stack them. The prompt conflated "sound like them" with "cite them"; those
  are now separate, with a guard rejecting quotation marks or any 24+ character
  run lifted from a save. Shared vocabulary passes; borrowed phrasing does not.
- Removing the quotes removed the anchor and the reader began **drifting
  between English and Korean** across runs at temperature 0. The locale was in
  the payload but nothing told the model to obey it.
- The first real run **crashed on a missing field**: the response schema marked
  only `state` required, the model omitted `groundedNoteIds`, and a good
  reading was discarded. Grounding is now derived — a note grounds a reading
  when the reading quoted evidence that note rests on, which was already known.

**Then the finding that stops this phase.** The reading kept coming out at
domain level ("moving beyond screen-bound software to build physical,
context-rich rituals"). I assumed thin inputs and widened its evidence from the
8 note-grounding signals to all 63 shared signals. **Identical output.** It was
not underfed.

Waka's five active notes share a mean pairwise word overlap of 0.08 — which the
eval reports as "readings are distinct from one another." Read them, and they
are five phrasings of *physical versus screen*. **The board is semantically
collapsed while passing the collapse test**, because the test counts shared
words and these share none.

So the reader is faithful and the board is narrow. Nothing downstream of these
notes can be more specific than they are, and no amount of prompt work here
changes that. The gate stays unpassed rather than banked.

**Next, in order:** replace the eval's lexical distinctness with embedding
cosine so semantic collapse is visible; find why synthesis produces five
phrasings of one idea; only then re-run this gate. Divergence weighting is
wired but inert — the divergence pass has never run on Waka (0 scored rows).
