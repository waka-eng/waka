# Accepted deployment handoff — 2026-11-11

**Accepted application baseline:** `b04d1da3938d51cc39678b2357733eabed40de25`.
Production and development were deployed and accepted at this exact commit.
This records a successful deployment, not approval for unrestricted real-user
launch. See the [current launch checklist](production-launch-2026-11-11.md).
Later documentation/branding releases must record their own workflow outcomes;
they do not retroactively change this baseline's evidence or complete its gates.

## Evidence and delivered behavior

| Evidence | Actual outcome |
| --- | --- |
| [Production 43018988673](https://github.com/waka-eng/waka/actions/runs/43018988673) | Exact-SHA main-push reusable CI and production release SUCCESS; all 34 mandatory runtime checks passed in artifact 13854749013. |
| [Development 43024465833](https://github.com/waka-eng/waka/actions/runs/43024465833) | Same-SHA full CI, migrations, SST, memory schema, idle-poll/chat configuration and DNS SUCCESS. Live-model CI gate skipped. |
| Release tag/tree | `production-20261111-b04d1da3`; tree `f42b743cd1a9b4acc08313dadf0d16d5c69b8fbd`. |
| Live HTTP/assets | Both domains' root, health and reviewed built assets responded successfully; this is liveness/build evidence, not full auth/UX acceptance. |
| Stage isolation | Authenticated runtime and DB metadata established distinct production/development timelines and preserved distinct stores. Both remote migration ledgers reached 86 without reset; local owner DB was not part of this rollout. |
| Effective runtime | Production API/worker and independently inspected PrincipleRefresh matched approved production DB, shared OpenRouter key, enabled chat and `deepseek/deepseek-v4.1-flash-1017`. Production admin flags stayed closed; dev-only flags stayed in development. No secret values were published. |

The release includes one WAKA companion using human-owned memory, retained and
isolated legacy profiles, durable attachment issuance/closure/reconciliation,
crash-safe cleanup settlement, citation batching, the XML parser patch and durable
account-wide accepted-chat quotas. Quotas are 20/minute and 120/hour in anchored
fixed windows, separate from provider-start/attempt and queue limits. They are
not an application-wide dollar cap or public signup-abuse policy.

Actual completion notification, exact-bucket/account S3-only SQS send policy,
14-day queue/DLQ retention, five-receive redrive, enabled batch-one/partial-response
mapping and cleanup consumer isolation passed. Consumer timeout is 30 seconds,
queue visibility three minutes, and the consumer has no model-provider keys.
The IAM gate checked trust, inline permissions and recognized AWS Basic/XRay
managed policy ARNs, not the latest full managed-policy JSON versions.

## Bounded functional and preservation proof

One synthetic production account sent one ordinary question using no owner
content. It became ready in about 15.2 seconds including polling: one worker
attempt, one answer dispatch and no embedding dispatch. Content-free worker
metrics reported 1,204 input/24 output tokens, $0.00021054 provider-reported cost
and 685.64 ms provider duration. Correlation was by the single attempt's stream
and time, not a request ID in the metric; this is not invoice proof.

The same account made 19 empty conversation creates after its question, then
received `chat_rate_limited` 429 with `Retry-After: 14`; counters were 20/20.
Committed replay returned 200 without extra provider work. Synthetic-account
deletion returned 200 and its former session returned 401. No repeated question
was sent for the audit-only correction or development synchronization.

All six original development identity/memory tables matched the pre-deploy
snapshot exactly after 84→86. Production's original IDs, ownership, wording,
locks and all other fields matched except one `profiles.updated_at`. The strict
full-row preservation check remains **false**: that single metadata delta predates
the first release mutation. Independent column attestation passed for every
other field. The actor/route is unknown; no corrective DML was performed.

A private recoverable production backup was restored and the earlier 4→85
upgrade rehearsed before guarded online application. The development snapshot
was separately restored and 84→86 rehearsed with exact memory comparisons.
Disposable restore resources were removed; private recoverable archives remain
under operator control. These one-off proofs do not establish ongoing backup,
PITR, retention, RPO/RTO or recovery ownership for real users.

## Release controls and safe recovery

Main push/merge is the canonical automatic production path. Its reusable CI and
mutation job use the same immutable event SHA; unsuccessful checks cannot reach
secrets, migrations, alias changes, deployment or DNS. Production runs serialize
without cancelling an in-flight migration. Dev pushes run their separate stage
pipeline. Repository administrative default remains dev. Historical manual refs
are not globally rewritten by publishing this workflow.

The initial aborted run had no production steps. The first actual application
rollout succeeded, but its audit rejected a valid generated consumer name. The
reviewed two-file correction at this baseline binds the exact queue mapping,
function ARN/account/region and SST stack, retaining all IAM/runtime checks.
The failed harness receipt remains part of the history; it was not relabeled green.

**Rollback constraints:** prefer a forward fix. Retain additive migrations
0084/0085, issuance inventory, durable closed fences, consumer, completion
notifications and retry/DLQ infrastructure. Never restore an unprotected upload
issuer while accepting uploads, down-migrate/reset memory or blindly replace
stores/credentials/routes. If needed, disable new chat replies through a reviewed
runtime release while preserving saved messages. Inspect the actual failed step
and partial effects before any retry. Apply only an exact checked compatible
commit; source rollback does not reverse a committed migration or external I/O.

Main/dev were synchronized without force or overwriting dirty work. Exactly 149
merged expendable remote branches were removed in guarded atomic batches;
unique/recovery refs, tags and the recovery stash were retained. Owner work and
private/session evidence were not blanket-staged. A clean clone contains the
accepted engineering changes; machine-specific worktree/session state is not a
prerequisite for another engineer.

## Still open

Live late/in-flight PUT and retry/DLQ recovery exercise, delivered operator alerts,
ongoing restore policy, effective provider-data/spending policy, public admission
and account recovery, origin/header trust, representative deployed performance
and first-time human comprehension remain separate gates. No finite production
erasure SLA was established. Native capture/later UX remain owner-paused; the
legacy-key inventory was explicitly skipped. The [current checklist](production-launch-2026-11-11.md)
classifies these by exposure and acceptance evidence instead of treating every
blank environment option as an automatic blocker.
