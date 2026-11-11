# Real-user web launch checklist — 2026-11-11

**WAKA is already deployed.** The application baseline `b04d1da3` passed production
and development deployment acceptance. This is the current must-do list before
accepting real-user/public memory, not a claim that another deployment alone
makes the service ready. It does not authorize cloud exercises, provider spend,
new recipients or policy changes. [Exact release evidence and rollback constraints](production-deploy-receipt-2026-11-11.md)
are separate from the historical [pre-release assessment](production-readiness-2026-11-10.md).

Assumption: first externally used **web** cohort. Native capture and later UX stay
owner-paused. [Beta readiness](../goals/beta-readiness.md#milestone-4-performance-and-operational-reliability),
[web quality](../goals/web-quality.md#gates) and
[performance](../goals/performance-improvements.md#gates) keep their existing Status
and gates; this checklist neither completes nor weakens them. No model, database
or live cloud exercise was run to write it.

## Already passed; do not repeat without a reason

- Exact-SHA reusable CI before production mutations; automatic main release,
  separate automatic development release, successful baseline workflows and
  all 34 mandatory production runtime checks. Both remote databases are distinct
  at ledger 86; backups restored and additive upgrades rehearsed without reset.
- One companion with retained isolated legacy data; tenant/revision/locked wording,
  idempotency, crash-safe durable attachment closure and generation-CAS settlement
  covered by targeted and full existing CI. Deployed completion notification,
  least-privilege send/consumer policy, mapping and queue/DLQ settings accepted.
- Actual production API/worker/third writer and dev API/worker DB/key/chat/model/
  stage/store bindings accepted. Chat and sharing the approved development key
  were explicit owner decisions, not remaining launch questions.
- One bounded synthetic production answer, account-wide 429/Retry-After,
  committed replay and synthetic-account deletion/revocation passed. The durable
  [20/minute + 120/hour fixed-window quota](../../packages/api/src/lib/chat-rate-limit.ts#L6)
  is real but does not limit total signup traffic or whole-app dollars.
- Fresh baseline production dependency audit reported zero advisories. Six
  GitHub alerts mapped to SST/opencontrol or mobile CLI tooling chains; no current
  production route exploit was confirmed. Tooling maintenance remains follow-up.

## Ranked remaining gates

### 1. Bound admission, account recovery and aggregate spend

**Type:** owner decision plus public-abuse/spend gate. **Owners:** owner/admin
sets exposure/budget; Dev/Main implement or verify the chosen boundary.

[Signup](../../packages/api/src/routes/auth-password.ts#L159) creates an account
from validated credentials without an invitation gate. The reviewed source does
not make a private cohort enforceable. Each new account gets its own chat/provider
allowance, so a shared provider key plus account quotas cannot cap a flood of new
accounts. Identifier/device login protections exist; they are not signup or
aggregate cost admission. Public auth/capture traffic has no newly invented
site-wide IP middleware in this release.

The existing owner choice is USD 5/month starting recurring AI budget; whether
combined or per environment and provider allocation/enforcement are unresolved
([budget record](../goals/beta-readiness.md#L662), dated log).
This is distinct from old evaluation allowances. OpenRouter is shared by explicit
choice; Gemini and infrastructure also incur costs. Request/token limits and
reported usage are not a hard dollar cap. Inference-key access is not evidence
of provider-admin access or an enforced billing limit.

There is deliberately [no password reset](../../packages/api/src/routes/auth-password.ts#L375).
Do not resume its deferred feature by stealth. Choose supported sign-in methods,
recovery/support ownership and a safe ownership-verification path; explain the
actual limitation before real users depend on password-only access.

**Must show:** chosen public versus controlled admission is actually enforceable;
normal signup/login/callback/logout on the intended origins and supported auth
methods work; synthetic unauthorized/foreign session/export/admin refusals and
session revocation remain correct. Demonstrate the chosen provider/project/key
limits and expected exhaustion behavior across dev+prod, with a named budget
owner. No new-account bypass or misleading recovery affordance. No real-user
content in probes. A controlled beta still needs an enforced cohort boundary;
public launch additionally needs abuse controls matched to its exposure.

### 2. Own ongoing recovery before storing irreplaceable memory

**Type:** data-loss gate. **Owners:** owner/admin selects retention and recovery
objectives/operator; Dev/Main document and rehearse the approved path.

The release's private snapshots and restore/upgrade rehearsals passed. They are
one-off evidence. Current workspace evidence does **not** establish ongoing
production backup/PITR schedule, retention, access, monitoring or agreed RPO/RTO.
SST's production [resource retain setting](../../sst.config.ts#L77) is not a backup.
DB restoration also needs a plan for attachment references and irreversible object
erasure; a DB snapshot does not restore deleted object bytes.

**Must show:** named recovery operator, accessible current recovery point and
approved retention/RPO/RTO; isolated restore of schema, identity/ownership,
representative locked wording and attachment-reference behavior; a concrete
migration-success/deploy-failure recovery decision. Keep additive schema,
issuance inventory, durable fences and completion consumer. Prefer forward fixes;
never restore the old unprotected issuer, down-migrate or reset user memory.
Do not promise restoration beyond the chosen object-deletion/retention boundary.

### 3. Prove live erasure and failure delivery before external attachments

**Type:** privacy/operational data-retention gate, required by the existing
[external-object and owner-alert gates](../goals/beta-readiness.md#production-gate-owner-alerting-added-2026-10-28).
**Owners:** Dev/Main exercise approved synthetic cases; owner/admin provides the
responsible recipient and access. Wiring/source tests already passed; this is
end-to-end acceptance, not a request to rebuild the mechanism.

[S3 completion→SQS/DLQ](../../sst.config.ts#L453) and crash-safe closure/CAS settlement
are deployed. A real late/in-flight PUT, failed delete, restart, retry and DLQ
recovery sequence has not been exercised in the deployment. HTTP-200 per-object
errors and transport failures are covered locally, not proved by green health.
Unknown keys are not authority for orphan sweeps; historical unbound stores stay
quarantined until authoritatively bound. Closure must preserve live/retained
references and newer completion events.

The [production cleanup alarm](../../sst.config.ts#L468) has no destination when
`WAKA_OPERATIONS_ALERT_TOPIC_ARN` is absent. Existing
[`WAKA_ALERT_SNS_TOPIC_ARN` recovery alarms](../../sst.config.ts#L515) are dev-only;
filling that variable alone does not add production signal coverage. Browser
exceptions still reaching a local console are not a delivered operator incident.

**Must show:** synthetic completion event → durable inventory → bounded failure/
retry/restart → eventual unreferenced-byte deletion, including a PUT begun while
valid and finishing after expiry/earlier cleanup, duplicate/out-of-order events,
DLQ/redrive and preserved live references. Separately demonstrate failure
detection → deduplicated content-free notification received by the named human
→ inspection and bounded recovery. Cover terminal/wake/overdue work and required
API/browser failures without idle DB polling. Console alarm state is insufficient.
No finite erasure SLA is established by grace, daily sweep or retry constants;
measure backlog/dispatch as well as eligibility before making a deletion promise.

### 4. Confirm provider-data policy and attested source controls

**Type:** explicit owner/admin policy + security/privacy acceptance. **Owners:**
owner/admin approves the data policy and attests provider/ingress configuration;
Dev/Main verify effective requests and authorization under that policy.

The [OpenRouter request helper](../../packages/api/src/lib/openrouter-http.ts#L115)
only adds restrictive preferences: unset/blank inherits provider-account policy;
`data_collection=deny` or ZDR can restrict it, never relax an account requirement.
Blank overrides are **not proof that collection is enabled or disabled**. Effective
OpenRouter/account/provider and Gemini project terms/tier/retention remain
unverified. A ZDR flag does not configure Gemini or establish the whole app's
privacy policy. User-facing capture/provider/deletion explanations must match
what the approved providers actually receive and retain.

[`WAKA_TRUSTED_PROXY_HOPS` blank](../../packages/api/src/lib/login-throttle.ts#L282)
is a safe non-guessing default: source bucketing stays off; identifier/device
protections remain. Do not set a hop count from a diagram or trust arbitrary
X-Forwarded-For. Function URL public-principal/NONE observations alone do not
prove an account-data bypass. The actual exclusive-origin/header conditions
remain unattested; preserve auth/cache/CORS boundaries and verify them before
relying on source/edge quotas for public exposure.

**Must show:** approved/disclosed provider handling supported by authoritative
account/project evidence and sanitized effective-request checks; intended origin,
OAuth/cookie/session/tenant/cache protections accepted for supported launch
paths. If source-based protection is part of the admission plan, attest direct
origin reachability and header append/overwrite semantics first, or choose an
independent enforceable control. Do not manufacture proxy or privacy settings.

### 5. Finish the existing performance and human product gates

**Type:** existing beta/product acceptance, not evidence of a security defect.
**Owners:** Dev/Main measure the approved synthetic candidate; owner recruits
participants and supplies expected cohort/concurrency.

Citation work was measured at pool one with identical output digests and
90→15/14 SELECTs. These are local reader timings, not deployed end-to-end p95.
One successful synthetic answer is not a latency distribution. Use existing
[instruments and sample rules](../../tools/performance/README.md) to record
warm/cold/concurrent queue, retrieval, provider and publication stages; validate
save/reload/retry, Review, chat and locked wording without existing owner content.

Keep the [existing fixture thresholds](../goals/performance-improvements.md#gates):
≤4 unsolicited detail reads/≤40 requests in 60 seconds; 2,000-item/150 ms-delay
Home median ≤800 ms, p95 ≤1.2 s and warm chrome ≤400 ms; Review ≤3 core requests,
median ≤500 ms; 10,000-item search p95 <100 ms and context median <60 ms/p95 <100 ms.
Label these fixture results separately from real deployment timings. The current
static handoff/icon change does not justify repeating already-passed full local
suites or paid matrices. It also cannot close the open deployed timing gate.

The [first-time results CSV](../craft/evidence/web-quality/first-time-results.csv)
has only its header. Observe the [five existing tasks](../craft/evidence/web-quality/first-time-check.md)
with five first-time participants: ≥4/5 unaided on every task, zero accidental
public shares or navigation deletion. Keep failures and recheck recurring
confusion. Agent/owner walkthroughs are not participants. Do not declare general
beta readiness before the goal's human/operational evidence exists.

## Blank options are not five independent blockers

| Option | Current meaning | Required launch action |
| --- | --- | --- |
| `WAKA_OPENROUTER_DATA_COLLECTION` | No extra request restriction when blank. | Confirm actual account/provider policy; set `deny` only if it implements the approved policy. |
| `WAKA_OPENROUTER_REQUIRE_ZDR` | No extra ZDR request preference when blank. | Decide retention policy and provider compatibility; ZDR is not automatically mandatory and does not cover Gemini. |
| `WAKA_OPERATIONS_ALERT_TOPIC_ARN` | Production DLQ alarm has no delivery action when blank. | Supply an approved destination or another verified delivery mechanism covering the required production signals. |
| `WAKA_ALERT_SNS_TOPIC_ARN` | Legacy recovery alarms are development-only. | Not a standalone production requirement; verify production coverage rather than filling a dev setting blindly. |
| `WAKA_TRUSTED_PROXY_HOPS` | Deliberately refuses to guess a source address. | Keep blank until topology attested; admission/abuse protection must not depend on untrusted forwarded headers. |

## Owner inputs and sequence

Only three decision bundles remain; enabled chat/model/shared OpenRouter and
publishing the static handoff are already approved:

1. **Exposure and support:** controlled versus public cohort, expected concurrency,
   supported sign-in/recovery and responsible support contact.
2. **Provider policy and spend:** data collection/retention/disclosure, the existing
   USD 5/month allocation across shared dev/prod OpenRouter plus Gemini and the
   actual enforcement/admin access. No cap is inferred or changed here.
3. **Operations and data recovery:** responsible operator/recipient, backup and
   restore objectives/retention, and any user-facing deletion/recovery promises.

Then Dev/Main prepare bounded admission/recovery/alert work and authorized
synthetic erasure/restore/auth/performance acceptance; owner/admin supplies actual
provider/ingress/backup evidence. Human observations can run on the stable
candidate in parallel. Review recorded failures before exposure, not after a
green health check. A small cohort reduces load but does not waive existing
security, operations or human gates. Native signing/store/device capture, later
UX and dev-tool dependency maintenance remain separate work; legacy-key inventory
was explicitly skipped and must not be reopened or revoked as cleanup.
