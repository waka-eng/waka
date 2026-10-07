# The goals, and which ones are live

`docs/goals/` is 11,000+ lines across 30 documents — the largest thing in the
repository after `Home.tsx`, and until this index existed there was no way to
tell, without opening all of them, that `three-layers.md` is a finished
account of work that shipped in August and `everything-in-the-world.md` is
work in flight. Both are ~1,000 lines and both read like a plan.

A goal is not a task list. It is a body of work with **gates** — points where
a measurement decides whether the next phase is worth doing, or whether the
honest answer is to stop. That is why a finished goal stays here rather than
being deleted: the record of what was measured, and what the measurement
decided, is the part worth keeping.

**If you are new:** read one **in flight** goal and one **done** one. The done
one shows you what a gate looks like when it has an answer. Nothing in
**proposed** has been started, and several were written months ago.

Each row's status is a summary of that file's own `Status:` line, written by
hand. `packages/web/test/goal-index.test.ts` guarantees this table is
**complete** — every goal has a row, every row names a real file, every goal
carries a `Status:` line to be sorted by. It does not verify that a row's
wording still matches the file's, and cannot say which section a goal belongs
in. **The file is the authority on its own status**; if a row and a file
disagree, the file is right and the row is stale.

## In flight

Work happening now, or stopped mid-way with a recorded reason.

| Goal | Status |
| --- | --- |
| [`native-accounts.md`](native-accounts.md) | In progress — local journeys verified; dev rollout and Android browser consent approved. Simulator acceptance continues; registered signing and verified device links deferred by owner. |
| [`beta-readiness.md`](beta-readiness.md) | Incomplete — milestones 1 and 3 delivered in PR 350; operational audit and recovery fixes deployed through PR 351. Dev configuration/heartbeat and public URL policy observed. Milestone 2 first-time comprehension and milestone 4 controlled live measurements, spending/privacy/source safeguards and exercised alerts remain open. |
| [`performance-improvements.md`](performance-improvements.md) | In progress — five milestones delivered to dev; loading/Review follow-up accepted locally. Exact deployed timing verification remains open. |
| [`ux-feature-implementation.md`](ux-feature-implementation.md) | Paused by owner after the checked feedback/room-flow batch; dev delivery requested. Later UX/algorithm slices, remaining release cases, semantic validation, historical repair and deployed verification remain open. |
| [`everything-in-the-world.md`](everything-in-the-world.md) | Phase 2 passed (2026-08-23). Phase 3 next. |
| [`every-workflow-works.md`](every-workflow-works.md) | Phase 2 passed (2026-08-22). Phase 3 next. |
| [`the-legible-loop.md`](the-legible-loop.md) | In flight — Phases 1–5 passed; Phase 6 is next. |
| [`one-product-one-system.md`](one-product-one-system.md) | Audit complete, phases open (2026-08-25). |
| [`ambition-reading.md`](ambition-reading.md) | In progress — Phase 0 passed with one criterion amended. |
| [`room-timeline.md`](room-timeline.md) | Phases 0–1 shipped; Phase 2 largely built, not finished. |
| [`no-quiet-corners.md`](no-quiet-corners.md) | In flight, yielding — queue position handed to `the-legible-loop.md`. |
| [`durable-interest.md`](durable-interest.md) | **Halted** at the Phase 1 gate (2026-08-09). A halt with a number is a result. |
| [`one-shift-a-day.md`](one-shift-a-day.md) | Phases 1–3 passed; **halted** at the Phase 4 gate (2026-08-31) — floor 8/8 live, gate 1/2, one fresh-day re-run to finish. |

## Done

Shipped, and kept for the measurements.

| Goal | Status |
| --- | --- |
| [`capacitor-foundation.md`](capacitor-foundation.md) | Done 2026-10-07 — M1 shared/native builds and simulator storage/callback/font/API checks accepted; Android network denial and iOS controlled failure/retry verified. Native accounts, full parity and stores remain M2–M6. |
| [`responsiveness-reliability.md`](responsiveness-reliability.md) | Implementation complete 2026-10-06 — Review Next 28→20 statements, chat polling 7→4; bounded transient retry signaling and hold cleanup verified locally. Dev delivery approved; cloud timings remain unmeasured. |
| [`dev-validation.md`](dev-validation.md) | Done 2026-10-06 — core personal loop and slow/failure/Back/return checks verified on dev; four observed fixes shipped in PRs 353–356. 804 web and 947 API unit cases; synthetic account erased, production unchanged. |
| [`chat-home-memory.md`](chat-home-memory.md) | Done 2026-10-04 — all chat/home/memory milestones implemented and accepted locally, including visual cues and Capture spark. 709 web, 803 API unit, 111 SQL cases; calibration 22/24 (91.7%), known misses retained. Not pushed/deployed. |
| [`personal-ux-clarity.md`](personal-ux-clarity.md) | Done 2026-10-04 — all eight UX improvements verified locally; 689 web, 766 API unit and 16 SQL tests. Not pushed or deployed. |
| [`personal-experience-delivery.md`](personal-experience-delivery.md) | Done 2026-10-04 — all 31 tasks/M1–M8 in the approved web/simulator scope, deployed and verified on dev through PRs 339/340. Production and native/store deployment excluded. |
| [`personal-capture-foundation.md`](personal-capture-foundation.md) | Done 2026-10-04 — first bundle accepted with simulator substitution; physical microphone and device behavior remain unverified. |
| [`a-room-you-can-trust.md`](a-room-you-can-trust.md) | Done 2026-08-23. |
| [`principles.md`](principles.md) | Done 2026-08-21. All eight phases passed their gates. |
| [`three-layers.md`](three-layers.md) | Done 2026-08-15. All ten phases passed. |
| [`signal-capture.md`](signal-capture.md) | Shipped 2026-08-09 (in-app slice); other surfaces deferred. |
| [`group-note-coverage.md`](group-note-coverage.md) | Answered 2026-07-31 — the question resolved without the build. |

## Superseded

Kept for the reasoning, overtaken by later work. Do not build from these.

| Goal | Superseded by |
| --- | --- |
| [`group-top-of-mind.md`](group-top-of-mind.md) | The three-layers rebuild (2026-08-15). |
| [`group-top-of-mind-synthesis.md`](group-top-of-mind-synthesis.md) | Cross-member synthesis landed 2026-08-21. |

## Drafted, not started

Written and not begun. Check the date before acting on one — the codebase has
moved since several were drafted.

| Goal | Status |
| --- | --- |
| [`a-frontend-you-can-read.md`](a-frontend-you-can-read.md) | Draft v2 (2026-08-16). The `Home.tsx` size problem lives here. |
| [`a-codebase-you-can-navigate.md`](a-codebase-you-can-navigate.md) | Draft v1 (2026-08-17). |
| [`close-the-two-gaps.md`](close-the-two-gaps.md) | Draft v1 (2026-08-17). |
| [`nothing-invented.md`](nothing-invented.md) | Draft (2026-08-18). |
| [`every-space-owns-its-stack.md`](every-space-owns-its-stack.md) | Plan (2026-08-17); its survey is four months of work out. |

## Proposed

Ideas with a shape, no commitment.

| Goal | Proposed |
| --- | --- |
| [`metabolism-game.md`](metabolism-game.md) | 2026-08-10 |
| [`two-modes.md`](two-modes.md) | 2026-08-08 |
| [`salience.md`](salience.md) | 2026-08-03 |
| [`board-selection.md`](board-selection.md) | 2026-08-02 — the code exists, parked; see `scoring/board-selection.ts`. |
| [`wall-that-evolves.md`](wall-that-evolves.md) | 2026-08-02 |
| [`combination-as-an-act.md`](combination-as-an-act.md) | not started |
| [`finding-your-people.md`](finding-your-people.md) | not started |

## Not a goal

| File | What it is |
| --- | --- |
| [`HANDOFF-ambition-reading.md`](HANDOFF-ambition-reading.md) | A session handoff note, kept with the goal it hands off. |
