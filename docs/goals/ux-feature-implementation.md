# Goal: implement the experience review

Status: in flight — A/B, C input/output/cache, D1–D3c support/source handoffs and reading recovery, D3d1–D3d2 question/statement-vector fences, plus E1 manual refresh locally checked; pending/statement support, remaining lower-layer fences, legacy context, E2 and later slices remain open. Deployment-target verification, historical repair and full release verification remain open.
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
| D | F1: exact source attribution, explicit support checks, retention, revisions and durable downstream jobs | Deletion/edits remove invalid current citations; bounded omission/failure do not withdraw good support; stale jobs cannot commit; locked words survive | D1–D3c provenance, automatic support checks, durable handoffs, write fences and personal reading support/recovery locally verified. D3c: 78 targeted SQL / 671 unit / 374 web; synthetic rendered checks at two viewport sizes. Pending/statement support, legacy personal context, lower-layer claim fences, live semantic quality and historical repair remain open. |
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
- 2026-10-01, D2a: added explicit per-claim assessment on both provider roads,
  separate from bounded extraction. The shadow reviewer supplies only the
  current source's allowed material, not related inspirations or old generated
  explanations. It returns IDs/hashes and supported/unsupported/unresolved
  verdicts. Missing or duplicate verdicts, unknown sources, provider failure,
  incomplete attachments, oversized input and exhausted call budgets cannot
  become negative evidence. Source/statement/membership changes invalidate
  the report. Legacy unverified group claims never enter its model context.
- D2a is intentionally a read-only comparison stage required by the rollout
  plan, not a live support writer. `pnpm review:signal-support --help` describes
  the explicit owner/inspiration/group-mind IDs and required 0–10 provider-call
  budget. It loads no dotenv files, opens a database-enforced read-only
  connection and has no mutation flag. Zero budget makes no provider calls;
  agree the cost bound before running a positive budget. No historical
  assessment or live provider call was run during this implementation.
- D2a verification: 16/16 deterministic provider/review unit cases and 9/9
  real SQL cases pass. The latter check no mutation of locked words/evidence,
  re-assessment of a mistaken negative proposal, deleted-source exclusion,
  source/statement/membership races, group privacy and database-enforced
  read-only operation. The related source/room regression run passed 40/40
  before the additional read-only case (41 distinct SQL cases in total).
  Full API unit suite 671 passed / 3 paid-live benches skipped. API and CLI
  typechecks, CLI help smoke check and diff check pass. The orphan gate first
  found the unregistered CLI; the command now has a real workspace tool entry
  point, without changing the gate or adding an unused-code allowance.
- Next D work remains semantic mutation, not more shadow reporting: represent
  reversible support withdrawal, use reviewed explicit outcomes to reconcile
  standing atomically, and verify restoration of a mistaken withdrawal while
  protecting edited words. Then complete durable source-to-reading handoff
  and all downstream revision fences. No public state or threshold was added
  or changed; this checkpoint does not meet D's full acceptance gate.
- 2026-10-01, D2b: migration 0036 adds metadata-only applied support reviews
  and a distinct evidence-loss retirement marker. Explicit application rechecks
  source hashes, claim/lock state, current membership and prior decisions under
  transaction locks. Unsupported links stop being current evidence; a later
  supported review restores the relationship without reviving deleted quotes.
  Unresolved decisions do neither. Dismissals and merge retirement are not
  reversed. Edited held/contested principles retain their words and regain
  support when the current evidence qualifies again. The review record, signal/
  principle standing and debounced reading request commit atomically; failed
  enqueue rolls the entire application back. Replaying a review is idempotent.
- D2b regression baseline: reproduced 3/3 re-entry failures with the new
  explicit writer in place. Bounded extraction reattached a locked pattern's
  withdrawn link; after generated retirement it minted a twin; an unaware SQL
  writer could reinsert the withdrawn link. Matching now treats a source's
  explicit withdrawal as mandatory context (including evidence-retired targets),
  and related-source discovery cannot bypass it. A DB guard waits for concurrent
  support writes before checking the latest decisive review. An unresolved
  later review does not erase that decision. Those 3 original failures pass.
- D2b verification: 30/30 support-review/application SQL cases pass, including
  concurrent replay, an old insert observed waiting on a real database lock,
  stale material/wording/membership/visibility rejection, lost-job rollback,
  private-source exclusion and edited-principle restoration. Combined with
  evidence, curation, room privacy, refresh-receipt and queue suites: 104/104
  SQL tests across 10 suites. API unit suite 671 passed / 3 paid-live benches
  skipped; web 366/366. API/web/admin and both operations CLI typechecks, web
  build, migration check, CLI help checks and diff check pass. All writes
  were confined to disposable schemas on explicit local `waka_agent_test`.
- `pnpm apply:signal-support --help` documents the separate explicit application
  command. It requires the report file, matching review/profile IDs and an
  explicit DB URL; it makes no model calls and loads no dotenv defaults. It is
  NOT authorization for a hosted repair. Migration 0036 and these operations
  have not run on hosted data. No positive-budget live assessment, push or
  deployment occurred. Older workers must not remain able to re-mint withdrawn
  meanings; coordinate the full writer cutover before applying hosted reports.
- Automatic source-edit reconciliation is still unconnected. Next integrate
  reviewed support assessment with source mutation/derivation, complete durable
  enqueue for every source write and fence statement/artifact revisions. Current
  top-of-mind validity while replacement is pending, exact restored-support
  attribution in the UI, and recovery/regeneration of unedited machine-derived
  dependents remain open. The explicit apply tool is not a substitute for that
  automatic product loop or for the full A–J/L1–L3 completion requirements.
- 2026-10-01, D3a baseline: reproduced 4/4 route failures when queue insertion
  was rejected: capture, edit, answer save and answer removal still committed
  and returned 200/201. Reproduced 2/2 automatic-support gaps: empty discovery
  left explicitly unsupported evidence standing and new material could not
  restore its retired claim. Also reproduced 1/1 queue-tail failure: an older
  exhausted attempt marked a job failed with `rerun_requested = true`, stranding
  a newer committed source edit. These seven reproduced failures now pass.
  The suspected manual-reread/daily-hold race already behaved correctly; its
  passing regression was retained without changing that behavior.
- D3a implementation: normal derivation assesses existing/withdrawn links before
  bounded discovery, with at most one 12-claim support call per attempt. Stable
  decisions are reused only for identical source material, wording and policy;
  migration 0037 stamps that policy explicitly, and legacy unstamped checks
  are not reused. Genuine uncertainty preserves support; unavailable, malformed,
  missing or budget-incomplete assessments request worker retry. Changed source
  material invalidates the pass. Explicit operator review still forces a fresh
  check, including a mistaken negative assessment on unchanged material.
- Capture/edit, reflection save/removal, attachment finalization, enrichment
  cache updates and discovery now persist their next jobs transactionally.
  Enrichment rechecks the fetched resource after the network call. Public work
  fans out using current ownership/visibility; private answers never do. A
  public-to-private change queues room rereading rather than private derivation.
  Source deletion locks the parent and affected signals, reconciles every cited
  destination, cancels obsolete source jobs and persists reading requests.
  The shared source-request helper moved from routes to
  `lib/inspiration-derivation-requests.ts`; it no longer swallows enqueue errors.
  Worker wake-ups remain post-commit and recoverable.
- Creation and edits now share one source/destination key. A newer request
  arriving during a failed older attempt returns to pending with a fresh retry
  allowance rather than inheriting that attempt's terminal failure. Discovery's
  reading request moved into its write transaction; the documentation drift
  gate now checks the authoritative writer plus the explicit support writer.
  Real SQL cases verify that empty discovery with unchanged support creates no
  reading job, while actual withdrawal can create one without new candidates.
- D3a verification: 113/113 SQL tests across 10 suites pass, including 14
  source-job durability tests and 9 automatic-support tests. Those cover partial
  room-fan-out rollback, enrichment/reading handoff rollback, fetched-resource
  races, same-input caching and policy changes, failure vs genuine uncertainty,
  room privacy, deletion across destinations, old-job settlement and recovery.
  API unit suite 671 passed / 3 paid-live benches skipped; web 366/366.
  API/web/admin typechecks, web build, migration and diff checks pass. All SQL
  used explicit loopback `waka_agent_test` isolated schemas. No live model
  calls, hosted migrations/repair, push or deployment occurred.
- D still has release-blocking work. Current generated readings must stop
  claiming withdrawn support while replacement is pending; human-edited entries
  must remain with truthful standing. Human/machine statement changes need
  source rechecks and all synthesis/principle commits need source/statement
  fences. Exact restored-support attribution and recovery of machine-derived
  dependents remain open, as do live semantic-quality checks before rollout.
  E2 must carry source revision and artifact completion through the actual UI,
  including ambiguous saves and repeated requests. Coordinate older workers
  and legacy reason-keyed jobs at cutover; the new key does not establish that
  an already-running old worker is safe. A–J/L1–L3 scope is unchanged.
- 2026-10-01, D3b baseline: reproduced 6/6 generation failures: a personal
  reading committed after source, signal or entry edits; an older pass replaced
  a newer reading; changed evidence still minted a principle; and a later
  failed principle comparison left an earlier candidate persisted. Separately
  reproduced a revoked-share lookup through old personal feedback (1/1) and
  an artifact written by a reclaimed worker despite unchanged inputs (1/1).
  These eight baseline failures now pass. The privacy reproduction used
  synthetic accounts; hosted incidence/exposure was not assessed.
- Migration 0038 introduces per-profile generation revisions, advanced in the
  same transaction as relevant mutations. Personal/room synthesis and principle
  generation capture the revision before loading their inputs and recheck it
  under a final transaction lock. A private reflection does not advance its
  room's revision. Actual-write triggers avoid invalidating on ignored duplicate
  inserts; rolled-back writes roll back the token. These are internal commit
  tokens, not public reading versions or source-completion receipts.
- Principle comparisons now plan the entire batch, including provisional
  same-batch targets, before any write. Citation attachment, promotion, minting,
  history and conflicts commit together. Personal/room/principle workers verify
  their claim inside the write transaction, not only at job settlement. Final
  principle-row locking is non-waiting so a simultaneous human edit can finish
  while generation retries; signal support/deletion locks protect mutable words
  without blocking artifact citation FKs.
- Personal feedback input is filtered to owned targets before its bounded
  context scan, then ownership is checked again when loading target wording.
  Room/other-profile reactions remain stored but cannot retrieve another
  profile's later private words into a personal prompt or crowd out an owned
  correction. This closes the reproduced fresh lookup; it does NOT certify
  previously generated personal readings/principles or their recycled context.
  A separate metadata-only historical impact scope and conservative serving/
  regeneration treatment are still needed for potentially affected outputs.
- Additional verification exposed a D1 cascade defect: deleting a reflected
  inspiration could update evidence after its parent was gone, failing the
  composite FK. Migration 0039 removes that parent's witnesses before child
  cascades, skips redundant child-copy cleanup and keeps standalone reflection/
  attachment redaction intact. It also aligns the withdrawn-evidence guard with
  non-key signal locks; a real waiting-insert test verifies old writers still
  cannot restore a withdrawn link. No historical data was repaired by these
  migration definitions.
- D3b verification: 149/149 SQL tests across 12 suites pass, including 21
  generation-fencing cases, 11 refresh/lease cases and reflected-source deletion.
  Cases include change-and-revert, private-answer room isolation, public deletion,
  member metadata/feedback changes, rollback, actual lock waits, concurrent human
  edits, complete-batch failure, and personal/group/principle claim loss. API unit
  suite 671 passed / 3 paid-live benches skipped; web 366/366. API/web/admin
  typechecks, web build, migration and diff checks pass. Tests used only explicit
  loopback `waka_agent_test` isolated schemas. No live model calls, hosted schema
  changes/repair, push or deployment. No API server was listening on local 3010.
- Next D work is read-side truth, not more claim that fences finish the loop:
  already-published personal readings can still carry withdrawn support, and
  the no-signal/no-change carry path must not re-certify those words. Preserve
  edited/pinned wording with accurate standing, contain unverified legacy
  personal context, and expose a concise recovery path. Source/statement changes
  also need pending-support treatment and complete downstream re-assessment;
  question, embedding and derivation worker claim checks are not established
  by the reading/principle checks above. Source-to-artifact receipts, ambiguous
  saves, personal cache invalidation and E2's visible journey remain open.
  Routine database-error logging also needs review for parameter/content leakage
  under L3. The full A–J/L1–L3 objective and release gates remain unchanged.
- 2026-10-01, D3c baseline: reproduced 5 personal-output failures (unsupported
  generated text served, locked/pinned stale explanations, public unsupported
  text and no-signal carry resurrection), then 1 public opt-out read race and
  2 selection gaps (dismissed/foreign-evidenced signals still reaching personal
  generation). All eight now pass. Synthetic fixtures establish these defects,
  not incidence or exposure in hosted accounts.
- Personal current/version/public reads now project the complete citation set.
  Invalid machine conclusions are withheld instead of salvaged by dropping only
  the invalid citation. Locked/pinned wording survives with changed standing;
  copied belief/prompt text is cleared. Read projection does not erase history.
  Public content queries recheck both sharing flags and filter before their
  bounded limit. Public output retains no private IDs, sources or explanations.
  Personal generation and principle input use the same standing predicate;
  no-change/no-signal carry cannot re-certify withheld conclusions. Exact kept
  body/type matches can regain valid citations without changing human words.
- Private version revalidation reads projection and generation revision in one
  repeatable-read snapshot. Home checks its displayed version on focus/visibility
  and a 30-second interval only while relevant, with cancellation, a bounded
  deadline and mutation/identity/order guards. It does not automatically install
  another version while someone reads. A failed check keeps the last reading
  and offers GET-only "Check again"; a separate "Read again" starts generation.
  Open stale personal provenance is closed when changed support is applied.
- Rendered verification caught two styling defects missed by unit checks:
  recovery controls inherited the 10px dim metadata register, and public paper
  headings/body inherited dark-surface ink. Recovery now uses 14px labels and
  44px targets; the public surface scopes its ink, and a dangling CSS selector
  no longer makes note text inherit loading-copy styling. Layouts are unchanged.
  `pnpm e2e:reading-support` is a manual all-network-mocked browser check, not a
  new automatic browser gate. At 1280×900 and 390×844 it verifies one support
  notice, failed-check recovery without generation, public kept wording, no
  horizontal overflow or page errors. Screenshots inspected. Computed contrast:
  recovery 17.03:1; public title 17.40:1; note/standing 8.26:1. External fonts are
  blocked in this fixture, so the screenshots use fallback fonts.
- D3c verification: 15/15 personal-support SQL cases; with refresh, fencing,
  group-output, principles, contested, cadence and boundary regressions, 78
  distinct SQL cases pass. API unit 671 passed / 3 paid-live benches skipped;
  web 374/374 across 61 suites. API/web/admin and the manual browser script
  typechecks, web build, migration and diff checks pass. All SQL writes used
  disposable schemas on explicit local `waka_agent_test`; browser APIs were
  entirely synthetic. No live model calls, hosted schema/repair, push or deploy.
- This is current-standing projection, not a complete proof of current meaning.
  Source/statement edits pending assessment, historical personal feedback/context
  contamination, principle read-side standing, lower-layer worker ownership and
  complete personal cache invalidation remain open. E2 still needs exact
  source-to-artifact receipts, ambiguous-save reconciliation and the full visible
  journey. Entry mutation ordering/failure receipts and draft recovery also need
  work; snapshot guards do not claim to solve them. Full A–J/L1–L3 gates remain.
- 2026-10-01, D3d1 baseline: 3/7 reflection-question cases failed. A reclaimed
  worker overwrote its replacement's question, and locale/new-answer changes
  during the provider call still persisted stale questions. Source edit, answer
  edit and parent deletion already removed the job via redaction; those passing
  cases were retained rather than counted as new fixes.
- Question writes now reload the exact consumed context while holding the
  profile generation-revision row, then verify and lock the worker claim before
  storing the answer in the same transaction. Context comparison does not treat
  unrelated reading completion as a reason to buy another question call. Claim
  locking is non-waiting here: source redaction may hold that job row before its
  mutation reaches the revision trigger, so waiting back on it would deadlock
  the human write. The question retries instead. No new public state or table.
- D3d1 verification: 9/9 question SQL cases pass, including a real second-
  connection row lock (55P03 on the question writer; human source edit commits)
  and unchanged context despite an unrelated reading revision. With source
  material, durable save, reading-lease and queue regressions: 54/54 SQL cases
  across five suites. API typecheck and 671 unit tests pass / 3 paid-live benches
  skipped. Tests used only explicit local `waka_agent_test` disposable schemas
  and injected providers. No live model calls, hosted writes, push or deploy.
- D3d remains incomplete: embedding, derivation, enrichment and gardening writes
  must also reject reclaimed/stale work. In particular, statement re-embedding
  still writes after a provider call without checking current wording, and its
  failure path can delete a newer vector. These are the next lower-layer cases,
  not resolved by the question or reading guards. D/E2 and later release gates
  retain their full scope.
- 2026-10-01, D3d2 baseline: all 6 statement-vector race/cache cases failed.
  Older success/failure could overwrite/delete a newer edit's vector; same-input
  concurrent success was replaced or deleted; an existing current vector still
  spent another call; and a direct stale-wording request was not rejected.
- Re-embedding now checks scoped current wording before calling the provider,
  reuses matching cache, and locks/rechecks the statement plus worker claim
  before writing. It does not wait back on a human's row lock. A concurrent
  matching cache wins on either provider outcome. Failure cleanup is restricted
  to this model's mismatched hash; provider failure with no valid output requests
  the existing bounded queue retry. Source/claim/DB failures cannot masquerade
  as provider failure or delete cache. Private provider error text is not logged
  or propagated from this path. Neither human wording nor locks are changed.
- D3d2 verification: 12/12 new SQL tests pass, including real queue-router claim
  loss on success and failure, a second-connection human row lock, model-scoped
  cleanup, refused-commit rollback and cache reuse. With question fences, signal
  lock/statement-chain/suppression and reading receipt suites: 47/47 SQL tests.
  API typecheck and 671 unit tests pass / 3 paid-live benches skipped. All SQL
  used disposable schemas on explicit local `waka_agent_test`; clients were
  injected or their embedding method replaced in the test. No live provider,
  hosted write, push or deployment. No numerical threshold changed.
- Remaining D3d work still includes capture-vector, support-review, discovery,
  enrichment and gardening commit claims. Statement edit/drop/enqueue ordering
  and durable statement-support propagation are not established by this writer
  fix. The source-to-artifact contract and all later delivery gates remain open.
