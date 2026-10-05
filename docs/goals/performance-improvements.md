# Performance improvements

Status: in progress (2026-10-05), milestones 1 and 2 passed locally; milestone 3 next.
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
