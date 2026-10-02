# Goal: implement the experience review

Status: paused at the owner's request after completing the current feedback/room-flow batch. Delivery of the checked batch to dev is explicitly requested; no further implementation should continue after it. Remaining release cases, later UX/algorithm slices, semantic validation, historical repair and deployed verification stay open. The full objective is unchanged, not completed.
Created: 2026-10-01, on the owner's instruction to implement the full plan.
Branch: `codex/ux-feedback-revisions`; preceding implementation delivered through `codex/ux-feature-implementation`.
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
| D | F1: exact source attribution, explicit support checks, retention, revisions and durable downstream jobs | Deletion/edits remove invalid current citations; bounded omission/failure do not withdraw good support; stale jobs cannot commit; locked words survive | D1–D3e3 locally checked and delivered to dev, including current wording/material bindings and bounded review coverage. D3e4 feedback revisions/current-context and atomic corrections locally checked: 1,156 API / 440 web. Remaining context/recovery edge cases, deployed verification, live semantic quality and historical repair stay open. |
| E1 | F7/F8: authoritative poster and truthful manual refresh | Queue acceptance, changed/unchanged completion, failure and fresh displayed version verified | Implemented with job receipts, resumable profile-scoped polling, held-job manual upgrade and authoritative headline. Local checks pass (8 receipt SQL tests, 10 hook tests, full web 362/362); deployed verification remains open. |
| E2 | F9: capture/reflection outcome and recovery | Save → answer → generation → visible result; delay, daily hold, retry, resume and rapid requests verified | E2a–E2h delivered to dev. Connected production-build desktop/mobile capture → three answers → owned reading → explicit adoption → reopening/retraction passes against real authenticated routes/SQL/workers with deterministic providers. Synthetic-browser recovery/account-switch and backend fault journeys pass. Connected fault/account-switch/cross-device, older-job branches and deployed walks remain open. |
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

## Source-to-reading completion contract (D/E2)

Keep three identities separate: an inspiration's allowed-material revision,
a numbered request on a possibly reused job, and a published reading version.
Queue request versions alone are not evidence that a saved answer was read.
The remaining implementation must bind all three, with metadata rather than
copies of private text:

- Track personal and public source revisions separately; private reflections
  advance only personal material. Do not certify legacy processed state.
- In the save transaction, bind the requested material to its destination and
  exact derivation request. Retain the latest derived and completed material
  revisions independently; a newer request never inherits an older completion.
  A later material revision may supersede an earlier receipt; do not claim
  that deleted or replaced words themselves were read.
- At successful derivation, bind changed standing to the exact downstream read
  request. A genuine no-change derivation may settle without buying another
  synthesis, but it cannot skip an earlier outstanding read dependency.
- Bind completion to the actual artifact transaction/result. Respect cadence,
  failure, coalescing, newer requests and current ownership at every handoff.
  A job ID, queued acceptance, or timeout alone proves none of these outcomes.
- Expose one resumable status line for the latest relevant save, with matching
  artifact adoption only on explicit action. Add idempotent save/reconciliation
  so an ambiguous POST does not duplicate inspirations or answers.

E2a numbers requests and makes manual-refresh receipts version-aware. E2b adds
material counters and per-request destination bindings; E2c binds downstream
completion/artifact publication; E2d exposes scoped recovery and capture/answer
progress with explicit adoption. Idempotent save reconciliation and the full
release journey remain required; these increments are not completion of D or E2.

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
- 2026-10-01, D3d3 baseline: 10/10 new worker cases failed: reclaimed capture-
  vector, support, discovery, match, enrichment and comparison writes were still
  accepted; a failed later comparison left a partial proposal batch; and source
  jobs could act on another profile's capture/attachment when given a poisoned
  internal payload. A further reproduced case showed a late opposed verdict
  overriding the effect of a keep-apart decision recorded during its call.
  These are isolated reproductions, not evidence of hosted exploitation.
- The queue now passes its commit-claim guard through capture-vector storage,
  support application, discovery's final source check, enrichment and comparison
  persistence. Each check and its writes share a transaction; guard failure
  rolls that stage back. Source jobs check owner/parent binding before any
  provider/fetch. Direct reviewed operations keep their existing explicit
  authority. Earlier stages validly committed before a later claim loss are
  not rolled back, and no incomplete job is called a complete learning receipt.
- Comparison now prepares all judgments before its batch write, verifies the
  profile revision, uses non-waiting statement locks, and rechecks recorded
  pairs before inserting. A concurrent keep-apart decision cannot gain a new
  contradictory pair from that late verdict. No model thresholds or public
  states changed; partial provider failure leaves no comparison records.
- D3d3 verification: 16/16 new real-SQL worker tests pass, including successful
  derivation/support/enrichment (not only rejection cases), changed wording,
  claim loss at each stage, poisoned-owner payloads, keep-apart races and a real
  second-connection human lock. With nine related pipeline suites plus gardener
  coverage: 161/161 SQL tests across 11 suites. API typecheck, 671 API unit tests
  and 374 web tests pass; 3 paid-live benches skipped. Migration and diff checks
  pass. All SQL used disposable schemas on explicit loopback `waka_agent_test`;
  model methods and the enrichment fetch were replaced with deterministic test
  data, with the fixture host allowlisted only in the test. No live provider,
  hosted data/schema write, push or deployment.
- Lock-order review added one more real two-connection test: a source writer
  holding a generation revision can still update its job row after the worker
  yields. Lower-stage guards acquire affected revision rows non-waiting before
  taking the claim, matching mutation-trigger → enqueue order; enrichment
  includes existing evidence destinations. This avoids introducing a claim/
  revision wait cycle while adding ownership checks. The explicit support
  application CLI help smoke check also passes; no report was applied.
- The full goal is still incomplete. Next required work is the source/statement
  revision and completion contract: pending support must be truthful, statement
  edits must durably request reassessment, and a saved answer must be traceable
  to its actual completed reading rather than a recycled job ID. Post-artifact
  principle scheduling is still outside its artifact transaction. Historical
  context/repair, cross-device caches, live semantic evaluation and every later
  delivery/release gate remain open; worker claim guards do not prove them.
- 2026-10-01, E2a: fixed the prerequisite request identity before exposing a
  capture/reflection completion claim. Seven initial SQL cases failed because
  a reusable job had no numbered request/completion coverage. Migration 0040
  adds bigint requested/completed versions with invariant checks. Coalescing
  retains one job while numbering each accepted request; terminal reuse and
  explicit retries get new numbers. A worker acknowledges only the version it
  claimed, under its existing lease predicate. Holds, failures and rolled-back
  saves acknowledge nothing. Legacy completed coverage starts at zero.
- Refresh acceptance/status now carry decimal-string counters. The browser
  persists the numbered receipt, asks for that request when polling/resuming,
  and rejects an older success on the same job instead of adopting it. Checks
  retry the same receipt without buying another generation; values beyond the
  JavaScript integer range preserve precision. Older browser sessions containing
  only a job ID may ask the server for current status, but unverified legacy
  success is reported as unknown rather than fabricated completion.
- Migration readiness uncovered missing latest snapshots and bigint-default
  serialization failure. Restored an authoritative 0040 snapshot from the current
  38-table TypeScript schema using the installed Drizzle generator; a fresh
  generated snapshot produces zero diff statements and serializes without a
  custom bigint codec after SQL-literal defaults replaced bigint JS defaults.
  The real empty-database migration passed, but the conservative enum-upgrade
  scanner flagged 16 comparisons in this branch's UNDEPLOYED 0035/0038/0039
  trigger definitions. Explicit text comparisons fix those warnings without
  weakening the gate or editing any known deployed migration.
- E2a verification: 12/12 new SQL cases pass, covering pending/running/terminal
  reuse, rollback, failure/hold, late settlement, principle retry, real refresh
  routes, operational retry serialization, large counters, scoped status reads,
  and upgrade of a legacy completed row without inventing coverage. With queue,
  source durability, write fences, provenance and migration tests: 96/96 SQL
  cases across eight suites. API unit 671 passed / 3 paid-live benches skipped;
  web 377/377. API/web/admin types, web build, migration/diff checks and all 5
  offline migration-integrity checks pass. The fresh-migration test created and
  removed its disposable local database; all other SQL used isolated loopback
  `waka_agent_test` schemas. No hosted write, live provider, push or deploy.
- E2 is NOT complete: queue versions are not source-material revisions. Next
  bind saved material and per-destination derivation to exact downstream
  reading completion, including no-change work, earlier unfinished dependencies,
  cadence, attachment enrichment and concurrent edits; then wire the one-line
  capture/reflection experience and idempotent ambiguous-save recovery. The
  operational retry route also still needs worker wake-up/recovery verification.
  Deploy only after verifying stage targets and coordinating old workers; an
  unaware old writer cannot certify numbered completion. Full A–J/L1–L3 remains.
- 2026-10-01, E2b baseline: 3/3 source receipt cases failed because saved work
  had neither a material counter nor a binding to its numbered queue request.
  A further reproduced assessment race treated changed-and-restored material
  as current because its content hash matched again. The new revision fence
  reports that in-flight review stale without treating it as negative evidence.
- Migration 0041 adds metadata-only personal/public source counters and
  `inspiration_processing` receipts. Counter triggers cover actual capture,
  included-answer and attachment changes; skipped/unanswered prompts and
  timing-only updates do not move them. Private answers never advance public
  material. Legacy sources start at baseline one with NO invented processing
  records. Source deletion cascades through the new metadata; no raw snapshots
  are copied. Material readers verify the counter around their reads, and final
  source/review checks reject a changed revision even when its hash returns.
- Each numbered derivation request gets its own immutable material/destination
  binding. Reprocessing identical material does not inherit an earlier receipt's
  completion. Binding verifies source owner, destination, current visibility,
  human membership, job ownership/type/payload and request version. Queue row
  and receipt commit together, including standalone backfills. Capture, edit
  and answer-save responses now carry the exact personal processing receipt;
  current client wrappers do not yet surface it as processing-complete.
- Enqueue locks the source before the job, matching deletion's order. A real
  two-connection test observes the enqueuer waiting, then source deletion and
  job cancellation completing without a deadlock. Backfill skips sources closed
  or deleted after its list read. Savepoint-protected room fan-out rolls back
  only a now-unavailable destination, preserving the personal save; actual
  queue failures still roll the save back. That savepoint test injects the
  authorization outcome while using real source/job/receipt SQL; visibility,
  membership and legacy-agent refusal are separately tested by actual queries.
- E2b verification: 18/18 source-processing SQL cases pass; source save routes
  return revisions 3 → 4 → 5 for inline answers, edit and another answer while
  their one job advances requests 1 → 2 → 3. No receipt is prematurely derived
  or completed. With nine related suites, 142 distinct SQL cases pass. The
  upgrade test applies 0041 to a schema staged through 0040 and preserves legacy
  text without fabricating processing. Tracking is installed before the
  non-overwriting baseline backfill; the upgrade fixture also inserts a source
  and answer in that interval and verifies their counter is not reset. The
  real fresh migrator also passes.
  API unit 671 passed / 3 paid-live benches skipped; web 377/377. API typecheck,
  migration/diff checks and 5/5 offline migration-integrity checks pass. The
  generated 40-table snapshot has zero diff against the current schema. All
  writes stayed in disposable local schemas/databases; no provider calls,
  hosted migration/repair, push or deployment occurred.
- E2c next: set `derived_at` only inside a successful matching source pass;
  bind changed support/discovery to the exact reading request; record the
  artifact result in its publication transaction and set `completed_at` only
  when derivation and that dependency are satisfied for current material.
  Preserve earlier outstanding read dependencies when a retry discovers no
  new candidates. A valid no-change pass may settle without another synthesis,
  but no queued receipt may stand in for it. A reading can finish during
  extraction after support withdrawal, so retain its result without premature
  completion and reuse it only if the final derivation adds no further changes.
  Handle enrichment-in-flight, withdrawn room material and superseded source
  revisions explicitly. Then add scoped status/retry endpoints, client receipt
  preservation, one-line capture/reflection progress and ambiguous-save
  idempotency. None of those completion/UI gates is claimed by E2b; the new
  receipt completion fields deliberately remain unset until the chain is wired.
- 2026-10-01, E2c baseline: 3/3 source-completion cases failed because no stage
  wrote derivation/completion or carried a required prior read. Separately
  reproduced the principle handoff gap: a deliberately refused principle enqueue
  left the reading and source completion already published. That reproduction
  used the actual old post-publication path, not a guessed failure condition.
- Derivation now binds source receipts to support/discovery reading requests
  inside those data transactions. Its successful final pass marks derivation;
  genuine no-change work may settle without synthesis, but it retains an earlier
  unfinished read. Failed/missing reads can be requested again. Recovery of a
  committed derivation skips another extraction and does not duplicate its read.
  Transient support failures or pending/failed attachment enrichment do not
  mark source processing complete.
- Personal/group publication records the first matching numbered artifact
  result in the artifact transaction, including a valid empty read. Results
  arriving during extraction survive failure/retry and finished-job cleanup,
  without completing the source before derivation succeeds. A later required
  read clears the earlier result. Current material, source scope and membership
  gate completion; stale revisions and withdrawn/departed room sources do not
  acquire new completion. Room waiting-for-affirmations is not publication.
  Recorded results are parsed as metadata and checked against artifact ownership.
- Eligible principle scheduling moved from the worker's post-commit tail into
  publication. Eligibility is read once for this handoff, through the same
  transaction, and no wake/model call occurs under that transaction. A failed
  enqueue rolls back the reading and its receipts; retry commits all three.
  Billing-profile locks are non-waiting for the transactional group handoff.
  Broader account-erasure concurrency and manual-refresh recovery after a crash
  between publication and job settlement still need release-level verification.
- E2c verification: 20/20 real SQL completion cases pass, including current
  publication, no-change, inherited/failed/missing dependencies, large-stage
  failure/retry, early publication, cleaned-up jobs, malformed cached result,
  newer requests, source races, empty-read lease loss, enrichment, room waiting,
  privacy/leave and principle handoff rollback. With 11 related suites: 184/184
  SQL cases. API unit 671 passed / 3 paid-live benches skipped; web 377/377.
  API typecheck, migration/diff checks and 5/5 offline migration-integrity checks
  pass. All DB writes were in explicit local disposable schemas; providers were
  injected. No hosted changes, live model calls, push or deployment occurred.
- E2d next: expose profile-scoped processing status and recovery. A response
  must distinguish a specific receipt from the latest material/repeated request,
  follow superseding material without claiming deleted words were read, hide a
  partial publication until completion, and classify cadence, room participation,
  enrichment and unknown/legacy work truthfully. Preserve receipts through client
  API adapters and account-scoped storage, show one status line, and adopt ready
  wording only on explicit action. Then implement request-identity reconciliation
  for ambiguous source/answer saves and run the full release-1 journey. Do not
  call E2 or the full goal complete based on these backend-only checks.
- 2026-10-01, E2d: client adapters had discarded the top-level processing
  receipt on capture and answer saves (2 reproduced failures). They now retain
  it for capture, answer and edit; capture/answer writes explicitly name the
  profile that opened the composer. One session-stored metadata reference per
  account/profile follows the latest relevant source through queued, active,
  held, completed, failed or unknown work. Status checks do not generate.
- Added personal `GET /inspirations/:id/processing` and explicit
  `POST /:id/processing/retry`. A read-only snapshot verifies source/receipt
  ownership, follows the newest current-material request, reports separate
  derived/completed revisions, and hides partial/foreign results. Completed
  metadata survives queue cleanup; legacy succeeded jobs do not imply current
  completion. Recovery locks current ownership/material, resumes only missing
  or failed enrichment/derivation/reading, does not duplicate saved material,
  preserves active leases and cadence holds, and rolls back the job counter
  if recording its new receipt fails. Keeper/read-only credentials cannot
  recover and are not offered that action. Room processing metadata is not
  exposed by this personal endpoint.
- The UI shows one progress line, either beside reflection or on the personal
  wall. Completion offers See reading; that action confirms status again and
  fetches an owned matching-or-newer artifact before adoption. No new headline
  arrives on the old six-second timer or silently on tab return. An earlier
  wording comparison comes from a fresh historical projection, is tied to its
  verified snapshot, and is withdrawn on revalidation/edit rather than kept as
  an unverified text cache. Checking a failed/ambiguous recovery response never
  repeats the POST automatically. Deleted/inaccessible sources remove their
  progress reference. A future hold sleeps until eligibility and starts a
  fresh bounded observation window then.
- Additional unit reproductions caught 5 cases: deleted-source notices falsely
  saying kept, a failed confirmation adopting old ready state, malformed ready
  results, foreign receipt metadata, and a scheduled hold instantly becoming
  delayed at eligibility. All now pass. The 16 hook cases also exercise resume,
  old account/source responses, repeated recovery, hung reads, unchanged output
  and explicit adoption. Raw words are not stored in the progress reference.
- Rendered verification found 3 defects beyond the unit seam: following a
  question scrolled the overflow-hidden world by 391px and clipped its dialog;
  disabling a checking action dropped focus to the body so Escape failed; and
  a 31-second simulated tab absence silently adopted the newer headline.
  Follow-up focus now prevents ancestor scrolling and moves only the native
  dialog/card scroll; progress actions retain focus while busy; returning
  revalidates the displayed artifact instead of replacing it. The processing
  action measures 44px high × 84.8px wide with 14px type in both viewports.
- E2d verification: API/web typechecks, API unit 671/671 (3 paid-live benches
  skipped), web 399/399 across 62 suites, build, migration check and diff check
  pass. Real isolated-loopback SQL: 13 status/recovery + 18 source-binding +
  20 completion + 6 profile-boundary + 8 keeper-key = 65/65. Manual
  `pnpm e2e:source-processing` passes at 1280×900 and 390×844 (the latter with
  mobile/touch emulation): saved answer, preserved unfinished draft, still
  headline, explicit open/comparison, failure retry, reload resumption and
  unchanged completion/dismissal. Current screenshots were inspected; this
  fixture blocks non-local assets and mocks every API, uses reduced motion,
  and does not certify deployed services, real device behavior, model quality,
  or the full three-answer release journey. No hosted write, model call, push
  or deployment occurred.
- Next E2e: make ambiguous capture/answer saves reconcilable by request identity
  instead of resubmitting and potentially duplicating authored content. Pending
  attachment-finalization recovery belongs to G (registered enrichment failures
  are covered here). D's pending/statement support, legacy context, full release
  journey and all later A–J/L1–L3 requirements stay open. This is a locally
  verified delivery increment, not completion of E2 or of the full goal.
- 2026-10-01, E2e1 baseline: 4/4 real-route cases failed. Repeating a lost
  capture response produced 2 captures instead of 1; repeating an answer
  produced 2 answers; reusing an identity for other words created rather than
  conflicting; no committed-request lookup existed. Three client-wire cases
  separately failed because save metadata/error codes were discarded and the
  request identity was not sent.
- Migration 0042 adds `inspiration_save_requests`, keyed by profile and UUID
  request identity, with normalized input hashes and source/answer/processing
  references. It contains no authored response snapshots. Parent references
  carry the tenant through composite FKs. Delete triggers clear output links
  and processing metadata, leaving a non-reusable tombstone; profile erasure
  removes it. No expiry or historical backfill can silently turn an old key
  into another create. Existing words/answers survive the additive upgrade.
- Capture/answer creation accepts an optional UUID `Idempotency-Key`. Authored
  rows, inline answers, experience/citation writes, processing jobs and the
  request record commit together. Same-intent replays return current permitted
  content and the original processing reference, not stale original words,
  another answer or another derivation request. Changed input/operation/parent
  conflicts; removed results return 410. A profile-scoped non-waiting request
  lock serializes concurrent intents, with a specific in-progress response;
  replays also fail promptly on locked output rows instead of hanging. Keyless
  creates remain ordinary independent creates, not purportedly deduplicated.
- Added metadata-only `GET /inspirations/save-requests/:requestId`, under the
  existing profile read boundary. A 404 says no committed save was observed,
  not that a still-running POST failed; 410 denotes deliberate removal.
  Neither lookup nor replay creates generation work. The client preserves
  save acknowledgments, failure codes, cancellation and explicit request IDs.
  For a keyed, explicitly profiled ambiguous write it performs one lookup; a
  confirmed existing record permits one same-identity POST to verify the
  original input hash and read the current result. Unknown lookup, cancellation,
  second network loss and removal do not cause an automatic new create. Inputs,
  owner and key are frozen for that attempt, so mutating a caller's objects
  cannot redirect recovery to another profile or payload. This is a bounded
  API protocol, not a substitute for the browser's durable intent storage.
- E2e1 checks: 18/18 save SQL cases pass, including upgrade, normalized/repeated
  input, genuine distinct saves, original-result edits, deleted capture/answer,
  profile/FK boundaries, erasure, full transaction rollback, a confirmed held
  request lock, simultaneous independent connections and locked-result replay.
  With 7 related suites, 91/91 SQL cases pass, including the actual fresh
  migrator. API unit 671 passed / 3 paid-live benches skipped; web 412/412.
  Both typechecks, web build, migration check and diff check pass; the generated
  41-table snapshot has zero diff against the current schema. All mutations
  used explicit disposable loopback databases/schemas. No hosted migration,
  model call, data repair, push or deployment occurred.
  The existing rendered processing flow also passes at both 1280×900 and
  390×844 after the client changes; it still exercises keyless composer calls,
  so it is regression evidence, not browser save-idempotency certification.
- Next E2e2 is still required for the user-visible fix: persist the exact
  pending capture/answer intent, UUID and owner BEFORE sending. Current Home
  and ReflectionFlow calls still omit request IDs. Survive optimistic draft
  clearing, reload, dialog exit, timeout, and account changes without choosing
  a new key. Reconcile a saved result before editing/replacing an unresolved
  intent; do not append a second orb, archive row or answer on replay. Preserve
  a newer unsent draft separately, and keep a pending answer's original question
  as well as its words. Sync current answers before requesting a follow-up if
  another device has moved ahead. A removed result must not be recreated by an
  automatic retry. Clear resolved pending metadata/drafts in a crash-safe order.
  Verify the three-answer release journey and failure branches after this is
  wired; attachment finalization remains G. The complete A–J/L1–L3 objective
  remains unchanged. Deploy schema/API before enabling keyed browser behavior
  and verify the actual hosted targets/protocol; no mixed-old-writer guarantee
  or end-to-end browser duplicate protection is claimed by this increment.
- 2026-10-01, E2e2: reproduced a reflection retry without any request identity.
  Capture and reflection now persist immutable, account/profile-scoped intents
  before their first network request. Separate per-request keys avoid overwriting
  simultaneous pending intents. Reopen/focus reads committed status; unknown
  outcomes retain the same UUID and words for explicit retry. An older server
  that cannot honor the protocol receives no authored POST. Storage failure
  before preparation also sends nothing. Hung observations are bounded and
  aborted; late account/source responses cannot alter the current view.
- Both composers use the protocol. Drafts remain until confirmation; matching
  draft cleanup precedes pending-key removal and continuation. Later in-memory
  or stored drafts survive old completion. Reflection questions travel with
  pending answers, current answers are loaded before continuing, and badge/orb
  counts reconcile to served counts instead of blindly adding one on replay.
  Opening a recovered answer does not buy a new question. Confirmed validation
  errors allow Edit draft; ambiguous outcomes retain their identity. Removed
  items are not recreated. Explicit corrupt-record reset preserves recovery
  bytes without adopting them. Initial waits show progress, not Try again.
- Verification at the requested stopping point: web typecheck, all 433 tests
  across 64 suites, build and diff check pass. This includes 13 journal tests,
  5 draft-settlement cases, reflection identity retry, and mounted capture tests
  for same-ID retry and newer-draft preservation. The fully mocked rendered
  capture → answer → explicit reading flow passes at 1280×900 and 390×844,
  now requiring request IDs on its POSTs and serving the save-lookup protocol.
  It still does NOT certify real-stack lost-response/reload recovery, the full
  three-answer/retraction release gate, real-device behavior or deployed state.
  No new backend/schema changes were needed in this batch; previous 91 SQL and
  671 API unit checks belong to E2e1, not a fresh full-stack certification.
  Nothing was pushed, deployed, repaired on hosted data or sent to a live model.

## Pause checkpoint and reevaluation — 2026-10-01

The owner asked to finish the active batch, pause, and reassess because the run
had taken too long. E2e2 is wrapped locally; do not automatically pick up another
slice. The original full A–J/L1–L3 goal remains incomplete.

- **Locally implemented:** core input/focus/readability corrections, preservation
  of human edits, account-scoped drafts, room/private-reflection boundaries,
  substantial support/worker race fixes, truthful generation progress, explicit
  reading adoption, and save/retry/recovery protocol plus browser journals.
- **Partially finished / still needs proof:** remaining D support/context cases,
  the complete release-1 journey and failure branches against a real local stack,
  wider mobile/accessibility checks, cross-device behavior, actual generation
  quality/latency/cost, historical-data repair and hosted rollout.
- **Not yet delivered by this goal:** visible search and navigation improvements
  (F), reliable attachment recovery (G), initial-load performance work (H),
  evaluated reading/principle improvements (I), next-round room participation
  and starters (J), password recovery (L1), complete policy/copy alignment (L2),
  and onboarding, telemetry and user/release validation (L3).
- **Reevaluation:** most effort went into reliability and implementation depth,
  while much of the visible product roadmap remains pending. The next decision
  should be a review of this substantial local change set and a short product
  walkthrough, followed by a deliberately bounded release scope—not another
  open-ended implementation pass. Verify deployed DB targets before migration;
  separate GitHub/SST configuration is not proof of the actual runtime values.
- **Known boundary:** attachment finalization still uses the prior best-effort
  path; text/answer idempotency does not make uploads or link finalization safe
  to retry. Deployed guarantees and completion of the full plan are not claimed.

## Resumed dev delivery — 2026-10-01

The owner explicitly requested pushing the completed local batch to dev and
continuing the goal. Fresh fetch found remote dev unchanged at `33e65a7`, with
the local branch 26 commits ahead and none behind. The push is a normal
fast-forward, not a history rewrite. This authorizes the existing automatic
dev deployment; it does not authorize production deployment or historical repair.

Before that push, closed the configuration drift between dev migrations and
runtime: the workflow now requires `DB_CONNECTION_URL_DEV`, compares its
normalized configured endpoint/database with production without connecting or
printing credentials, and synchronizes development's SST `DbConnectionUrl`
from that same dev value. The guard precedes infrastructure changes/migrations
and rejects missing/invalid targets, credentials-only differences, pooled/direct
aliases, and target-override URL parameters. Separately named aliases can still
refer to one underlying database, so this is not a claim of provider-level
isolation or a read of the deployed production runtime.

Pre-push checks: 679 API unit tests pass (8 new deployment-preflight cases;
3 paid-live benches skipped), 433 web tests pass, both typechecks and web build
pass, and migration check passes. Explicit loopback SQL: 40/40 across the fresh
migrator, keyed saves and source completion suites. No local command migrated
hosted data, invoked a paid model, or changed production configuration.

After delivery, continue with the complete personal release-1 journey and its
failure/recovery branches before opening another feature slice. Keep deployment,
historical repair and real-model quality evidence separate from local checks.

- Dev delivery: `f4e4932` fast-forwarded to remote dev. Automatic deployment
  run `36945056441` succeeded, including the configured database-target guard.
  This does not certify provider-level isolation, repair legacy data, or verify
  the logged-in product experience. Production was not deployed.
- CI run `36945056467` found 3 failures in the old ratified-light SQL fixture
  (1,099 other tests passed). Reproduced all 3 locally: its generated readings
  cited signals with no evidence, now correctly withheld by D3c. Added owned
  evidence to that fixture, preserving all original answered/lock assertions,
  and added a regression proving feedback cannot revive unevidenced generated
  wording. Targeted result: 5/5 pass; the complete local API suite then passed
  1,103 tests (3 paid-live benches skipped), with API typecheck passing. No
  production reader logic changed.

## E2f — backend release journey checkpoint — 2026-10-01

The next gate was declared before testing: three saved answers must remain
single authored rows on replay; retracting the exact supporting answer must
remove its quote and unsupported relationship; progress must not report a
replacement reading until the current material finishes. Provider failure must
leave the capture/answers saved and recover without another authored create.

Added `personal-learning-journey.db.test.ts`: real Hono save, lookup, edit,
delete, processing/retry and manual-refresh routes run through the real Postgres
queue and current-reading projection. Authentication, model output and embeddings
are deterministic injections; all writes stay in disposable loopback schemas.
The three cases cover the normal and failed-provider three-answer/retraction
journeys, then no-new-candidate processing, an actual daily hold, and explicit
manual completion with unchanged wording. They also verify exact answer-quote
identity, one witness rather than three, another account's refusal, current
material superseding old receipts, and a removed answer's non-reusable save key.

Result: 3/3 new journey tests pass. Full local API suite: 1,106 passed, 3
paid-live benches skipped, across 100 passing suites. API typecheck, vocabulary
gate and diff check pass; goal index 3/3 passes. No new runtime behavior,
threshold, schema or model prompt changed in this checkpoint. The test provider
was corrected to consume the real question/context-plus-answer format; an empty
discovery is tested independently of a genuine new signal needing a daily hold.

This passes the scoped backend checkpoint, NOT the complete release-1 gate.
Real-browser ambiguous-response/reload recovery, account switching, the complete
older-job-finishes-last journey, room/deployed walkthroughs, pending/statement
support and historical context/repair remain open. Continue with the bounded
browser recovery journey before starting F–J or claiming E2/release completion.

## E2g — browser recovery and draft fixes — 2026-10-01

The previous goal turn made progress: it pushed the batch, fixed the CI fixture
and added the real-route backend journey. On this resumed turn, the app goal
tracker is active. Remote `25d5b6e` has successful CI (`36946246366`) and dev
deployment (`36946246440`). The full A–J/L1–L3 objective remains unchanged.

Declared browser gate: commit a capture/answer but drop its response, make
lookup temporarily unavailable, reload, then recover by its original identity.
There must be one saved row, no automatic repeat POST or follow-up question,
and a newer owned draft must survive signing out/in while another account
sees neither that draft nor its processing/recovery status.

Expanded the manual `e2e:source-processing` fixture with connection-reset
responses after synthetic commits, failed status lookups, owned request logs,
reload and actual sign-out/sign-in UI. Its server fixtures enforce profile
boundaries. The test now uses the production web build at loopback port 3012:
the old Vite dev server intentionally bypasses RequireAuth, so it could not
prove the production sign-out navigation. All API responses remain synthetic;
non-local assets are blocked, and no real account/model/database is touched.

Two product failures were reproduced in both the browser and targeted React
tests before fixing them:

- Escape deleted a newer short capture draft while an older save was uncertain
  (expected words, actual stored draft null). It now closes through the existing
  save-as-draft action, preserving short and long drafts consistently.
- A recovered first reflection was shown as both saved and an unfinished
  answer (expected no textarea, actual textarea held the saved words). Restore
  now preserves the first question's null predecessor instead of substituting
  the newly committed answer ID. Matching draft cleanup can therefore finish;
  no new question is requested just by opening it.

After fix: 38/38 targeted hook/composer/reflection/draft tests, 435/435 complete
web tests across 64 suites, web typecheck/build, manual-script typecheck and
diff check pass. The production-build browser journey passes at 1280×900 and
390×844 with touch/mobile emulation. Screenshots inspected; no page errors or
horizontal overflow. Processing controls remain 44px high with 14px labels.
Reopening/recovery issues one POST per authored intent, keeps the original
question, clears only the matching draft/journal and offers an explicit next
question. The browser fixture and backend journey are complementary evidence;
they do not yet establish one connected real-browser/real-worker journey.

Next D checkpoint: statement edits still commit before vector removal and
best-effort queue insertion, and they do not durably request existing-evidence
reassessment. Close that source/statement handoff and its pending-support
serving gap before claiming the personal loop complete. Historical context,
older-job/account races, real-stack/deployed walks and all later slices remain
open; these two UI fixes do not complete the goal.

## D3e1 — durable human statement work — 2026-10-01

The previous goal turn made progress (two browser-reproduced recovery fixes,
regressions and dev push). Its `3c79dbe` CI (`36947028521`) and dev deployment
(`36947028650`) both succeeded. Current work remains the complete experience
plan, with D's statement/pending-support gate as the next prerequisite.

Declared atomicity gate: an edited/reverted signal cannot commit wording,
history or vector removal while losing any required job. Old witnesses must
be rechecked, including withdrawn links whose sources still exist; a support
check must not rediscover candidates or certify a capture's full derivation.
Executed the original routes before the change: 6/6 cases failed (three queue
failure cases still answered 200, missing witness rechecks, repeated locked
wording adding history, and revert missing witness rechecks). Fixture setup
was first corrected to the actual JSONB/dimensions/input-hash embedding schema;
those setup errors were not counted as product reproductions.

Signal edit/revert now lock their owned source parents before the statement,
serialize against derivation and commit history, stale-vector removal,
re-embedding, witness reviews and reading request together. A busy source
writer wins promptly (409, no partial edit). An identical already-locked edit
adds no chain/job receipt; it can still settle a newly recorded dispute.
Wake-up follows commit. Source deletion also cancels the new review jobs.

Canon-first addition and migration 0043 introduce `review_signal_support`, a
separate keyed, metered worker operation. It runs the existing bounded support
assessment and its current-material/worker fences without extraction or vector
discovery. It creates no `inspiration_processing` receipt and cannot claim one
complete. This avoids duplicate discovery while the edited signal is waiting
for its new vector, and keeps ordinary capture jobs separate. The generator
rejects attempts to combine support-only work with source-completion authority.
Machine restatement propagation and pending-support serving remain next.

Verification: 11/11 new real-route/SQL cases pass, including all failed job
insertions, identical replay, revert rollback, previously withdrawn support
restoration, current negative assessment preserving locked words, second-client
source locking and a reclaimed review worker. Full API: 1,117 passed, 3
paid-live benches skipped, 101 passing suites. API typecheck and 435/435 web
tests pass. Fresh migration 2/2, generated 0043 snapshot/journal, migration,
vocabulary and diff checks pass. Two older lock fixtures now explicitly run
deterministic re-embedding after an edit before testing later matching; their
original word-preservation/promotion/release assertions are retained.

This passes the scoped durable-human-edit checkpoint. It does not prove current
support while assessment is pending, propagate machine restatements across all
witnesses, repair history or complete D/release 1. Migration 0043 was exercised
only in disposable loopback schemas/databases. No live provider or hosted DB
mutation occurred. Keep this batch on the implementation branch until the
pending-support reader/worker handling is ready; old worker builds do not know
the new job type, so the deployment step must coordinate their transition.
No production deployment or historical repair is authorized by this checkpoint.

## D3e2 — pending support and word-bound citations — 2026-10-01

Previous turn: progress (atomic statement work, 11 SQL regressions, pushed
draft PR [#331](https://github.com/waka-eng/waka/pull/331)). Its CI run
`36948345809` succeeded. The complete A–J/L1–L3 objective remains active.

Declared gate: changing a source or statement must stop presenting old support
as current before a worker finishes. Protected words survive; copied generated
explanations do not. Positive assessment can renew an unchanged claim without
duplicating its witness, but cannot certify an artifact built from different
wording. Failed checks keep relationships and give an explicit recovery path.

Baseline: 6/6 serving/review cases failed (source edits served old conclusions,
protected entries retained old explanations, positive checks did not renew
source lineage, rewritten signals recertified old artifacts, provider failure
still served unchecked proof, and a change-and-return accepted an old review).
Two additional cached-verdict cases failed after source/statement change-and-
return. Two owner-word cases failed: editing an entry or principle kept its
previous wording's citations as current. These 10 reproductions now pass.

Canon-first migrations 0044–0046 add monotonic wording/body counters and bind
evidence, review-cache records and artifact/principle citations to their consumed
revisions. Counters advance on actual changes, including change-and-return;
clients cannot reset them by supplying a counter. Nullable old bindings refer
only to the migration baseline, and exact existing material identities retain
their recorded source revision. No legacy value is replaced with the newest
counter or described as independently reviewed. This does not repair history.

Personal/public/room serving and generation share the revision predicates.
Unsupported generated conclusions are withheld; edited/pinned words remain
with changed-support metadata and cleared old explanation/citations. Private
answer changes still leave public room proof current. Machine restatements
stamp their immediate grounded sources after the wording change and durably
request checks for their other currently allowed witnesses. Fresh generation
binds its own citations; copied old bindings do not acquire new authority.
Private signal evidence queries now keep foreign-profile sources out, and
pending quotes/reasons are not presented as current support. Exports serialize
new bigint counters as decimal strings.

Read workers hold for actual queued/running support work without consuming a
retry or publishing an empty success; future input eligibility controls the
hold time. Manual reads bypass cadence, not input checks. Explicit reading/
principle retries recover missing/failed reviews; active checks are left alone,
and finished genuine uncertainty does not start a retry loop. The principle UI
distinguishes queued checks from active checks, preserves protected wording
with one short notice, and permits failed-support retry below the generation
bar. Opening a queued support view does not buy another read.

Verification: full API 1,131 passed / 3 paid-live benches skipped across 102
passing suites; full web 438/438 across 64 suites. The 14 new real-SQL cases
cover the original failures, cache revisions, long input holds, failed-check
recovery, owner body edits, machine restatement → review → fresh reading, and
private-answer/public-source room isolation. Three new component cases verify
queued copy/no mount POST, explicit failed-check retry and protected wording.
API/web typechecks, web build, migration/diff checks and both fresh-migration
cases pass. Older fixtures now declare current proof before testing commit
races, keep identical-word locking separate from rewording, construct a
verified no-change reading directly, and actually recheck a restored public
voice. Their original privacy/fence/standing assertions remain.

Production-build manual browser checks pass at 1280×900 and 390×844 for both
reading support and capture/reflection recovery. The support fixture now waits
for camera motion to settle before screenshot inspection. The new notice uses
14px text at 5.45:1 contrast; existing recovery controls remain 44px high,
14px, 17.03:1. APIs are synthetic and non-local assets blocked, so this is
rendered UI evidence rather than a connected real-stack or deployed result.

All SQL used disposable loopback schemas/databases; no live model or hosted
DB mutation occurred. PR #331 stays draft pending broader release checks and
worker cutover. Next: finish bounded support-review coverage/recovery for large
claim sets, audit remaining legacy personal context, and connect the complete
browser/worker release journey. Historical repair, deployment verification,
semantic quality/cost, later F–J/L1–L3 work and the full goal remain open.

## D3e3 — bounded support coverage — 2026-10-01

Baseline: a changed source with forty existing claims exhausted its ordinary
three retries before checking all claims. Partial coverage also repeated
discovery. This is unfinished work, not a provider failure.

Canon-first migration 0047 adds separately metered `assess_signal_support`
jobs. Each immutable batch names at most twelve claims and binds material,
membership and statement revisions. The coordinator waits without consuming a
retry, then discovers once after all current coverage exists. Actual faults
retain bounded retries; explicit source/reading recovery resumes failed
batches. Stale batches make no provider call, reclaimed workers cannot commit,
and partial reports cannot apply verdicts outside their named scope. Batch
reading work binds matching unfinished source receipts without certifying full
derivation or completion.

Verification: six new real-SQL cases pass, including forty claims covered in
four assessment calls, separately metered starts, one discovery pass and no
failed jobs. Full API: 1,137 passed, three paid-live benches skipped, 103
passing suites. API typecheck, migration check and diff check pass. All SQL
used explicit disposable loopback databases; providers/vectors were synthetic.
No hosted database, actual account or live provider was changed.

The owner requested delivery of the current work to dev and continuation of
the full goal. Before that delivery, deploy a worker compatibility guard so
an older worker leaves newer job types pending rather than exhausting their
attempts. Connected release-journey verification, legacy context, deployed
checks, historical repair and the remaining A–J/L1–L3 gates stay open.

## E2h — connected browser/worker loop and saved identity — 2026-10-01

The owner's dev request is being delivered through PRs #332 (worker
compatibility) and #331 (revision-bound support and bounded reviews). #332
CI passed and its development deployment succeeded at 03:12:46 UTC on
2026-10-02. Allow at least fourteen minutes for pre-compatibility worker
invocations to expire before #331's deployment. #331 CI also passed; the full
local API suite now passes 1,139 tests with three paid-live benches skipped.

The new manual `e2e:connected-learning` gate bridges a production-build
browser into the real authenticated Hono routes, queue workers and isolated
local SQL. No processing statuses or reading responses are invented by the
browser fixture. Providers and embeddings are deterministic; network model
calls are refused.

Baseline found a real saved-identity defect: the scene birthed a confirmed
capture as `kept-<requestId>`, while the archive keyboard used its persisted
inspiration ID. Its card could not reopen without reload. Reloading proved
the saved reflection data was intact. Confirmed captures now use the saved
ID in both places; the unsaved offline preview keeps its temporary identity.

After fix, the connected gate passes at 1280×900 and 390×844: one capture,
three exact saved answers, generated follow-ups, real derivation and support
checks, truthful daily hold/manual override, owned artifact completion,
explicit reading adoption, keyboard reopening without reload, and retraction
of the exact cited answer. The remaining two answers persist and the old
generated conclusion is withheld by the real read projection. Eight extraction,
four assessment and four synthesis fixture calls across both sizes; zero
provider network calls. Screenshots inspected. Full web 438/438,
web typecheck/build, strict manual-script typecheck and diff checks pass.

This closes the connected local happy-path gap, not all of E2 or release 1.
The manual cadence override uses the real API directly, so its UI path is not
claimed here. Connected failure/account-switch/cross-device paths and deployed
walks remain open. Audit also found personal synthesis feedback context checks
target ownership but not current support or consumed wording; reproduce and
fix that next without discarding the person's feedback history. Later F–J,
L1–L3, semantic evaluation and reviewed historical repair remain open.

## D3e4 — verdict wording and current feedback context — 2026-10-01

Previous turn: progress. PR #331 merged all checked work to dev at
`d06cb9c`; CI `36960364518` and deployment `36960364514` both succeeded.
The full A–J/L1–L3 objective remains unchanged.

Baseline: five regressions failed: feedback on a stale signal, a stale generated
entry or rewritten signal still reached personal synthesis; new verdicts had no
consumed wording revision; a failed reading enqueue still acknowledged feedback.
The three context cases were also reproduced directly through actual synthesis
input in isolated local SQL before building the regression suite.

Canon-first migration 0048 adds nullable `feedback.target_revision`. New writes
capture the target's statement/body revision under a short write lock. A
supplied display revision must match; busy/changed targets return a recoverable
409 without storing a verdict. Legacy nulls refer only to revision one, not
current or independently reviewed history. Word changes and change-and-return
cannot transfer old verdicts. Personal confidence, answered/dispute markers,
room reactions/affirmation counts and model context share the wording predicate.
Unsupported generated feedback targets are excluded before the context limit;
explicitly held entry words remain available without being recertified.

Verdicts, immediate pair/principle dispute changes and reading jobs now commit
together. Personal corrections use the deliberate/manual read path, not the
passive daily floor. Room-only reactions enqueue current room work, including
room-grown signals, without buying an unrelated personal synthesis. Current
membership/share rows remain locked through commit. Feedback history is retained
and exports serialize the new bigint as a decimal string. Separately held owner
decisions remain until explicitly changed; epoch matching is not an implicit
undo of a principle's under-review state.

Personal principle and reading-ground controls send the displayed revision,
reload their displayed state on stale rejection, and show the verdict receipt
only after confirmation. Older external callers can omit the optional display
revision; the server still captures its current revision. Room-control display
revision plumbing and connected concurrent-device UX remain follow-up work.

Verification: 13 new SQL cases, four additional route cases and two client
cases pass. They cover the original failures, preservation/current-limit
behavior, entry/principle revision binding, explicit stale refusal, no daily
hold, room-only work and rollback of pair resolution/principle disputes when
queuing fails. Full API: 1,156 passed, three paid-live benches skipped, 105
passing suites. Full web: 440/440, both typechecks, web build, migration/diff
checks and fresh migration 2/2 pass. One old declaration fixture now supplies
the actual revision-one database field rather than a shape the DB cannot return.
The connected production-browser/real-worker learning gate still passes at
1280×900 and 390×844. All model/vector output is deterministic; all SQL uses
explicit disposable loopback targets. No provider network, hosted migration,
historical repair or actual account mutation occurred.

This batch is reviewable local progress, not a deployed fix or goal completion.
Next: concurrent target/access guard coverage, complete room-control revisions,
then connected failure/account-switch and deployed release verification. The
remaining F–J/L1–L3 and measured semantic-quality/repair gates remain open.

## D3e5 — current room targets and pause checkpoint — 2026-10-01

The prior turn made progress: D3e4 was committed and pushed as draft PR #333;
its CI passed. The owner now requests completing this task, pausing, and merging
all remaining work to dev. #333 is the only open repository PR.

Concurrent SQL checks verify that a busy owned target returns 409 without a
verdict/job, an older displayed revision still fails after the writer commits,
and a freshly read revision succeeds. An unauthorized reader gets 404 even
while another profile's target is busy, not an existence-revealing conflict.

Room UI review found raw inspiration cards being treated as shared statements,
and identical public inspiration IDs colliding across personal/room scenes.
Room scene instances now have stable namespaced view keys, while API calls keep
the inspiration's actual ID. The room's member chooser, count, keyboard reach
and card ownership use the same member scope. Another member's public card is
readonly; one's own can reflect privately. Signal feedback is offered in Shape
together on actual room statements, not inspiration IDs. The HTTP wall serializer
now carries their wording revision, rather than dropping it between SQL and UI.

The new reply controls preserve focus, refuse duplicate in-flight submission,
acknowledge only a confirmed write, and discard late results after wording,
account or room changes. Read failure does not retract an acknowledged write.
Current members' latest current-word verdicts reach room synthesis; personal
correction text and outsider verdicts do not. Existing first-draft thresholds
remain unchanged. A related room-entry race now waits for the group roster
before declaring a deep link missing; no broad navigation redesign is claimed.

Verification: full API 1,159 passed / three paid-live benches skipped; web
447/447 across 65 suites. Typechecks, production build, vocabulary/seam/design
ratchets, migration/diff checks pass. The connected real-auth/Hono/SQL/worker
journey passes at 1280×900 and 390×844, now including member-ground selection,
readonly peer captures, actual statement/revision POST and a persisted reply.
New controls measure at least 44px high with 14px text; screenshots inspected.
Providers/vectors are deterministic; explicit disposable loopback SQL only.
No live provider calls, historical repair, production deployment or actual
account mutation were performed during implementation.

Current task implementation is complete. Pause the app goal before the
separately authorized delivery to dev. Remaining work is not erased: connected
failure/account-switch/cross-device coverage, deployed task walks, broader
navigation/search/attachments/performance, evaluated generation, the room
participation/next-round contract, launch requirements and reviewed historical
repair still require work after an explicit resume. Do not mark this goal complete.

## F0 — focused navigation/recall authorization — 2026-10-01

The owner approved the next focused batch: navigation and visible search.
This is a direct task, not a request to restart every remaining delivery slice.
The wider backlog remains paused. Work begins from clean dev `9c61084` on
`codex/navigation-recall`; PR #333 and its development deployment are complete.

Route contract before implementation:

- Stable wall IDs determine identity; readable labels are optional. Existing
  name-only wall links still resolve. Renaming does not invalidate new links.
- Meaningful wall, section, inspiration, reflection and parked-date navigation
  enters browser history. Back/Forward applies the latest requested snapshot
  without remounting the world or restoring a stale request over newer intent.
- URLs contain identifiers and view metadata, never copied inspiration words,
  answers or search phrases. Search phrases may remain in account/profile-bound
  history state but are not included in copied links.
- Detail restoration is read-only and honors existing profile/membership/public
  boundaries. An unavailable link is not silently shown as a different memory.
- A visible Find inspiration surface searches the owned archive, distinguishes
  loading/no-match/failure, supports pagination and opens the existing card even
  for a record outside the initially loaded field. Room search clearly refers
  to the viewer's own archive, not another member's private stack.

Gate: on small and capped archives, open an older result and its reflection,
copy/reload its link, visit another room, use Back/Forward and restore the view;
repeat after rename and with failed search/unavailable detail. Include stale
response/account changes and mobile keyboard/dialog checks. No attachment,
ranking, model-threshold or broader performance redesign belongs in this batch.

### F1 — focused implementation and local gate — 2026-10-02

The batch adds router-backed stable-ID wall links, section/date/member and
inspiration/reflection metadata, and restores POP navigation in the existing
world. A readable label or URL normalization replaces the current entry;
travelling to another place pushes it. Closing an overlay in the same place
does not create a Back-button trap. Restoration aborts superseded detail reads.

Find is visible on desktop and mobile. Its paginated results show a preview,
date and reflected cue and can open records outside the field's 2,000-item
window. Room Find explicitly reads **your** archive. Search phrases remain
in profile-bound history state, not copied URLs. Failed reads have retry paths,
not false no-match results. Inspiration and individual saved-answer links
reopen the existing card and reveal the referenced earlier answer without
requesting a new question or saving anything.

The new single-record group GET uses the same public/current-human-author
predicate as the field, plus current reader membership in the same SQL query.
Its explicit projection never contains answers, attachments or signal evidence.
The source-level gate now counts the private `signalEvidence.inspirationId`
column specifically, rather than banning an identically named lookup input;
the evidence-column join and projection bans remain. Four real-SQL route cases
cover the field ceiling, private/outsider/departed sources and readers, stale
agent membership, malformed IDs and the public-only DTO.

Verification: web **467/467** across 68 suites; API unit **683 passed / 3
paid-live benches skipped**; targeted disposable-Postgres routes **4/4**.
API/web typechecks and production web build pass. The real-auth/Hono/SQL
loopback preview contains 2,002 owned records: the browser found and opened
the excluded oldest record, restored its reflection with Back/Forward, copied
and reloaded a specific earlier answer, and opened a peer's public room card.
At 390×844, results paginated from 50 to 100 in the scrollable dialog; Escape
returned focus to Find. New controls measured at least 44px high / 14px text.
The real room menu also took the viewer from their ground to the room and
browser Back restored their ground, rather than restarting headquarters.
Desktop and mobile screenshots were inspected. Provider networking was disabled;
no actual dev/production account data or deployment was changed.

This is the navigation/search batch, not completion of the wider goal. Deployed
verification after review and merge remains a release gate. Agent-specific
curation write clients, broader account-switch/cross-device journeys, attachments,
startup pagination/performance, evaluated generation, and the room next-round
contract remain separate work. The older edge-travel affordance still refuses
field travel despite remaining accessible; the room menu works there. Record
that interaction mismatch for the next usability/bug batch rather than changing
the canvas travel law here. Keep the broader backlog paused.
