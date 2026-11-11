# Production readiness — 2026-11-10

Assumption: the next release is the first externally used **web** release,
initially a controlled beta unless the owner chooses public registration.
Available evidence does **not yet support release approval**. This is a focused
checklist, not a new implementation, production audit or authorization to deploy.
No tests, provider calls, cloud reads or data mutations were performed here.

## What the evidence establishes

| Level | Established | Limits |
| --- | --- | --- |
| Current local worktree | Single companion; crash-safe object closure before DELETE, generation-CAS settlement, issuance inventory and completion reconciliation; citation SELECTs 90→15 with matching output digests; parser patch and zero-advisory production audit. 1,009 SQL / 1,122 unit tests passed, plus 35 post-correction targeted units; types/build/migration/frozen-install checks passed. | Changes remain uncommitted at HEAD `3992dc33`. Migration 0084 was applied only to verified local `waka_dev`. Local adapter timing and crash tests are not deployed acceptance. See `security-performance-implementation-2026-11-10.md:107`. |
| Committed/development evidence | [Read-only run 42971165948](https://github.com/waka-eng/waka/actions/runs/42971165948) succeeded at committed `3992dc33`; daily-only worker schedule verified. Historical goal records describe earlier dev deliveries. | The new run skipped check/deploy/migrations/secrets. It does not deploy or test the uncommitted candidate. URL auth NONE/public principal were observed; exclusive ingress/header trust and external alert delivery were **not** attested. Receipt: `docs/craft/evidence/security-performance-2026-11-10/dev-read-only-audit.json:2`. |
| Actual production | Source config names `waka.im` and retains production resources (`sst.config.ts:65`, `:77`). | Current deployed SHA, schema, policy conditions, secrets, DB/store isolation, backups, event delivery, alerts, billing and release acceptance are **unverified**. A development observation or old handover does not establish these facts. |

## Ranked release checklist

All seven items below block accepting real external memory on the current
evidence. Work may be prepared in parallel; the deployment sequence follows.

### 1. Freeze a reviewable candidate and bind release to its checks

**Dev/Main:** assemble the intended changes into a reviewed release SHA without
blanket-staging unrelated owner work. Pass the existing CI workflow on that exact
SHA, then bind production deployment to that result/ref. CI already includes a
low-threshold production dependency audit, types, disposable SQL/migrations and
web tests/build (`.github/workflows/ci.yml:95`, `:110`, `:125`, `:154`). Browser and
paid-model gates are deliberately separate, not implied by a green automatic run.

**Specific gap:** production has one manual deploy job with checkout of the
dispatch ref, no explicit reusable-check dependency or DB-target comparison
(`.github/workflows/deploy.yml:39`, `:46`, `:137`). Dev calls CI and compares
configured targets (`.github/workflows/deploy-dev.yml:62`, `:142`). Repository
branch protections/environment approvals are unknown; this is not a claim that
no protection exists anywhere. Review cancellation safety and domain cutover as
part of this workflow. CI uses Node 24, production deploy builds on Node 20
(`ci.yml:44`, `deploy.yml:24`); align or demonstrate the approved build/runtime
combination rather than assuming equivalence.

**Receipt:** exact SHA + passing checks + reviewed infrastructure diff + verified
release-ref/approval controls. **Owner/admin:** approve the concrete release and
provide repository/deployment access; no deployment is authorized by this review.

### 2. Prove production targets, backup/restore and migration rollback

**Owner/admin + Dev:** identify the actual production and development database,
object store and secret bindings using sanitized authoritative identifiers.
`scripts/check-deployment-databases.mjs:1` compares configured endpoint strings;
it cannot prove differently named aliases are independent databases. Do not
infer isolation from an env filename or the statement that there are no users.

Record production backup/PITR policy, retention, access and owner-approved
recovery objectives, then restore a current backup into an isolated target and
verify schema, representative ownership/locked wording and object references.
The old shared-Neon backup in `docs/goals/three-layers.md:930` is historical,
not a current production restore receipt. Production resource `retain` is useful
but is not backup/restore verification.

Rehearse the full production migration delta from the **observed** production
ledger, not just 0084 from the local ledger. The workflow migrates before SST
deployment (`deploy.yml:137`): define recovery for migration-success/deploy-failure
and code rollback. Preserve the ledger/triggers and completion consumer; rolling
back to an API without issuance inventory while accepting new PUTs would reopen
the late-upload boundary. Plan upload issuance/cutover control explicitly, rather
than assuming URL expiry drains in-flight requests. **Receipt:** isolated restore
and upgrade/rollback rehearsal, backup timestamp, target attestation and a named
recovery operator; never a reset of owner data.

### 3. Accept production auth, ingress and intended product configuration

**Dev/Main implement/verify; owner/admin supplies actual origin/OAuth policy.**
On the candidate stage, prove login/signup/Google callback, Secure/HttpOnly
cookies, logout/session revocation, cross-account/profile refusal, export and
admin denial using synthetic accounts. Existing cookie/session controls are in
`packages/api/src/lib/auth.ts:50`, `:235`; these need live-origin acceptance,
not replacement based on an assumed absence of controls.

Attest Function URL policy **conditions**, direct-origin reachability and
forwarded-header append/overwrite behavior before configuring proxy trust.
Unknown topology deliberately disables source bucketing while identifier/device
protections remain (`packages/api/src/lib/login-throttle.ts:282`, `:298`). The dev
NONE/public-principal flags alone prove neither bypass nor a production exploit.

**Concrete launch decision:** production currently always sets
`WAKA_CONVERSATION_REPLIES=0`; the chat model override is development-only
(`sst.config.ts:271`, `:283`). Choose disabled replies as an explicit product
limitation, or approve and verify production chat/model configuration and its
cost/privacy/quality receipt. Do not silently inherit a dev feature flag.
For a closed beta, verify an enforced admission boundary: signup currently
proceeds from valid credentials to account creation without an invitation check
(`packages/api/src/routes/auth-password.ts:182`). A private URL alone does not
establish invite-only access; an external edge restriction is unverified.
Production admin opt-ins are absent from the dev-only block; keep them closed
unless explicitly needed and prove the intended authorization/allowlist.

### 4. Exercise durable erasure in the real object-store deployment

**Dev/Main + cloud admin:** deploy/review migration 0084, exact store identities,
completed-object notifications, queue/subscriber IAM, retry/DLQ and the existing
daily safety sweep. These are currently code only (`sst.config.ts:460`, `:476`).
Use synthetic objects/accounts to prove live/retained reference protection,
transport and HTTP-200 per-key errors, restart recovery, owner erasure and a PUT
started before expiry but completed after a prior deletion pass. Confirm a newer
completion survives an older attempt's settlement (`attachment-sweep.ts:107`,
`attachment-uploads.ts:8`, under `packages/api/src/lib/`). Unknown event keys must
not authorize a broad orphan sweep.

Inventory historical **unbound** store holds explicitly; bind only authoritative
known identities and verify closure without deleting live bytes or arbitrary
same-named objects. Local data must not be erased merely because launch has no
users. **Receipt:** real event → durable inventory → retry → eventual deletion,
including DLQ/redrive. Establish an observed operational cleanup bound before
making a user promise. The 24-hour finalization allowance, daily batch cap and
five-minute claim are eligibility/recovery mechanics, **not** a deletion SLA.

### 5. Deliver operational failures to a responsible human

**Owner chooses recipient/channel; Dev/Main wire and exercise; admin confirms
subscription/access.** New DLQ alarm actions read
`WAKA_OPERATIONS_ALERT_TOPIC_ARN` (`sst.config.ts:474`); older queue alarms read
`WAKA_ALERT_SNS_TOPIC_ARN` and exist only inside the development branch (`:490`).
The production workflow exports neither variable (`deploy.yml:19`). Audit the
actual deployment binding; adding a topic elsewhere is not proof these alarm
actions receive it. There is no verified production equivalent of the old dev
queue alarms or delivered notification.

Cover terminal work/wake failures, overdue/exhausted/missed work, cleanup
failures/backlog/DLQ, API failures and browser render/unhandled errors. Preserve
the owner's no-idle-DB-polling policy; intended budget/cadence waits are not
incidents. The existing goal specifies sanitized metadata, deduplication and
failure → owner delivery → bounded recovery (`beta-readiness.md:76`, under
`docs/goals/`). **Receipt:** real synthetic failure and received notification,
acknowledged inspection/redrive/recovery and named support ownership. Console
alarm state alone does not pass this gate.

### 6. Approve and enforce provider costs and data handling

**Owner/admin decides policy and manages provider accounts; Dev/Main verify
wiring and safe receipts.** The recorded starting budget is $5/month, but combined
versus per-environment allocation/enforcement remains unresolved
(`docs/goals/beta-readiness.md:662`). Existing 60-starts/account/window control
(`packages/api/src/lib/model-budget.ts:45`) and usage metrics are useful but
not an application-wide dollar cap covering OpenRouter, Gemini and infrastructure.
Verify actual stage credentials/project billing caps, reset periods, headroom,
budget delivery and the expected held-work behavior. Inference keys do not
themselves grant provider-management authority. Paid smoke/evaluation requires
an explicit bounded allowance; no historical evaluation budget is reused here.

Approve provider collection/retention and the corresponding user-facing data,
deletion and support explanation. Restrictive request preferences exist
(`packages/api/src/lib/openrouter-http.ts:117`), but `sst.config.ts:269` only
forwards flags present in the deployment environment; the production workflow
does not export those privacy flags. Actual account/provider policy is
unverified. **Receipt:** approved stage budgets/provider choices, authoritative
cap/privacy observations and the candidate's effective sanitized configuration.

### 7. Measure the deployed candidate and complete human acceptance

**Dev/Main:** synthetic desktop/narrow built-web journeys on the release SHA:
auth/onboarding, private save/draft recovery, find/Review, single-companion chat
as configured, locked wording/share preview, export and deletion. Observe real
warm/cold/concurrent queue → retrieval → provider → publication stages and
bounded recovery/idempotency. Do not relabel the local 90→15 SELECT improvement
as deployed HTTP/provider latency (`docs/goals/beta-readiness.md:58`).

Keep existing gates: ≤4 unsolicited detail reads/≤40 requests in 60 seconds;
2,000-item fixture with 150 ms API delay Home median ≤800 ms/p95 ≤1.2 s, warm
chrome ≤400 ms; Review ≤3 core requests/median ≤500 ms; 10,000-item search p95
<100 ms and context median <60 ms/p95 <100 ms. Distinguish these defined local
fixtures from separately recorded deployed timings; preserve output/tenancy
checks (`docs/goals/performance-improvements.md:18`). Agree the launch cohort
and expected concurrency before interpreting deployed results.

**Owner recruits five first-time participants; Dev/Main observe the candidate.**
The results CSV has only its header (`docs/craft/evidence/web-quality/first-time-results.csv:1`).
Use the existing five tasks and target: ≥4/5 unaided on each task, zero accidental
public shares or deletion through navigation; retain failures and repair/recheck
recurring confusion (`first-time-check.md:3`, `:29`, in the same directory).
Agent/owner walkthroughs do not replace this gate. General beta/web-quality goals
remain incomplete; no threshold is waived for a small cohort.

## Sequence and the few owner decisions

1. **Owner decisions now:** controlled beta versus public admission/cohort size;
   whether launch includes replies and which approved model; production/dev
   budget allocation and provider-data policy; operations recipient/responsible
   person and recovery/retention objectives. The existing $5 amount need not be
   invented again—its scope/enforcement needs resolution.
2. **Dev/Main next assignment:** prepare a reviewed candidate SHA and a concrete
   production release configuration/workflow proposal covering exact CI/ref
   gating, database preflight, chat, privacy and both alert bindings. This is
   preparation for approval, not authorization to dispatch production now.
3. Rehearse restore/migrations on an isolated copy; deploy that same candidate to
   development and exercise cloud erasure/notifications, authentication and
   deployed measurements with approved synthetic data/spend. Run human tasks in
   parallel once the candidate is stable. The current verify-only run is not
   this deployment.
4. Review the evidence and infrastructure diff, approve a bounded production
   rollout, then verify production targets/config/health/auth before admission.
   Complete safe production-specific event/alert/cost acceptance before real
   external captures; keep a named stop/recovery path.

| Scope | Release implication |
| --- | --- |
| Controlled external beta | Can limit cohort and manual support load, but still needs the data/security/operations and human gates above. Password reset is absent by current product choice (`auth-password.ts:375`); approve a workable recovery/support policy and explain it before account use. Do not quietly resume the closed reset feature. |
| Public web registration | Additionally demonstrate enforceable admission/abuse and aggregate cost controls at the chosen public exposure/concurrency, plus a workable account recovery/support path. Current source alone is not evidence that these public-launch conditions hold. |
| Native/store release | Separate later gates for signing/stores, physical-device capture and account/link behavior. Native capture and later UX are owner-paused (`docs/goals/native-capture.md:3`, `ux-feature-implementation.md:3`); do not resume them for web release. |
| Legacy-key inventory | Explicitly skipped by owner; not a release work item. Do not revoke/delete existing credentials or local records on the assumption of no users. |

No production acceptance item or overall goal was marked complete by this review.
