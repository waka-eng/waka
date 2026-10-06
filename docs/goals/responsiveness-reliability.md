# Review and chat responsiveness

Status: implementation complete (2026-10-06); dev delivery approved by owner.
Benchmark results are local; live cloud retry/timing measurements remain separate.
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

### 2026 10 06 database gate passed

The unchanged gate requires at least 25 percent fewer Review Next statements
and 25 percent lower simulated median, with chat at no more than four
application statements. Five matching candidate samples use 20 Review Next
statements (28.57 percent fewer) and 1079.81 ms simulated median (28.43 percent
lower than 1508.73 ms). Chat uses four statements rather than seven, simulated
median 216.84 ms rather than 376.82 ms (42.46 percent lower). Local medians are
6.85 ms and 2.18 ms respectively; no improvement in local chat latency is
claimed. Driver counts match instrumentation and output assertions pass.
Receipt: `work/performance/responsiveness-candidate.json`, both schemas cleaned.

Review now reuses session rows only inside its locked transaction and avoids
building the same presentation twice. Chat fetches only the last two message
identities, latest request, retry aggregates and one job row; it no longer
loads request context/content history during a poll. Ownership, current source
versions, replay tokens, hourly limits and old review manifests remain checked.
The new real-driver regression pins active chat polling to four statements.

Verification: API types and performance-tool types pass; real Review/dialogue,
conversation and retry/recovery SQL suites pass 103 cases. Initial chat checks
caught an undefined lease helper and a Date bound directly into raw SQL; both
were fixed before acceptance, without weakening those checks. Transport delay
is a local simulation, not measured cloud p95 or end-to-end provider latency.

### 2026 10 06 retry gate passed locally

The API's existing `InvocationType: Event` wake now carries `mode: enqueue`.
Only that event in Lambda may request native redelivery, after the bounded
drain verifies an exact still-pending failed transition from its own attempts.
The hint includes profile/job identity, attempt, settlement time and due time;
a later success, claim, rerun, hold or budget deferral invalidates it. The check
does not claim work, scan unrelated jobs or invoke a provider. API wake failures
still cannot turn a committed save into a write failure, and a worker never
self-invokes when it enqueues the next stage.

SST now explicitly pins two extra asynchronous attempts. AWS documents waits
of one minute, then two minutes, after function errors; delivery can be late or
duplicated, so SQL claims and model-dispatch fences remain authoritative.
Contract verified against [AWS asynchronous error handling](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)
and SST's local `FunctionEventInvokeConfig` implementation. The controlled
`BackgroundJobRetryScheduled` error counts in Lambda Errors; it does not mark
the durable job failed. Operators must distinguish this expected signal from
exhausted jobs. A future alert based on raw Lambda Errors must account for it.

Native redelivery is bounded, not a new scheduler for every attempt. After the
two extra deliveries, or for backoff beyond the two-minute lookahead, remaining
work still uses the existing recovery/daily sweep or a later normal enqueue.
No tighter cron, new cloud service, new IAM permission, sleeps or migration.
Local calls and scheduled recovery/daily events never manufacture this signal.

Eight real SQL retry cases pass: due-time exclusion, duplicate claim delivery,
budget deferral with retained error, both cadence/support holds, active leases,
source reruns/tenant mismatch, exhaustion/lost ownership and long backoff.
The tests caught stale `last_error` on a hold; the documented held-not-failed
transition now clears it. Worker summaries also include their previously
omitted held count. Signal/SDK/config coverage passes 31 targeted unit cases.
The final full API suite passes 961 cases with three existing paid cases skipped.
All 103 targeted SQL cases, API/performance-tool types, migration integrity and
three goal-index cases pass. Tests use scripted processors/SDK transports,
not live providers or AWS. Actual Lambda redelivery timing remains unmeasured
until an authorized dev deployment; no cloud latency improvement is claimed.

Milestone implemented and accepted locally. At local acceptance, provider calls,
AWS writes and remote database writes were zero; the evaluation allocation is unchanged.
No changes to review selection, prompts, human wording, design or daily cadence.
The owner approved dev delivery on 2026-10-06. Release uses a PR into `dev` and
the existing automatic development-stage deployment. No production release,
paid evaluation or additional product milestone is included.
