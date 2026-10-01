# Goal: implement the experience review

Status: in flight — phase A implemented and desktop-verified; B starting. Full release verification remains open.
Created: 2026-10-01, on the owner's instruction to implement the full plan.
Branch: `codex/ux-feature-implementation`.
Baseline: `33e65a7` on `dev`.
Specification: [experience review, revision 3](../audits/ux-feature-review-2026-10-01.md).

## Objective and completion

Implement all delivery slices, independent launch requirements, and required
verification in the referenced plan. Preserve the current visual feel and
the owner's preference for few public states. An individually passing slice
does not complete this goal. Features explicitly deferred in the plan remain
deferred; this does not shrink the defined releases or their gates.

The plan's accepted recommendations guide implementation: personal reflection
privacy, preservation of human words, explicit current support, revision-safe
generation, accurate completion, accessible input, stable navigation, reliable
attachments, useful readings, and next-round room participation. Amend the
canon before introducing new data concepts. Do not resume older halted model
experiments or revive superseded room goals.

## Delivery and verification ledger

| Slice | Requirements | Gate | Current evidence |
| --- | --- | --- | --- |
| A | F5/F6/F10: input, overlay scrolling/focus, readable active controls | Reproduce slash/wheel defects; verify typing, caret, Escape/Tab, wheel/touch and contrast in actual affected flows; web checks | Implemented; 5 original failures now pass, 325 web tests pass. Desktop fixture verified. Mobile touch/200% zoom and deployed verification remain open. |
| B | F3/F4: edited principle preservation, truthful support, account-scoped drafts/preferences and cancellation | Isolated SQL preservation tests and two-account browser/state tests; API/web checks | B1 preservation implemented: baseline 3 failures, then 6 SQL / 653 unit tests pass. B2 storage/cancellation pending. |
| C | F2: private reflection containment across prompts, vectors, context and outputs | Private-answer mutations cannot affect room inputs; current membership/visibility checks; read-only historical impact report and reviewed repair scope | Pending |
| D | F1: exact source attribution, explicit support checks, retention, revisions and durable downstream jobs | Deletion/edits remove invalid current citations; bounded omission/failure do not withdraw good support; stale jobs cannot commit; locked words survive | Pending |
| E1 | F7/F8: authoritative poster and truthful manual refresh | Queue acceptance, changed/unchanged completion, failure and fresh displayed version verified | Pending |
| E2 | F9: capture/reflection outcome and recovery | Save → answer → generation → visible result; delay, daily hold, retry, resume and rapid requests verified | Pending |
| F | F11/F12: visible search and durable navigation | Results beyond initial archive, failure/no-match separation, stable IDs, deep links, Back/Forward and rename verified | Pending |
| G | F13: capture attachments and recoverable failure | Paste/drop/select preview; saved text survives failure; retry attaches once; sharing destination clear | Pending |
| H | F18: progressive initial load and bounded prefetch | Small/large archive baseline vs result, first useful view and card/search/deep-link integrity | Pending |
| I | F14/F16: evaluated generation quality and useful secondary readings | Baseline/rubric first; fixed scenarios and independent/user review where available; changed candidate clears predeclared gates | Pending |
| J | F15: grounded starters and next-round room collaboration | 50% distinct participation, two evidence voices, separate direct-proposal majority, membership races, disagreement and version lineage verified | Pending |
| L1 | F17: password recovery | Delivery, token lifetime/single use, non-enumeration, session policy, actual recovery verified | Pending |
| L2 | F19: canonical policy and product copy | Current sharing, reflection, room/principle and generation definitions agree with implemented behavior | Pending |
| L3 | Onboarding, telemetry, user validation, release and repair verification | Contextual first-loop experience; metadata-only trace; realistic task checks; model latency/cost and usability measurements, required repairs and rollout evidence | Pending |

Start independent A/B fixes while investigating C/D. Ship B before enabling
D's support withdrawal. E1 may proceed independently, but E2's evidence
receipts depend on D. The remainder follows the dependency graph in the plan.
Keep code, deployment, historical repair, and user validation evidence distinct.

## Working rules

- Record the failing reproduction before the fix and the exact targeted
  verification after it. A failed gate remains work to resolve, not permission
  to soften the gate. Independent work can proceed only where that failure
  does not undermine its assumptions.
- Commit separately by slice with the slice ID in the subject.
- Use injected providers and disposable local Postgres for deterministic
  cases. Verify the database host before any mutation; `.env.local` has pointed
  at remote Neon in this session despite the old repository note.
- Before live model evaluations, state the call/cost estimate and stopping
  limit, record actual usage, and compare the same cases against the baseline.
- Historical repair needs a named impact manifest, retention treatment,
  checkpoints and a recovery path. Preserve human edits and current privacy
  choices. A safe new writer alone does not prove old data repaired.
- Mark a slice complete only when its scoped gate is evidenced. Record missing
  external validation or provisioning explicitly; do not count it as done.

## Log

- 2026-10-01: Started from clean tracked code at `33e65a7`; the untracked audit
  was preserved. Remote `dev` matches the baseline (0 ahead / 0 behind).
  Registered the full A–J/L1–L3 scope before implementation. No live model
  calls or data repair performed.
- 2026-10-01, A: baseline reproduced 5/5 failures (reflection slash and wheel
  cancellation in room/reflection/settings/date surfaces). Shared input
  ownership now passes those 5 cases; full field suite 12/12, targeted dialog
  and related suites 42/42, full web suite 325/325, typecheck/build successful.
  Local fixture browser: slash entered as `/`; Shift+Tab cycled from Close to
  the final action; Escape restored the room opener; wheel left background
  position unchanged. Computed active dialog text now yields 5.47:1 contrast
  on its actual panel background. No live model calls. Mobile touch/200% zoom
  and deployment are not claimed by these checks.
- 2026-10-01, A follow-up: native modified-Tab remains owned by browser tab
  navigation; dialog focus cycling applies to unmodified Tab/Shift+Tab only.
  Dialog regression suite 4/4 passed.
- 2026-10-01, B1: reproduced deletion of edited held and contested principles
  against isolated schemas in local `waka_agent_test` (2/2 SQL failures) and
  the pure decision rule (1/1 failure). Added `unsupported_at` migration 0031,
  preserved locked wording and disputes under row lock, and exposed withdrawn
  support in JSON, the human UI and canonical machine rendering. Restored
  evidence clears unsupported standing without rewriting words or resolving
  disputes. After fix: 6/6 SQL tests, 653 API unit tests passed (3 live benches
  skipped), both typechecks passed, 15 targeted web checks passed, migration
  check passed. No shared database migration or historical repair executed.
