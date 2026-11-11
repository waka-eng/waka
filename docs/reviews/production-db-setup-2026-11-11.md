# Production DB setup — 2026-11-11

> **2026-11-11 outcome:** the application was subsequently deployed and accepted at `b04d1da3`. Read the [portable release handoff](production-deploy-receipt-2026-11-11.md) and [current real-user launch checklist](production-launch-2026-11-11.md). The dated observations and pending steps below are historical; they are not the latest runtime status.

Target: actual `waka.im` production, established by Main's authenticated current
Console reads. No new DB, app deployment, provider call, IAM change, object wipe,
worker configuration or recurring schedule was introduced. **Production forward
migration is complete and verified: ledger 4 → 85, no reset, original identity
and memory preserved.** Main accepted the internal target/backup/rehearsal and
exact-session execution gates before remote DDL. The new application/workflow
and object-event infrastructure have not been deployed or published.

## Identity and configuration

Sanitized receipts under `work/production-release-env-20261110/` prove:

- `console-routing-readonly.json`: `waka.im` alias → production distribution
  `E294H8J9AJZ2TE` → associated published router/KVS → current `/api` host.
- `console-api-binding-readonly.json`: that host equals the current production
  API Function URL; its complete DB URL privately equals current `.env.production`.
- `console-other-bindings-readonly.json`, `console-writer-bindings-readonly.json`:
  production worker and PrincipleRefresh use the same production DB; production
  API points at that worker. Dev API/worker match `.env.development` instead.
- `console-dev-routing-readonly.json`: the actual `dev.waka.im` domain routes
  to the verified development API, completing domain-to-timeline isolation.
- `execution-identity-readonly.json`: fresh SQL verifies production timeline
  fingerprint `cc26e26fcfab4515`, development `3631c0e78238ea6f`, both `neondb` on
  PG 17.11. Same project/tenant does not mean the two branch timelines are one DB.

Only previously blank `ATTACHMENTS_BUCKET` and `WAKA_VAULT_BUCKET` were filled in
each private stage file using its own current Console receipt. Existing nonblank
values were never replaced. The original 14 values remain intact, including
auth/provider credentials. Files remain ignored/untracked/0600; private prior
copies are outside the worktree. Remaining blank choices are the two privacy
flags, two alert destinations and deliberately unattested proxy hops.

Production runtime OpenRouter is **confirmed absent** on API and worker; its
key exists locally but has not been published by this task. Gemini equals the
stage file. Dev runtime provider keys both match its file. Historical runtime
does not gain new models, single-companion behavior or cleanup delivery merely
because its database is upgraded.

## Private backup and restore

Read-only PG17 custom backup:

- Directory: sibling `waka-sync-backups/production-db-20261111T085622Z/` (0700).
- Archive: `production-before-setup.dump`, **90,862 bytes**, file/log/manifest
  permissions 0600. SHA-256:
  `aa519881f42a68670d91ae381a6c7f955c5432b92d8b0e139c4d2da1ec061b21`.
- Matching `pg_dump`/`pg_restore` 17.11; manifest read succeeds with 192 entries.
  Connection credentials were child-process environment values, never command-line
  URLs, logs, tracked docs or uploaded artifacts.

The owner service remains PG16 at loopback 5432. A separate SCRAM-protected PG17
instance at **127.0.0.1:55437**, inside that private directory, holds only exact
disposable rehearsal DBs. The archive was restored successfully with no owner/ACL
replay. Raw source/credential/archive contents remain private.

## Upgrade and historical writer rehearsal

The backup has four migration records through 0003. Its baseline hash matches
the historical production commit `cb1cc0bae1663b4826e925bbf16089da07874c3d`, rather
than today's edited baseline. Do not replay 0000 or rewrite the production ledger.

The actual current migrator successfully applies **81 pending files, 0004–0084**:
ledger **4 → 85**, final timestamp `1794355200000`. HMAC comparisons preserve
IDs/counts/selected identity and memory wording in accounts, profiles,
inspirations, signals, reading entries and principles. No rows were reset.
Receipt: `rehearsal-migration-receipt.json`.

Historical production source was exercised against the upgraded private copy:
all 23 old ORM table projections; actual signup/session and capture-enqueue
routes; archive read; old worker SQL claim/settlement with a stub processor; and
old PrincipleRefresh's selection/no-due-work path. Seven checks pass with **zero
provider/cloud network attempts**. Pending/running job types were checked
independent of due dates; none are unsupported. Production's read-only queue
observation contains only three succeeded old-type jobs, no pending/running
work, other active connections or idle-in-transaction sessions.

Limits: this uses historical source with the installed compatible libraries,
not a live provider/quality evaluation or a cryptographic redeployment claim.
New job-producing code must wait for a coordinated future API/worker rollout.
PrincipleRefresh is explicitly the third production writer, not forgotten.
Receipts: `old-writer-compatibility.json`, `pre-apply-writer-observation.json`.

Decision: bounded **online forward upgrade** is supportable for this observed
schema/old-writer state; no reset or service quiescence is justified by the
rehearsal. Contention, changed identity/history or failed guards must abort,
not trigger an automatic reset/retry. Production is still not launch-ready.

## Exact-session execution guard

Neon's pooled endpoint rejected startup timeout settings. The corresponding
direct endpoint, using the **same credentials**, was privately re-attested to
the exact reviewed timeline. Only the execution connection changes; the owner
stage URL is not rewritten. Direct startup settings prove 5-second lock and
120-second statement timeouts; migration `RESET lock_timeout` returns to 5s.

`tools/ops/guarded-migrations.mjs` uses Drizzle's official migration file reader
and dialect path. One outer transaction checks DB/timeline/timeouts **on the
physical transaction that will execute DDL**, then locks/verifies the original
ledger. Drizzle's inner migration transaction is a real savepoint of that same
session. Even its CREATE SCHEMA/TABLE IF NOT EXISTS runs after the guard. The
final check verifies ledger85, latest timestamp, same backend PID and effective
timeouts before outer commit. There is no hidden second connection or copied
migration SQL loop.

A second fresh PG17 restore rehearsed this exact adapter: absent timeouts refuse
**before DDL**, leaving ledger4; valid guards apply 4→85 with the same physical
session and 5s/2min settings. Receipt: `actual-migrator-session-rehearsal.json`.
The separate direct production identity/settings read is in
`migration-timeout-guard-readonly.json`; that diagnostic alone is not mislabeled
as an already executed production migration.

The reviewed fingerprint is now mandatory **before any SQL/client access** in
the adapter. Two focused refusal cases prove wrong/missing fingerprints touch
no SQL client. The caller pins
`02a89a7affab4eff2bf1225730b0f2a05328bf215600dc907eb7fa018237362d`.

## Actual production result and resolved verification harness error

Fresh stage values, both timelines, production ledger4, no pending/running work
or other active/idle-in-transaction connections, backup checksum and the reviewed
file fingerprint all passed immediately before execution. The guarded direct
connection applied 0004–0084 atomically. Actual physical session remained the
same and 5s lock/2min statement limits remained effective through commit.
`production-apply-receipt.json` records **migrationCommitted=true**, ledger85 and
final timestamp `1794355200000`.

The first separate post-commit HMAC predicate failed, and all further writes
stopped. Read-only reproduction identified the exact harness error: Drizzle
changes postgres.js timestamp parsers, so the unchanged principle's `locked_at`
was a JavaScript Date before initialization and a string afterward. Only that
table's raw JSON digest flipped on the **same unchanged production data**.
This was a verification-code error, not evidence of changed stored wording.

Independent comparison to the **untouched upgraded backup restore** normalized
only timestamp representation to UTC text at full microsecond precision. IDs,
ownership, exact wording, locked state and counts in all six identity/memory
tables match. No words were trimmed/rebound or checks weakened. Production has
the same 60 public tables, all three lifecycle triggers and both validated
composite attachment tenant FKs; ledger85 and the reviewed production timeline
were reverified. The receipt preserves the initial failed harness result and
its read-only resolution separately; no migration retry/reset occurred.

Evidence: `postcheck-parser-reproduction.json`,
`post-commit-readonly-diagnosis.json`, and final `production-apply-receipt.json`.
Main independently reviewed these and accepted verification as resolved/passed.
Production, development and local `/api/health` return HTTP200/oktrue. Development
remains ledger84; owner `waka_dev` remains ledger85 from the earlier local-only
0084 application. No development/local owner schema or memory was modified.

## Cleanup, checks and remaining work

Both exact disposable PG17 rehearsal databases were dropped, the dedicated
55437 server stopped, its data directory and temporary credential removed.
The private recoverable archive/checksum/manifest/logs remain; owner PG16:5432
and the running app at localhost:3010 were untouched. Cleanup receipt:
`rehearsal-cleanup.json`.

This continuation adds only `tools/ops/guarded-migrations.mjs` and its two
fingerprint refusal tests, plus dated reports/inventory updates and verified
blank-key fills in private stage files. Prior 34 targeted env/release checks
remain passed and unchanged. Final API types/whitespace checks pass; no broad
suite, provider evaluation or unchanged benchmark was repeated.

Remaining five blank choices: `WAKA_OPENROUTER_DATA_COLLECTION`,
`WAKA_OPENROUTER_REQUIRE_ZDR`, `WAKA_OPERATIONS_ALERT_TOPIC_ARN`,
`WAKA_ALERT_SNS_TOPIC_ARN`, `WAKA_TRUSTED_PROXY_HOPS`. Production API/worker still
lack OpenRouter at runtime. Existing source secrets and stage URLs were
preserved; neither publishing keys nor deploying the reviewed app/workflow,
S3 completion queue/alerts or new feature settings was part of this DB operation.
No production erasure SLA, external alert delivery, deployed performance or
human comprehension gate is implied complete. **Database setup is complete;
the old deployed application is not thereby production-release ready.**
