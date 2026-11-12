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

## Alarm identity correction before preview

The preceding source review missed a provider argument: pinned
[@pulumi/aws 6.66.2 MetricAlarm](https://github.com/pulumi/pulumi-aws/blob/v6.66.2/sdk/nodejs/cloudwatch/metricAlarm.ts)
uses `name` for the physical alarm name. The helper supplied `alarmName`, which
would leave generated names inconsistent with its exact invocation permission
ARNs and the relay's allowlist. The correction supplies `name: alarmName` after
caller options and excludes name overrides from the helper's typed options.
Runtime payloads, IAM scope, cost and the separately held maintenance activation
are otherwise unchanged.

Superseded [run 43126009764](https://github.com/waka-eng/waka/actions/runs/43126009764)
at `e96d3c78` is **completed/cancelled**. Its production job executed **zero
steps**; the request's acceptance alone was not used as that evidence. No preview
or resource apply occurred in this attempt.

The preview now privately verifies all eight desired physical alarm identities
from the versioned
[Pulumi 3.210.0 engine-event contract](https://github.com/pulumi/pulumi/blob/v3.210.0/sdk/nodejs/automation/events.ts),
specifically `resourcePreEvent.metadata.new.inputs.name`, before accepting the
sanitized receipt. Missing, unknown, foreign, wrong or duplicate identities fail
closed; only counts and booleans are published. General operation redaction is
unchanged. Targeted checks execute the actual SST helper with provider
constructors stubbed, verify permission/name alignment and refusal cases, and
retain the existing isolation audit tests: **36 passed**. A new exact-SHA CI and
actual preview are still required; local fixtures do not establish cloud wiring.

## Child-failure visibility correction

[Run 43128006311](https://github.com/waka-eng/waka/actions/runs/43128006311)
at `c359d8fc` passed the complete reusable CI job. SST's preview child then exited
1 before producing resource operations. Sanitized artifact `13904406551`
verified the strict bootstrap/state/passphrase preflight but contained zero
operations and zero observed alarm identities. It **does not verify the alarm
names or infrastructure**. All alias, secret, migration, deploy, DNS and live
acceptance steps were skipped. Existing-stage update-history bookkeeping remains
a permitted preview effect; zero operations alone does not prove zero such writes.

The child error's exact cause remains unknown. Inspection of the original job
logs in memory found only the wrapper's generic failure; its captured diagnostic
text had already been deleted. Existing update metadata offered no new error.
Pinned SDK inspection did not establish another application/IaC defect.

The bounded correction changes the driver and a small diagnostic classifier,
tests and this receipt only. All application, IaC, dependencies and credential
values remain identical to `c359d8fc`. The driver classifies captured child output
in memory before deletion, publishing closed diagnostic categories and at most
eight exact public-repo/versioned-SDK source locations with bounded line/column
numbers. It publishes no message, snippet, stack, arbitrary path or value, and no
longer creates its own temporary raw log. Unknown stays unknown; observed
categories alone are not a root-cause claim. Classifier failure cannot replace
the original child exit, operation or eight-alarm identity receipt. The existing
strict bootstrap, name and redaction gates remain unchanged.

Targeted classifier/privacy/location and actual-driver fault-injection checks,
plus the retained preview and monitoring-isolation cases: **58 passed**. Script
syntax and diff checks passed. No repeated local full suite was needed for this
driver-only change. A fresh exact-SHA normal CI/preview is required; resource
apply, main/dev publication, daily maintenance activation and additional
synthetic Discord/model/data exercises remain held.

## Pinned SST log channel

[Run 43130461325](https://github.com/waka-eng/waka/actions/runs/43130461325)
at `5a788d23` again passed full CI, then failed the preview child with exit 1,
zero operations and zero observed alarms. Artifact `13904489155` reports a
successfully parsed but **unknown** diagnostic, without safe source locations.
All apply steps were skipped; no infrastructure acceptance is claimed.

Main identified a concrete missing channel in
[SST 3.19.3's CLI](https://github.com/sst/sst/blob/v3.19.3/cmd/sst/main.go):
the underlying unexpected error goes to `slog`, while default output can carry
only a generic wrapper. The CLI explicitly supports `SST_PRINT_LOGS=1`. This
explains why default output can be insufficient; it does not establish the
underlying app/IaC cause.

The driver now enables that flag **only on the captured preview child**, strips
it from preflight subprocesses, and never assigns it to the parent environment
or inherits the child's raw console. It removes the old fixed SST log before
spawn. On failure, it may read only a fresh regular, non-symlink log: at most the
last 2 MiB, in memory, through a bounded read. Captured output remains bounded
to 20 million characters. The existing closed classifier and exact source
allowlist are unchanged. Safe channel-presence flags and byte counts accompany
the original child exit/operation/identity receipt. The ephemeral SST log is
deleted after the receipt is written; only sanitized JSON is published.

The actual-driver tests cover generic output plus underlying pinned-style log
diagnostics, child-only logging, preflight/parent isolation, credential canaries,
stale/non-file/unreadable logs, bounded tails, malformed/unknown content,
cleanup ordering and unchanged failure/identity guards: **62 targeted tests
passed**, including the retained policy and monitoring-isolation cases. Script
syntax/diff checks passed. The diagnostic method is the only new behavior; all
app/IaC/dependency/workflow bytes remain unchanged. One new exact-SHA CI/preview
is authorized for this method. If it still fails or remains unknown, further
executions stop pending concrete review; apply and live exercises stay held.

## Proven startup cause and local correction

The failure is in the candidate's initial SST config load, before resource
planning. The module-level JSON import added for the shared scheduled-event
payload violated SST 3.19.3's startup contract. Its
[DisallowImports plugin](https://github.com/sst/sst/blob/v3.19.3/pkg/js/js.go)
rejects static imports from `sst.config.ts` during the initial
[Project.New app evaluation](https://github.com/sst/sst/blob/v3.19.3/pkg/project/project.go)
without injected globals, returning the exact `ErrTopLevelImport` sentinel.
Main's inspection of the pinned official Go module archive confirms that contract. Zero observed
alarms were a downstream symptom; they did not establish an IAM/name failure.

An authentic local reproduction used the installed **SST 3.19.3 binary**,
copies of the actual config/shared JSON/protocol, a credential-free environment
and HOME, disabled dependency downloads/telemetry and macOS network denial.
Both variants deliberately stop in `app()` before provider/home/run execution.
The original static import exits 1 with **ErrTopLevelImport**, without reaching
that stop. Moving only the import inside `async run()` removes that error and
reaches the deliberate app stop. Neither variant enters provider loading. The
local stderr byte counts differ from the CI wrapper; the deleted original
697-byte stream is not claimed recovered.

The fix moves the same JSON import into `async run()`; its payload is unchanged
(SHA-256 `97b673552cc5f81df14168f7fcb38c3b2f704a49b74a8a9e1ad96eb785e5ae3f`).
A real-CLI startup regression now exercises both variants, rather than mocking
the import plugin. The scheduled-event regression still sends the serialized
shared JSON through the real worker guard with all I/O stubbed; its source
assertion now reflects the dynamic import. The classifier additionally recognizes
only the exact typed sentinel. No provider policy, dependency, secret, payload,
alarm, retention or maintenance eligibility is changed.

**78 targeted tests passed**, including real CLI startup, classifier/preview and
worker dispatch cases. API typecheck and script syntax/diff checks passed. The
local correction is held for Main's review before any new CI/cloud execution;
no new dispatch, apply, release, live maintenance, provider or Discord exercise
was performed to diagnose this source defect. The last failed cloud attempt
remains [43132825056](https://github.com/waka-eng/waka/actions/runs/43132825056).
