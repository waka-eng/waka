# Goal: implement the experience review

Status: in flight — A/B, C input/output/cache, D1 source provenance and E1 manual-refresh fixes locally checked; D2/D3, E2 and later delivery slices remain open. Deployment-target verification, historical repair and full release verification remain open.
Created: 2026-10-01, on the owner's instruction to implement the full plan.
Branch: `codex/ux-feature-implementation`.
Baseline: `33e65a7` on `dev`.
Specification: [experience review, revision 3](../audits/ux-feature-review-2026-10-01.md).

## Objective and completion

Implement all delivery slices, independent launch requirements, and required
verification in the referenced plan. Preserve the current visual feel and
the owner's preference for few public states. An individually passing slice
does not complete this goal. Features explicitly deferred in the plan remain
deferred; this does not shrink the defined releases or their gates.

The plan's accepted recommendations guide implementation: personal reflection
privacy, preservation of human words, explicit current support, revision-safe
generation, accurate completion, accessible input, stable navigation, reliable
attachments, useful readings, and next-round room participation. Amend the
canon before introducing new data concepts. Do not resume older halted model
experiments or revive superseded room goals.

## Delivery and verification ledger

| Slice | Requirements | Gate | Current evidence |
| --- | --- | --- | --- |
| A | F5/F6/F10: input, overlay scrolling/focus, readable active controls | Reproduce slash/wheel defects; verify typing, caret, Escape/Tab, wheel/touch and contrast in actual affected flows; web checks | Implemented; 5 original failures now pass, 325 web tests pass. Desktop fixture verified. Mobile touch/200% zoom and deployed verification remain open. |
| B | F3/F4: edited principle preservation, truthful support, account-scoped drafts/preferences and cancellation | Isolated SQL preservation tests and two-account browser/state tests; API/web checks | B1: 6 SQL / 653 unit tests pass after 3 reproduced failures. B2: 4 failures reproduced, then two-account draft and stale-response checks pass; full web suite 331/331. Deployed/account-switch browser verification remains open. |
| C | F2: private reflection containment across prompts, vectors, context and outputs | Private-answer mutations cannot affect room inputs; current membership/visibility checks; read-only historical impact report and reviewed repair scope | C1/C2/C3 code locally verified (51 SQL cases; full web 349/349). Read-only inventory completed across 5 rooms in the DB referenced by the local env files; hosted-stage mapping is not verified. Historical repair, deployment coordination and deployed verification remain pending. |
| D | F1: exact source attribution, explicit support checks, retention, revisions and durable downstream jobs | Deletion/edits remove invalid current citations; bounded omission/failure do not withdraw good support; stale jobs cannot commit; locked words survive | D1 source identity/quote retention and stale derivation checks locally verified (16 source SQL cases; web 366/366). Explicit semantic support reconciliation, full downstream fencing, durable handoff and historical repair remain open. |
| E1 | F7/F8: authoritative poster and truthful manual refresh | Queue acceptance, changed/unchanged completion, failure and fresh displayed version verified | Implemented with job receipts, resumable profile-scoped polling, held-job manual upgrade and authoritative headline. Local checks pass (8 receipt SQL tests, 10 hook tests, full web 362/362); deployed verification remains open. |
| E2 | F9: capture/reflection outcome and recovery | Save → answer → generation → visible result; delay, daily hold, retry, resume and rapid requests verified | Pending |
| F | F11/F12: visible search and durable navigation | Results beyond initial archive, failure/no-match separation, stable IDs, deep links, Back/Forward and rename verified | Pending |
| G | F13: capture attachments and recoverable failure | Paste/drop/select preview; saved text survives failure; retry attaches once; sharing destination clear | Pending |
| H | F18: progressive initial load and bounded prefetch | Small/large archive baseline vs result, first useful view and card/search/deep-link integrity | Pending |
| I | F14/F16: evaluated generation quality and useful secondary readings | Baseline/rubric first; fixed scenarios and independent/user review where available; changed candidate clears predeclared gates | Pending |
| J | F15: grounded starters and next-round room collaboration | 50% distinct participation, two evidence voices, separate direct-proposal majority, membership races, disagreement and version lineage verified | Pending |
| L1 | F17: password recovery | Delivery, token lifetime/single use, non-enumeration, session policy, actual recovery verified | Pending |
| L2 | F19: canonical policy and product copy | Current sharing, reflection, room/principle and generation definitions agree with implemented behavior | Pending |
| L3 | Onboarding, telemetry, user validation, release and repair verification | Contextual first-loop experience; metadata-only trace; realistic task checks; model latency/cost and usability measurements, required repairs and rollout evidence | Pending |

Start independent A/B fixes while investigating C/D. Ship B before enabling
D's support withdrawal. E1 may proceed independently, but E2's evidence
receipts depend on D. The remainder follows the dependency graph in the plan.
Keep code, deployment, historical repair, and user validation evidence distinct.

## Working rules

- Record the failing reproduction before the fix and the exact targeted
  verification after it. A failed gate remains work to resolve, not permission
  to soften the gate. Independent work can proceed only where that failure
  does not undermine its assumptions.
- Commit separately by slice with the slice ID in the subject.
- Use injected providers and disposable local Postgres for deterministic
  cases. Verify the database host before any mutation; `.env.local` has pointed
  at remote Neon in this session despite the old repository note.
- Before live model evaluations, state the call/cost estimate and stopping
  limit, record actual usage, and compare the same cases against the baseline.
- Historical repair needs a named impact manifest, retention treatment,
  checkpoints and a recovery path. Preserve human edits and current privacy
  choices. A safe new writer alone does not prove old data repaired.
- Mark a slice complete only when its scoped gate is evidenced. Record missing
  external validation or provisioning explicitly; do not count it as done.

## Log

- 2026-10-01: Started from clean tracked code at `33e65a7`; the untracked audit
  was preserved. Remote `dev` matches the baseline (0 ahead / 0 behind).
  Registered the full A–J/L1–L3 scope before implementation. No live model
  calls or data repair performed.
- 2026-10-01, A: baseline reproduced 5/5 failures (reflection slash and wheel
  cancellation in room/reflection/settings/date surfaces). Shared input
  ownership now passes those 5 cases; full field suite 12/12, targeted dialog
  and related suites 42/42, full web suite 325/325, typecheck/build successful.
  Local fixture browser: slash entered as `/`; Shift+Tab cycled from Close to
  the final action; Escape restored the room opener; wheel left background
  position unchanged. Computed active dialog text now yields 5.47:1 contrast
  on its actual panel background. No live model calls. Mobile touch/200% zoom
  and deployment are not claimed by these checks.
- 2026-10-01, A follow-up: native modified-Tab remains owned by browser tab
  navigation; dialog focus cycling applies to unmodified Tab/Shift+Tab only.
  Dialog regression suite 4/4 passed.
- 2026-10-01, B1: reproduced deletion of edited held and contested principles
  against isolated schemas in local `waka_agent_test` (2/2 SQL failures) and
  the pure decision rule (1/1 failure). Added `unsupported_at` migration 0031,
  preserved locked wording and disputes under row lock, and exposed withdrawn
  support in JSON, the human UI and canonical machine rendering. Restored
  evidence clears unsupported standing without rewriting words or resolving
  disputes. After fix: 6/6 SQL tests, 653 API unit tests passed (3 live benches
  skipped), both typechecks passed, 15 targeted web checks passed, migration
  check passed. No shared database migration or historical repair executed.
- 2026-10-01, B2: reproduced unscoped-draft disclosure (1 failure) and a late
  refresh/profile/preferences response restoring a signed-out account
  (3 failures). Capture/reflection drafts and visibility now use account +
  profile storage keys; Home and protected route state remount on identity
  changes; late identity-bound replies are ignored. Legacy unowned drafts are
  retained locally but never auto-assigned. Two-account same-mount switching
  and restoration, private defaults, remembered public choice, and reflection
  drafts pass. Targeted suites 27/27; full web 331/331, typecheck/build pass.
  No user account was switched or modified during these checks.
- Next: C requires a public-only projection for both prompts and embeddings,
  plus assessment of legacy room-derived context/output. Use isolated local
  SQL/provider fixtures before changing that path. B's final browser account
  verification must also exercise overlapping authentication mutations and
  cookie responses, beyond the stale read/profile responses already covered.
  Local Vite preview remains available on port 3011 (fixture mode; no API on
  port 3010). The broader C–J/L1–L3 scope and A/B deployed/mobile gates remain
  pending; this is an implementation checkpoint, not goal completion.
- 2026-10-01, C1: reproduced 6/6 SQL failures: private answers in extraction
  and vectors, departed membership before/during extraction, visibility and
  text changing during extraction. A separate unit reproduction confirmed
  private reflection changes still fanned out room jobs (1/1 failed).
  Added `input_scope` to embedding identity and `input_policy` to signals;
  room extraction/retrieval excludes answers and unverified legacy context,
  matching, and suppression anchors. Personal answers remain available to
  personal learning. Reflection saves/deletions now queue only personal work.
  Commit-time membership, primary/related capture and attachment checks run
  after model calls and roll back outdated output; locks hold those checks
  through commit. Changed public material raises a retryable error.
- C1 verification: 16/16 room-derivation SQL tests, 6/6 room visibility tests,
  and 6/6 principle preservation tests passed on isolated local Postgres
  schemas (28 total). Cases include private-only edits leaving retrieval
  unchanged, rejected non-group destinations, legacy context/match/suppression
  exclusion, and a privacy change inside the match judge rolling back the
  restatement and evidence. The concurrency fixture initially stalled on the
  harness's single connection; stopped its identified process, removed only
  its disposable schema, and reran using a separate simulated-user connection.
  API typecheck, report-script typecheck, migration check and diff check pass.
  API unit suite: 654 passed, 3 paid/live benches skipped. No live model calls.
- C1 impact tooling: `pnpm report:group-input-impact --group-id <uuid>`
  (`tools/ops/report-group-input-impact.ts`)
  requires an explicit connection URL and group ID; emits only IDs/counts and
  uncertainty, inside a repeatable-read/read-only transaction. The fixture
  verifies scope isolation, no content disclosure/mutation and truncation.
  It has NOT been run against shared data. It is an inventory, not authority
  to repair and not proof of historical exposure or safety.
- C deployment hold: migration 0032 replaces the embedding conflict index.
  Old derivation workers must be stopped/drained before migration, followed
  by new workers; do not run mixed versions or roll back to the private-input
  writer. No shared migration, push, deployment, or historical repair occurred.
  Next complete C2: exclude unverified signals/artifacts/principles from every
  downstream prompt and current/historical read, preserve authored/locked
  wording without silently certifying it, show honest restricted output,
  and assess actual legacy scope before a named repair batch. Existing output
  readers are not yet protected by C1; the full C gate has NOT passed.
- 2026-10-01, C2: baseline reproduced 5/5 output privacy failures: unverified
  room signals served with two voices; current/historical raw entry bodies;
  unverified belief/prompt fields riding on approved body text; old protected
  entries in synthesis prompts; and legacy principles served because their
  current citations looked safe. Added nullable policy stamps in migration
  0033 and a shared read/prompt projection. Verified current room signals are
  the only eligible citations. Legacy generated words stay stored but are
  withheld; protected entries are carried in the version chain without being
  shown or fed to a model. Exact member-proposed, accepted body text remains
  readable without unverified generated explanation or citation attribution.
- C2 principle generation now excludes unverified principles and readings
  from distillation/matching, stamps new room principles, and counts only
  verified room reading appearances. Room synthesis checks current membership,
  artifact version and selected public material again before writing.
  API restriction metadata drives a short notice in current room, history and
  principle views; withheld content is not described as an empty room, a
  failed generation, or an unchanged historical reading. The impact report
  now distinguishes unverified entry counts and finds room principle jobs
  billed to a member via their destination payload.
- C2 verification: 8/8 output-privacy SQL cases pass, including new principle
  prompt isolation, protected-word persistence, membership changing during
  synthesis, and metadata-only inventory of member-billed room jobs. Combined
  room/history/reaction/principle/input suite: 51/51 SQL cases. API unit suite
  655 passed / 3 paid-live benches skipped; full web suite 334/334. API and web
  typechecks, web build, migration check and diff check pass. Fixtures now
  distinguish verified generated records from legacy records; the history
  fixture explicitly records member approval and asserts that unverified
  legacy citations do not expose contribution credit. No live model calls,
  shared database writes, push or deployment occurred.
- Remaining C checks are concrete, not a claim of completed containment:
  Home caches room bundles for the session and its open-panel poll compares
  only version numbers. A restricted projection can change at the SAME
  version. Revalidate cached room data on return/focus, apply fresh restrictions
  without waiting for a new artifact, and exercise failure/retry and account
  change. HTTP responses already use `no-store, private` globally, but that
  does not invalidate the in-memory cache. Then run the scoped read-only
  legacy inventory, review uncertainty/retention/old workers and repair scope,
  and verify the protected serving behavior in a deployed environment. D's
  exact provenance and full revision-safe downstream handoff remain separate
  unfinished requirements; source-level reconciliation is not proved by these
  output filters.
- 2026-10-01, C3: baseline reproduced 4/4 Home cache failures (same-version
  restriction on focus/return, late stale response, and failed verification
  retaining old wording). A fifth reproduction at the real HTTP client found
  it dropped `restricted`, which component-only mocks had hidden. The client
  now preserves that flag. Room reads are cancellable, token-owned, bounded
  to 30 seconds and renewed only for the active room. Historical caches are
  invalidated with the room, including pending reads. Known restrictions
  remove old wording before slower bundle requests finish. Failure clears
  unverified shared content and exposes Retry; a retry cannot be overwritten
  by an older response. Field updates remove withdrawn inspirations, while
  unchanged snapshots do not recreate the simulation. Room principle reads
  likewise expire and withdraw on failed access verification; personal saved
  content and drafts are unaffected.
- C3 verification: full web suite 349/349 across 58 suites, web typecheck and
  production build pass; diff check passes. The 15 added cases cover the
  original failures, immediate restriction during a partial load, real field
  removal, no field rebuild on unchanged reads, same-version panel polling,
  bounded hung-read recovery, expired principles, historical pane/dial
  revalidation, wire metadata and HTTP cancellation. These are real React/
  simulation tests with documented network/canvas seams, not pixel/deployed
  verification. No server-side generator or database writer changed in this slice.
- C read-only impact assessment: verified the LOCAL files `.env.local`,
  `.env.development` and `.env.production` have identical connection URLs.
  This does not establish which databases the hosted stages use (see correction
  below). The inventory queried only the DB referenced by these local files.
  Ran the report against all 5 room IDs returned by a bounded, read-only group
  inventory. Reports at 2026-10-01 11:34:49–11:35:04 UTC were untruncated:
  42 unverified signals, 42 reading versions containing 102 unverified entries,
  1 locked entry, 0 room principles, and 8 failed derive-signals jobs (each at
  3 attempts). All 42 signal rows had no current reflection on their linked
  evidence; that does NOT exclude deleted answers or earlier prompt context,
  and is not proof of exposure or proof of safety. No text/answer/quote was
  fetched, no model invoked, and no shared row or schema modified. Identifiers
  remain in the scoped tool report rather than being committed to the repo.
- The initial rollout question assumed hosted dev and production shared a
  database; that assumption was premature and the question is withdrawn.
  No migration or repair is authorized by the inventory. A reviewed named
  repair batch, old-worker coordination and deployed checks still gate C.
  Local D/E and remaining delivery work can continue; the full A–J/L1–L3
  goal remains unchanged and incomplete.
- 2026-10-01 correction after the owner's request to double-check: deployment
  uses separate GitHub secrets. `deploy-dev.yml` sets migration environment
  `DB_CONNECTION_URL` from `secrets.DB_CONNECTION_URL_DEV`; `deploy.yml` uses
  `secrets.DB_CONNECTION_URL`. Runtime functions receive the SST
  `DbConnectionUrl` secret scoped to `development` or `production`, not local
  dotenv files. The production workflow explicitly synchronizes its DB secret;
  development currently relies on its existing stage secret. Local files
  still match, but live equality was never established. Runtime discovery via
  the local AWS credentials was denied (`lambda:ListFunctions`); no deployed
  secret values were read. Treat deployment targets as separately configured,
  verify the actual stage binding before any migration/repair, and do not
  classify the 5-room inventory as covering both deployed stages. No env file,
  secret, workflow, hosted database, or infrastructure was changed.
- 2026-10-01, E1 baseline: reproduced 2/2 UI failures (queue acceptance
  claimed a redraw; the boot-time adopted headline survived a completed new
  board) and 1/1 SQL failure (manual refresh joined an automatic job held until
  tomorrow without waking it). Completion testing then reproduced another
  failure: `noChange: true` with an empty entries array wrote an empty board
  while claiming no change. That path now preserves current words for both
  personal and room readings.
- E1 implementation: migration 0034 adds a metadata-only job result (top-of-mind
  ID/version/outcome), committed with the owning worker's completion. A rerun
  exposes no premature receipt; old workers cannot settle another claim's
  job status. GET refresh status is profile-scoped and never returns payloads
  or provider errors. Manual requests upgrade a held automatic job; subsequent
  automatic work does not inherit manual cadence bypass. The UI saves only
  the job ID in account/profile-scoped session storage, resumes status reads,
  bounds slow status checks, distinguishes queue/running/held/delayed/failed
  and completed outcomes in one transient line, and applies a fetched matching
  or newer version before reporting completion. It does not move the camera.
  Empty completion remains visible even when there is no headline.
- E1 verification: 8/8 real SQL receipt tests, 4/4 shift-floor tests, 3/3 queue
  fairness tests, 9/9 room output privacy tests (including no-change carry),
  and 6/6 route boundary tests pass — 30 SQL tests on isolated local schemas.
  The boundary suite now probes the status endpoint as well; its authorized
  attachment fixture still emits its pre-existing isolated-queue warning, so
  that suite is evidence of access behavior, not of attachment job delivery.
  10/10 hook tests cover resumability, delayed/held work, transient and terminal
  failures, bounded hung reads, duplicate starts, and identity changes. The
  real Home tests cover queued, completed-new and empty results. Full web
  suite 362/362; API unit suite 655 passed / 3 paid-live benches skipped.
  API/web/admin typechecks, web build, migration and diff checks pass. No
  live model calls, shared migrations, external writes, push or deployment.
- Remaining contract work is unchanged: D must provide exact source revisions,
  evidence withdrawal and durable downstream handoff; E2 must connect saved
  captures/reflections to those revisions and their resulting readings. A
  job receipt is not proof that every newer source edit has propagated. The
  initial POST's ambiguous delivery still needs request identity/reconciliation
  in that broader workflow; the current resume path starts only after a receipt
  is known. Lease-fenced job settlement is not full artifact/source fencing.
  Keep those requirements open rather than treating E1 as the whole loop.
- 2026-10-01, D1: four baseline defects reproduced: deleted reflection quotes
  and reasons survived; an edited inspiration retained the first quote; source
  edits and reflection deletion during personal extraction committed stale
  results. Migration 0035 records content-addressed source IDs/hashes without
  raw snapshots, constrains exact reflection citations to their owner/parent,
  and forbids private-answer quotes on group evidence. Source mutation triggers
  remove copied quotes/reasons, affected vector caches and stale question-job
  payloads. Match judgments finish before the locked source/statement check
  and evidence writes; an empty extraction also checks its source. Reruns
  update quotes without adding witnesses. No bounded omission withdraws a link.
- D1 readers suppress untraceable legacy quotes/reasons. Personal evidence
  identifies a quoted reflection and opens its answer, rather than treating
  it as text from the parent inspiration. Local deletion invalidates late
  evidence/question responses and copied spans while preserving unsaved drafts.
  This is exact citation tracking, NOT a semantic assessment of the claim.
- D1 verification: 73/73 SQL cases across source provenance and eight related
  room/curation/principle suites passed; one additional answer-edit regression
  then passed with the full source suite (16/16), giving 74 distinct SQL cases.
  API unit suite 655 passed / 3 paid-live benches skipped; web 366/366 across
  60 suites. API/web/admin typechecks, web build, migration and diff checks
  pass. All SQL used explicit loopback `waka_agent_test` isolated schemas.
  No live model calls, hosted migrations/repair, push or deployment.
- D2/D3 remain required: explicitly assess previously linked claims against
  current material (supported/unsupported/unresolved), recover mistaken
  withdrawal without rewriting human words, fence all downstream artifacts
  and statement changes, and durably schedule every source mutation. Full
  retention across historical derivatives and cross-device personal caches
  is not established by D1. D/E2 and the complete release gates stay open.
