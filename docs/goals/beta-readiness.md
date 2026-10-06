# WAKA beta readiness milestones

Status: in progress (2026-10-05), milestone 1 passed locally; milestone 2 next, milestones 3 and 4 remain open.
Branch: `codex/beta-readiness-m1-m4`, based on deployed dev `56a2694`.

## Objective

Implement all of milestones 1 through 4 from the comprehensive app review:
authentication and dependency safety, core-loop UX clarity, AI quality and
historical context, and performance and operational reliability. Preserve the
current visual feel, private ownership, human wording locks, source validation,
and versioning. Keep native release and milestone 5 out of this goal.

## Milestone 1 Authentication safety and dependency fixes

Prevent silent bcrypt truncation for new passwords with byte-aware validation,
while retaining login compatibility with existing hashes and passwords. Patch
the affected Hono dependency and verify authentication/authorization behavior.
Keep existing-account recovery limitations explicit; do not silently change
stored hashes or lock existing users out.

Gate: ASCII and Unicode inputs through the 72-byte boundary have regression
coverage; oversized signup is refused before database access or hashing; the
hashing helper cannot create a truncated new password; existing hashes still
authenticate. Dependency audit and applicable route tests confirm the patch.

## Milestone 2 Core loop UX clarity

Make Capture, Principles, Review, chat, and sharing easy to find without adding
public state categories. Give Principles a persistent clear entry/count or
preview; distinguish evidence and actions; clarify room-only capture sharing;
explain Review selection and Next without implying deletion. Use readable
action labels with preserved input sizes and touch targets. Make source-based
chat continuation consistent across old and new replies and conversation
titles recognizable by their substantive topic.

Gate: desktop and narrow built-browser journeys cover all five destinations,
Back/deep links, keyboard/focus, drafts, audience defaults, and existing data.
New-user comprehension must be observed without guidance; owner acceptance
alone or automated tests do not establish that human gate. Record the actual
evidence and keep that gate open when participants are unavailable.

## Milestone 3 AI quality and evolution

Evaluate the complete fixed 24-scenario generation matrix on DeepSeek V4.1
Flash, retaining the known compound-guide and locale-grounding failures in the
rubric. Add bounded, dated, owned historical context for questions about how
thinking changed, with meaningful-version comparison and explicit abstention
when evidence is insufficient. Preserve correction, deletion, source freshness,
human wording, and account/group separation. Validate usefulness and specificity
alongside structural output and citation checks; do not retune weights blindly.

Gate: the full fixed matrix meets its existing >=90% qualitative bar, all
critical safety cases pass, and history-aware chat uses actual earlier/current
records without invented dates, missing-source revival, or foreign history.
Model requests must declare and verify their expected model and budget.

## Milestone 4 Performance and operational reliability

Benchmark long conversation reads before changing them, then batch reference
validation and add bounded history delivery where required. Measure deployed
queue, retrieval/embedding, provider, and publication delays separately, including
warm/cold and concurrent behavior. Add monitored bounded recovery for overdue
runnable jobs, preserving durable idempotency and intended cadence/budget waits.
Make model usage/spending observable and establish explicit per-environment
cost controls and alerts. Verify provider-data policies and trusted origin/source
configuration rather than inferring them from an env filename or default.

Gate: long-thread measurements and regressions demonstrate reduced read work
without stale/foreign citation access or lost messages; deployed measurements
distinguish stages; overdue runnable work recovers without duplicate model work;
usage/spend visibility and safeguards are exercised. Existing performance gates
and ownership/material-revision invariants remain satisfied. Human or cloud
access requirements remain open until authoritative verification is available.

## Verification and budget

Use targeted checks from AGENTS.md and explicit disposable loopback databases
for SQL/UI tests. Never use the env-file database default for mutations. No real
account content in paid evaluations. Use the approved cumulative USD 5 test
budget: allocation before this goal is USD 1.5833779064, leaving USD 3.4166220936.
Announce each paid batch and retain usage and failed/unknown outcomes.

Implement and commit milestones separately. Publishing, deployment, new
security-sensitive access, or external coordination requires applicable user
authority. Do not mark all four complete from a narrower unit/smoke check.

## Log

### Start on 2026 10 05

Confirmed clean local dev at `56a2694` and a matching remote head. The previous
review yielded progress: a synthetic check proved bcrypt ignores different
suffixes after 72 bytes; production dependency audit reported four moderate
Hono advisories, with no high/critical findings reported. The new branch keeps
older stashes and deployed data untouched. Milestone 1 starts with defect-first
ASCII/Unicode and legacy-login regression cases.

### Milestone 1 gate on 2026 10 05

Criterion: no silent truncation for new passwords, compatible legacy login,
patched production dependency, and authentication regression checks.

The defect-first boundary run passed 6 and failed 8 of 14 tests. Oversized
signup reached the refusing database spy (500 rather than 400); hashing resolved
instead of rejecting the four oversized ASCII/Unicode inputs. After adding one
UTF-8 byte policy to signup and the hashing helper, all 14 boundary cases pass.
Legacy verification deliberately remains unchanged, including old long inputs;
stored password hashes were not migrated or rewritten.

Installed Hono changed from 4.13.0 to 4.13.7, including its node-server peer.
The production dependency audit changed from four moderate advisories to zero
reported advisories across 105 production dependencies. The lockfile diff changes
only the Hono version/integrity and its peer binding. This is not a claim about
unscanned application logic or the entire development-tool dependency graph.

Verification: 835 API unit tests passed, three opt-in paid benches skipped;
49 targeted auth/boundary tests passed; seven real signup/login SQL cases passed
on explicit loopback `waka_capture_a03_test`. SQL cases cover accepted 72-byte
ASCII/Korean/emoji passwords, rejected oversized registration with no identity
or session rows, and a legacy long-password login without rewriting its hash.
API typecheck, diff check, and all three goal-index checks passed.

Retained repair evidence: a test cleanup accidentally returned a spy and was
corrected to a void hook; the new response assertion needed an explicit JSON
type; a package-version diagnostic used an unexported package subpath and was
replaced by reading the installed package metadata. These were not failures
of the boundary policy. No model calls, remote data changes, schema changes,
push or deployment occurred. Verdict: milestone 1 passes locally.
