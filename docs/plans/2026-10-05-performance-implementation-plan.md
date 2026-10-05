# WAKA performance implementation plan

Status: implementation in progress, updated 2026-10-05. Milestones 1 and 2
passed locally. Milestones 3 to 5 have not started. Work is tracked in
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
| 3 Make search scale | P1 | Not started | Optimize matching and exact counts, then prove equivalent bilingual results at 10,000 inspirations. |
| 4 Speed up personal memory readers | P1 | Not started | Optimize Chat retrieval and artifact reads without weakening current evidence checks. |
| 5 Validate delivery and optimize startup if needed | P2 | Not started | Run final regression and breakpoint checks, add cheap CI guards and prepare delivery evidence. |

Three milestones remain. Startup bundle and font changes are conditional,
not a prerequisite for the higher-impact database work.

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

### Immediate next implementation batch

Implement milestone 3 before changing Chat retrieval:

1. Capture fresh query plans and thirty-sample timings at 10,000 inspirations
   for common, rare and no-result English/Korean queries. Include child-only
   matches, transcript corrections, multiword queries and literal wildcards.
2. Move cheap matching ahead of expensive matching where equivalent, and
   avoid performing the full match again for an exact total. Use explicitly
   scoped child candidates and the existing full-text index where it helps.
3. Compare complete IDs, ordering, cursors and totals against the baseline,
   including another account's volume and empty result pages.
4. Add an index or versioned projection only if measurements justify it.
   Preserve current material, correction precedence, invalidation and safe
   resumable backfill; do not silently omit originals with missing coverage.
5. Meet the bilingual search p95 budget, preserve failed experiments, run
   ownership/material tests and retain a separate milestone commit and receipt.

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

The budgets below are proposed acceptance targets, not results already achieved.
Rebaseline with repeated samples before judging an implementation.

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

Status: not started. Begin only after milestone 2 passes.

### Implementation tasks

- [ ] Reproduce result and count plans with matching, rare and no-result
  queries. Include English/Korean, multiword input, literal `%`, `_` and `!`,
  reflection-only matches, link/image text and corrected audio transcripts.
  Include several accounts so another account's data volume is represented.
- [ ] Apply and test the cheaper-predicate-first optimization without changing
  membership, result order, cursor handling or exact totals. Compare full
  returned IDs/totals, not just elapsed time. The one English experiment is
  evidence for trying it, not proof that all queries get nine times faster.
- [ ] Avoid evaluating expensive matching twice just to return an exact count.
  Measure a shared matched set or equivalent query arrangement; handle empty
  pages correctly. Do not silently remove totals or mislabel partial results.
- [ ] Explicitly constrain child matching to the requested profile before
  scanning reflections/media. The serving permission checks and composite
  ownership boundaries remain mandatory.
- [ ] Inspect use of the existing full-text GIN index before adding another
  index. Do not assume a UNION rewrite is faster; it was not in the tested case.
- [ ] If rare/no-result or Korean cases still miss the budget, propose a
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

Status: not started. Use milestone 3 work only where retrieval semantics match.

### Implementation tasks

- [ ] Optimize lexical Chat candidate lookup before model dispatch. Avoid
  repeated child scans/scoring across the whole archive where indexed matching
  or shared work can preserve the same candidates. Select candidates before
  assembling bounded excerpts. Reuse milestone 3's search work only where its
  retrieval semantics match Chat's current contract.
- [ ] Compare old/new context output on the existing bilingual retrieval
  corpus, including older relevant material, short follow-ups, unrelated
  questions, reflections, enriched media, transcript corrections, contested
  Principles and deleted/edited originals. Preserve source IDs, ordering,
  revisions, hashes, excerpt limits, abstention and citation reopening behavior.
- [ ] Batch independent Top of Mind/Principle projection reads and reuse
  current support calculations within a request. Reduce statements and serial
  round trips without skipping auth, tenant, statement, body or material checks.
  Do not add a long-lived cache of supposedly current machine conclusions.
- [ ] Measure both local pool settings and the deployed single-connection
  Lambda configuration. Do not increase global connection concurrency as a
  substitute for removing redundant work.
- [ ] Record content-free stage timings for queue wait, material/context reads,
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

Status: not started. Bundle/font work is conditional on an observed bottleneck.

### Implementation tasks

- [ ] After milestones 1 to 4, repeat the complete benchmark and investigate
  remaining startup long tasks. Split noncritical settings/share/reflection
  modules and defer unnecessary font families/weights only when profiling
  shows a meaningful gain. Retain the existing typography and atmosphere;
  avoid a renderer/framework rewrite or cosmetic redesign.
- [ ] Verify cold and warm Home, Capture, Review, Chat and return navigation at
  desktop and mobile breakpoints, with slow/failing requests and long Korean
  text. Measure layout shifts and interaction timing, not only bundle bytes.
  Keep input text at least 16 px and touch targets at least 44 px.
- [ ] Add inexpensive request-count, cache-isolation, cancellation and loader
  regression tests to existing CI. Keep browser performance runs, load tests
  and paid quality evaluations manual. Do not restore CI Browser gates or add
  recurring performance jobs without a separate request.
- [ ] Prepare one small PR per approved milestone, with before/after numbers,
  correctness results and recovery notes. Deploy only when requested. Verify
  the actual dev database target before migrations/backfills; production is
  excluded. Prefer additive changes and preserve compatibility during API/web
  rollout. Reverting a client optimization must not require deleting memory.
- [ ] Compare signed-in dev cold/warm traces with local results and separate
  network, database, queue and provider delays. Real-device performance remains
  a follow-up if iPhone/Android devices are unavailable; viewport/simulator
  checks must not be reported as physical-device performance.

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

Recommended next step: implement and accept milestone 3. Then complete memory
readers and final regression checks. Milestones 1 and 2 needed no migration;
search projection/index work remains conditional.
Production deployment, native/store packaging, a visual redesign and changes
to generation thresholds or model prompts are outside this performance plan.
