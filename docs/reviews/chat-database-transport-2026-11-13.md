# Chat database transport review — 2026-11-13

Status: offline candidate; bounded actual development pooler compatibility passed.
Reviewed PR/CI/deployment acceptance is required before activation. Production is unchanged.
Baseline: development `1511c53ec95e1c752afb1b42408f04178cadf7cd`.

## Finding and scope

The latest observed attempt spent 6.625 seconds in database-oriented worker
preparation, revalidation and publication, versus 2.759 seconds in the answer
provider. Those phase totals include application work and transaction/connection
costs; they do not measure PostgreSQL CPU or isolate physical network RTT.
The 19.174-second adjacent-event sequence is not a correlated browser measurement.

Two bounded operator probes used the installed postgres-js 3.4.9 driver with
runtime TLS, max=1, prepare=false and only fixed constant SELECTs/read-only
transactions. Warm five-query medians were 60.449 ms from AWS us-west-2 and
1.529 ms from us-east-1 against the same approved development database. This is
strong regional amplification evidence, not exact Lambda RTT or a whole-chat
speedup ratio. Cold queries (1,718.268/760.176 ms) include confounded connection,
setup/order and possible resume effects. No owner tables were queried.

A separate local binary-protocol trace exposed avoidable work: postgres-js
`unsafe()` defaults each query to prepare=false, and Drizzle's postgres-js
session uses `unsafe(sql, parameters)`. Merely enabling the root pool's prepare
option does not enable cached preparation. With both opt-ins, repeated SQL can
send Bind/Execute/Sync without another dependent Parse/Describe exchange.
First-time preparation still describes; changing SQL/parameter types or a new
connection can require preparation again. This is not a statement-count reduction.

Pinned evidence is postgres-js 3.4.9 `src/index.js` unsafe(), `connection.js`
build()/ParameterDescription(), and Drizzle 0.45.2 postgres-js/session.js.
Current [Neon pooling documentation](https://neon.com/docs/connect/connection-pooling)
documents protocol-level preparation support; SQL PREPARE/EXECUTE is a different,
unsupported pooling contract. Documentation is not proof of this endpoint's
configuration or handoff behavior.

## Bounded candidate

A small client adapter forwards SQL and parameter arrays unchanged and returns
original native Query objects. It adds prepare=true only for nonempty bound
queries without an explicit/inherited prepare option. Explicit prepare=false or
undefined stays on the native path. Transaction callbacks, savepoints and reserved
clients inherit the adapter; release, values/raw/execute/cancel and callback return
values retain driver behavior. No dependency patch, interpolation, application
retry, fallback, pool expansion, TLS/type change or source-proof cache is added.

Only the development API and BackgroundWorker opt in through
`WAKA_DB_PREPARED_QUERIES=1`. The selector rejects activation outside development
stages. Production, defaults, local runs without the opt-in, PrincipleRefresh,
attachment cleanup and monitoring/budget consumers retain their current setting.
The existing 19 development runtime checks remain; three additional checks
attest the two opt-ins and the unchanged PrincipleRefresh transport (22 total).
No schema, migration, provider, secret, IAM, workflow, new service or metric series
changes are included.

The pinned driver already reparses cached queries after specific explicit server
rejections (FetchPreparedStatement/RevalidateCachedQuery/transformAssignedExpr).
That differs from replay after an uncertain write acknowledgement. The adapter
adds neither behavior. An actual local proxy test drops the successful server
COMMIT acknowledgement: the caller fails with CONNECTION_CLOSED, exactly one row
is durable, and the INSERT was built once. No automatic write replay occurs.

## Executed offline evidence

Real routes, worker, readers and SQL ran against a fresh disposable loopback PG17,
with max=1 and zero-delay synthetic provider/embedding transport. Five cases cover
plain, Why with three sources, 120-message history, valid vectors and failed
embedding fallback. Full provider-input and published-message/citation digests,
locked words, SQL counts, transaction controls and reader row counts match the
frozen baseline in every case.

The same process intentionally reuses its statement cache across cases, matching
warm-client reuse. These are protocol counts, not independent latency trials:

| Case | Parse/Describe exchanges, baseline → candidate |
| --- | --- |
| First plain conversation | 73 → 43 |
| Why + 3 sources, indexed | 157 → 9 |
| 120 prior messages, indexed | 157 → 5 |
| Why + 3 sources, failed embedding | 140 → 0 |
| 120 prior messages, failed embedding | 139 → 0 |

Statement executions remain identical. Existing 85 conversation/reply/opening/
context DB checks also pass with the actual adapter enabled in the isolated
fixture, including Stop, source edits/deletion, publication fences, ownership,
no-memory corrections, concurrent writers, pool-one locks, rollback and replay.
Native driver checks cover scalar/JSON/date/null decoding, Query methods,
transaction/options/array-return/savepoint/reserve behavior and the uncertain
COMMIT fault. Initial fixture errors (JSON double serialization, relocated module
and migration lookup) were corrected in test setup; no product behavior was
relaxed to pass them. Local timing does not establish deployed improvement.

## Acceptance, rollback and remaining work

A separately reviewed two-client read-only probe passed once on the actual dev
pooler: five fixed bound constant/PID reads, two type catalogs, three read-only
transactions and zero rollbacks. Client 2 held the former backend while client 1
successfully reused its cached statement on a different backend. IDs stayed only
in memory; both clients closed, with no owner-table reads or writes. This is a
bounded current-endpoint compatibility result, not a universal failover/schema
guarantee. The independently guarded regional probe allowances were not reused.

Then exact-source Main review, ordinary PR CI and dev-only deployment must pass.
The actual runtime audit must show the expected 22 checks. Measure naturally
occurring postdeployment phase data separately; do not predict a percentage chat
speedup from removed describe exchanges. Rollback is a reviewed source change
removing the two opt-ins and updating their audit expectations together, followed
by the normal dev pipeline; no manual runtime edit or automatic fallback.

No new infrastructure charges are introduced. Prepared statement memory/cache
behavior remains bounded by the native connection lifecycle and requires actual
pooler validation. Regional co-location is a separate, potentially larger gain:
a Neon project region cannot be changed in place, and moving the AWS home region
also affects SST state/passphrase routing. A new dev-only Neon project requires
actual account/plan/cost review, complete writer quiescence, consistent copy,
identity/queue/index preservation and a safe post-write rollback plan. No region,
resource or database cutover is authorized by this candidate. The existing Google
embedding HTTP402 is a separate availability/quality issue, not repaired here.
