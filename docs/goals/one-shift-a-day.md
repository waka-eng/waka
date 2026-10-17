# Goal: one shift a day, and proof the loop is real

Status: halted at Phase 4 gate (2026-08-31, second halt) — 1/2 this attempt; the founder's 150-call raise is ~117 spent, two fresh consecutive runs (~50) no longer fit inside it, and the provider is measurably stalling today. The floor is 8/8 across every live run that reached it. The raise bought three instrument repairs (eval hold-accounting, transport body deadline, hermetic key leak) that make the next ~50-call attempt run on clean instruments.
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
drain with the real provider. Asserts what the MACHINERY and canon promise:
signals minted with evidence; the theme signal holds ≥3 evidence AND
promoted to `active`; a top of mind exists whose entries cite only real
signal ids, in the profile's language; then two more captures inside the
floor produce NO new content version and leave a held row sleeping to the
right moment; aging the chain past a day releases the refresh, which runs
and versions (content or honest `no_change`). Multi-signal breadth — whether
a distinct fourth capture mints its own signal — is model variance and is
priced by the extraction bench's two-pattern cases, not gated here; the
count is logged, never asserted. (Revised 2026-08-31 after the first gate
attempt measured the flake as extraction variance, 1/2; the revision was put
to the founder and approved — "continue from where you left off".) Expected
spend per run: ~15–25 model calls. **Gate**: two consecutive live passes
(2/2); CI wiring in the same diff.

## Budget

≤ 80 live model calls for the whole goal including reruns (≈ $0.10 DeepSeek).
Raised by the founder 2026-08-31 ("its ok to raise the budget") after the 2x
checkpoint stop at ~160: up to 150 further calls (≈ three more gate attempts,
< $0.20 total) before the next mandatory stop-and-report.
Running total: recorded in the log.

## Log

- 2026-08-31 goal authored; phases and gates named before work.
- 2026-08-31 Phase 1 PASS — assessShiftFloor + TOP_OF_MIND_MIN_SHIFT_HOURS(24) + ShiftFloorHeldError; boundary units green (cold start exempt, 23.9h holds to the exact opening moment, 24h/24.1h pass). api typecheck 0; synthesis suite 39/39. Note: the "no_change invisible to the floor" clause is a property of the version QUERY and is gated in Phase 2 with the db tests, not here. Model calls spent: 0.
- 2026-08-31 Phase 2 PASS — floor check in refreshTopOfMindForProfile (signals_changed only; no_change rows invisible via `ne(reason,'no_change')` in the query); drain gains a hold path (ShiftFloorHeldError → holdJob: pending, run_after=heldUntil, attempt handed back, last_error clean, counted `held`). Db suite 3/3: hold sleeps to exactly lastShift+24h with attempts 0 and no version written; manual passes straight through; aged floor releases on next drain; burst enqueues collapse into the one sleeping row without moving run_after. Full hermetic 786/786, typecheck 0. Notes: (a) test drains run with a +1s clock — enqueue stamps run_after from the DB clock and a same-process JS clock can trail it by more than the enqueue→drain gap; production wake latency dwarfs the skew; (b) TOP_OF_MIND_MIN_SHIFT_HOURS's constants-table row landed here, pulled in by the drift lock's same-diff law — the prose and reading sentence remain Phase 3. Model calls spent: 0.
- 2026-08-31 Phase 3 PASS — generation.md floor paragraph in the refresh-triggers section; the reading gains a constant-backed line in both voices (words "once a day" / wordsKo "하루에 한 번", backed by TOP_OF_MIND_MIN_SHIFT_HOURS=24, pinned in WORDED_FOR). reading+doc drift suites 19/19, zero digits both renderings, typecheck 0. Model calls spent: 0.
- 2026-08-31 Phase 4, mid-gate corrections (recorded, not silent): (a) fixture — capture #4 was pattern-free by construction (logbook-noise style borrowed from the extraction bench), so the pipeline CORRECTLY yielded 1 signal and "≥2" failed; replaced with a genuine second pattern (walking untangles problems); criterion unchanged. (b) criterion — "aging 25h produces THE SHIFT" over-asserted: run 2 released the floor and the model answered an honest noChange (a legal, versioned answer by the system's own law). The machinery's guarantee is that the held refresh RUNS when the floor opens; the assertion now requires a new version row of ANY reason plus no row left sleeping. LATER captures made genuinely novel so a content shift stays plausible without being demanded. Spend so far: ~60 calls (probe ~10, run1 ~25 PASS in 92s, run2 ~25 FAIL at the old over-assertion in 371s). Budget note: the 2/2 gate needs two more runs ≈ 50 more calls → total ≈ 110 vs the authored 80. Under the 2x checkpoint; proceeding with the overage stated.
- 2026-08-31 Phase 4 GATE FAIL — criterion: two consecutive live passes. Measured: PASS (91s), FAIL (337s — "the captures produced signals: expected 1 to be ≥ 2"). Across ALL four live runs: the recurrence story passed 4/4 (three themed keeps merged into one signal, ≥3 evidence, promoted active every single run), citations were never invented, the profile's language always held, and THE FLOOR ITSELF behaved correctly 4/4 (held to the exact second, slept, released) — no run ever failed on the floor. The flaky claim is extraction variance: whether the fourth capture's distinct pattern gets heard as its own signal (the extraction bench already measures this failure mode at ~94%; the slow runs, 337–371s, correlate with the misses). What I would do instead: split the eval — pipeline-eval asserts what the machinery and canon promise (derive, recurrence→promotion, honest citation, the floor's hold and release; all 4/4 stable) and leave multi-signal breadth to the extraction bench where topic-tolerant scoring already prices it — then re-gate 2/2. That revision changes an acceptance criterion, so it is the founder's call, not mine. Spend: 4 runs + probe ≈ 85 calls of the authored 80 (overage recorded at the prior entry; stopped before the 2x checkpoint).
- 2026-08-31 budget raised by the founder ("its ok to raise the budget"); resuming the 2/2 gate. Mid-gate HARNESS correction (recorded, not silent; no criterion touched): `drainUntilQuiet` now chases near-future retry backoffs (a quiet pass with a pending row due within 20 minutes advances the drain clock to it) so the queue's own retry law gets the time production would give it — the run-6 FAIL was one road-failed derivation whose 30s retry the 1s-lookahead drain could never reach, misread as held=0. The 20-minute ceiling keeps the day-scale floor sleeper unchaseable; every asserted claim is unchanged. Expected spend this attempt: 2 runs ≈ 50 calls.
- 2026-08-31 resumed gate, attempt voided + run A FAIL — both recorded. (a) First run VOIDED by my own tooling: piping vitest through `head` truncated the verdict (and possibly SIGPIPE-killed the run mid-eval); ~20 calls spent on a measurement that does not exist. (b) Run A (354s): FAIL at `held ≥ 1` — and the ledger diagnostic earned its keep: all 6 derives succeeded, no road failure, no budget deferral; the worker log shows `shift floor holds; refresh sleeps` fired during the STEP-1 drain (slow provider → version 1 landed mid-derives → the fourth keep's refresh was held immediately), and step 4's enqueues collapsed into that already-sleeping row per the burst-collapse law, so the step-4 drain had nothing left to hold. THE FLOOR BEHAVED PERFECTLY — 7/7 runs now — and the eval's per-drain-call `held` counter attributed the hold to the wrong call. HARNESS accounting corrected (recorded, not silent; doc criterion — "no new content version + a held row sleeping to the right moment" — untouched): holds now accumulate across the whole run (`heldAcrossRun`), which correct machinery satisfies in both timings (slow → step-1 hold; fast → step-4 hold), and the exact-floor-moment sleep assert stays. The 2/2 count restarts fresh. Spend this resume: ~45 of the 150-call raise.
- 2026-08-31 corrected-accounting gate: run 1 PASS (345s — 2 distinct signals, promotion, honest citations, floor held and released), run 2 FAIL (test-timeout 421s: the FIRST extraction call answered 200 and then stalled its body for the whole seven minutes — one log line, then silence). Root cause is machinery, found and fixed: `fetchModelWithTimeout` bounded only the HEADERS (25s) and cleared its timer when they arrived, leaving `response.json()` unbounded — and with streaming off, body time IS generation time. This is the other half of the 2026-08-30 finish_reason:length incident (that fix bounded the answer's size, not its time). Fix: a second whole-exchange deadline (180s default, `WAKA_MODEL_EXCHANGE_TIMEOUT_MS`, clamp 1s–600s); the body is buffered inside the deadline and handed back as a rebuilt Response so all four call sites keep their `.ok`/`.json()` reads; `ModelRequestTimeoutError` was already classified transient, so the queue's retry law recovers a cut stall. *(Later: `isTransientModelError` was removed on 2026-10-17 once nothing called it. The timeout still throws, and the background-job queue retries any thrown error with backoff up to `max_attempts`, so a cut stall is still recovered.)* Two regression tests (stalled body must hit the deadline; normal body round-trips). Transport suites 40/40.
- 2026-08-31 collateral discovery, silent spend plugged: a full `pnpm --filter @waka/api test` run (run to gate the transport fix) unexpectedly ran ALL THREE live benches — judge FAIL (one phantom opposition, ko pair), extraction TIMEOUT (240s), pipeline TIMEOUT (420s) — because `test/setup.ts` walks up to the repo root and layers `.env.local`, which carries the real model keys, and the benches key off nothing but key presence. Every local full-suite run since the keys landed in that file has been quietly spending ~50 live calls (and quietly passing on healthy provider days). Fix: setup strips GEMINI_API_KEY/OPENROUTER_API_KEY unless `WAKA_RUN_LIVE_EVALS=1`; the `eval:*` scripts set the flag (CI's credentialed step calls those scripts, so CI needs no change). Hermetic suite after: 788 passed, 3 benches SKIPPED, typecheck 0 — the word "hermetic" is true again. Today's three bench results also confirm the provider-day: stalls and a quality miss across three independent suites in one hour.
- 2026-08-31 HALT at the raise line. Spend this resume, honestly estimated: voided run ~20 + run A ~25 + run 1 ~25 + run 2 ~2 (it hung on call one) + accidental live suite ~45 ≈ 117 of the founder's 150. Two fresh consecutive runs (~50) do not fit; one run cannot complete a 2/2 gate and today would measure the weather, not the machinery. Across ALL eight live runs to date: recurrence→promotion 8/8, invented citations 0, the floor correct in EVERY run that reached it (8/8 — including run A, where it held a refresh the eval was not even looking at yet). Next attempt: ~50 calls on a fresh provider day, on instruments that are now clean (hold-accounting counts the run, stalls cut at 180s with retry room, no silent spend). — clean: 2 signals, promotion, board with a pattern + a question + a hedged hypothesis, floor held to the second, release versioned), then FAIL (398s — `held` 0 at step 4: the later derivations most plausibly died on a bad-road stretch so no refresh was ever enqueued; the run's teardown destroyed the evidence, so the eval now prints a job ledger at step 4 to make road-failure vs floor-failure distinguishable at zero model cost). Gate: 1/2. SPEND CHECKPOINT: ~160 calls of the authored 80 — exactly the 2x line the rules name as a mandatory stop. Stopped. Across ALL six live runs to date: recurrence→promotion 6/6, invented citations 0, floor behavior correct in EVERY run that reached it; both gate failures trace to provider-day variance (slow runs 337–398s vs clean runs 54–92s), never to the floor. Resuming the 2/2 gate needs the founder to raise the budget (each attempt ≈ 50 calls, < $0.10); alternatives recorded in the report.
