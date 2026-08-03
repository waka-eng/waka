# Why the board says one thing — five hypotheses, five rejections

Findings from 2026-08-02/03. Read-only throughout: every experiment ran through
`tools/group-reading-eval.ts`, which calls the real judge and persists nothing.
Total spend under $1.

## The complaint

Waka's board produces readings that are all one idea — *physical rituals,
building beyond the screen* — and the founder's bar is that **a very obvious
synthesis does not need WAKA; anyone can make it themselves.**

## What was tested

| # | Hypothesis | Result |
|---|---|---|
| H1 | Each note is judged blind to the others, so every trigger lands on the strongest theme | **Rejected — it made things worse.** Showing the judge the board produced 3 → 9 notes, three of them character-for-character identical. Prior outputs act as exemplars, not exclusions. |
| H2 | One member dominates the material semantically | **Rejected.** Yunji ranks 4th of 6 on centrality (0.801 against a 0.795–0.815 spread). The apparent dominance is volume — 24 of 63 signals — not gravity. |
| H3 | Some members are inaudible, so it is really a two-person board | **Rejected.** Enrichment had already run; Se One's 13 bare links carry page text and 13 of her 14 saves are audible. |
| H4 | Trigger selection picks the most obvious pairing | **Rejected.** Re-ranked triggers by the surprising band of the room's own spread rather than by maximum similarity. Same theme, one fewer note. |
| H5 | The evidence pool around each trigger is concentrated | **Confirmed as a defect — rejected as the cause.** See below. |

## The one real defect found

Candidate ranking is `0.50 × wow_score + 0.25 × similarity + 0.20 × surprise +
0.05 × time`. **Half the weight is the candidate's own standing score**, which
says how much a signal matters on its owner's board and nothing about whether
it makes an interesting pair with *this* trigger.

Measured across 16 triggers × 8 candidates = 128 evidence slots:

| | shipped | standing score withheld |
|---|---|---|
| distinct signals ever used | **11 of 24** | 29 |
| mean overlap between two pools | **75%** | 34% |
| most-reused signal appears in | **16 of 16 pools** | 9 of 16 |

**Thirteen of twenty-four audible signals were never shown to the judge at
all.** Sixteen judgements, eleven signals, one board.

This is worth fixing on its own merits — a retrieval stage that shows the same
material regardless of the question is not doing retrieval. But it is **not the
cause of the collapse**, because:

## The result that closed the investigation

Withholding the standing score tripled the variety of evidence the judge saw —
and produced **the same two readings, word for word**:

- *"Building as a human ritual beyond the screen"*
- *"The shift from model performance to domain-specific deployment"*

Change 66% of the material, get the same sentences. Across all four arms the
judge also refused a near-constant **~85%** of triggers.

## What that leaves

Two explanations survive, and this round could not separate them:

1. **The judge converges by construction.** Its criteria produce the same
   shape of sentence from this room regardless of what it is shown.
2. **The room genuinely has one strong thing to say**, everything else
   correctly fails, and the product's honest output is one forceful reading —
   not six.

The intended control — run a second room through the same judge — was
inconclusive: the `builders` room has no audible shared signals at all, so
there was nothing to judge. **That is itself a finding: a two-member room with
nothing readable produces silence, and no surface says why.**

## What would separate them, cheaply

- **A synthetic room.** Assemble signals from deliberately unrelated domains
  and run the same pass. If the judge still says "physical rituals", it
  converges; if it says something about that material, the room is the answer.
- **The founder rubric on the two survivors.** Not a metric: could any of the
  four of you have written those two sentences by looking at the saves? If yes,
  they fail the bar regardless of how consistently they are produced.

## What not to do next

Four of five hypotheses were about the *pipeline*, and all four were wrong. The
next round should not be a sixth pipeline hypothesis. The remaining questions
are about the judge's criteria and about the material — and one of them can be
answered by four people reading their own saves, with no code at all.
