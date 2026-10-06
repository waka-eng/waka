# Review and chat responsiveness

Status: in progress (2026-10-06).
Branch: `codex/responsiveness-reliability`, based on dev `8d67723`.

## Objective

Reduce database round trips in Review Next and chat, and improve delivery of
transient retries without duplicating model work. Keep the current design,
source validation, human wording, review selection, locks and spending limits.
This is one bounded implementation milestone, followed by reassessment.

## Database gate

Measure the unchanged paths before editing. Use an explicit disposable
loopback database, pool one, synthetic content and no provider traffic. Record
SQL statements and matching output checks, with and without an explicit
50 ms per-statement transport simulation. Require at least 25 percent fewer
Review Next statements and at least 25 percent lower simulated median latency.
Chat reply-state reads should use no more than four application statements,
while preserving ownership, deletion, phase, hourly budgets and retry times.
The simulation must not be reported as a cloud latency measurement.

## Retry gate

Transient work should receive a bounded near-term retry rather than depend
only on the fifteen-minute recovery sweep. Preserve database due times,
leases, attempt limits, account budgets, intentional daily cadence and the
safety sweep. Never retry completed provider work or turn budget/cadence waits
into errors. Verify ordinary asynchronous invocation behavior before choosing
the delivery mechanism; new security-sensitive access needs separate approval.

## Verification and boundaries

Target API types, unit tests, real review/conversation/recovery SQL cases and
performance output parity. Fix observed regressions without weakening tests.
Record all gates before calling the milestone complete. No production changes,
real-account data, model retuning, schema migration or deployment is planned
unless implementation evidence makes one necessary and it is authorized.

No paid calls are needed for the initial measurements. The existing evaluation
allocation remains $3.1340356674 used or held of $5, including the unreconciled
$1.50 dev reservation. Any live provider batch requires a declared bound.

## Log

### 2026 10 06 start

The clean checkout matches deployed privacy cleanup `8d67723`. Review Next
already uses one HTTP request but repeats session/presentation reads around
the same transaction. Chat polling loads the same job twice and separately
reads account identity. The current worker stops when only future backoff is
left; dev recovery runs every fifteen minutes. Baselines are next, not assumed
from the earlier sparse cloud observations.

### 2026 10 06 baseline

Five samples per path, pool one: Review Next uses 28 application statements,
median 8.36 ms locally and 1508.73 ms with FIFO 50 ms transport simulation.
Chat status uses seven statements, median 2.06 ms locally and 376.82 ms with
the same delay. Real driver counts equal the instrumented statement counts.
The first instrument missed fluent select builders; it was corrected before
editing application code and a driver-parity assertion now rejects that error.
Both disposable schemas cleaned successfully; provider calls and remote writes
are zero. Receipt: `work/performance/responsiveness-baseline.json`.
