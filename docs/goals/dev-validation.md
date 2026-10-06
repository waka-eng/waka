# Dev validation milestone

Status: in progress (2026-10-06).
Branch: `codex/review-next-performance`, based on dev `1f4f2f7`.

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
