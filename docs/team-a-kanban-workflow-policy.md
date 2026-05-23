# Team A Kanban Workflow Policy

This policy keeps Team A / WAKA agent work moving without weakening WAKA safety guardrails. It applies to planner-a, dev-a, review-a, qa-a, and orch-a when working in this repository.

## Core rule

Only present a kanban task to the user as blocked when it is truly `REAL_BLOCKED`. Routine handoffs and recoverable board/session stalls must be completed, promoted, decomposed, reassigned, archived, unblocked, or converted into a concrete follow-up task by the agents that can resolve them.

## `REAL_BLOCKED`

`REAL_BLOCKED` is limited to work that needs external input or an irreversible/high-risk human decision before an agent can safely continue:

- Missing user or stakeholder input that cannot be inferred from the existing task, parent handoff, repository, or product guardrails.
- Required approval for destructive actions, production data access, deploys, merges, protected-branch updates, security-sensitive changes, or contact with external users/services.
- Missing credentials, secrets, paid/private access, or unavailable required services that the agent cannot obtain or mock safely.
- Product direction decisions that would change WAKA behavior, user promises, data ownership, trust/safety posture, or launch scope.
- Non-recoverable missing context after the agent has inspected parent handoffs, comments, relevant files, and available task history.

When a task is `REAL_BLOCKED`, leave concise durable context in the task thread, state the specific decision or input needed, and stop.

## `ROUTINE_HANDOFF`

`ROUTINE_HANDOFF` states are normal workflow transitions, not user blockers. Examples include:

- `READY_FOR_REVIEW`
- `READY_FOR_QA`
- `APPROVED_FOR_QA`
- `NEEDS_FINALIZATION`
- Ordinary implementation-to-review, review-to-remediation, QA-to-finalization, or final handoff states.

Agents must handle these by completing the current slice with structured metadata, promoting or creating the next specialist task, or performing the expected follow-up within the assigned role. Do not ask the user to unblock routine review, QA, approval-for-QA, or finalization flow.

## `RECOVERY_STALL`

`RECOVERY_STALL` cases are recoverable board, task-shape, or session conditions. They must not be surfaced as user blockers unless recovery proves impossible and the case becomes `REAL_BLOCKED` under the definition above.

Common recovery-stall examples and expected actions:

| Case | Expected agent action |
| --- | --- |
| Malformed or empty task | Inspect parent handoffs/comments; recover a concrete scope when possible; otherwise archive or ask the orchestrator to replace it with a well-scoped task. |
| Test artifact or accidental card | Archive it or comment with the cleanup reason; do not ask the user to decide. |
| Stale claim or abandoned session | Reclaim/retry through the board, summarize prior attempt evidence, and continue or reassign. |
| Missing dependency promotion | Promote or link the dependency correctly, or create the missing parent/child task with explicit acceptance criteria. |
| Recoverable worker/session failure | Retry with a smaller scope, rerun failed checks, or reassign to the appropriate specialist with the failure evidence. |
| No-scope task | Close as no-op with evidence, archive, or decompose into a concrete follow-up if the parent handoff makes the intended scope clear. |

Use durable comments for recovery rationale when another agent may need the evidence.

## Orchestrator escalation rule

Orchestrators escalate to the user only for `REAL_BLOCKED` cases. For `ROUTINE_HANDOFF` and `RECOVERY_STALL`, orchestrators should recover the board state themselves: complete/promote tasks, create specialist follow-ups, unblock recoverable stale work, reassign to the right profile, archive no-op/test artifacts, or decompose vague recoverable work into concrete cards.

## Role-specific expectations

- planner-a: produce scoped handoffs with acceptance criteria, explicit non-goals, risk tier, and verification. Treat missing routine downstream tasks as a decomposition issue to fix, not a user blocker.
- dev-a: implement only the scoped slice, preserve doc/code boundaries, run proportionate checks, and complete with `handoff_state: READY_FOR_REVIEW` when review is the next gate.
- review-a: classify findings as blocking or non-blocking, create or request remediation for blocking findings, and complete routine review handoffs without asking the user to advance them.
- qa-a: verify the stated acceptance criteria and safety guardrails, record evidence, and complete or create concrete remediation cards instead of blocking on routine QA outcomes.
- orch-a: keep the board flowing by promoting, recovering, archiving, reassigning, or decomposing tasks. Escalate only when a true external decision/input is required.

## WAKA guardrails remain in force

This workflow policy does not override repository or product safety rules. Team A agents must still preserve WAKA product direction and repository guardrails when working on product slices.

This policy also does not authorize product code changes, deployment, protected-branch pushes, production data access, secret exposure, destructive operations, or external contact. Those remain `REAL_BLOCKED` unless the task already includes explicit approval and safe execution criteria.
