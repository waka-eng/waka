# Performance improvements

Status: in progress (2026-10-05), milestone 1 passed; milestone 2 next.
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
