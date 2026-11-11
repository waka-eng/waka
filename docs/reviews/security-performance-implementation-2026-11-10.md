# Security/performance implementation — 2026-11-10

> **2026-11-11 outcome:** the application was subsequently deployed and accepted at `b04d1da3`. Read the [portable release handoff](production-deploy-receipt-2026-11-11.md) and [current real-user launch checklist](production-launch-2026-11-11.md). The dated observations and pending steps below are historical; they are not the latest runtime status.

Owner scope: skip legacy-key inventory; implement durable cleanup, issued-upload
reconciliation, citation batching after a fresh real-SQL baseline, and the
compatible parser patch. No production changes, paid providers or new recurring
polling. Existing single-companion and owner work remains in place.

## A — durable cleanup

Migration 0084 introduces `attachment_objects`, independent of profile/account
cascades. Source triggers record removal/replacement of live and retained-copy
keys transactionally. Shared storage-key advisory locks plus closed-hash receipts
fence finalization/restoration against cleanup. Successful cleanup clears raw
key and issuance owner metadata. Failed storage calls/individual errors retain
retry state; the existing daily housekeeping drains bounded batches. Store
identity is pinned; unbound/mismatched inventory is retained without sending
deletes to a different store. Legacy endpoint identity cannot be inferred from
the old object URL; it requires explicit verified binding rather than guessing.

Initial focused gates: nine real-Postgres tests passed on fresh loopback
`waka_secperf_20261110_test` schemas, covering cascades, rollback, retained-copy
expiry, staged expiry, partial deletion, store mismatch, stale finalize and
fail-closed account erasure. A real AWS SDK request to a loopback HTTP server
also passed an HTTP-200 per-object-error regression. API types passed before
the final friendly closed-object refusal check; required checks follow after
the remaining phases. Initial failures were a Date bind and incomplete synthetic
copy fixture; both corrected. No tests used `waka_dev`.

## B — issuance and late completion

Fourteen combined lifecycle/route SQL cases now pass, including fresh-event
grace, duplicate/out-of-order events, unknown/mismatched inventory, owner
deletion, abandoned issuance, successful finalization and a simulated PUT
completing two days after both URL expiry and an earlier absent-object DELETE.
The presign route receipt proves inventory exists before its returned URL;
closed chat finalize returns 409 `attachment_erased`. Two event-handler unit
cases verify partial SQS failure reporting and local-store isolation. A
dedicated cleanup-only S3 → SQS subscriber and 14-day DLQ are prepared in
infrastructure code; these resources have not been deployed. Default strict
account erasure also refuses an unverified storage binding before sending
external deletes, retaining its SQL inventory on any failure.

The 24-hour allowance means eligibility only. Daily dispatch is bounded to
ten batches of at most 100; retry timing/backlog can delay removal. Events
after closure re-arm inventory without reopening finalization. Neither local
adapter tests nor this retry mechanism establish a finite production SLA.

### Reopened crash gate — corrected before final acceptance

Main identified that an external DELETE could survive rollback of the original
closure transaction. Cleanup now has three phases on the same pool-one DB:
commit the locked reference-check/closed decision and five-minute retry claim;
perform external deletion with no open SQL transaction; settle only the exact
monotonic bigint generation claimed. Every completion/cleanup request advances
generation, including events sharing the old attempt's timestamp.

The corrected focused gate passes **18 SQL + 3 HTTP/event unit cases**. New
faults cover death before DELETE, successful DELETE with no settlement,
settlement transaction rollback after physical deletion, and same-timestamp
completion during I/O using the same single DB connection. Closure and raw-key
retry inventory survive each crash; stale finalize is refused; an older success
cannot clear the newer event. Prior A/B receipts were provisional until this
correction. C's reader implementation/measurements and D's dependency selection
were unchanged by this fix.

## C — measured citation batching

Fresh deterministic successful/missing/mixed/retained/repeated source fixture,
one Postgres connection, twenty samples per case, no simulated delay or provider
traffic. Reader code was unchanged for the baseline. Complete output digests
match in all six before/after cases, including full-length excerpts, locked
wording, original-text legacy proof, stale/foreign/missing references and
separate retained-owner labels.

| Case | Citation SELECTs before → after | Actual local median ms before → after |
| --- | --- | --- |
| 90 successful inspiration identities | 90 → 15 (−83.3%) | 272.3 → 10.1 |
| 90 missing identities | 90 → 15 (−83.3%) | 247.2 → 7.0 |
| 90 successful mixed-kind identities | 90 → 14 (−84.4%) | 290.3 → 25.3 |
| Mixed current/stale/foreign/legacy | 91 → 16 (−82.4%) | 284.1 → 29.0 |
| Retained both-owner scope | 180 → 30 (−83.3%) | 530.0 → 43.9 |
| Three repeated identities | 3 → 1 (−66.7%) | 8.2 → 1.9 |

All ninety-identity cases exceed the 50% statement reduction gate. These are
local reader timings, not HTTP, production or cold-start latency. Receipts:
`work/performance/citations-baseline.json` and `citations-candidate.json`;
instrument: `tools/performance/citation-readers.ts`. Existing SQL projection,
context, historical/tenant and bounded-message/window regressions passed in the
full relevant database gate. No generation/provider tuning changed.

## D — compatible parser maintenance

The [reviewed advisory](https://github.com/advisories/GHSA-474x-hrwr-fgx4)
identifies 5.12.0 as patched; the [npm registry version record](https://registry.npmjs.org/fast-xml-parser/5.12.0)
and `pnpm view` confirmed the exact version/integrity. AWS XML builder pins
5.7.3, so a narrow `@aws-sdk/xml-builder>fast-xml-parser` override selects
5.12.0, including that release's required transitive dependencies. Production
audit is now **zero advisories**. Real SDK XML-error parsing, signed presign
response and API regressions passed after the update. No SST major upgrade.

The lockfile also normalizes the shared Vitest coverage peer link to the
already-existing Node 25 type instance; API Node 22 and web Node 25 instances
both remain. No Node runtime upgrade occurred. A frozen, script-disabled
install reproduces the resulting lockfile; the benign resolver normalization
is retained rather than hand-editing an inconsistent peer graph.

## Final local gates and refresh

- API unit gate: **1,122 passed / 24 skipped**. After the crash-safety correction,
  changed lifecycle/event tests and the SST/generation documentation gate passed
  again (**35 targeted unit cases**); unchanged broad unit suites were not repeated.
- Full database regression gate: **1,009 passed / 4 skipped**, 103 passing files,
  on the explicit fresh loopback disposable DB. This includes the corrected
  18 lifecycle/route/crash SQL cases and fresh/stuck migration coverage.
- API/web types, web build, `pnpm db:check`, SST syntax without provider execution,
  whitespace check and frozen install pass.
- Migration 0084 was reviewed as additive: one operational table/index plus
  functions/triggers, no owner memory rewrite/reset. Actual local app target
  verified as `::1:5432/waka_dev`, role `agi`; migration ledger advanced 84 → 85.
- Refreshed the existing API watcher without restarting nightly/model work.
  `http://localhost:3010/api/health` returns 200/`ok:true`; the root UI's served
  main JS matches the freshly built bytes. The same persistent terminal remains.
- Exact disposable `waka_secperf_20261110_test` was dropped and catalog absence
  verified. Test schemas/global migration databases cleaned themselves. No
  owner captures, keys or memory were deleted; no push/deployment. Main’s
  subsequent read-only development audit is recorded below.

## Operational gates

Prepared infrastructure: completed-object notifications to a standard SQS queue,
native partial failure redelivery, 14-day message/DLQ retention and a DLQ-depth
alarm. `WAKA_OPERATIONS_ALERT_TOPIC_ARN` can supply an operator-approved SNS
destination at deployment. Without it the alarm has no delivery action; neither
an alarm resource nor a console message counts as owner notification. Review
the deployment diff/IAM, actual event delivery, retry/backlog behavior, DLQ
redrive and a real delivered notification before production acceptance. The
local attachment stub does not publish real S3 notifications; tests explicitly
drive the completion adapter instead.

### Fresh read-only development observations

Local AWS CLI/credential sources were unavailable, but Main ran the repository's
existing verify-only GitHub Actions workflow using its established credentials.
[Run 42971165948](https://github.com/waka-eng/waka/actions/runs/42971165948)
passed on committed `3992dc33`; deployment/check jobs were skipped, with no
migration, secret update, alarm exercise or live configuration change.
The [sanitized receipt](../craft/evidence/security-performance-2026-11-10/dev-read-only-audit.json)
records successful URL/resource-policy reads: URL authentication is `NONE`, a
public principal is present, and no CloudFront service grant was observed by
the bounded policy reader. This is not proof of unrestricted account-data
access or of the policy's complete conditions. Exclusive ingress and actual
forwarded-header trust remain **unverified**, so trusted proxy hops stay unchanged.
The audit also observed the daily sweep as the only enabled worker schedule;
alerts were inspected read-only and external notification delivery remains false.

The new cleanup resources exist only in the current worktree, not in that
committed deployment. Event delivery, lifecycle/IAM, dead-letter redrive,
notification delivery and actual erasure latency remain operational gates.
A finite late-PUT erasure bound requires observing the completed upload event
and successful cleanup; URL expiry is not that boundary.
