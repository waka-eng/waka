# Production monitoring implementation review

Prepared 2026-11-11. **Source candidate, not live acceptance.** Baseline:
`19f8193135b66937d31867315a08a06e8959c935`. See the
[operator runbook, cost and privacy contract](../operations/monitoring.md) and
[remaining real-user launch gates](production-launch-2026-11-11.md).

The candidate uses two production Lambdas, one Dynamo operational table, one
14-day failure queue, one five-minute public probe clock and eight alarms.
There is no SNS hop, custom paid dashboard, vendor subscription, memory DB poll,
SQL migration or model call. Native console views are the operator dashboard.

The existing 18 potentially active model/recovery metric series are $5.40/month
under the deliberately all-active assumption, **not an observed bill**. New
production Faults/DailySweeps add two series. Fifteen production alarm metrics
plus three existing dev alarm metrics cost $1.80/month. Existing fixed baseline
including the old prod DLQ alarm is $5.80; new fixed baseline is $7.80, so the
increment is $2.00. Normal all-active/usage envelope is **$9.18/month**; the
persisted failure-cooldown/full-60s-API-timeout/chatter envelope is **$9.56** under
the stated invocation/log/query/incident assumptions. This is not a hard cap or
the entire application's AWS/AI bill.

Reliability/privacy boundaries:

- Relay-only Discord secret; exact alarm/source-account/region/stage allowlist,
  mention-free fixed content, no event/error body forwarding. Intent precedes
  POST, conditional lease and settlement fence retries; post-acceptance crashes
  may duplicate, never an exactly-once claim. Relay Errors/Throttles are excluded
  from actioned aggregates to prevent a self-alert loop; the retained failure
  queue is the delivery alert boundary, with console fallback.
- Probe has only its fixed operational Dynamo key. It commits a two-hour
  conservative deadline before API I/O; skipped probes stay degraded. One
  recovery sample cannot reset cadence; a second sample at least 30 minutes later
  is required. Root checks continue every five minutes. Real native worker Errors
  are covered; the audit requires the existing precise-wake group/role binding,
  which makes the legacy expected retry-signal fallback unreachable in Lambda.
- Missing-probe alarm starts unarmed only when new; a read-only pre-apply snapshot
  preserves actual armed state through IaC updates. Initialization requires a
  natural healthy native-metric/OK baseline; failure records actual action state
  and never disables a previously working alarm. No forced probe/state/test POST.
- PostHog no-external SDK has replay/autocapture/remote flags/URL/console/network
  recording disabled; event payloads are rebuilt from a closed metadata schema.
  Auxiliary log/metric sends are dropped. Anonymous document IDs rotate at
  logout/account change; no WAKA IDs/words/links/raw errors/stacks leave.

Verification completed locally:

- API unit gate: **1,185 passed, 24 skipped**, after adding the actual deployed
  monitoring entrypoints and isolated public clock to existing strict source
  gates. The initial stale entrypoint/clock assertions failed and were corrected;
  no gate was removed. Subsequent daily-payload worker/source regression batch:
  **53 passed**, with all sweep/drain I/O safely stubbed.
- Focused delivery/probe/storage/audit/initialization tests cover concurrency,
  crash windows, tied/out-of-order states, 429/5xx/timeout, expired claims,
  already-armed redeploy/failure, foreign identity/IAM/key refusal and full public
  health with DB/network calls made fatal. Full-timeout/chatter tests span 31 days
  of persisted state and bound failing API attempts to 373.
- Web privacy: **four checks passed**, including actual installed SDK HTTP
  payloads after automatic expansion and rejection of sensitive canaries,
  replay/identify and auxiliary log capture. API/web types, web build and current
  production dependency audit passed. SDK is a conditional ~123 KiB gzip chunk;
  ordinary entry bundle remains about 263 KiB, not a deployed latency claim.
- Private source scan: no actual stage credential matches or private paths in
  the candidate. Production-environment encrypted webhook write accepted; two
  public build variables privately matched the approved US project settings.
  Stage files remained unchanged; no global/dev credential or policy write.

Main independently verified the US PostHog project/token and no-card/free-usage
posture in the authenticated project UI. No paid plan/card setting or separately
configured per-product $0 cap is claimed. No live SDK event has been sent by these
tests. The owner's one direct Discord sample was accepted at 22:21:21 UTC; it is
not alarm-path evidence and exhausts the current synthetic-message allowance.

The daily target-payload correction is a **separate commit**
`99d79af15d1d93c4451aead4458abf78ac79ff29`. It makes existing maintenance reachable
without a new clock or manual catch-up. The runbook enumerates exact retention,
reference/closure/store protections, unbounded expired-shelf row selection and
possible ordinary processing of pre-existing newer reruns. **Live activation is
held for concrete review**, alongside the monitoring candidate.

Still required: exact-SHA CI and sanitized actual SST preview/source-policy/cost
review before main/dev publication, live mandatory runtime/heartbeat audit,
natural observations and PostHog ingestion verification. AWS alarm→Discord
delivery/recovery remains unexercised; no extra synthetic message is authorized.
Erasure, provider/privacy/spending, deployed performance, human comprehension and
owner-paused goals keep their existing gates/statuses. Original owner work and
local memory/services are untouched.

## First CI attempt and narrow vocabulary correction

[Run 43122863429](https://github.com/waka-eng/waka/actions/runs/43122863429)
at `eb49b20f` passed API units (1,191; 24 skipped) and the hermetic API suite
(2,207; 25 skipped), then failed web vocabulary preflight on eight immutable
PostHog SDK/API names. The production job was skipped with **zero steps**:
no infrastructure preview, SST initialization/history write, resource apply,
secret update, live DB operation or DNS change occurred in that attempt.

The follow-up adds only those exact names to the gate's existing ALLOWED map,
with external-API reasons, and documents the analytics test's actual `fetch`
mock boundary in its required G6 header. No runtime behavior, test assertion,
selector, exclusion or gate is changed. The real full web command subsequently
passed vocabulary, seams and **1,582 tests across 209 suites**. A fresh exact-SHA
CI/preview is still required; the failed attempt is not preview acceptance.
