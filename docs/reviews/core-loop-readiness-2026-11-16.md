# Core-loop readiness and bounded reply polling

Source baseline: dev `1225993e`. The built synthetic browser baseline passed
48 journey/locale/viewport cases, plus four separate first-run onboarding
checks. Main accepted that baseline before product edits. Original citation
opening UI checks remain unpassed/parked: the explicit `waka-proxy` decision
`dec_1794841858735_0d768acb` preserves the minimal chat and instead requires
long-history continuation plus current-owned citation integrity. No retired
source drawer is restored.

## Selected change

A ready reply could wait for the next one-second status read. Add one optional
read 500 ms after the first fast pending observation. Keep the regular 1s/2s
schedule and its approximately 58s timer-only pending watch. Skip the optional
read if the first read takes more than 250 ms. Bound it by the next regular
point, racing the deadline independently of transport cancellation, including
conversation hydration. Late optional results cannot deliver or retime work.

Optional nonterminal failures/older observations are advisory; they do not
consume the regular failure/backoff history or move its next check. Explicit
401/404/410 retain their existing meaning. The total status-read limit is 36
per watch, including failures, instead of 35 successful pending observations.
This deliberately tightens mixed-error watches; Check again remains explicit.
Visibility/focus can start a fresh watch as before; the older-state clock still
survives those refreshes. Current revision, Stop, retry and ownership checks are
unchanged. No backend quota, model call, SQL, queue, pool or provider changes.

## Local before/after evidence

The primary comparison has 72 actual built-browser samples: four scenarios ×
two versions × nine samples (one API-process restart, five warm 350ms answers,
and 550/950/3000ms answers). The TCP framing observer is **off** for these
wall-time samples. Deterministic fake providers are used, not live models.
The single prepared API/worker pool, buffers and loopback database are shared;
process-cold is not Lambda/Neon cold. Inputs and normalized publications match
exactly across all samples of each scenario/version.

| Scenario | Warm render-ready median before → after | Process-cold before → after |
| --- | ---: | ---: |
| Empty first chat | 1108.2 → 1006.8 ms | 1190.2 → 671.1 ms |
| 600-source first chat | 1121.7 → 609.6 ms | 1174.7 → 691.5 ms |
| Legacy uncited 160-message history | 1139.4 → 625.7 ms | 1175.3 → 691.1 ms |
| Current cited 160-message history | 1141.8 → 624.4 ms | 1240.7 → 674.5 ms |

Render-ready means the uniquely marked new reply is laid out, intersects the
viewport and scroll clip, and is visible after two animation-frame opportunities.
It is not an exact GPU-paint timestamp. The legacy uncited history has no prior
ready-request attestations; the cited control has 80 valid historical reply
requests and current owned references. Neither stands in for every history.

The 550/950ms boundary samples generally retain the next regular delivery point;
one uncited 950ms sample is 123ms slower. Primary 3s samples differ by at most
18ms. Small sample/order variation is not a tail-latency guarantee. A separate
actual-hook fake-clock sweep covers 112 arrival/RTT pairs through 59s/1000ms:
16 improve, 94 tie, two remain outside both watches; none delivered later.
This sweep is scheduling evidence, not physical network latency.

## Read cost and limitations

Eight separate observer-on slow samples measure protocol work, not primary
speed: zero or one extra status GET, approximately two or three additional
PostgreSQL CommandComplete messages and 0–960 extra server bytes. These are
framing counts across the whole send window, not causal network flights.
Local worker totals change by -11 to +12ms in those pairs; this limited shared-
pool test does not establish cloud or multi-user contention behavior.

If the optional read sees ready but hydration misses its deadline, the regular
watch may repeat the full owned conversation GET. The regression tests cover
that path. An actual ready cited162-message GET cost 21 CommandComplete,
94,368 server bytes and 32ms locally; this is an example, not a universal cap.
Aborting the optional client request does not prove server-side work has ended.
There is at most one optional status read and potentially one duplicate
hydration read per watch, with no extra answer/model dispatch.

This addresses publication-to-display delay. It does not establish or solve
current deployed admission, worker wake, region RTT, provider time or model
quality. The earlier 8s saved reassurance is not a durable-ACK timestamp.
Response-header timing is not the database commit or completed receipt parsing.

## Reproduction evidence

The local goal artifact root is `/tmp/waka-core-loop-20261116`:

- `baseline/case-status-summary.json`: accepted baseline and retained corrections.
- `performance/polling-comparison.json`: paired sample summaries and raw hashes.
- `performance/results.jsonl`: original 58 rows plus observer-off and diagnostic rows.
- `performance/poll-arrival-sweep.json`: actual old/new hook schedules.
- `performance/polling-tests-candidate-final.log`: targeted lifecycle/error tests.
- `final/results.jsonl`: independent final journey accounts and retained failures.

All data/providers are synthetic. Owner app3010, storage3011, databases,
credentials and protected source remain outside the fixture. No real provider
or regional operation is authorized by this report.

## Conditional infrastructure option

A separate unserved synthetic PG17 copy/restore verified all 68 table/sequence
HMACs and schema, preserving exact synthetic locked wording,001+2 vectors,
control/work and an unknown dispatch. The successful local run took 3.644 s;
this is integrity evidence, not regional speed or live downtime evidence.
The original failed fixture construction and identifier audit are retained.
The local `colocation/option.md` records published cost assumptions, all-four-
writer/source-role/IaC barrier prerequisites and before/after-new-writes rollback.
No live move, role/credential/resource change or cloud capability is claimed.
