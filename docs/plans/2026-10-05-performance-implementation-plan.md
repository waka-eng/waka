# WAKA performance implementation plan

Status: implementation in progress, updated 2026-10-05. Milestones 1 to 4
passed locally. Milestone 5 local acceptance passed; PR delivery and deployed
verification remain open. Work is tracked in
[the performance goal](../goals/performance-improvements.md).

Make WAKA feel ready sooner and stop unnecessary work after it opens. Start
with Home and Review loading and navigation, then search, then memory readers.
Keep the current visual identity and the one-inspiration Review flow. Finish
and verify one milestone before starting the next. All five milestones have
already been requested; a failed gate requires reassessment, not a lower bar.

This plan covers local implementation and verification. It does not
independently authorize database repair, model requests, push, merge or
deployment. The original local Review work is preserved in a separate
checkpoint from performance changes.

## Current status and remaining priorities

| Milestone | Priority | Current status | What remains |
| --- | --- | --- | --- |
| 1 Reduce Home request volume | Completed | Local gate passed; committed, not pushed | Recheck its budgets after later changes. |
| 2 Make Home and Review ready sooner | Completed | Local gate passed; delivery pending | Recheck its budgets after later changes. |
| 3 Make search scale | Completed | Local gate passed; migration/backfill delivery pending | Apply migration before API delivery to an independently verified dev target; recheck budgets later. |
| 4 Speed up personal memory readers | Completed | Local gate passed with pool five and one | Recheck full regression and deployed behavior during authorized delivery. |
| 5 Validate delivery and optimize startup if needed | P1 | Local acceptance passed; full milestone open | Authorized PR delivery, dev rollout and deployed verification remain. |

One milestone remains, split into three bounded work batches below. Startup
bundle and font changes are conditional, not a prerequisite for delivery.

Milestone 1 reduced the first sixty seconds of Home API traffic from 1,555 to
32 requests on the 2,000-inspiration fixture with 150 ms added API delay.
Unsolicited original reads fell to zero. Initial readiness still took about
two seconds, so removing request waste did not by itself finish the user-facing
loading problem. The committed
[milestone 1 receipt](../craft/evidence/performance/milestone-1.json) records
the comparison and its limits.

Milestone 2 enables Home and Capture before the full field is ready,
keeps Review mounted while its new URL becomes a confirmed session URL, and
optionally returns the current original with its Review response. Twenty
interleaved local runs per build recorded Home median 1,910.6 to 400 ms and
sample p95 1,994.6 to 432 ms. Fresh Review median fell from 842 to 359.7 ms;
its opening uses two core requests plus Home's metadata read. Warm Chat return
median was 215.05 ms, with a maximum 271 ms across twenty runs and no new
archive walk. The [milestone 2 receipt](../craft/evidence/performance/milestone-2.json)
retains the local measurements and limitations; these are not deployed or
physical-device guarantees.

Milestone 3 passes across twenty query classes at 10,000 originals: interleaved
local HTTP p95 is 23.18–46.03 ms versus 416.9–530.21 ms. Complete cursor walks
preserve membership/order/totals. A nullable, policy-tagged raw-text projection
is needed for dense multiword queries; it uses current-text fallback until
backfilled. Migration 0067 and its explicit bounded backfill are local-tested,
not applied to dev. The [milestone 3 receipt](../craft/evidence/performance/milestone-3.json)
records all values and the rejected query-only experiment.

Milestone 4 passes with interleaved Chat context median 54.76 ms/p95 75.43 ms
at pool five and 51.59/68.3 ms at pool one. Artifact reads use ten/four SQL
statements versus fourteen/nine. All forty cached retrieval queries retain the
existing quality gate with no new provider spending. Principles trades slightly
more local CPU for five fewer round trips; no cloud speedup is claimed. The
[milestone 4 receipt](../craft/evidence/performance/milestone-4.json) records
these results, rejected approaches and content-free timing instrumentation.

### Immediate next implementation batch

Batch A is locally accepted. The next action is delivery under separately
confirmed authority, not additional speculative optimization. Nothing in this
document independently authorizes push, merge, deploy, dev backfill or model calls.

| Batch | Deliverable | Completion condition |
| --- | --- | --- |
| A Finish local acceptance | Complete locally; see milestone 5 receipt | Existing budgets and correctness pass; failed experiments, final source hashes and limits are retained. |
| B Prepare and deliver dev safely | Reviewed milestone changes, migration 0067 and bounded search backfill | Separate delivery authority is confirmed; actual dev target is verified; migration verification succeeds before new API deployment. |
| C Verify deployed experience | Signed-in cold/warm performance and workflow checks | Confirm deployed revision and schema, measure real latency and stage delays, and fix reproducible regressions before calling the rollout complete. |

The verified implementation contains desktop-readable inputs, schema-verification
updates, a cheap CI contract guard and synthetic fault/worker test controls.
The full milestone is not delivered. Follow the prepared
[dev delivery checklist and PR descriptions](2026-10-05-performance-dev-delivery.md)
for the exact next steps.

### Bug fixes required throughout

Performance work is not complete if it breaks a normal workflow. Treat these
as blocking checks within the milestone that touches them, not a separate
open-ended bug backlog:

- Preserve Capture text/media and reflection drafts through errors and Back.
- Distinguish loading, genuinely empty, caught-up and failed states. Do not
  display invented content, a premature failure or an indefinitely disabled
  action while useful work is available.
- Keep repeated clicks, interrupted saves and concurrent tabs idempotent;
  advance Review only after a confirmed action.
- Withdraw deleted/edited or inaccessible source context. Preserve account
  and profile boundaries, current citations and human wording locks.
- Test the changed flows with long Korean text, keyboard navigation and narrow
  screens. Fix clipping, inaccessible controls and layout jumps in scope.

Each confirmed bug should get a reproducible case and a regression test before
its fix is counted as complete.

## Measured baseline

The test used a production web build, fresh API imports and disposable local
Postgres accounts with 25, 250, 2,000 and 10,000 inspirations. HTTP and SQL
timings are local, not deployed end-to-end latency. Browser passes added either
zero or 150 ms of API response delay. API endpoint medians use 15 samples;
context/selection medians use 10. Browser ready times are individual passes,
not percentiles. Physical-mobile CPU, steady-state animation beyond the first
eight seconds, live model latency and worker contention were not measured.

| Finding | Measured result | Implication |
| --- | --- | --- |
| Home detail warming | 2,000 full inspiration requests, plus 64 signal-detail and 24 room requests | Most opening work is not needed for the first screen. |
| Background detail sweep | 81.2 seconds with 150 ms added API delay; about 3.85 MB of cumulative API responses during the recorded Home window | A ready-looking screen can continue substantial network and database work. The 81 seconds is not the initial loading time. |
| Home ready time | 0.43 seconds at 25 inspirations and 1.91 seconds at 2,000 with added delay | Waiting for ten serial archive pages makes readiness depend on archive size. |
| Returning from Chat | Another ten-page archive walk; 1,880 repeat detail requests were already recorded before the test was stopped | Home component caches are lost across this navigation. |
| Search median | 3.83 ms at 25 inspirations, 88.27 ms at 2,000, 410.45 ms at 10,000 | Per-request matching and the separate count both scan substantial data. |
| Search experiment | Result-page plus count SQL fell from 404.74 ms to 45.53 ms when the cheaper literal predicate ran first | A small optimization is promising for the tested English query. A simple UNION rewrite did not improve that case. Neither establishes broad search performance. |
| Review opening | Nine requests in the loading window and an approximately 854 ms request chain under added delay | Repeated session/count reads and route remounts add avoidable waiting. |
| Chat context median | 8.66 ms at 25 inspirations, 49.73 ms at 2,000, 133.92 ms at 10,000, before AI work | Lexical matching and ranking need optimization without reducing recall. |
| Artifact readers | Top of Mind used 14 SQL statements; Principles used nine, including surrounding auth/transaction work | Cheap local statements can still accumulate database-network latency. |

Local detailed evidence is in `work/chat-home-memory/performance-summary.json`,
`performance-api.json`, `performance-browser.json`, `performance-sql.json`
and `performance-search-comparison.json`. Those generated files are ignored by
Git. The table above preserves the compact baseline in this plan. Milestone 1
made the benchmark reproducible and retained a sanitized comparison receipt.

## Milestone order

| Milestone | Deliverable | Schema expectation |
| --- | --- | --- |
| 1 Reduce Home request volume | Remove archive-wide warming and preserve safe navigation snapshots | No migration expected |
| 2 Make Home and Review ready sooner | First-page readiness and consolidated single-inspiration Review loading | Reuse existing revision columns; no migration expected |
| 3 Make search scale | Equivalent faster matching/counting with English and Korean coverage | Index/projection migration only if the measured gate requires it |
| 4 Speed up personal memory readers | Faster Chat context and fewer artifact-reader round trips | Index changes only when query plans justify them |
| 5 Validate delivery and optimize startup if needed | Dev verification, mobile follow-up and selective bundle/font work | No migration expected |

The budgets below are the acceptance targets. Each milestone's status and
receipt distinguish measured results from remaining verification.

## Milestone 1 Reduce Home request volume

Status: passed locally at `c6fee2e`; see the goal log and committed receipt.

### Implementation tasks

- [x] Promote the disposable performance probe into a supported manual command
  under `tools/`. Require an explicit disposable loopback database, disable
  provider calls by default, and register cleanup before seeding. Record build,
  fixture shape, pool configuration, request counts, bytes and timings without
  credentials, prompts or account content. Repeat cold/warm navigation and
  count both issued and completed requests.
- [x] Ensure benchmark API processes use current code. Add reliable local API
  watch/restart behavior with graceful shutdown, or require a fresh isolated
  process for each run. The baseline local script watched only the web build;
  it now watches API code too. Do not mistake an older running server for a
  current-code result.
- [x] Remove the all-inspiration detail sweep in `Home.tsx`. Fetch full text,
  reflections and media when an inspiration is opened. Default to no
  unsolicited inspiration detail warming; allow at most four explicit
  near-term prefetches if measurement later justifies them.
- [x] Prioritize evidence for the visible Top of Mind entry. Stop loading every
  signal's full evidence sequentially before publishing that entry's roots.
  Keep lightweight signal metadata if the scene needs it; fetch further
  evidence on demand. Do not request more than the visible entry actually cites.
- [x] Load only room roster metadata on Home. Fetch wall/proposal contents on
  room approach or entry, not for every room at boot. This is a fetching change,
  not an expansion of room features or sharing permissions.
- [x] Move bounded summary snapshots and request deduplication outside the Home
  component so Chat navigation does not discard them. Key by account, target
  profile, wall and request scope. Clear on logout/account changes and revoke
  inaccessible wall/grant state. Start with memory-only storage, one active
  profile snapshot and the existing 2,000-summary ceiling.
- [x] Define invalidation for capture, edit, removal, reflection, transcript
  correction, visibility changes and new server revisions. Cached raw text is
  not current evidence: reopening it requires an owned revision check. Reuse
  the existing material revision in DTOs if needed, not timestamp-only checks
  or a new parallel revision concept. Never feed client caches into generation.
- [x] Validate warm archive snapshots against server-owned source identities,
  material revisions and current membership before reuse. Audit revision
  coverage first: the existing generation fence is not a whole-archive change
  counter, so an unchanged Top of Mind/generation revision cannot certify an
  uncited inspiration. Use a bounded metadata/delta read over existing tables
  to catch remote edits, deletions and new captures without reloading all full
  records. Until validation succeeds, cached geometry/chrome is only a loading
  aid, not proof that a preview or citation is current.
- [x] Share in-flight GETs safely: one consumer closing must not cancel another
  consumer's request. Do not deduplicate or automatically replay mutations.
  Evict forbidden/missing resources rather than retaining a negative result
  indefinitely. Fence late responses after identity or view changes.

### Acceptance gate

For the 2,000-inspiration, 64-signal, 12-room fixture, opening Home must cause
no archive-wide detail sweep, no unrelated room-content reads and no more than
four unsolicited inspiration detail requests. Track all initial and background
calls, including polling, for 60 seconds; target at most 40 total API requests.
Reading one inspiration and opening Why this reading must still work.

Home to Chat to Home must not restart the complete archive walk or detail sweep.
Small freshness checks are allowed. Capture/removal/reflection changes must
appear correctly on return, and account/profile changes must expose no previous
identity's content. Stop and correct the cache contract if those checks fail.

Primary files: `packages/web/src/pages/Home.tsx`, `packages/web/src/lib/data.ts`,
`packages/web/src/lib/api/`, `scripts/dev-local.sh` and focused web tests.

## Milestone 2 Make Home and Review ready sooner

Status: passed locally; see the goal log and milestone 2 receipt. The field
loads separately because a partial field would change the current layout.

### Implementation tasks

- [x] Separate first-page readiness from completion of the archive walk.
  Hydrate the initial 200 summaries, use the server's real total and load older
  pages only when needed or in a bounded background continuation. Cancel that
  continuation on identity changes or when it has no active consumer.
- [x] Preserve positions, camera, timeline and open controls while more data
  arrives. Do not resort the visible field or replay the arrival animation.
  Prototype stable layout before wiring progressive updates. If that cannot
  be preserved, keep the field loading separately and enable Capture after
  authentication/draft hydration instead of forcing a visually unstable load.
- [x] Restore the user's prior section, date, scroll and selected state after
  Chat navigation. Validate current data without making a return look like an
  entirely new visit or letting stale context become authoritative.
- [x] Keep Review mounted through its new-session-to-confirmed-ID transition.
  Reuse the committed response instead of refetching the same session because
  the URL key changed. Real navigation to another session must still reset it.
- [x] Add opt-in current-inspiration data to the existing Review read/start
  response, loaded with its matching owner/material revision in one database
  snapshot. Keep Home's resume read metadata-only. Preserve the durable start
  identity, one-open-session constraint and explicit lost-response recovery.
- [x] Remove the always-on Review count request when a source is already
  present. Return enough truthful empty/caught-up information when no source
  is eligible. Refresh Home's resume label on return or a confirmed change,
  not on every internal Review URL transition.
- [x] Preserve single-inspiration reflection, current-original validation,
  deletion confirmation/revision fencing, drafts and historical review links.
  Cancel superseded reads and handle timeout/error states without indefinite
  loading or advancing the cursor before a confirmed action.

### Acceptance gate

At 2,000 inspirations and 150 ms added API delay, target median Home/Capture
readiness at or below 800 ms and p95 at or below 1.2 seconds. Opening Capture
must not depend on loading the entire archive. A warm Chat return should have
usable chrome within 400 ms without trusting unvalidated evidence.

Review opening from an already-ready Home should require at most three core
Review requests, with no duplicate session/count fetches; target median time to
readable original and enabled actions at or below 500 ms under the same delay.
Measure cold deep links separately. Back, refresh, concurrent tabs, edits,
removed originals, interrupted saves and resumed drafts must remain correct.

Primary files: `packages/web/src/lib/data.ts`, `use-view-navigation.ts`,
`use-review-session.ts`, `use-review-entry.ts`, `components/ReviewPanel.tsx`,
`packages/api/src/lib/review-sessions.ts` and its routes/serialization.

## Milestone 3 Make search scale

Status: passed locally. Migration 0067 and bounded operator backfill are needed
before delivery; dev/production have not been mutated. Query-only matching
missed dense English multiword at 212.787 ms, so a stored projection was needed
to meet the original complete query-set gate. No additional index was added.

### Implementation tasks

- [x] Reproduce result and count plans with matching, rare and no-result
  queries. Include English/Korean, multiword input, literal `%`, `_` and `!`,
  reflection-only matches, link/image text and corrected audio transcripts.
  Include several accounts so another account's data volume is represented.
- [x] Apply and test the cheaper-predicate-first optimization without changing
  membership, result order, cursor handling or exact totals. Compare full
  returned IDs/totals, not just elapsed time. The one English experiment is
  evidence for trying it, not proof that all queries get nine times faster.
- [x] Avoid evaluating expensive matching twice just to return an exact count.
  Measure a shared matched set or equivalent query arrangement; handle empty
  pages correctly. Do not silently remove totals or mislabel partial results.
- [x] Explicitly constrain child matching to the requested profile before
  scanning reflections/media. The serving permission checks and composite
  ownership boundaries remain mandatory.
- [x] Inspect use of the existing full-text GIN index before adding another
  index. Do not assume a UNION rewrite is faster; it was not in the tested case.
- [x] If rare/no-result or Korean cases still miss the budget, propose a
  versioned, tenant-scoped search projection or justified indexes. Document the
  schema concept first. Preserve audio-correction precedence and current
  enrichment rules; synchronize invalidation on every source/child change and
  deletion. Backfill in bounded, resumable batches on dev only after verifying
  the actual target. Reads must not silently create repair/model work, and
  missing/stale index coverage must not silently omit valid originals.

### Acceptance gate

Target local search p95 below 100 ms at 10,000 inspirations on the representative
query set, with equivalent results, ordering and exact totals. Report misses by
query class and retain failed experiments. Do not declare completion from the
easy English matching case if no-result or Korean search remains slow.

If an index/projection is needed, require fresh-migration, source edit/removal,
reflection/media change, interrupted-backfill and cross-profile tests. No
migration is justified solely by an assumption that an index is absent.

Primary files: `packages/api/src/routes/inspirations-recall.ts`, attachment
material helpers, `packages/web/src/components/InspirationSearch.tsx` and
relevant query/schema tests.

## Milestone 4 Speed up personal memory readers

Status: passed locally with both pool settings. Literal substring recall and
the existing quality gate are preserved; search's whole-word semantics were
not substituted. Signed-in dev job/provider observation remains delivery work.

### Implementation tasks

- [x] Optimize lexical Chat candidate lookup before model dispatch. Avoid
  repeated child scans/scoring across the whole archive where indexed matching
  or shared work can preserve the same candidates. Select candidates before
  assembling bounded excerpts. Reuse milestone 3's search work only where its
  retrieval semantics match Chat's current contract.
- [x] Compare old/new context output on the existing bilingual retrieval
  corpus, including older relevant material, short follow-ups, unrelated
  questions, reflections, enriched media, transcript corrections, contested
  Principles and deleted/edited originals. Preserve source IDs, ordering,
  revisions, hashes, excerpt limits, abstention and citation reopening behavior.
- [x] Batch independent Top of Mind/Principle projection reads and reuse
  current support calculations within a request. Reduce statements and serial
  round trips without skipping auth, tenant, statement, body or material checks.
  Do not add a long-lived cache of supposedly current machine conclusions.
- [x] Measure both local pool settings, including pool one as a model of the
  Lambda connection budget. Do not increase global connection concurrency as a
  substitute for removing redundant work.
- [ ] Independently verify the deployed API/worker connection configuration
  during authorized dev verification. A pool-one local run is not proof of
  actual Lambda configuration or latency.
- [x] Record content-free stage timings for queue wait, material/context reads,
  embeddings, model execution and publication validation. Observe existing dev
  jobs before attributing delay to a model. Avoid prompt/source/credential logs.
  Any new live evaluation is manual, synthetic and bounded by the remaining
  owner-approved spending cap; these local performance tests used no model calls.

### Acceptance gate

At 10,000 inspirations, target local Chat context median below 60 ms and p95
below 100 ms without worse retrieval or changed evidence. Target Top of Mind
at most ten SQL statements versus fourteen and Principles at most six versus
nine under the same counting method. Retain the original measurements if an
optimization cannot safely meet these budgets.

Stop if faster reads require stale citations, narrower unvalidated recall or
weaker tenant checks. This milestone does not change generation thresholds,
the daily Top of Mind floor, human wording locks, model choice or prompts.
Ranking/context changes need the established quality gate, not timing alone.

Primary files: `packages/api/src/lib/conversation-material.ts`,
`conversation-context.ts`, `personal-output.ts`, `signal-support-state.ts`,
`routes/top-of-mind.ts`, `routes/principles.ts` and associated SQL tests.

## Milestone 5 Validate delivery and optimize startup if needed

Status: local acceptance passed; delivery and deployed verification pending.
Bundle/font work is deferred without a demonstrated benefit. The
[milestone 5 receipt](../craft/evidence/performance/milestone-5.json) distinguishes
final measurements, earlier exploration and remaining scope.

### Current local evidence

The final token-based build has twenty local desktop runs with Home median
385.05 ms and Review median 377.75 ms; twenty narrow-viewport runs recorded
386.7 and 380.4 ms. Final warm return maxima are 198.7/201.1 ms for desktop/narrow.
The viewport is a desktop
browser at a mobile width, not a physical phone. The final thirty-sample API
run is retained separately in `work/performance/m5-final/api.json`.

A sixty-second Home window recorded 31 issued/completed requests, one original
detail read associated with a prior synthetic capture and zero room-content
reads. A controlled model-free worker completed one real queue claim with 509
material/context/validation iterations; twenty browser samples were taken
while that worker was active. These contention tests do not measure provider
latency or a production generation workload. Keep the earlier failed worker
claim setup in the evidence rather than counting it as a successful load test.

Schema-verifier updates require migration 0067, and a fresh-database test calls
that same verifier. The verified CI guard preserves manual browser/model
checks. Capture and reflection input rules now enforce at least 16 px on
desktop as well as narrow screens, including the more-specific Capture rule
that originally overrode the minimum. The shared input-size token preserves
the design-system ceiling. Final checks pass: 737 web and 1,518 full API tests,
all application/runner types, production build and migration checks. Three
paid evaluations remain skipped. The first literal-size failure and a 423 ms
warm-return sample under simultaneous full-API-test load are retained in the
receipt; the later uncontended repeat is reported separately.

### Batch A Finish local acceptance

Completed without remote data changes:

- [x] A1 Finalize the test harness. Document one-off archive-read, Review-read
  and lost-Capture-response controls, worker start/stop/status and cleanup.
  Verify deterministic synthetic queue selection after earlier Capture/Review
  tests have queued jobs. Prove failure cleanup stops its worker/server and
  removes only its own disposable schema. Provider networking stays disabled.
- [x] A2 Finalize the readable-input fix. Verify the winning computed styles
  in Capture, reflection and Chat at desktop and narrow widths, with long
  Korean text and keyboard focus. Input text must be at least 16 px and
  primary interaction targets at least 44 px. Preserve surrounding typography,
  layout and the current visual feel.
- [x] A3 Finalize rollout regression checks. Verify 0067 columns, migration
  receipt and synchronous text-write trigger before API deployment. Prove
  search metadata backfill does not bump material/generation revisions or
  schedule regeneration. Keep cheap loader/cache/request/schema guards in
  normal CI; browser/load/provider evaluations remain manual.
- [x] A4 Close workflow bug cases. Retain drafts on later archive failure,
  failed Review opening and Back/reopen. Confirm retry does not duplicate
  Review sessions or skip an original. A lost Capture response may replay its
  durable idempotent request, but must create exactly one inspiration; record
  both the committed response and replay rather than claiming no mutation
  retry occurs. Preserve deletion, account/profile and stale-citation fences.
- [x] A5 Consolidate final verification. Record the exact code/build revision,
  fixture size, pool, sample count and worker overlap. Use at least twenty
  browser and thirty API samples for sample p95 gates. Separate unchanged
  2,000-source fixtures from the post-Capture 2,001-source fixture with a
  2,000-summary ceiling. Check existing test/type/build results against the
  final candidate and run only checks missing after the last change.
- [x] A6 Commit a sanitized milestone 5 receipt and local implementation.
  Include before/after budgets, reproduced bugs, failed experiments, recovery
  checks and measurement limits. Review the diff for unrelated edits and
  content/credential leakage. Update the goal/index with the actual gate
  result, not the intended result.

Batch A gate: Home median at most 800 ms and sample p95 at most 1.2 s under
150 ms added API delay; Review median at most 500 ms with at most three core
requests; warm Home return within 400 ms; at most forty Home API requests in
sixty seconds, no unrelated room reads and no broad detail sweep. Search p95
must remain below 100 ms at 10,000 sources, Chat context median below 60 ms and
p95 below 100 ms, and Top of Mind/Principles readers at most ten/six statements.
Existing correctness, migration and isolation checks must still pass.

### Batch B Prepare and deliver dev safely

These are delivery tasks, not new product features. Start only with the
corresponding push, merge/deploy and database authority:

- [ ] B1 Prepare milestone PR descriptions and separate the earlier
  single-inspiration Review checkpoint. Keep the existing dependency order
  and include each milestone's measurements, correctness and recovery notes.
  Confirm the current remote base before choosing separate or stacked PRs.
  Do not include unrelated local work or silently merge a dependent PR early.
- [ ] B2 Verify the actual development database and API/worker bindings.
  Compare configured targets without exposing credentials. Do not infer
  isolation from `.env.local`, a branch name or a stage label. Production
  schema, source data and deployment are excluded.
- [ ] B3 Rehearse and execute migration 0067 before the new API reads its
  columns. Run the read-only schema verifier and fresh-migration checks.
  Nullable coverage must continue to use current-text fallback during rollout;
  the API must not silently repair data or call a model on a read.
- [ ] B4 Run an explicitly authorized, bounded search backfill against the
  verified dev target. Dry-run first; use resumable small batches and record
  remaining rows, lock contention and revision/job invariants. Stop and
  investigate if the target is ambiguous or source revisions change.
- [ ] B5 Verify deployed API and web revisions match the intended changes.
  Keep a documented revert path: additive search columns can remain, and
  reverting a client/API optimization must not delete memory or human wording.

Batch B gate: the reviewed revision is deployed to the verified dev target;
0067 verification passes, historical coverage is reported honestly, and no
production data or deployment is touched. PR approval alone is not deployment
proof. Push/open PRs and merge/deploy remain separate actions.

### Batch C Verify deployed experience

- [ ] C1 Measure authorized signed-in dev cold/warm Home, Capture, single-item
  Review, Chat and Back after confirming the deployed revision. Record actual
  request counts and timings, not only an inventory of unique resource URLs.
  Compare with local results without promising localhost latency in the cloud.
- [ ] C2 Observe existing content-free timing events for queue wait,
  material/context reads, embeddings, provider execution and publication
  validation. Verify actual connection settings before proposing pool changes.
  Do not attribute a pending UI to the model without stage measurements.
- [ ] C3 Fix reproducible deployed bugs exposed by the rollout, each with a
  regression case. Prioritize duplicate saves, lost drafts, stale/deleted
  evidence, wrong-user context and permanently stuck loading before cosmetic
  changes. Re-run the affected budget after each fix.
- [ ] C4 Record unavailable checks explicitly. Current local cloud-config
  inspection returned `AccessDeniedException`; that is an access limitation,
  not proof of a deployment failure. Real iPhone/Android microphone, keyboard
  and CPU behavior remain a follow-up under the owner's prior device deferral.

Batch C gate: report measured deployed behavior and any unresolved failures.
Do not claim cloud/provider or physical-device performance from viewport tests.
If required diagnostics remain inaccessible, report the precise access needed
and retain that acceptance item as open.

### Conditional follow-up

Only propose extra optimization after final profiling identifies a remaining
bottleneck. Candidate startup evidence has two long tasks totaling 166 ms in
the first eight seconds, with the longest 107 ms, while readiness already meets
the local budget. That alone does not justify a large bundle/font rewrite.
Split noncritical code or reduce font loading only after a matched comparison
shows a user-visible gain without changing typography or losing interactions.
Cache or connection-pool changes likewise need deployed evidence and the same
freshness/isolation gates.

### Acceptance gate

All previously passed budgets and correctness cases must still pass. Ship
optional startup changes only with a measurable user-visible or byte/long-task
improvement; otherwise record that they were deferred. Preserve review drafts,
capture media, citations, human locks and account/profile isolation throughout.

## Execution and reporting

The original single-inspiration Review work was checkpointed at `33614ed`;
milestone 1 and its supported benchmark were committed at `c6fee2e`.
Milestone 2 passed its local gate and is checkpointed separately. Record the
exact revision before comparisons or delivery; no private account data belongs
in fixtures.

For each milestone, use warmed, repeated, interleaved before/after samples on
the same fixture and build mode. Record sample counts, median/p95, request
volume, bytes, SQL plans/counts and the test environment. Repeat browser runs
at least five times per cold/warm scenario for exploratory comparisons; report
the observed median and worst run at that sample size. Use at least twenty
matched browser runs and thirty API samples for a release p95 budget, without
presenting a sample percentile as a guaranteed population limit.
Check no-worker and controlled-worker contention separately. Do not compare
one cold run with a warmed candidate or extrapolate localhost timings to dev.

Run targeted web/API checks during implementation and full existing suites
before handoff. Migrations, if introduced, also need `pnpm db:check` and fresh
disposable-database validation. Each handoff should state what improved, what
failed, what remains and whether anything was pushed or deployed. Record the
gate verdict before moving on; stop and reassess a failed or marginal gate.
Do not silently expand the approved scope.

Recommended next step: authorize delivery under batch B. Milestones 1, 2 and 4
needed no migration; milestone 3 requires
the additive migration 0067 and verified, explicit bounded backfill before
claiming deployed search performance.
Production deployment, native/store packaging, a visual redesign and changes
to generation thresholds or model prompts are outside this performance plan.
