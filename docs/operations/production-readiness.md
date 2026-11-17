# Production readiness and recovery

Status: preparation only, 2026-11-17. Owner selected public signup after abuse and
human acceptance, current dev features/models including Embedding2, a combined
$10/month dev+production AI spending target with alerts and existing quotas, disclosed nontraining retention, Google and
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
preparation branch a live production release. Local merge9a7cfff5 and the
53db0128 follow-up preserve those protections and are the reviewed source input
for this admission work. Final exact release review is still required; no main
ref or deployed production state changed.

## Signup admission and AI target

Source preparation now includes one conditional Turnstile adapter and one
`signup_admissions` table. No vendor account, widget, secret or live verification
was created. Production defaults to `closed` for NEW accounts; local/dev defaults
to `off`. `turnstile` requires exact trusted stage/App/origin, a real same-stage
sitekey/secret and a valid signing secret. Invalid/missing production settings
close new signup only. Existing password login and verified Google recovery do
not load a challenge or depend on its readiness.

The shared password/Google helper claims UNIQUE token and nonce digests BEFORE
Siteverify, since vendor replay detection is eventually consistent. GET readiness is read-only; nonce-cookie issuance is an Origin-checked POST.
HTTP is outside SQL locks, fixed endpoint/no redirects/no retries,8s and8KiB. Required proof
fields are exact hostname, action, cdata and <=300s freshness. No IP is guessed
from XFF. A signed flow/stage/origin grant is consumed with account+human creation;
creation-start reservations persist across failure/uncertainty and account erasure.
Unknown outcomes cannot replay the same grant or silently recreate an account.

New Google users without a grant return to verification, then start a second
ordinary OAuth round. Its state and PKCE are bound to the signed grant; no raw
proof or Google identity is passed in URL parameters or stored in admission rows.
Existing identities, verified-email takeover and owned missing-human repair retain
the existing paths. Native new-account continuation keeps only the existing signed
mobile binding, verifies on the web, then restarts ordinary mobile OAuth. A routing
`mobile=1` flag grants no authority without that cookie.

Configured password admission is a same-origin web flow. The native resource
transport intentionally omits WebView cookies and cannot carry this web grant.
Native signup reads only public readiness: OFF keeps the existing native form;
closed/unavailable shows that state while sign-in remains usable; configured
verification offers a browser handoff to the checked API origin's
`/login?signup=1`. The hint selects a tab only. No email, password, nonce, grant or
session is passed, and no cookies are copied. After web signup the user returns
and signs in normally. Origin/cookie checks stay unchanged. Actual native-device
handoff and human acceptance remain unpassed; production stays closed until
activation and human-use gates pass.
Existing installed bundles do not gain this handoff from a web deployment.
When verification is configured, legacy cookie-less/native-Origin refusals
include the same stage-checked public browser signup URL and return/sign-in
instructions; closed configuration never advertises browser signup availability.
No native build, store release or paused native work is resumed here.

Beta defaults per stage database are20 verification reservations/hour,100/day,
and10 creation-start reservations/hour,50/day. Every instance shares the SQL
reservation, including invalid/unknown attempts. Configuration is strict and
bounded (verification max100/hour500/day, creation max50/hour200/day); no quotas
are replenished by deleting an account. Digests are kept at least seven days, then pruned in bounded batches on new
attempts. Without new attempts they can remain; no scheduled purge or exact
deletion deadline is claimed. No new job is added. **An attacker can exhaust the global invalid
attempt budget and temporarily refuse legitimate NEW users.** These bounds do not
identify a source or replace ingress/DDoS protection. Existing login throttles and
per-source trust ambiguity remain: do not invent `WAKA_TRUSTED_PROXY_HOPS=1`.
No invitation-only substitute or UI-only checkbox is called human verification.
Actual vendor/sitekey/privacy/activation, ingress and human acceptance remain open.

The owner explicitly chose a **$10/month combined dev+production spending TARGET
with alerts and existing quotas**, not an automatic dollar stop. Earlier local
preparation wording requiring a strict cap is superseded; old receipts are kept.
The existing60 shared starts/account/hour,20 chat model slots/account/hour and
recall10/min+60/hour remain. They are counts, not dollars. No shared spend service,
new price framework, provider reroute or top-up is requested.

Main/operator must own alert destinations and a monthly all-provider review across
OpenAI, OpenRouter and direct Google, including media and native001/retained paths.
Record actual account/project/key/stage scope, reset periods, thresholds and alert
recipient/delivery. OpenAI spend alerts do not stop requests; an OR key credit limit
covers that key only. Existing AWS hosting/monitoring budgets are separate.
Unknown native costs remain unknown; reported usage is not an invoice and should
not be described as zero or as guaranteed spending within$10. Review usage and
respond to alerts by an explicitly approved configuration pause or budget choice;
do not hide quota exhaustion with account splitting, resets or retries. Actual
billing/account metadata and alert delivery may still require authenticated access;
approval alone does not sign in. No hard-cap or enforced-invoice claim is made.

## Credential and privacy readiness

The owner explicitly authorized temporary production reuse of the current dev
OpenAI key on 2026-11-17. All four production workflow consumers bind directly to
the existing `OPENAI_API_KEY_DEVELOPMENT` secret: validation, read-only preview,
stdin setup and private runtime comparison. This is one explicit shared-key
choice, with no automatic fallback or new extraction/copy mechanism. Production
still targets its own SST secret namespace; auth/session/Google/DB and all other
provider bindings remain unchanged. Missing-key validation and exact runtime
comparison remain required. No provider entitlement or paid capability is
attested by this source change. Never put a value in a command argument, local
env file, release artifact or support log. Later dedicated-key rotation remains
separate from this temporary release binding.

Disclose captured/derived/reflection/attachment text and relevant media sent to
each actual provider. OpenAI `store:false` prevents Responses application state;
it is not proof of ZDR or zero abuse-monitoring retention. Main's current public
primary references report Google AI Studio via OpenRouter as trainingNo with 55-day
retention and not ZDR; this is endpoint policy, not the actual account's eligibility.
Direct Google audio/HEIC/native001 terms are separate. Preserve restrictive OR
collection/ZDR preferences exactly; incompatible, invalid or unproven account
requirements hold processing, not a reason to relax flags or select another route.
Logs/receipts must exclude memory words, tokens, raw error bodies, cookies and keys.
The human widget itself contacts Cloudflare and can process browser/network
metadata under its policy, even though our Siteverify POST omits remoteip. Its
site configuration, terms/disclosure and real human acceptance remain required
before activation; no claim that omitting remoteip prevents all vendor IP data.

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
   90 SQL files through 0089; accepted production c395 officially applied 0086/0087,
   but no independent current production-ledger read is attested here.
   Review additive0088 (embedding indexes) and0089 (signup admission), with the
   unchanged prior journal and matching staged proofs; no reset,
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
real first-time human observations, actual providers/privacy/alerts, exact
integration/target/backup coverage, and the final production/data/spend approval.
No synthetic/source pass closes those external gates.

## Conditional challenge configuration and acceptance

Current source defaults are API dev-off /production-closed. Workers,
PrincipleRefresh and cleanup receive neither Turnstile secret nor sitekey.
`WAKA_SIGNUP_ADMISSION_<STAGE>` and `WAKA_TURNSTILE_SITE_KEY_<STAGE>` are explicit
GitHub variables (DEVELOPMENT/PRODUCTION suffixes); they are not proof of a
configured vendor site. The private runtime `WAKA_TURNSTILE_SECRET` comes only
from the API's conditional same-stage SST `TurnstileSecret`. A separately approved
private stdin setup is needed before enabling; do not pass it in argv or use a
public dummy key. This candidate performs no setup and both deployment preflight and audits intentionally
reject activation until a later exact review changes that expectation.

Dev runtime acceptance retains the old23 check names and adds ONE aggregate,
`signupAdmissionIsolated` (24 total). It attests API off plus absent human
secret/sitekey, no signup configuration on worker/PrincipleRefresh/cleanup, and
keyless cleanup. The existing `monitorCleanupFunctionName` output is now emitted
in dev as well, adding one read-only function-config read to this audit.
Production acceptance adds `signupAdmissionIsolated` and
`cleanupNoSignupSecrets` while preserving every prior check; API must be closed
and all four roles lack Turnstile material. Values stay in memory; only booleans
and existing safe resource names leave the auditor. Actual deployed24/production
audit evidence is still required; source tests do not substitute for it.
