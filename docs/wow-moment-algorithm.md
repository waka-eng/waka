# WOW moment algorithm foundation

This document captures the current agreed shape for WOW moments. It replaces older visual architecture drafts that assumed separate outlier scoring or synchronous LLM generation.

## Persisted signals

- Every inspiration carries a persistent `importance_score` and `wow_score`.
- Scores are normalized internally to the inclusive `0..1` range.
- Persisted integer score columns may store normalized scores as `0..100` values by rounding `score * 100`.
- `wow_score` is a stored snapshot, not a value recalculated during list reads.
- Update rule: workers update `wow_score` only when one of its constituent signals changes (`importance`, top similarity, top surprise similarity, or time distance). If those signals do not change, the stored `wow_score` stays unchanged.
- There is no separate `OutlierScore`; outlier behavior is represented by WOW kind and by the same score pipeline as other moments.

## Score formulas

All inputs to weighted formulas are clamped to `0..1` before calculation, and every output is clamped to `0..1`.

```text
ProcessingScore = hasReflection ? 1 : 0

ContentDepthScore = 0.70*TextDepth + 0.30*ContextScore

RevisitScore = 0.65*UniqueRevisitDays
             + 0.25*TotalRevisitCount
             + 0.10*RevisitedInLast7Days

ImportanceScore = 0.40*ContentDepth
                + 0.25*Processing
                + 0.25*Revisit
                + 0.10*TimeSignal

WowScore = 0.45*Importance
         + 0.25*TopSimilaritySignal
         + 0.20*TopSurpriseSimilaritySignal
         + 0.10*TimeDistanceSignal

RuntimeCandidateScore = 0.50*WowScore
                      + 0.25*SimilarityToTrigger
                      + 0.20*SurpriseSimilarityToTrigger
                      + 0.05*TimeDistanceToTrigger
```

`RuntimeCandidateScore` is a request-time ranking helper for candidates relative to a trigger inspiration. It is not the same as persisted `wow_score`.

## WOW kinds

A persisted WOW moment has exactly one `WowKind`:

- `recurrence`
- `bridge`
- `surprise_bridge`
- `tension`
- `outlier`

## Related inspirations

A WOW moment may reference multiple inspirations. Each relation stores:

- the related inspiration id and displayed text,
- the role that inspiration played in the moment,
- the reason it belongs in the moment.

The user-facing explanation should answer both: why is this a WOW moment, and how do these inspirations participate?

## AI generation scope

The current bounded judge slice retrieves a trigger plus top candidate inspirations with `findWowMomentCandidates`, sends only that trigger + retrieved-candidates block to `judgeWowMomentForInspiration`, and can explicitly persist an accepted existing judgment via `persistWowMomentForInspirationJudgment`. Candidate retrieval itself may still select and score candidates from the user's tenant-scoped candidate pool before producing that bounded block for LLM judging/persistence.

Persistence remains caller-controlled: `POST /inspirations` and background workers still do not automatically generate or persist WOW moments. The helper no-ops for `{ isWowMoment: false }`, validates tenant ownership, re-checks related ids against the trigger plus retrieved candidates, derives a durable `idempotency_key` from version + user id + trigger inspiration id + WOW kind + sorted unique related inspiration ids, conflict-safely inserts/reselects one `wow_moments` row, and inserts deduped `wow_moment_inspirations` rows with the trigger at role `trigger`/sort `0` and other bounded related inspirations at role `related`/sort `>0`.

Later slices will add:

- Gemini embeddings for inspiration similarity and bridge detection,
- signal updaters for `importance_score` / `wow_score`,
- an explicit route or background worker trigger for generation/persistence when product behavior is approved.

The current API and UI only list/display persisted database rows when they already exist.
