# WOW moment algorithm foundation

This document captures the current agreed shape for WOW moments. It replaces older visual architecture drafts that assumed separate outlier scoring or synchronous LLM generation.

## Persisted signals

- Every inspiration carries a persistent `importance_score` and `wow_score`.
- `wow_score` is a stored snapshot, not a value recalculated during list reads.
- Future workers update `wow_score` only when one of its constituent signals changes.
- There is no separate `OutlierScore`; outlier behavior is represented by WOW kind and by the same score pipeline as other moments.

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

This foundation slice does not generate WOW moments. Later slices will add:

- Gemini embeddings for inspiration similarity and bridge detection,
- signal updaters for `importance_score` / `wow_score`,
- an LLM generation step whose output includes title, kind, why/explanation, reflection question, and multiple related inspirations with roles/reasons.

The current API and UI only list/display persisted database rows when they already exist.
