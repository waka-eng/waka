# Performance improvements

Status: in progress (2026-10-05), milestones 1 to 4 passed locally; milestone 5 next.
Branch: `codex/performance-improvements`, based on the separately checkpointed
single-inspiration Review implementation at `33614ed`.

## Objective

Implement all five milestones in the approved
[performance implementation plan](../plans/2026-10-05-performance-implementation-plan.md).
The owner has requested the complete plan, superseding its initial
milestone-1-only recommendation and per-milestone approval pauses. Preserve
the gates and complete each before proceeding. Deployment still requires a
separate request; production and physical-device claims are excluded.

## Gates

1. Home request volume: no archive-wide detail sweep or unrelated room-content
   reads; at most four unsolicited inspiration detail reads and forty total
   initial/background API requests in sixty seconds on the specified fixture.
   Chat return reuses safely validated summaries without another archive walk.
   Account/profile/grant changes, mutations and late reads cannot leak or
   restore unavailable content. Benchmarking is repeatable and provider-free.
2. Readiness: Home/Capture median at most 800 ms and p95 at most 1.2 seconds
   at 2,000 inspirations with 150 ms added API delay; warm return chrome within
   400 ms. Review from ready Home uses at most three core requests and median
   at most 500 ms. Stable layout, URL/back state, drafts, deletion fencing and
   historical review links survive.
3. Search: local p95 below 100 ms at 10,000 inspirations over the representative
   bilingual/material query set, with equivalent IDs, order, cursors and totals.
   Conditional projection/index work preserves ownership, canonical material,
   source invalidation and safe resumable backfill. Retain unsuccessful cases.
4. Memory readers: Chat context median below 60 ms and p95 below 100 ms at
   10,000 inspirations without retrieval/evidence regressions; Top of Mind at
   most ten SQL statements and Principles at most six by the same counting
   method. Preserve publication/tenant/revision/lock checks and generation policy.
5. Final acceptance: prior gates and existing correctness suites pass; desktop
   and mobile-breakpoint workflows are measured; expensive browser/paid checks
   remain manual; optional startup changes require a measured gain. Prepare
   milestone delivery evidence and PRs, observe dev where authorized, and
   distinguish deployment/physical-device limitations from verified work.

## Verification and budget

Use explicit disposable loopback Postgres and synthetic accounts, never an
env-file default. No provider calls for performance fixtures. If retrieval
changes require live evaluation, use the previously approved cumulative USD 5
cap: prior accounting allocated USD 1.58019284, leaving USD 3.41980716; current
performance spending is zero. Announce and account for any paid batch first.

Use targeted checks from AGENTS.md during development and full existing suites
before milestone handoff. Capture new baselines before changes, not only the
prior audit. Every milestone gets a separate commit and explicit gate result.
The original plan's measurement/sample requirements remain authoritative.

## Log

### 2026 10 05 start

Inspected the current worktree, plan, goal index and execution command. The
pending Review work and plan were checkpointed separately at `33614ed` before
performance changes. Confirmed the test database is `waka_capture_a03_test`
on 127.0.0.1:5432. No remote data or provider requests will be used by the
performance fixtures. Milestone 1 starts with a supported benchmark, bounded
loading and cache validation using actual source material revisions; the
generation fence alone does not certify an uncited inspiration.

### Milestone 1 gate on 2026 10 05

Criterion: no broad original/room warming, at most four unsolicited original
reads and forty total requests in sixty seconds; safe summary reuse on Chat
return, with current originals and reading roots available on demand.

Fresh before/after on 2,000 inspirations, 64 signals, twelve rooms and 150 ms
API delay: 1,555 to 32 requests in the first sixty seconds; original detail
reads 1,436 to zero, signal detail reads 64 to one, room content reads 24 to
zero. Initial readiness was 1,957.2 to 2,013.1 ms: this milestone removes work,
not the serial page-readiness bottleneck reserved for milestone 2. Chat return
used one authorized snapshot validation, zero archive pages and zero original
detail reads. Editing an uncited source while away changed the fingerprint and
caused ten fresh summary pages on return, with no new broad detail sweep.

Verdict: request-volume gate passes. Built-browser Why this reading and its
original were inspected. Private support identities preserve field meaning;
group summaries omit them. Tests cover account/profile/logout boundaries,
one-consumer cancellation, late reads, attempted/lost writes, fresh material
revisions, old archive deletion, foreign targets and refused lineage reuse.

Verification checkpoint: 723 web, 803 API unit and 1,480 full hermetic API tests
passed. API/web/admin and benchmark types, web build and shell syntax passed.
The first parallel typecheck raced a vocabulary test's temporary source file;
it passed when rerun after that test completed. Earlier lighting/root tests
exposed metadata/timing dependencies and were repaired without dropping their
behavior assertions. One additional missing-lineage SQL test is run separately.

The supported manual runner disables provider networking, records issued and
completed requests, supports pool/sample/fixture/output settings and registers
cleanup before seeding. The local script now watches API code as well as web.
No new migration, model call, remote mutation, push or deployment occurred.
The compact receipt is [milestone 1 evidence](../craft/evidence/performance/milestone-1.json).
The added missing-lineage SQL case passed in the 6-case snapshot suite.
Current full web run is 723/723; the final citation invalidation change passed
20 focused behavioral cases plus web/API typechecks. Artifact changes now
withdraw prior roots and refetch the visible entry without trusting old citations.
Milestone 2 is next under the owner's all-milestones approval.

### Milestone 2 planning checkpoint on 2026 10 05

The owner requested a clear implementation plan. Updated the existing plan
without advancing application code in this turn. Milestone 2 has local,
uncommitted changes for early Home/Capture readiness, retained Review route
transitions and an opt-in revision-matched current original in Review reads.
Its gate has not passed. Saved candidate Home readiness samples number twenty:
median 372.25 ms, sample p95 466.5 ms and maximum 569 ms. These observations
are not a matched before/after acceptance result or deployed/device evidence.

Next work is background-loading recovery, capture during continuation, Review
and Back/draft edge cases, rollout compatibility, repeated Review/warm-return
timings and final correctness verification. Milestones 3 to 5 are not started.
No new model call, schema mutation, push, merge or deployment was performed
for this planning checkpoint.

### Milestone 2 gate on 2026 10 05

Criterion: Home/Capture median at most 800 ms and sample p95 at most 1.2 s;
warm return usable within 400 ms; Review at most three core opening requests
and median at most 500 ms. Preserve layout, navigation, drafts and source fences.

Two production builds, baseline `c6fee2e` and the final local candidate, used
separate disposable schemas with 2,000 inspirations, 64 signals, twelve rooms
and 150 ms added API delay. Twenty interleaved samples per build: Home median
1,910.6 to 400 ms, sample p95 1,994.6 to 432 ms; fresh Review median 842 to
359.7 ms, sample p95 883.3 to 369.9 ms. Twenty final resumed openings had
median 175.9 ms, sample p95 178.6 ms. Warm return median was 214.5 to 215.05 ms,
sample p95 292.3 to 253.9 ms and candidate maximum 271 ms. Warm return was
already fast from milestone 1; this preserves it, not a new gain.

The baseline Review loading window had nine requests. The candidate has one
Home resume metadata read plus two core opening requests: active with current
material, then start with current material. No original-detail/count/duplicate
session reads. Across twenty warm returns, twenty manifest checks and zero
archive-page requests occurred after the first Chat opening.
The final pure Home sixty-second window had 31 issued/completed API requests,
1,223,221 response bytes, zero original detail and zero room-content reads,
so milestone 1's request budget still passes after these changes.

Verdict: readiness gate passes locally. Complete geometry still arrives in a
bounded background continuation; the partial field is never painted and then
reshuffled. A synthetic capture submitted while that continuation was loading
appeared once; the database had 2,001 originals and one matching new source.
The fixture was cleaned and recreated before final matched measurements.
Built-browser Next advanced originals 1 to 2 to 3 to 5 to 6; expecting 4 first
was a test expectation error, since 4 already had a saved reflection. A draft
survived close/resume. Chat Back restored an expanded selected principle and
the lower list's exact 1,684.5 px scroll position. Cold field links show loading.

Fixed the later-page failure path to retain ready Home/Capture and its draft,
with an explicit retry rather than a full-page failure or dev fixture switch.
Tests prove deduplicated retry, continuation cancellation, three consecutive
panel URL transitions, cancellation after a retained transition and legacy API
read negotiation without automatic POST replay. Current original/revision
bundling is owner-scoped and repeatable-read; historical links, revision-fenced
removal, lost responses, concurrent journals and reflection recovery still pass.

Verification: 734 web tests and 1,483 full hermetic API tests passed; three paid
evaluations skipped. API/web/admin and benchmark types, production web build
and diff checks passed. No migration, provider call, remote account mutation,
push, merge or deployment. Compact
[milestone 2 evidence](../craft/evidence/performance/milestone-2.json) retains
results. Browser percentiles are local samples; physical devices, cloud latency
and controlled-worker contention remain later validation work. Milestone 3
starts next under the existing all-milestones approval.

### Milestone 3 gate on 2026 10 05

Criterion: local search p95 below 100 ms at 10,000 inspirations across the
representative bilingual/material queries, with complete membership, ordering,
cursors and exact totals preserved. Conditional storage must support safe
source updates, partial coverage and bounded resumable backfill.

Fresh baseline at `5796d4e`: common search median 416.77 ms, p95 471.17 ms.
Expanded four-account corpus (25, 250, 2,000 and 10,000 originals) covered
twenty query classes, thirty samples each and a full cursor walk. Every
baseline class returned the expected complete set, but p95 ranged 444.75 to
640.61 ms. English/Korean, rare/no-result, multiword, literal percent/underscore/
escape, reflection, link/image and corrected/superseded speech were included.

The query-only experiment used cheap literal matching first, owned candidate
sets and a single window count. SQL was 31.506 ms for common English, 22.962
for rare English, 22.157 for no result and 23.601 for Korean multiword, but
212.787 ms for dense English multiword. EXPLAIN showed the existing GIN index
working for rare cases; dense text still reparsed per row. This failed the
original multiword budget and justified storage, not a claim of a missing index.

Added policy-tagged, nullable raw-text vectors with a synchronous text-write
trigger in migration 0067. Child matches remain current owned reads. Missing or
unsupported vectors fall back to raw text; readers perform no repair/model
work. No new index was needed. A window over identities counts once before
LIMIT, then joins only the page's previews/material revisions in the same SQL
statement. All original visibility, tenant and effective-material rules remain.

Final interleaved HTTP comparison alternated request order, thirty samples per
class per build. Across twenty classes, baseline p95 ranged 416.9 to 530.21 ms
and candidate p95 23.18 to 46.03 ms. Each pair checked page membership/totals;
both independent complete cursor walks checked every matching owned identity
and order. Verdict: the search gate passes locally. Compact
[milestone 3 evidence](../craft/evidence/performance/milestone-3.json) retains
the unsuccessful experiment, all paired values and measurement limits.

Also reproduced a real cursor bug: a limit-one page over three originals tied
at a microsecond timestamp returned only one. New opaque cursors preserve exact
UTC PostgreSQL precision; existing strings still decode. Searched/unsearched
tie and empty-tail tests now pass. No visible timestamp format changed.

Rehearsed migration/backfill on 12,275 historical disposable rows: dry-run
reported 12,275, a 250-row batch left 12,025, a subsequent bounded resume left
zero. Material revision sum stayed 17,794, generation sum 900 and jobs zero.
Tests cover busy rows/concurrent text edits, scoped repairs, unsupported/missing
coverage, removal, current child edits, exact source/material hashes and unchanged
embedding input. List/detail DTOs expose neither vector nor parser policy.
Production stage and wrong-host apply commands were refused before DB work.

Verification: 1,494 full API tests and 734 web tests passed; three paid evals
skipped. Sixteen focused SQL cases, including the final hash/DTO assertions and
real fresh migration, passed. API/web/admin/benchmark types, web production build,
db:check, offline migration integrity and diff checks passed. A test response
needed an explicit type annotation before the final typecheck passed. The new
snapshot captures existing manually-authored 0065/0066 schema additions; their
duplicate generated DDL was removed from the new migration, not older history.
No remote migration, backfill, source mutation, provider call, push or deployment.
Dev rollout must apply 0067 before the new API; rollback can retain additive
columns and use the old reader. Pool-one, worker contention and deployed/device
verification remain later work. Milestone 4 is next.

### Milestone 4 gate on 2026 10 05

Criterion: Chat context median below 60 ms and p95 below 100 ms at 10,000
originals with unchanged retrieval/evidence; Top of Mind at most ten SQL
statements and Principles at most six, including the same auth/transaction work.

Fresh pre-change baseline at `beb31b0`, pool five: context median 122.62 ms,
p95 143.88 ms; artifact statement counts fourteen/nine. Pool one baseline was
124.54/131.36 ms with the same counts. Candidate sets alone still took 106.48
ms median; materializing folded passages took 64.56 ms and spilled 1,593 read
and 531 written temporary blocks in the 71.496 ms SQL probe. Both missed the
original bar. Streaming passage folds removed the spill; lightweight owned
identity/date rows avoid full-text buffering, and a term-position bit mask
deduplicates witnesses without a second aggregate. A child anti-join was slower
at 51.44 ms SQL and was removed. Final SQL probe was 45.345 ms, no temporary I/O.

Final interleaved thirty-sample comparison: pool five context median 145.9 to
54.76 ms and p95 197.8 to 75.43 ms; pool one median 131.5 to 51.59 ms and
p95 142.4 to 68.3 ms. Both compare identical normalized synthetic context.
Top of Mind uses ten statements and Principles four. Verdict: the memory-reader
gate passes locally with both pool settings. No global connection increase.

Top of Mind combines current citation projection, feedback and conflict flags
in one query inside its existing repeatable-read artifact/token snapshot.
Principles reads wording, support, current verdict, citations and bounded
personal/review examples in one statement, preventing mixed-version projection.
It saves five round trips, but local HTTP median rose 5.98 to 7.49 ms at pool
five and 5.81 to 7.37 ms at pool one: record the CPU tradeoff, not a claim of a
measured cloud speedup. Declared/human-locked wording and withholding rules stay.

Chat preserves literal substring scoring, source/term uniqueness, timestamp/id
tie order, owned revision filtering before its six-source limit, original text,
labels, hashes and excerpt limits. UTF8 passage case folding is performed once
using the same lower-and-match operation as PostgreSQL's ILIKE implementation;
other encodings retain native ILIKE. Reference SQL tests compare twenty queries
on the same fixture, including English/Korean, Unicode case, repeated terms,
wildcards, duplicate children, stale/missing lineage and corrected media.
Primary implementation reference:
[PostgreSQL like.c](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/utils/adt/like.c).

Replayed all forty existing queries with cached vectors and zero new provider
calls/cost. Original set: hybrid 21/21, semantic gain five, unexpected two,
negative matches zero. Holdout: 6/6, gain five, unexpected/negative zero.
Validation: 6/6, gain four, unexpected/negative zero. All predeclared quality
gates passed with the prior lexical results retained. No ranking/model/prompt,
generation threshold, daily floor, human lock or publication policy changed.

Added closed-label content-free stage timing for queue wait (excluding intended
run-after delay), material/context reads, embeddings, models and publication
validation. Logs contain only stage, operation, duration and outcome; no source,
identifier, exception text or credential. Tests retain original results/errors,
this binding, one transport call and log-sink failure isolation. Existing dev
jobs/provider timings are not yet observed; no model-delay attribution is made.

Verification: 1,518 full API tests and 734 web tests passed; three paid evals
skipped. API/web/admin and runner types, web build and diff checks passed.
Early checks caught unused imports, a unit mock missing the new projection,
an ambiguous raw-subquery ID, an untyped term index and a reserved test variable;
all were fixed without dropping behavior assertions. Compact
[milestone 4 evidence](../craft/evidence/performance/milestone-4.json) retains
paired values, rejected experiments, quality results and limits. No new schema,
provider spending, remote mutation, push or deployment. Milestone 5 remains:
full regression/breakpoint/worker checks and authorized delivery observation.
