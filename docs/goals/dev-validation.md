# Dev validation milestone

Status: done (2026-10-06) — personal dev journey, failure recovery and observed repairs verified; synthetic account erased.
Branch: `codex/review-next-performance`, based on dev `1f4f2f7`.
Verified app deployment: `4ec9f2e`, PRs 353–356; production unchanged.

## Objective

Ship the locally verified Review Next performance fix, validate the personal
capture, reflection, Review, Principles and chat loop on dev, and fix defects
found in that pass. Preserve the current design and one-inspiration-at-a-time
Review. Production and new feature expansion are out of scope.

## Delivery gate

The Review fix passes normal PR checks, merges to dev, and the corresponding
automatic deployment succeeds. Confirm the deployed API supports the atomic
advance contract. No schema migration is expected; the deployment verifier
must still confirm the current schema and dev database bindings.

## Journey gate

Use private synthetic content in a separate test account, never existing
account content. Verify capture persistence, reflection and follow-up question
behavior, one-item Review and Next, visible Principles with valid evidence, and
context-aware chat with clickable continuation. Verify Back/deep links and
return visits with saved progress and drafts intact. Check slow and failed
requests, including ambiguous writes, without duplicate saved content or false
success. Record actual rendered behavior and request timings; local fault
injection and tests supplement, but do not replace, the deployed journey.

## Repair gate

Each discovered defect gets a failing reproduction, an in-scope fix and a
passing regression. Deliver needed fixes through normal PR checks and repeat
the affected dev journey. Clean up only this milestone's synthetic account and
test artifacts. Finish with a short result and remaining limitations.

## Safety and budget

No production changes, provider administration, recurring caps, security
policy changes or real-account mutations. Paid calls use synthetic inputs and
the existing cumulative $5 evaluation allowance: $1.6332342014 already used.
Declare bounded batches before dispatch. Keep unknown costs counted and stop
before the allowance is exhausted. Physical-device testing and unassisted
first-time usability research remain separate beta-readiness gates.

## Log

### 2026 10 06 start

Fetched origin: dev remains `1f4f2f7`; the clean local branch contains only
Review fix `4cf4cdd`. No remote PR is open. Prior local proof records four
serial requests reduced to one and median transition 815 to 248 ms with
150 ms injected delay, six samples per path. This is not a deployed timing
claim. Normal CI and the deployed journey are the next gates.

### 2026 10 06 delivery and first dev findings

PR 353 passed normal CI and merged to dev `ac75ca7`. Automatic deployment
37509739745 is running; deployed advance is not yet claimed.

A loopback-only gateway forwards actual dev HTML, assets and API calls using
an in-memory session for a new private synthetic account. It does not read or
replace existing browser cookies. Eight captures persist across reload. A
lost capture response after the upstream save recovers by an owned receipt
read and an idempotent replay, with eight total originals and no duplicate. An unfinished reflection survives
closing and reload. Its generated follow-up asks what a test participant's
confusion revealed; the next answer saves and the original shows two reflections.
The first chat reply cites two current originals and gives a relevant next step.
Discuss this saves a continuation; that reply failed and remains recoverable,
so successful continuation is still an open check.

Initial profile-list read returned 429; a later identical read returned 200.
No service-limit change is justified from this transient observation.

Home hides its manual re-read action while source processing waits for the
daily reading, even when support has withdrawn every displayed entry. A real
Home regression with owned status reproduces the absent action. The repair
offers Read again only for withdrawn support with scheduled reading work, not
active derivation, and queues nothing until explicitly pressed. The corrected
regression fails against the unchanged baseline and passes with the fix.
All 803 web cases, 32 targeted checks, web types and production build pass.
No backend policy, cadence, schema or automatic generation behavior changes.

The bounded synthetic provider batch reserves $1.50 from the remaining test
allowance; actual provider charges are not available through the test session.
Reserve remains counted, so cumulative used or held is $3.1332342014 of $5.

### 2026 10 06 deployed recovery and chat diagnosis

PRs 353 and 354 deployed successfully at `ac75ca7` and `2d67468`. Both
deployment verifiers confirm migrations 0065/0066/0067 and matching API/worker
dev database bindings. The actual API advertises supportsAdvance with one
item and its current source. A lost Next response preserves the old card;
explicit Retry replays the same durable advance and returns its existing
successor, without advancing twice. Reload reconciliation uses reads. The
gateway trace distinguishes this replay from the separate read-only retry
of a failed Review GET. A slow double-click produces one transition. Observed
advance request times are 3863 ms, 1884 ms for its idempotent replay, and
6202 ms with 2000 ms added delay; this is not a cloud p95 or a 248 ms claim.
An unsent chat draft survives Back and return. The repaired Read again control
is visible on the actual deployed Home with withdrawn support and a scheduled
reading. Its screenshot is saved with private synthetic data only.

The continuation failed on all three permitted attempts; the app retained
the message, references and draft and surfaced the one-hour reply limit.
Four diagnostic calls cost $0.000801466 total. A read-only reconstruction of
the exact failed request verifies its stored context hash and source identities
before any provider call. Baseline reproduction returned valid output. A
prompt-only candidate still repeated the earlier follow-up question and was
rejected despite valid citations. The final candidate keeps a validated answer
but omits an optional question already asked; invalid citations, IDs, shape,
bounds and multiple-question output remain refused. This candidate passes
947 API unit cases, 42 focused cases and API types. The final paid probe is
accepted with current citations and no repeated question. This small sample
does not claim a statistically measured quality gain or explain every prior
provider failure. Dev delivery and an affected live continuation are next.

Three additional, distinct private captures extend the fixture to eleven,
using the unchanged evidence threshold. Two patterns now have three supporting
originals and are active; the third is still processing. Generated Principles
and the manual reading remain open checks, not declared complete from an
empty state. No threshold or stored source was fabricated.

The read-only operational audit 37510702607 succeeds. Its bounded stage-wide
log page has 49 usage samples, $0.003619674 priced usage and 27 unpriced Gemini
requests; it is partial and not test-account billing. The $1.50 reservation
therefore remains held. Including priced diagnostics, cumulative used or held
is $3.1340356674 of $5. No recurring cap or provider policy changed.

### 2026 10 06 generated output and final Back repair

The delayed source job recovered on its second attempt and completed derivation
at 18:47:22 UTC. The account now has three active patterns, each with three
independent supporting originals. An explicit Read again produces reading
version 2 with one current entry and no withdrawn support. The ordinary next
pass produces one held Principle citing all three active patterns, with no
unsupported or changed-support flag. Its rendered Why this fits contains the
three statements and current saved examples. No threshold override, fake
timestamp, direct signal/Principle write or extra calendar wait was used.

PR 355 passed normal CI and deployed at `d9ccac6` in run 37515437552. A final
rendered Back check finds an unrelated UI defect: expanded Principle evidence
remains visible after its Principle closes. A real-router regression fails
on that orphan evidence while the route and action controls correctly close.
The one-line fix renders evidence only for the open Principle. All 804 web
cases, 25 targeted navigation/reading cases, web types and build pass locally.
Deliver this small repair, recheck the affected Back rendering and the deployed
chat continuation, then erase only the synthetic test identity.

### 2026 10 06 completion

PR 356 passes normal CI and deploys at `4ec9f2e` in run 37519793821. The
deployment again verifies the existing memory schema and API/worker database
bindings; no new migration is needed. On the actual built dev UI, expanded
Principle evidence has one rendered container before Back and zero afterward.
The selected controls close and Home returns with its reading and Principle.

The originally failed source-led continuation now completes after the ordinary
retry window, without duplicating its human message. Its two user messages and
two assistant replies remain; every reference is currently available. A separate
chat begun from the generated Principle produces a relevant reply citing that
Principle and a current inspiration. That conversation contains one user and
one assistant message, also with current references. No new principle or
inspiration is implicitly saved by either chat.

Delivery, journey and repair gates pass for this scoped dev milestone. The
record includes cold return, preserved capture/reflection/chat progress, source
and Principle deep links, Back, ambiguous capture/Next responses, a delayed
double-click and a failed Review GET. Local final verification is 804 web cases,
947 API unit cases, types and build; each application repair also passes normal
remote CI. Bounded model probes and the earlier 43 Review SQL cases are retained,
not added to overlapping CI totals.

Cleanup verifies the exact generated account and profile before erasing them
through the dev account API. The erased session returns 401, the gateway exits
successfully, port 3018 has no listener, and its temporary browser tab closes.
Only the eleven synthetic originals and their associated test memory are
erased; existing account memory and production are not changed. Temporary
diagnostic scripts are removed; private synthetic proof images and numeric
operational artifacts remain in the ignored performance directory.

Remaining findings are separate follow-up work: cloud Next took about four
seconds in these sparse observations, and transient generation can wait for
dev's fifteen-minute recovery. These are not p95/load measurements. First-time
comprehension, physical devices, broad model-quality guarantees and recurring
spending/privacy/source safeguards remain the broader beta-readiness work.
The unknown dev provider charge still holds its $1.50 reservation; no unknown
usage is treated as free. The documentation skill guided the validation gate
record and evidence ledger, without a new cloud Page or design change.
