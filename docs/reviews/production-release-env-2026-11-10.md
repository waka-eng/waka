# Production release/environment increment — 2026-11-10

> **2026-11-11 outcome:** the application was subsequently deployed and accepted at `b04d1da3`. Read the [portable release handoff](production-deploy-receipt-2026-11-11.md) and [current real-user launch checklist](production-launch-2026-11-11.md). The dated observations and pending steps below are historical; they are not the latest runtime status.

**2026-11-11 continuation:** authenticated current Console receipts now prove
both domains' LIVE routing → API URLs, API → worker pointers, and API/worker
DB equality with their same-stage files. Production PrincipleRefresh is also
bound to the production DB. Fresh SQL reconfirmed distinct Neon timelines.
Previously blank canonical storage keys are now filled only from those exact
same-stage receipts. The initial binding blocker below is historical; see
`production-db-setup-2026-11-11.md` for the completed backup/rehearsal/production migration receipt (ledger4→85, no reset, memory preserved).
Current production API/worker **lack OPENROUTER_API_KEY**, while Gemini matches
the production file; both dev provider keys match the development file. No
runtime/provider/schedule writes or app deployment have been made.

Scope: reviewable CI/env patch and read-only target identification. No app
deployment, secret publication/rotation, IAM change, model call, resource
creation, reset or remote migration was performed. Current candidate changes
remain uncommitted. `waka_dev`, development data and the running local stack
were preserved.

## Concrete patch

- Production calls the existing reusable CI workflow with `github.sha` and
  requires a successful result before the entire deploy job can run. Failure,
  cancellation and skipped CI deny **all** alias/secret/migration/SST/DNS steps.
  CI and production checkout the same full immutable SHA and verify actual HEAD.
  Production credentials are job-scoped, outside reusable CI. Named production
  environment approval settings still depend on repository administration.
- Production build Node version now matches CI's existing Node 24. Production
  runs are serialized without cancelling an in-flight migration/deploy merely
  because a later run arrives. Endpoint preflight runs before production
  mutations; it remains an endpoint check, not alias/isolation attestation.
- Stage-specific GitHub variables now reach the SST privacy/alert options;
  invalid explicit option formats fail before mutations. No policy or recipient
  value is supplied by default. Production replies remain disabled by the
  existing SST policy; no feature/provider/cost decision was changed.
- `scripts/reconcile-stage-env.mjs` preserves existing values, re-reads before
  writing, refuses concurrent changes, uses only the selected file's credentials,
  keeps ignored stage files private and makes private recoverable backups outside
  the worktree. `.env.example` documents canonical names and unresolved choices.
  It is not copied over either stage file.

## Redacted variable matrix

Key-only source/file/wiring inventory: `production-release-env-inventory-2026-11-10.json`
beside this report. Source mentions do not attest a live runtime binding.

Both files already existed, ignored/untracked with mode **0600** and 14 populated
keys each. They now contain 34 production / 35 development keys, still private.
Every original value was preserved. New default values derive from current
source configuration; this is not a claim about the stale deployed stack.

| Key names | Production/local file | Development/local file | Deployment source / remaining gap |
| --- | --- | --- | --- |
| `DB_CONNECTION_URL` | Existing value preserved; readable Neon target | Existing value preserved; readable, distinct timeline | Production `secrets.DB_CONNECTION_URL`; dev `secrets.DB_CONNECTION_URL_DEV`. Both repository secret names exist; their actual encrypted values cannot be compared through the GitHub secrets listing. Current Console proof verifies production API/worker/PrincipleRefresh and development API/worker bindings; repository secret values remain unreadable. |
| `AUTH_SECRET`, `JWT_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Existing values preserved | Existing values preserved | Existing repository secret names and SST secret/runtime bindings exist. Local presence is not proof of live stage equality, provider validity or OAuth console configuration. No copies between stages or rotation. |
| `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | Existing populated values preserved | Existing populated values preserved | Both repository secret names exist. Production workflow sets the SST provider secrets before its next authorized deploy. OpenRouter repository secret was updated after the last observed production workflow run; current Console proof confirms OpenRouter absent from production API/worker, Gemini equal to the production file, and both provider keys equal to the development file. No inference calls were made. |
| `AWS_ACCESS_KEY_ID_APP`, `AWS_SECRET_ACCESS_KEY_APP` | Preserved | Preserved | Standard `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` mappings were added using **that same file's** existing values, not the other stage/local file. They allow existing S3 reads but deny relevant direct Lambda/CloudFront metadata actions below. Workflow continues mapping existing `_APP` repository secrets; no IAM mutation. |
| `AWS_REGION`, `AWS_DEFAULT_REGION`, `ATTACHMENTS_REGION`, `NODE_ENV`, `WAKA_STAGE`, `PUBLIC_API_URL`, `PUBLIC_WEB_URL` | Added source-established production defaults/origins | Added source-established development defaults/origins | SST supplies corresponding runtime values; these private local additions do not update deployed configuration. |
| `OPENROUTER_GENERATION_MODEL`, `WAKA_MODEL_SYNTHESIZE`, `WAKA_MODEL_TOP_OF_MIND_REVIEW` | Added current source pins | Added current source pins | Shared SST API/worker environment already pins these. No model tuning. Dynamic extraction/judge/support/reflect/routing/Principles overrides are optional and inherit the approved base unless explicitly configured. |
| `WAKA_CONVERSATION_REPLIES`, `WAKA_MODEL_CHAT` | Replies explicitly `0`; no new chat override selected | Current dev source behavior represented (`1` and its existing model pin) | No deployment or process-env change. Production remains off; enabling it is a separate product/cost/privacy decision. |
| `ATTACHMENTS_BUCKET`, `WAKA_VAULT_BUCKET` | Previously blank; now filled from current same-stage Console proof | Previously blank; now filled from current same-stage Console proof | Existing nonblank owner values were never overwritten. Old `S3_AWS_BUCKET_NAME` remains preserved but is not the current canonical API setting. |
| `WAKA_OPENROUTER_DATA_COLLECTION`, `WAKA_OPENROUTER_REQUIRE_ZDR` | **Undecided/unset** | **Undecided/unset** | Workflow reads `vars.<KEY>_PRODUCTION` / `vars.<KEY>_DEVELOPMENT`; values pass through only when explicitly provided. No repository variables were listed at inspection; environment-specific values/settings are unverified. No deny/ZDR choice invented. |
| `WAKA_OPERATIONS_ALERT_TOPIC_ARN`, `WAKA_ALERT_SNS_TOPIC_ARN` | **Missing destination**, explicit blanks | **Missing destination**, explicit blanks | Workflow now reads the matching stage-suffixed variables. New cleanup DLQ uses the first key; old queue alarms use the second and are dev-only. Wiring these variables does not add missing production queue/error coverage or prove external delivery. |
| `WAKA_TRUSTED_PROXY_HOPS` | **Deliberately unset** | **Deliberately unset** | No hop count guessed or forwarded by this patch. Topology attestation remains open. |
| `WAKA_BACKGROUND_WORKER_FUNCTION`, `WAKA_BACKGROUND_JOB_WAKE_GROUP`, `WAKA_BACKGROUND_JOB_WAKE_ROLE`, `SST_RESOURCE_*` | Resource-generated; no stale IDs copied | Resource-generated; no stale IDs copied | SST links/runtime provide them. Not missing provider credentials or values to blanket-copy into local stage files. |
| `WAKA_ENABLE_ADMIN_*`, admin allowlists, fixture/enrichment/private-host overrides, insecure cookies, local endpoints, test triggers | Not enabled/guessed | Existing source stage policy retained | Keep production admin opt-ins closed and fixture/private-network overrides absent. Local `.env.local` was not used as a source. |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `S3_AWS_BUCKET_NAME` | Legacy values retained | Legacy values retained | Presence does not satisfy current auth-origin or attachment runtime settings. No destructive cleanup/alias removal. |

**Important:** ignored `.env.production` / `.env.development` are local records.
GitHub Actions does not upload or read them. A populated local key does not
update GitHub/SST secrets. This patch prepares explicit wiring, not secret
publication or an application deployment.

Private backups: sibling `waka-sync-backups/stage-env-1794382919240-production/`
and `stage-env-1794382919291-development/`, directories 0700/files 0600. They
contain private original files and must never become artifacts or tracked files.

## Actual database result and isolation evidence

**Initial 2026-11-10 result:** the URL was available but live binding was not
yet verified, so no wipe/migration was attempted. **Updated 2026-11-11:** the
current `waka.im` routing and all three production writers are now attested to
this URL; backup/rehearsal and the reviewed execution gate follow in the dated
DB setup receipt. A reset remains unnecessary after successful forward rehearsal.

Read-only transactions succeeded for both configured URLs. They report the same
Neon project and tenant, database `neondb`/OID 16391, but **different actual
timelines**: SHA-256 identity fingerprints are production `cc26e26fcfab4515`,
development `3631c0e78238ea6f`. Public schema counts were 23 versus 59
tables. Same OID/server-address strings alone are not isolation evidence on
Neon; the timeline difference is the useful distinction. Neither remote URL
names the loopback local `waka_dev`. These facts establish distinct configured
Neon timelines, not the live domain-to-runtime assignment.

Existing SST state metadata and historical successful production
[run 32446198302](https://github.com/waka-eng/waka/actions/runs/32446198302)
identify production resource candidates. The state was parsed only in memory
for whitelisted resource IDs; no raw state/secret payload was printed or saved.
The public `waka.im` root responds, but that does not reveal its database.

Direct current reads were attempted, not inferred from listing denials:

| Needed metadata action | Exact production resource | Observed |
| --- | --- | --- |
| `cloudfront:GetDistribution` | `E294H8J9AJZ2TE` | AccessDenied |
| `cloudfront:GetFunction` (LIVE) | `waka-production-RouterCloudfrontFunctionRequest-kvwstnfr` | AccessDenied |
| `lambda:GetFunctionConfiguration` | `waka-production-ApiFunction-cdmoxatc`, `waka-production-BackgroundWorkerFunction-bantheuk` | AccessDeniedException (403) |
| `lambda:GetFunctionUrlConfig` | Production API function above | Needed once configuration reads are available; no claim this specific action was tested independently |

The corresponding direct dev distribution/router/API/worker reads also deny.
No IAM change or alternate credential search was performed. Minimal non-applied
read-access example: `production-binding-read-access.example.json` beside this
report. Alternatively an already authorized operator can perform the comparison
and return only safe identity/equality evidence. The remaining chain is current
`waka.im` alias → LIVE routing → API URL/function → API **and worker** DB binding,
then private equality/isolation checks against the proven distinct timelines.
Do not export environment values as an artifact/log or push code solely to
extract them. Main has the sanitized receipts for internal review before any
future production mutation.

Receipts are under `work/production-release-env-20261110/`: read-only access,
whitelisted stage resource IDs, direct-resource denials and Postgres identities.
No production backup was taken while live target assignment remained ambiguous;
take a private recoverable backup after that assignment is established and before
any authorized schema/data change. No new/billable DB or resource was provisioned.

## Verification and remaining acceptance

Targeted workflow/SHA/env/database-guard/SST tests: **34 passed**. They parse
workflow YAML, check all mutation steps are downstream of the successful gate,
exercise failure/cancel/skipped outcomes and SHA mismatch, verify same-stage
mapping/preservation and reject secret leakage/invalid explicit policy values.
API typechecking and whitespace checks passed; no unrelated suites were rerun.

At initial handoff, DB action was blocked on live binding. That metadata gate
has now passed; Main reviews the actual backup/rehearsal and guarded execution
plan before any remote DDL. Preserve dev/local
data and shared/unknown storage. Feature activation, provider choices, external
alerts, migration/restore rehearsal and production launch acceptance remain the
separate checklist gates; no overall goal is marked complete here.

## Exact DB setup procedure after Main's live-binding receipt

Observed on the production-file target, read-only: four migration rows through
`0003_refresh_principles_job`, highest timestamp `1787276958446`, 23 public
tables. Rows 0001–0003 match current files; the recorded initial baseline hash
differs from the current edited baseline but matches the baseline at historical
production commit `cb1cc0bae1663b4826e925bbf16089da07874c3d`. This is a history/rehearsal question,
not grounds to blindly replay 0000 or erase the ledger. The current migrator
would schedule **81** files, 0004–0084, not only the new cleanup migration.
Receipt: `work/production-release-env-20261110/production-schema-readonly.json`.

1. Re-read the current private stage file (the owner may have updated it),
   compare its DB target privately to **both current production API and worker**
   bindings, and re-check the Neon project/tenant/timeline inside the connection.
   Require the reviewed production timeline and distinction from the development
   timeline and local DB. A changed/shared identity stops mutation and returns
   the discrepancy to Main; no guessed target or newly provisioned DB.
2. Back up that proven target with the already installed matching client
   `/opt/homebrew/opt/postgresql@17/bin/pg_dump` (17.11), custom format, to a
   fresh sibling `waka-sync-backups/production-db-<UTC>/` directory, 0700 with
   archive/log files 0600. Resolve credentials into child-process libpq env,
   not command-line URLs or printed commands. Verify exit status, checksum,
   `pg_restore --list` and the backed-up migration metadata. The PATH default
   dump client is 16.15 and must not be used against this PostgreSQL 17 server.
   Keep the backup private and out of GitHub artifacts/tracked state.
3. Restore into an explicit fresh **loopback disposable** DB, with providers,
   automatic model draining and cloud wakes disabled. Rehearse 0004–0084 from
   the observed ledger; inspect baseline history/shape differences, migration
   success and compatibility. Do not “repair” the real production ledger to
   make a failed rehearsal green. Prefer this forward migration if it succeeds;
   no wipe is needed simply because the owner permits one.
4. Review the exact rehearsal/backup/identity result with Main. If a forward
   upgrade genuinely cannot be supported, propose a production-DB-only reset
   of app schema/ledger and clean migration under the existing wipe authority,
   justified by the actual failure. Never drop the Neon project/tenant, mutate
   development/local databases or wipe shared/unattested buckets. No reset plan
   has been selected or executed by this increment.
5. Account for the **old deployed production API/worker**. Rehearse those
   versions against the upgraded copy and review pending DDL/data changes.
   Apply online only if backward compatibility is established; otherwise use a
   reviewed production-only maintenance/quiescence window before schema/data
   changes. Do not assume “no users” stops scheduled worker writes. No Lambda,
   schedule or ingress settings have been changed here, and no unapproved app
   deployment is bundled into DB setup. A breaking schema with continuing old
   writers is a stop condition, not an acceptable half-upgrade.
6. Execute the reviewed migration/setup with the freshly verified production
   URL supplied only in child-process environment. Capture private/sanitized
   receipts and verify the resulting 85-entry migration chain, required tables,
   tenant constraints and lifecycle triggers/ledger. Re-check identity afterward;
   perform the approved read-only health/schema checks and report actual
   results. Preserve dev/local data. Keep the object-event infrastructure,
   notification, new-app deployment and external-user acceptance gates open:
   a migrated database with an old running application is **not production ready**.
