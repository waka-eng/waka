# Production readiness and recovery

Status: preparation only, 2026-11-17. Owner selected public signup after abuse and
human acceptance, current dev features/models including Embedding2, a combined
$10/month dev+production AI allowance, disclosed nontraining retention, Google and
password sign-in, and basic existing managed recovery verification before any
paid upgrade. This document does not authorize a production deploy, source-data
transfer, backfill, billing change, restore or credential action.

## Release and model identity

[Model routing](model-routing.md) owns the one canonical task/provider profile:
native OpenAI Terra-low for chat/extract/support/judge/reflection/review/principles/
principle judge/routing/supported vision; native Sol-medium for synthesis.
Audio remains direct Gemini 2.5 Flash. GIF retains OpenRouter DeepSeek and HEIC/HEIF
direct Gemini 3.1 Flash Lite. Model2 embeddings use OpenRouter/pinned Google AI
Studio; absent control remains native001. Keep retained providers available for
these explicit paths and reviewed rollback, rather than assuming a GPT key covers
every operation. No automatic fallback or model retuning is introduced.

**Integration hold:** main `c3958120` and dev `1a06209e` are not interchangeable
release trees. Main's local merge rehearsal found 12 conflicts and 285 differing
paths. Production has MCP credential/environment namespace safeguards absent dev:
production `connectionTarget` uses `waka-production-<profile>`, isolated browser
`WAKA_HOME`, and the key-only HOME placeholder. Retain those semantics and existing
tests while forward-porting latest dev copy, Embedding2 recall and journal paths.
Do not take the dev tree wholesale, discard prod-only protections, or label this
preparation branch an exact production integration. A small separately reviewed
local integration proposal/merge candidate is still required; no main ref changed.

## Admission and AI allowance — open gates

Public signup is not yet launch-ready. Password signup and Google new-account
creation currently lack a shared abuse admission gate. Login identifier/device
throttles are not signup controls. Per-source login throttling is unset because
CloudFront's edge address and a publicly reachable FunctionURL make header trust
ambiguous; do not set `WAKA_TRUSTED_PROXY_HOPS=1` from guesswork. Returning-account
login/recovery must remain usable when new-account admission is held. The minimal
ingress/human mechanism and bounded durable admission design require Main review;
no vendor, table, invitation-only substitution or UI-only proof is added here.
Real first-time human acceptance is a separate gate from automated abuse controls.

The existing 60 shared starts/account/hour, 20 chat model slots/account/hour and
recall 10/min + 60/hour remain. They are per-database/account counts, not a combined
monthly dollar stop. New accounts, job fanout and separate stages matter.
OpenAI project spend alerts do not stop requests. OpenRouter credit limits cover
only their actual key; Gemini/native OpenAI/media/legacy001 can remain outside.
Native cost can be unknown: do not record it as zero, refund uncertainty, equate
reported cost with invoices, or promise a stop exactly at$10. AWS hosting/monitoring
alerts are separate from the owner's AI allowance. No top-up is approved.

Main must establish actual provider/project/key scope, reset period, enforcement
versus alert behavior, exhaustion/recovery and all-stage coverage. If enforced
provider allocations cannot cover every path within the total, public paid
admission remains held for a concrete enforcement decision. No new central cost
service, reroute or pricing framework is implied. Billing consoles still needing
authentication provide no policy/enforcement evidence; “approve” does not sign in.

## Credential and privacy readiness

Production workflow requires explicit `OPENAI_API_KEY_PRODUCTION`, step-scoped to
validation, read-only preview, stdin setup and private runtime comparison. No
production value/presence/entitlement is attested here. Existing generic-name
metadata is insufficient. Keep all auth/session/DB and same-stage provider secrets
unchanged; never put a value in a command argument, release artifact or support
log. Source/metadata acceptance is not a successful model request or account check.

Disclose captured/derived/reflection/attachment text and relevant media sent to
each actual provider. OpenAI `store:false` prevents Responses application state;
it is not proof of ZDR or zero abuse-monitoring retention. Main's current public
primary references report Google AI Studio via OpenRouter as trainingNo with 55-day
retention and not ZDR; this is endpoint policy, not the actual account's eligibility.
Direct Google audio/HEIC/native001 terms are separate. Preserve restrictive OR
collection/ZDR preferences exactly; incompatible, invalid or unproven account
requirements hold processing, not a reason to relax flags or select another route.
Logs/receipts must exclude memory words, tokens, raw error bodies, cookies and keys.

## Supported sign-in and manual recovery

1. Keep ordinary password and Google state+PKCE sign-in. Google must validate
   issuer, audience, expiry and verified email. A verified Google identity matching
   an unverified password email follows the existing transaction: clear that
   password and revoke old sessions/CLI/mobile codes and all profile keys.
   Retained agent profiles and foreign accounts remain isolated.
2. There is no password-reset mail transport/token flow and no new reset promise.
   First use an existing trusted session or the ordinary Google flow for the same
   verified identity where available. Never ask for passwords, bearer tokens,
   recovery cookies or model keys in support chat.
3. A support request alone is not ownership. Main/operator must establish the exact
   account via independent existing ownership evidence; an email claim, public
   profile name, screenshot or remembered memory is insufficient. If proof is
   unavailable, refuse/escalate and explain that recovery may be impossible.
4. Any manual credential repair needs a separately reviewed exact account/action
   and approved execution. Generate a replacement credential privately, lock the
   actual account, preserve its Google identity and memory, and revoke affected
   sessions/codes/keys transactionally using existing revocation semantics. No
   account merge, profile transfer or blanket credential reset. Never revive a
   revoked credential or overwrite human-locked words as “recovery”.
5. Unknown commit/ACK is a hold. Reconcile exact owned credential/session metadata
   read-only before another action; absence of stdout is not rollback. Confirm
   normal sign-in and old-credential refusal only in separately approved checks.

No manual repair tool, self-service reset feature or real-user action is created.
The operator/support contact and real recovery exercise remain acceptance items.

## Managed database and attachment recovery

Read-only Neon Console observations on 2026-11-17 showed a production-labelled
project/default branch on Launch, AWS east1, PostgreSQL 17, history retention 1 day,
and branch protection “Not protected”. This is useful configuration evidence,
not a deployed target binding. The branch is not yet matched to the deployed URI
fingerprint, no accessible recovery-point timestamp/restore has been proven, and
no setting was changed. Do not infer an RPO/RTO, free plan or restore permission.

Before relying on it, Main must bind the actual deployed target without exporting
credentials; identify the recovery operator, available point/retention, restore
permission, ongoing cost and failure escalation. Prefer existing managed recovery
before a paid upgrade. Historical private snapshots/restore rehearsals and the
synthetic local copy/restore proof are references only, not fresh live coverage.
Production resource `retain` is not backup and branch protection is not PITR.

Attachments/vault are private stores with scoped presigned access. Source does not
itself establish object versioning/retention or an accessible recovery copy. A DB
snapshot cannot restore physically erased bytes. Verify exact bucket lifecycle,
versioning/backup and references before promising restoration. Keep erasure/privacy
obligations in tension with retention explicitly; do not silently keep deleted data
forever or reintroduce erased material from a recovery copy.

A separately approved isolated restore should verify migration ledger/schema,
account/profile/tenant links, exact human-locked words, current source/vector/work
metadata and attachment bytes/references under a bounded synthetic or expressly
approved data scope. Do not overwrite live production to test recovery. No strict
recovery-time/data-loss target or paid backup upgrade was selected.

## Migration, Embedding2 and rollback sequence

1. Bind exact release/tree and actual production target/ledger. Current source has
   89 SQL files through 0088; accepted production c395 officially applied 0086/0087,
   but no independent current production-ledger read is attested here.
   Review the only new migration 0088 and exact staged upgrade proof; no reset,
   down-migration or stale source restoration. Inspect the production integration
   conflicts above before an exact release can be approved.
2. Reuse frozen count/build/current-coverage/cutover tools and prior source proofs;
   do not rebuild an operator framework. Obtain actual owned profiles/types/epochs,
   input/count/cost caps, global unresolved attempts, backup and privacy gates before
   any new source transfer or paid build. Production data scope is not the dev 25/34
   cohort. Each live read/write/provider/wake effect needs the concrete new boundary.
3. Existing model2 policy `embedding2.dev-candidates.v1` retains its exact limited
   dev candidate/judge rules. It is not calibrated production evidence or semantic
   truth. No relabeling of provisional 0.80 or dev policy, no cosine-only agreement/
   suppression/independence, and no broad paid validation matrix implied. Main must
   review the production acceptance and genuine missing evidence explicitly.
4. Fresh C0 is RO/RR current-owned canonical hash, finite768/nonzero geometry,
   work/tombstone/frontier verification plus global all-manifest unresolved counts.
   Coverage is separate from provider invoice/outcome truth. Valid but child-heavy
   >8MiB cohorts intentionally refuse; do not trim material or expand caps silently.
5. C1 reruns the real verifier inside one explicit READ COMMITTED fenced transaction,
   exact owned native-before policy/epoch/G/F, sorted exclusive fences/NOWAIT and
   global unresolved 0. PG17 server whole-transaction deadline support must be proven
   for the actual production connection/pooler; dev's accepted SET is not prod proof.
   No cached C0 certificate, nested RR proof, relaxed G equality or mutation replay.
6. Lost ACK requires exact before/after tuple reconciliation under a fresh read
   envelope. All-before is not rollback while the original may still be in flight.
   Stop new mutations on uncertainty; do not reset ledgers or invent a new namespace.
7. Fresh empty profiles need under-fence zero-corpus proof; existing/newly nonempty
   profiles cannot be skipped. Production new-human enrollment is literalOFF in
   this candidate. A later explicit source/config/release gate may turn it on for
   genuinely newly inserted human paths, never existing missing-control profiles.
8. Prefer a forward correction after successful additive migration. A previous
   application SHA can require its matching metadata compatibility; old native
   vectors may have been correctly privacy-invalidated. Returning to001 requires
   fresh available coverage, not just changing a flag or restoring stale vectors.
   Preserve all-space invalidation on wording edits and all unknown-dispatch holds.

Final readiness still needs bounded live auth/tenant/erasure/alarm delivery and
real first-time human observations, actual providers/privacy/enforcement, exact
integration/target/backup coverage, and the final production/data/spend approval.
No synthetic/source pass closes those external gates.
