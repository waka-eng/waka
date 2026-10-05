# WAKA performance implementation plan

Status: proposed, implementation not started. Prepared 2026-10-05 from the
current production-build performance test and local single-inspiration Review
implementation.

Make WAKA feel ready sooner and stop unnecessary work after it opens. Start
with Home fetching and navigation, then search and Review, then memory readers.
Keep the current visual identity and the one-inspiration Review flow. Run one
milestone at a time, record its result, and pause for review before proceeding.

This document authorizes no implementation, database repair, model requests,
push, merge or deployment by itself. The existing local Review changes must
be preserved and tracked separately from performance work.

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
Git. The table above preserves the compact baseline in this plan; milestone 1
must make the benchmark reproducible and retain sanitized comparison receipts.

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

### Implementation tasks

- [ ] Promote the disposable performance probe into a supported manual command
  under `tools/`. Require an explicit disposable loopback database, disable
  provider calls by default, and register cleanup before seeding. Record build,
  fixture shape, pool configuration, request counts, bytes and timings without
  credentials, prompts or account content. Repeat cold/warm navigation and
  count both issued and completed requests.
- [ ] Ensure benchmark API processes use current code. Add reliable local API
  watch/restart behavior with graceful shutdown, or require a fresh isolated
  process for each run. The current local script watches the web build but
  runs the API without watch mode; do not mistake old server code for a result.
- [ ] Remove the all-inspiration detail sweep in `Home.tsx`. Fetch full text,
  reflections and media when an inspiration is opened. Default to no
  unsolicited inspiration detail warming; allow at most four explicit
  near-term prefetches if measurement later justifies them.
- [ ] Prioritize evidence for the visible Top of Mind entry. Stop loading every
  signal's full evidence sequentially before publishing that entry's roots.
  Keep lightweight signal metadata if the scene needs it; fetch further
  evidence on demand. Do not request more than the visible entry actually cites.
- [ ] Load only room roster metadata on Home. Fetch wall/proposal contents on
  room approach or entry, not for every room at boot. This is a fetching change,
  not an expansion of room features or sharing permissions.
- [ ] Move bounded summary snapshots and request deduplication outside the Home
  component so Chat navigation does not discard them. Key by account, target
  profile, wall and request scope. Clear on logout/account changes and revoke
  inaccessible wall/grant state. Start with memory-only storage, one active
  profile snapshot and the existing 2,000-summary ceiling.
- [ ] Define invalidation for capture, edit, removal, reflection, transcript
  correction, visibility changes and new server revisions. Cached raw text is
  not current evidence: reopening it requires an owned revision check. Reuse
  the existing material revision in DTOs if needed, not timestamp-only checks
  or a new parallel revision concept. Never feed client caches into generation.
- [ ] Validate warm archive snapshots against server-owned source identities,
  material revisions and current membership before reuse. Audit revision
  coverage first: the existing generation fence is not a whole-archive change
  counter, so an unchanged Top of Mind/generation revision cannot certify an
  uncited inspiration. Use a bounded metadata/delta read over existing tables
  to catch remote edits, deletions and new captures without reloading all full
  records. Until validation succeeds, cached geometry/chrome is only a loading
  aid, not proof that a preview or citation is current.
- [ ] Share in-flight GETs safely: one consumer closing must not cancel another
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

### Implementation tasks

- [ ] Separate first-page readiness from completion of the archive walk.
  Hydrate the initial 200 summaries, use the server's real total and load older
  pages only when needed or in a bounded background continuation. Cancel that
  continuation on identity changes or when it has no active consumer.
- [ ] Preserve positions, camera, timeline and open controls while more data
  arrives. Do not resort the visible field or replay the arrival animation.
  Prototype stable layout before wiring progressive updates. If that cannot
  be preserved, keep the field loading separately and enable Capture after
  authentication/draft hydration instead of forcing a visually unstable load.
- [ ] Restore the user's prior section, date, scroll and selected state after
  Chat navigation. Validate current data without making a return look like an
  entirely new visit or letting stale context become authoritative.
- [ ] Keep Review mounted through its new-session-to-confirmed-ID transition.
  Reuse the committed response instead of refetching the same session because
  the URL key changed. Real navigation to another session must still reset it.
- [ ] Add opt-in current-inspiration data to the existing Review read/start
  response, loaded with its matching owner/material revision in one database
  snapshot. Keep Home's resume read metadata-only. Preserve the durable start
  identity, one-open-session constraint and explicit lost-response recovery.
- [ ] Remove the always-on Review count request when a source is already
  present. Return enough truthful empty/caught-up information when no source
  is eligible. Refresh Home's resume label on return or a confirmed change,
  not on every internal Review URL transition.
- [ ] Preserve single-inspiration reflection, current-original validation,
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

Before implementation, record the current revision and preserve the pending
single-inspiration Review work. Move benchmark tooling out of ignored work
only as part of milestone 1; no private account data belongs in test fixtures.

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
failed, what remains and whether anything was pushed or deployed. Pause at
the milestone gate; do not silently expand into the next milestone.

Recommended first approval: milestone 1 only. It addresses the largest measured
waste without a schema migration or visual redesign. Reevaluate whether all
later work is necessary after its before/after results.
