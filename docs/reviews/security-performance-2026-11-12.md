# Focused security and performance review — 2026-11-12

Baseline: `a14919fd5a4fee089104d39996dbdf559145cdb1`, freshly fetched `origin/dev`.
This follow-up fixes two bounded source findings. Delivery is a PR to `dev`,
required checks and Main review before merge. Main/production are unchanged;
older atomic main/dev publication approvals are superseded by the owner's new
[delivery policy](../agent-team.md#delivery-policy).

Read the goal index and the own Status/gates of beta readiness, web quality and
performance. They retain human/deployed measurement gates. Native capture and
later UX remain paused. Legacy-key UI, admission/recovery and aggregate provider
spend policy were not silently resumed. No model calls, owner/shared DB probes,
cloud changes, test alerts or production invocations were used for this review.

## Fixed findings

### 1. A new dev run could interrupt mutation and then clear its predecessor's lock

**Medium availability/state-integrity risk; source confirmed, no live incident
or exploit asserted.** The old development concurrency cancelled in-progress
runs, while the next pipeline unconditionally ran SST unlock before secret,
migration and infrastructure operations. Rapid routine dev merges could cancel
a mutable apply and then remove its protection without establishing abandonment.

[The workflow](../../.github/workflows/deploy-dev.yml#L40) now cancels only the
separate verify-only lane. Mutable runs remain serialized and non-cancelling.
The automatic unlock step is removed; existing stage locks fail closed. Explicit
CI-success gating and event-SHA pins bind check and deployment source. Verify-only
semantics and production workflow bytes are preserved. [Operator instructions](../operations/development-deployments.md)
require exact stage/update ownership evidence and separately reviewed recovery;
no new unlock authority is granted. Pending-run replacement and independently
started operator processes remain GitHub-concurrency limitations.

### 2. Retained enrichment evidence repeatedly scanned the whole attachment result

**Bounded performance issue; high confidence in the measured transform, limited
applicability.** [Signal detail](../../packages/api/src/routes/signals.ts#L674)
filtered all enriched attachments for every evidence row: E×A identity visits.
A request-local index now groups the same returned rows once, preserving order
and the first matching quote. No SQL statement/filter, snapshot/hash/revision,
500-character quote rule, current/material gating, response membership, window,
tenancy or human lock changes. No cross-request proof cache.

Current derivation quotes personal passages only. This enrichment-source branch
is retained-data read compatibility; this is **not** a claimed latency win for
all new signals or current production traffic. The real DB regression explicitly
seeds that retained variant on a current material receipt, then checks multiple
ready attachments (first is not a match), foreign ownership/FK refusal, stale
source suppression and locked wording. Existing reflection/current-support tests
remain in force. Null/missing text and chat-only null-parent rows are covered by
the actual reader's projection fixture.

Matched local measurement, seven samples, fixed clock, actual `getProfileSignal`
with deterministic query-result fixtures, 2,000 evidence rows and 12,000 supplied
attachment rows (including defensive nullable text):

| Measure | Before | After |
| --- | ---: | ---: |
| Attachment identity visits | 24,000,000 | 12,000 |
| Reader transform median | 468.612 ms | 21.829 ms |
| Fixture query calls | 7 | 7 |
| Output digest | identical | identical |

Digest: `f48fff4db8b898a559f8cf42362528ab12ab57c1a2897144a5b753fbc56401fb`.
This is a 99.95% reduction in measured matching visits and about 95.3% in this
synthetic transform median. It is not real SQL, HTTP, cold-start, browser or
deployed latency. DB/I/O and other reader work remain. Reproduce with
`WAKA_MEASURE_SIGNAL_DETAIL=1 pnpm --filter @waka/api exec vitest run --config vitest.unit.config.ts src/routes/signal-detail-work.test.ts --silent=false`.
The test asserts a work bound rather than a fragile wall-clock threshold.

## Current review disposition

- **Auth/tenancy:** request authentication still checks a revocable DB-bound
  credential; personal key allowlist and human-only account gates remain.
  Selected source/material queries retain owner predicates and composite FKs.
  No new cross-owner capability was established. This is not an exhaustive audit.
- **Input/SSRF/uploads:** current scheme/credential/DNS checks, checked-address
  socket pinning, redirect checks, body deadlines/size caps and upload ownership
  remain. Existing durable issued-object/closed-generation protections are not
  reopened or replaced. No provider/network or live erasure exercise was run.
- **Queue/idempotency:** prior accepted fixed-window chat quota, committed replay,
  uncommitted-pending recovery, budget waits and durable cleanup fences remain;
  no fresh duplicate-dispatch trigger was confirmed in this focused pass.
- **Browser/runtime:** initial archive paging, return snapshots and covered/hidden
  canvas scheduling remain; no new idle-frame or bundle regression was proved.
  No browser timing or paid quality result is inferred from the CPU fixture.
- **Operational status:** historical launch/monitoring text saying candidate or
  inactive is stale. Accepted baseline [production](https://github.com/waka-eng/waka/actions/runs/43197995514)
  and [development](https://github.com/waka-eng/waka/actions/runs/43197995696) are green;
  actual runtime34, monitoring27 and budget19 checks plus natural baseline passed.
  Previously exercised Discord alarm/recovery, PostHog processed issue/privacy,
  and one SNS budget setup canary are retained accepted receipts, not re-exercised
  here. Native billing threshold delivery, human acknowledgement and a live
  attachment erasure/failure/retry/DLQ exercise remain distinct limitations.

## Dependency evidence

Fresh `pnpm audit --prod --json`: **zero advisories**, 180 runtime dependencies.
The full tooling graph has **six** (one high, four moderate, one low); this does
not establish six deployed application vulnerabilities. No versions or lockfile
were changed merely to clear tooling counters.

| Package/path | Current applicability and primary advisory |
| --- | --- |
| SST/OpenControl Zod3 | Oversized constrained collection validation affects the local control/tooling chain; application uses Zod4. Keep the development control server away from untrusted callers; major SST/provider migration is separate. [Maintainer fix and remaining v3 discussion](https://github.com/colinhacks/zod/pull/6652) |
| SST AWS SDKv2 | Region must be trusted; deployment config pins its region. Application SDKs are v3. [AWS advisory](https://github.com/aws/aws-sdk-js/security/advisories/GHSA-j965-2qgj-vjmq) |
| OpenControl/MCP node-server2.1.0 | Advisory requires protected static paths through `serveStatic`. The application's node adapter is patched2.1.3; Lambda uses Hono's AWS adapter. No affected application route was found. [Maintainer advisory](https://github.com/honojs/node-server/security/advisories/GHSA-rmxm-3fg6-px4f) |
| SST/MCP/Express qs6.16.0 | Trigger requires `stringify` comma-array mode with attacker-shaped objects; no such WAKA source call found. Tooling maintenance can use patched6.16.1 with consumer checks separately. [Maintainer advisory](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw) |
| Capacitor CLI/rimraf glob13.0.6 | Cancellation can leave traversal running. Tooling-only; patched major14.0.2 needs compatibility checks and is not a web/runtime upgrade. [Maintainer advisory](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4) |
| Same CLI path minimatch10.2.6 | Requires attacker-controlled patterns and optimizationLevel≥2; no application request path invokes the CLI. Patched11.0.1 is a major. [Maintainer advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) |

## Verification and rollout

Targeted workflow/reader checks passed. Real material/support/independence cases
use a fresh disposable loopback PG17 database, never an env-file default or owner
data; all providers are stubs. Initial harness collection lacked a synthetic JWT
secret; it was supplied without copying stage secrets. A new fixture initially
expected derivation to emit an enrichment quote, then was corrected to explicitly
seed the retained variant. No generation policy was changed to satisfy the test.
API typecheck and the full API unit gate passed: **1,424 passed, 24 skipped**
(127 passed files, five skipped). The focused workflow/reader run passed 54
checks; 32 unique material/support/independence DB cases passed across the
affected runs (the corrected material file passed all 18). The exact disposable
test database was dropped and its separate PG17 cluster stopped. No owner DB
or local app process was changed. PR CI remains required before merge.

No schema/migration, dependency, production workflow, SST/IAM, monitoring, budget
or private-env changes. The dev workflow improvement becomes effective only after
reviewed dev merge; existing lock failures intentionally stop for operator review.
Main remains at the accepted baseline. Public readiness is still governed by
[the launch gates](production-launch-2026-11-11.md), not by a green PR alone.
