# Production release candidate — 2026-11-11

Status: candidate preparation; production dispatch requires Main's review of the
immutable checked commit and actual SST preview. No goal's acceptance bar changes.

The owner approved shipping the current web app to waka.im, reusing the current
development OpenRouter key, and subsequently explicitly approved WAKA's Chat
answers with the same development model. These decisions supersede the earlier
production-off Chat entries in the dated readiness/environment reviews.

## Candidate and preservation

Base: `3992dc33ee09580b7b4562bd5aab04f8779dfdc4` (fresh origin/dev unchanged).
Isolated branch `release/production-20261111`; original dirty checkout stays on dev.
Included: completed single-companion API/UI/canon/tests; durable attachment
inventory/fence/event consumer and migration0084; bounded citation batching and
measurement harness; narrow XML-parser override; exact-SHA reusable CI gate,
stage-env validation and technical reviews; account Chat limiter/migration0085;
production Chat enablement and a checked infrastructure-preview mode.

Excluded: owner mobile icon/README work, web index/icon-only work and new public
icons, tools/app-icons.mjs, docs/waka-models-and-core-logic.html, all work/ files,
private stage envs/backups, .paseo state and Main's team instructions/.gitignore.
AGENTS includes only the product-model summary correction. A path-level manifest
and source preservation hashes are retained locally, outside the release index.

## Effective configuration and secrets

Production Chat is enabled (`WAKA_CONVERSATION_REPLIES=1`) using the verified
current development pin `deepseek/deepseek-v4.1-flash-1017`. API and worker share
the same runtime environment, including the linked OpenRouter key. Dev admin,
internal-status and job-admin flags remain dev-only. No other model, provider
privacy, proxy-trust, admission, alert destination or budget choice changes.

The ignored0600 production file has a private0600 backup. Only OpenRouter,
Chat flag/model changed; all other original values and the dev file are preserved.
Named GitHub `production` environment now overrides only OPENROUTER_API_KEY and
DB_CONNECTION_URL with their reviewed private values. Existing Actions AWS
credentials and auth/JWT/Google/Gemini/global/development secrets remain intact.
The local S3-limited AWS keys are never copied into Actions. No secret value or
credential URL is included here. GitHub production environment currently has no
protection rules/branch policy; workflow checks explicitly gate its mutations.

## Chat request admission

New conversations, new user messages and newly accepted explicit reply/retry
requests share **20/minute and120/hour per account**, across profiles/devices.
One Send including its inline reply costs one accepted mutation. Fixed windows
are anchored at first accepted use, restarting after60/3600seconds; a pair of
bursts can straddle a boundary. This is not a sliding-window or dollar budget.
Defaults are code-pinned in lib/chat-rate-limit.ts; no configuration variables or
extra service/polling schedule. Existing20reserved provider slots/account/hour,
3attempts/message/hour and60queue job starts/account/hour remain independent.

Counter row locking, both counter updates and all product/job writes share one
transaction. Idempotent replay, invalid/stale/unauthorized/refused work does not
charge. Quota refusal rolls back draft IDs and new jobs, responds429 with stable
`chat_rate_limited`, positive bounded Retry-After and matching retryAfterSeconds.
Counter storage failure fails closed before commit/worker wake. Read/Stop/delete
remain usable. Existing web pending drafts retain exact words/IDs for explicit
retry; no automatic busy-waiting or source-IP/header assumptions are added.
Existing durable password login policy is unchanged; this is a focused chat gate,
not a generic public-auth/signup/read/capture traffic limiter.

## Database and rollout

Actual production baseline is ledger85, Neon timeline fingerprint
`cc26e26fcfab4515`; development is distinct `3631c0e78238ea6f`.
0085_account_chat_limits.sql is additive, creates one FK-cascading operational
row/account and does not rewrite memory. SHA256:
`d8c5cde8168bb3e8ea7533c56a36f72aec3bfdfc536bae632f76de71bb425a85`.
Fresh explicit loopback test DB rehearsed85→86; synthetic ID/ownership/exact locked
words/timestamp preserved. Production remains85 until approved release workflow.
The private recoverable pre-setup PG17 archive is retained (see DB setup report).
No reset, object sweep or new development/local-owner migration is authorized.

Sequence: exact candidate CI → checked preview-only workflow (no alias/secrets/
DDL/deploy/DNS steps) → Main review → non-force fast-forward main to the exact
reviewed candidate → observe the automatic main-push release → read-only
runtime/queue/bindings/health/assets checks plus one synthetic chat answer.
Preview supplies the proposed OpenRouter secret in memory without persisting SST
secrets. SST3.19.3 diff is NOT a strict no-write command: upstream run.go
uses `command != "diff "` with a trailing space and writes an update-history
record. Main reviews this bounded metadata effect separately. An explicit
preflight refuses missing/old/new bootstrap versions, missing state and missing
passphrase before CLI initialization; no bootstrap upgrade is permitted. SST's documented Secret component marks values secret; our preview emits
only typed resource-operation identifiers, never raw state/diagnostics/artifacts.
See [SST Secret](https://sst.dev/docs/component/secret/) and its versioned
[implementation](https://github.com/sst/sst/blob/v3.19.3/platform/src/components/secret.ts).

Expected infra: attachment ObjectCreated→standardSQS(14d)→cleanup-only Lambda;
DLQ after5receives(14d),3min visibility, batch1/partial failures,30s consumer;
DLQ console alarm, no external recipient invented. Existing bucket identities and
DB must stay unchanged. Actual preview is a required separate receipt.

Rollback: keep additive0084/0085 schema, issuance inventory and durable fences.
Prefer forward fix. Disable new Chat replies for a runtime rollback if needed;
retain event consumer/SQS/DLQ/bucket notifications until all issued PUTs settle.
Never restore the historical unprotected upload issuer while accepting uploads.
No database down-migration or reset. Do not roll back buckets, credentials or
routes/aliases blindly. A deployment failure is inspected before any retry.

## Validation and remaining gates

Local targeted68SQL cases (7new limiter,24conversation,37reply) passed;30workflow/
SST/guard checks, API types and diff check passed. Concurrent distinct-message
requests across two independent max-one pools admit exactly20/28 with no partial
writes; other account unaffected. Retry replay, retained profiles, minute/hour
expiry, storage failure/recovery and rollback tested. Full candidate CI pending.

Postdeploy: verify API/worker key equality privately, replies/model/admin flags,
production DB/storage bindings, cleanup queue/redrive/notification consumer and
current built assets/health. Create a unique synthetic account with no saved
memory, send one bounded question with requestReply, wait with bounded backoff
for its answer (one normal user request,1200output-token ceiling; existing worker transient
retry policy can add attempts, so record actual attempts/usage), then delete only that synthetic account via the authorized API. No
owner content, broad evaluations or provider batch. Report actual result/limits.

External alert delivery, live late-PUT reconciliation/crash/retry exercise and a
finite erasure SLA remain operational gates; grace is not a dispatch deadline.
Historical unbound storage remains quarantined. Source/header trust attestation,
provider whole-app spending/privacy choices, real deployed latency and first-time
human comprehension remain open; legacy-key UI was explicitly skipped. Native
capture and later UX remain owner-paused. A successful deploy is not full beta
or production-readiness acceptance.


## Automatic production release — owner steering

Push/merge to main triggers production. Every run checks and deploys its exact
immutable event SHA through the reusable CI success gate before all production
mutations. Release branches/PRs cannot automatically deploy. Manual preview and
explicit manual release remain available; automatic pushes have no preview/alias
input and take the ordinary deploy path, leaving legacy-alias release disabled.
Production runs remain serialized without cancelling in-flight migrations.
Direct CI main-push trigger is removed to avoid duplicate checks; PR, reusable
and manual CI remain. Only the production workflow is enabled persistently,
as explicitly requested; no unrelated workflow, schedule or team wake is enabled.
Main publication is itself the deployment trigger and must wait for Main review.

Historical main has16 unique merge commits and no unique non-merge commits.
The ordinary ort merge into the release branch preserved both histories with
exactly identical source tree ce86f4b278cbb5a02575c6bde522606426f8902a.
The subsequent explicit automatic-release workflow/tests/docs change is the only
new source change after that ancestry merge; final SHA/tree are recorded in the
sanitized release receipt. No force push, ours merge, rebase or original-worktree
branch change is used. Main must still be an ancestor before publication.


## Forward correction before first production mutation

The first automatic run43005773164 was cancelled before its production job
mutated secrets/schema/resources. A focused SDK-source verification found
SST3.19.3 Queue.createPolicy permits S3/SNS/EventBridge SendMessage without a
source condition. Handler tenancy/inventory fences prevent arbitrary erasure,
but unsolicited service delivery can still consume Lambda/database resources.
The forward correction replaces the legacy Bucket.subscribeQueue helper with
an explicit S3-only queue policy conditioned on this bucket ARN and current AWS
account, plus a notification resource dependent on that policy. No live IAM
policy was changed outside the reviewed deployment. The new preview exposes
these two resources directly; Lambda subscriber children remain deferred until
the queue ARN is known. The redacted postdeploy audit now verifies actual SQS
policy conditions, Lambda trust/inline/managed-policy isolation and existing
runtime/queue contracts. No model, quota, DB migration or provider-key change.

The cleanup handler calls drainAttachmentObjects and therefore needs S3 object
deletes. Its broad bucket link is replaced with s3:DeleteObject on only this
bucket's object ARNs; SQS polling remains scoped to its queue, with ordinary
Lambda logs/tracing. The new consumer's trust is Lambda-only (SST's generic
same-account root trust is not needed). Existing API/worker roles are untouched.
Confirmed cancelled run43005773164 has a production job with zero steps, so no
production secrets, migrations or infrastructure were mutated by that attempt.

The0085 journal timestamp was corrected before any production application from
Nov12 midnight (future relative to the Nov11 release) to Nov11 10:00UTC,
1794391200000, still strictly after0084. Drizzle uses this as a high-water mark;
a future value would skip migrations generated later on the release day. SQL and
schema are unchanged; the85→86 replay and subsequent same-day migration selection
are rehearsed separately. No production ledger is rewritten.
