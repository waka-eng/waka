# Goal: one shift a day, and proof the loop is real

Status: in progress (2026-08-31)
Branch: `goal/one-shift-a-day`
Authored from the founder's statement (2026-08-31): "Implement so that the 1d
limit is enforced. Also, do real tests so that the signals are properly
created and top of minds are properly generated when new inspirations are
added." The intended behavior it serves, in the founder's words from the same
conversation: inspirations shape the top of mind naturally; the top of mind
shifts only on meaningful change and **at most once a day**; the history of
shifts stays visible.

## Why

Nothing in the pipeline enforces a time floor between top-of-mind shifts.
Refreshes are debounced to collapse a burst into one pass, not rate-limited
over a day — observed live on 2026-08-30: versions 1→3 inside ninety seconds.
Stability today is a prompt-level tendency (`noChange`), not a guarantee.

And the pipeline's end-to-end truth — a person keeps inspirations, signals
appear with evidence, one promotes at three, a top of mind gets written that
cites them — is asserted nowhere against the real model. The judge and
extraction have benches; the LOOP has only deterministic tests with scripted
providers. "It works when inspirations are added" is currently an inference,
not a measurement.

## Shape

The floor is queue arithmetic, not model behavior. A `signals_changed`
refresh that arrives while the latest **content** version (reason ≠
`no_change`) is younger than the floor is **held**: its own row goes back to
pending with `run_after = lastShift + floor`, attempts untouched — the same
mechanism the model budget already uses to defer, applied to one job. Held
rows absorb further enqueues by the existing debounce (pending rows keep
their `run_after`). The floor releases through the machinery that already
exists: the next keep wakes the worker and due rows run; an absent user's
shift lands with the daily cron. `manual` refreshes (the person's own "Read
it again", a language change) never wait — the machine holds a day, the
person never does. A profile with no content version yet (the cold start)
has nothing to hold stable and is exempt.

The proof is a live-model pipeline eval in the bench family (judge,
extraction): real inspirations through the real enqueue path, drained by the
real worker against the real provider, asserting the rows the canon promises
— and the floor holding in the same run.

## Phases

### Phase 1 — the floor's arithmetic
Pure: `TOP_OF_MIND_MIN_SHIFT_HOURS` (24) + `assessShiftFloor(lastContentShiftAt,
now)` returning pass / `{heldUntil}` + the typed `ShiftFloorHeldError`.
**Gate**: unit tests for the boundary (23h59m holds, 24h01m passes, no prior
content version passes, `no_change` versions invisible to the floor);
typecheck 0.

### Phase 2 — the hold in the queue
The floor check lives in `refreshTopOfMindForProfile` (it owns reasons and
versions) and throws `ShiftFloorHeldError`; the drain catches it and holds
the row (pending, `run_after = heldUntil`, attempts unchanged, counted as
`held`, never as failure). **Gate**: db tests — (i) a second
`signals_changed` refresh inside the floor writes NO version and the row
sleeps until `lastShift + 24h`; (ii) `manual` bypasses and versions; (iii) an
aged floor releases on the next drain; (iv) enqueues during a hold collapse
into the held row without moving `run_after` earlier. Full hermetic suite
green.

### Phase 3 — the floor is legible
`docs/generation.md` trigger table + a floor paragraph (drift lock enforces
the constant row). The reading gains one constant-backed sentence in both
languages — a user-facing behavior guarantee belongs on the surface that
cannot lie. **Gate**: generation-doc + reading drift tests green, both
languages, zero digits.

### Phase 4 — the loop, proven live
`test/pipeline-eval.test.ts` (bench family: `describe.skipIf` without keys,
excluded from hermetic runs, wired into CI's credentialed step): one profile,
four curated captures (three one theme, one apart) through the real enqueue +
drain with the real provider. Asserts: ≥2 signals minted; the theme signal
holds ≥3 evidence AND promoted to `active`; a top of mind exists whose
entries cite only real signal ids, in the profile's language; then two more
captures inside the floor produce NO new content version and leave a held row
sleeping to the right moment; aging the content version 25h and draining
produces the shift. Expected spend per run: ~15–25 model calls (extraction +
judges + 2–3 syntheses), well under $0.05 on the pinned model. **Gate**: two
consecutive live passes (2/2 — one pass on a live-model test is a coin flip);
CI wiring in the same diff.

## Budget

≤ 80 live model calls for the whole goal including reruns (≈ $0.10 DeepSeek).
Running total: recorded in the log.

## Log

- 2026-08-31 goal authored; phases and gates named before work.
- 2026-08-31 Phase 1 PASS — assessShiftFloor + TOP_OF_MIND_MIN_SHIFT_HOURS(24) + ShiftFloorHeldError; boundary units green (cold start exempt, 23.9h holds to the exact opening moment, 24h/24.1h pass). api typecheck 0; synthesis suite 39/39. Note: the "no_change invisible to the floor" clause is a property of the version QUERY and is gated in Phase 2 with the db tests, not here. Model calls spent: 0.
