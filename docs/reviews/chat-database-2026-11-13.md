# Chat database critical path — 2026-11-13

Baseline: dev `f0e2ef0d6d74d65b500f6ba1794a986dfc65e603`. This is a bounded
application/SQL improvement, not a database-region migration or proof that the
reported latency is resolved. Main/production is outside this change.

## What made the path sensitive to database latency

One actual post-PR477 worker attempt took 11.031s in the handler, including
8.918s in the reply processor: prepare 2.257s, failed lookup 0.243s, revalidate
1.756s, answer 2.556s and publication 2.104s. The three database-oriented
processor phases total 6.117s. They include transaction/connection acquisition,
application work, network and locks; they are **not measured SQL CPU or RTT**.
One adjacent save API invocation took 4.967s, with 2.411s admission and 0.942s
conversation projection. Request-to-browser correlation/paint was not measured.

The client in `packages/api/src/lib/db.ts` is reused across warm calls, uses
`prepare:false` for transaction-pooler compatibility, and defaults to one
connection on Lambda. The implementation awaits each dependent statement.
The pinned postgres-js driver separately awaits BEGIN and COMMIT; Drizzle adds
SET TRANSACTION for the former standalone repeatable-read poll. Statement
counts, protocol exchanges, a connection handshake and physical round trips
are different quantities. No pool, TLS, driver or deployment setting changes.

The main avoidable work was:

- Every poll used four sequential application reads plus BEGIN, SET TRANSACTION
  and COMMIT for one small status object.
- An ordinary send into an existing thread fully projected its old transcript,
  opening, attachments and current references before inserting, then projected
  again for its response. Most new-ID validation needs no such projection.
- Admission locked a conversation ID and immediately read that same full row.
- Every worker proof first attempted a conflicting fence INSERT even when the
  existing fence could be locked directly.

Worker currentness checks are intentional. Prepare reserves the model budget,
post-lookup revalidation catches changes/Stop before the answer, and publication
re-proves selected sources/ownership under locks. None was removed or cached.

## Changes and consistency boundaries

`replyState` now joins the same scoped conversation/owner, last-two-position
user selection, latest request, account-wide budget and correctly scoped job in
one SELECT. It retains `(created_at,id)` descending tie order, strict message
attempt `>` boundary, inclusive dispatch `>=` boundary, embedding+answer budget
weights, retained-profile scope, exhausted-lease behavior and native timestamp/
number/null decoding. A single PostgreSQL statement snapshot replaces the
standalone read transaction. The reader inside a write transaction stays inside
that transaction. If this query is split later, restore explicit snapshot
isolation. Consequently **new `reply_state` timings measure a direct SELECT and
JS calculation**, unlike the historical BEGIN/SET/COMMIT timings; historical
receipts and the earlier review have not been rewritten.

For normal new message IDs, Send locks/reads the full owned conversation row,
checks the exact message ID and any correction target narrowly, then performs
the existing insert/attachment/reply-intent/quota/response projection in the
same transaction. Existing-ID retries still compare exact words, correction
and linked attachments before returning the full current projection, without
another charge. Missing/deleted/full/foreign/correction errors retain their
precedence. No message durability change, deferred write or eventual save.

A memory fence is selected FOR UPDATE first. Only a missing row uses INSERT ON
CONFLICT DO NOTHING followed by SELECT FOR UPDATE. Both concurrent creation
and rollback preserve the same fence and lock order. The conversation lock
now returns the owned full row directly, including the same 404/410 checks.

## Matched real-SQL evidence

A fresh identity-verified disposable loopback PG17 instance ran real routes,
the actual local enqueue handler/claim/lease/settlement path, and a single-slot
runtime client. Native AWS scheduling callbacks were disabled. Models were
fake and embedding HTTP was strictly intercepted with a valid vector or a
synthetic 402; **zero paid/provider or owner-database calls** occurred. Fixed
synthetic inputs compare complete provider-input and published-projection
hashes, exact kept wording and ready state, separately for both lookup outcomes.
All five before/after cases matched.

The following counts exclude seed/warmup and protocol control commands:

| Fixture | Send before → after | Worker prepare / revalidate / publication before → after | Poll | Final full read |
| --- | ---: | --- | ---: | ---: |
| First plain | 29 → 25 | 17 / — / 16 → 16 / — / 15 | 4 → 1 | 6, unchanged |
| First Why, 3 supports, valid vector | 51 → 47 | 22 / 32 / 24 → 21 / 31 / 23 | 4 → 1 | 18, unchanged |
| 120 older turns, same valid opening | 63 → 43 | 23 / 34 / 25 → 22 / 33 / 24 | 4 → 1 | 18, unchanged |
| First Why, lookup fails | 51 → 47 | 22 / 18 / 21 → 21 / 17 / 20 | 4 → 1 | 18, unchanged |
| 120 older turns, lookup fails | 63 → 43 | 23 / 19 / 22 → 22 / 18 / 21 | 4 → 1 | 18, unchanged |

Each write transaction retains one BEGIN and one COMMIT. Final delivery retains
BEGIN, SET TRANSACTION and COMMIT. Standalone polling changes from four
application statements plus those three commands to **one SELECT total**.
The local handler's six other statements (head/account usage/claim/settlement/
empty-head checks) stay unchanged; native AWS wake/lease work is outside this
local measurement. Worker savings are three statements on the lookup path,
not the elimination of its necessary proof work.

Warm synthetic SELECT EXPLAIN ANALYZE covered 185 baseline/163 candidate plans:
median execution 0.009/0.008ms, maximum 0.294/0.226ms; 175/153 plans contained
index nodes, with no shared-block reads. Small-table sequential scans are not
proof of a missing index. These warm, small fixtures establish neither production
query CPU, lock contention, dataset scale nor Neon network performance.

A separate sensitivity fixture added 20ms before each awaited application
statement and two transaction-boundary waits; SET TRANSACTION was counted but
not separately delayed. It also preserved all five input/publication hashes.
For example the long lookup-failure send was approximately 1540→1008ms, worker
1762→1610ms and poll 133→23ms. Unchanged delivery also varied 477→447ms, showing
scheduler/local measurement noise. **This is synthetic per-await sensitivity,
not a faithful physical RTT model, cloud forecast or measured user speedup.**

## Verification and remaining limits

Real SQL regressions cover the one-statement poll, last-two/tie/hourly/budget
semantics, job timestamp/exhaustion/foreign-profile refusal, a controlled
uncommitted writer versus poll snapshot, simultaneous missing-fence creators
on two single-slot clients and preparation rollback/recovery. Existing source
edit/deletion/Stop/ownership/publication, exact replay, attachments, correction,
quota rollback and retained-profile tests remain required. A long-thread send
regression verifies one full projection and exact replay. Local raw-fixture
encoding/name mistakes are retained as failed receipts; no guards were relaxed.

Local checks passed: API unit gate 1,468 passed/24 skipped (131 files passed/5
skipped), API and web types. Real DB checks across scoped runs passed reply47,
conversation27 plus the new projection/replay case, attachments19, quota7,
opening4 and perspective3. Required exact-head PR CI and Main source review
remain separate before any dev merge.

There is no schema/migration, model/reasoning/provider, frontend/polling interval,
SST/workflow/IAM/secret or monitoring-series change. Final full delivery, worker
claim/fairness/account-budget controls, source proof reads and cross-region
placement remain follow-ups where evidence justifies them. The configured
us-west-2 Lambda versus us-east-1 database-region hint is a plausible amplifier,
not measured RTT. Any region change requires a separate backup/isolation and
infrastructure review. Google embedding's observed 402 RESOURCE_EXHAUSTED is
also separate; no billing, quota or transport change is included here.

Actual deployment, a fresh comparable live sample and submit-to-visible
acceptance remain separate from these local checks. The performance goal stays
in progress; no broad latency-completion claim follows from query counts.
