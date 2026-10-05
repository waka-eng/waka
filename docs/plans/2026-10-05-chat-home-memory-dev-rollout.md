# Chat home and memory dev rollout

Status: requested by owner on 2026-10-05; preflight underway.

## Scope and target

Ship all 21 completed commits from `codex/chat-home-memory`, based on dev
`84cba1363e30988f043fae3ae1a1eaff0833aeba`, through a PR to `dev`. Remote dev
has not diverged at preflight and no open PR is outstanding. Includes dedicated
atomic-first-Send chat, adaptive reply formatting, owned bounded hybrid recall,
visual Home actions/Capture spark, deduplicated and bounded/resumable/grounded
Principle generation, tests and the measured documentation. The implementation
goal is complete; this is its separately authorized delivery, not production.

## Database and deployment

- Use the existing automatic **Deploy dev** workflow, SST stage `development`,
  domain `dev.waka.im`. Never use local env filenames as remote target evidence:
  the checked-in machine's three legacy env files name the same Neon endpoint.
- The workflow compares normalized `DB_CONNECTION_URL_DEV` and production
  `DB_CONNECTION_URL` endpoints before any migration, then synchronizes the
  development `DbConnectionUrl` SST secret to the same migration target.
  Require that gate and the migration/deploy steps to pass; do not bypass them.
- Migration 0065 adds nullable reply retrieval-dispatch/selected-context columns,
  a bounded-array constraint and a personal embedding-scan index. Old code can
  tolerate the additions; existing reply rows remain valid with null metadata.
- Migration 0066 creates private `principle_generation_steps` receipts/cache with
  owner/job-bearing foreign keys, cascade erasure and lookup/budget indexes.
  It does not rewrite existing inspirations, reflections, signals or Principles.
- Both migrations must precede new application execution. SST's API references
  the BackgroundWorker's name/ARN, providing a dependency on that worker. Deploy
  the paired API/worker release together and require both exact reply flag/model
  configuration checks to pass. No alternate manual migration or provider swap.
  The rollout adds a read-only schema check for both migration receipts, columns,
  indexes, selected-context bounds and the owner-bearing job FK. Both deployed
  functions' DB URLs must equal the migrated dev secret without logging values.
- New policy keys permit one normal scheduled/explicit Principle pass after
  rollout; GETs remain read-only and repeated unchanged material deduplicates.
  No bulk historical-data repair, forced regeneration or paid evaluation run.

## Checks and evidence boundaries

Implementation checks: 803 API unit cases, 709 web cases, 111 distinct targeted
SQL cases; types/build/migration checks and actual local responsive walks.
Chat quality 24/24; generation rubric 22/24 (91.7%), all reviewed safety cases
pass, two quality misses retained. CI must additionally pass its full hermetic
API suite and migration replay before merge. Live-model/hour-long browser jobs
remain manual; do not run them as part of this rollout.

Current preflight passed all 1,470 full hermetic API cases, 803 unit subset,
709 web cases, API/web/admin types and migration consistency. Local AWS app
credentials lack `lambda:ListFunctions`; no permissions were changed. Use the
deployment workflow's existing operator credentials and verification outputs,
not those local credentials or a local env URL, for remote rollout evidence.

After merge record the PR/merge SHA and automatic deployment URL/result. Verify
deployed database separation/schema using credential-safe reads when available,
public HTTP health/current assets, and a signed-in UI route/read/capture-opener
check without editing existing memories. If sign-in cannot be verified, state
that limitation rather than equating public HTTP availability with acceptance.
Generated local screenshots, recordings, failed-prompt patches and model output
journals remain in ignored `work/`; fixture source and results summaries are in
the repository. No credential or real-account content is included in release
logs or the PR.

## Recovery

Prefer a forward repair. Retain the additive schema; do not drop receipt tables
or tracking columns after new work has used them. The previous baseline cannot
be assumed to safely consume new resumable processing receipts/policy keys.
Any application rollback requires a separately checked API/worker pair and
retained-data compatibility. Production and destructive restores are excluded.
