# Personal experience dev rollout

Status: preflight. This release covers capture, review and sharing through milestones 1–3. Avatar implementation is excluded. Production deployment is not requested.

## Target and checks

- Target: `dev.waka.im`, SST stage `development`, Git branch `dev`.
- Current remote baseline: `9c610845e75885a629a809104cfe22685cad806c`. The prepared branch contains its 37 successor commits, including the navigation change in open PR 334. No remote divergence was found at preflight.
- Deploy only through the existing GitHub workflow. It compares `DB_CONNECTION_URL_DEV` with production `DB_CONNECTION_URL` before migrations, rejects matching normalized endpoints, and sets the stage's `DbConnectionUrl` from the same dev value used by migrations. The previous run 36970690553 passed those steps; the new run must also pass. This proves configured endpoint separation, not arbitrary alias equivalence or a provider-level audit.
- Local `.env.local`, `.env.development` and `.env.production` currently name the same Neon endpoint. They are not authoritative deployment targets and must not be used for this rollout. No local credential values are printed or copied into GitHub.
- PR CI must pass API/web types, unit tests, disposable-database migration and SQL checks before merge. Milestone 3's unchanged web gate passed 645 tests. Repeat relevant checks if CI finds a defect; do not waive failures.

## Migrations and recovery

The release adds migrations 0049–0059: audio enums, transcription/correction/retry metadata, attachment recovery, reflection invalidation, review sessions/dialogue/evidence/processing and a model-attempt ledger. Existing raw inspirations and answers are not intentionally deleted or rewritten by rollout. Trigger/function updates affect future edits. Migration 0053 renames retry fields introduced by 0052 in this same release; 0059 replaces single-column job references with owner-bearing references and seeds an execution-accounting baseline.

Apply the journal once using the guarded development workflow; never `db:push` or run an untracked backfill. A failed migration/deploy is not a completed rollout. Inspect the failed step and journal before retrying, and preserve existing successful migrations.

Prefer a forward repair after cutover. Do not drop the new tables or reverse audio enums: that would destroy newly saved material. Before any application rollback, stop new writes/worker execution through the deployment operator, retain the new schema, and check whether audio/review data has already been created. The old baseline cannot be assumed to support those new flows. An old-code redeploy is acceptable only after confirming compatibility for the retained data; otherwise repair forward. A provider restore or destructive schema reversal requires a separate recovery decision and verified backup, not an automatic action in this task.

## Dev acceptance

Record the merged SHA, workflow URL and deployment result. On the actual dev app verify sign-in, capture/save, review entry/completion/reopen, stored reading, Principles and card preview/export handoff. Use a clearly labeled private QA capture rather than editing existing memories. Reopen in a second visit to verify persistence. Observe content-free counts and outcomes: save attempts/failures, review starts/completions/reopens and card renders/export handoffs. Report the sample size; these smoke observations are not population analytics or proof of external publication. Physical devices/native share completion remain deferred.

If authentication or a missing deployment credential prevents a check, record that item as incomplete. Build success and public HTTP availability alone do not prove the signed-in experience. No real-account content may be copied into release logs.
