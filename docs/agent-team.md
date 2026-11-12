# Engineering coordination

The owner approved an ongoing Main + Dev team on 2026-11-08. This is a workspace
engineering arrangement, separate from WAKA's one in-app companion. Human
contributors can use the same ownership and review boundaries without Paseo.

| Role | Responsibility | Ownership |
| --- | --- | --- |
| Main | Clarify owner intent, prioritize scoped work, coordinate dependencies, review evidence and communicate outcomes. | Team instructions and optional local assignment/session state. |
| Dev | Investigate, implement, verify and document assigned engineering work; report failures and limits. | Assigned source, schema, assets, tooling, deployment configuration and technical docs. |

Reuse established sessions when available. Optional local routing information can
live in `.paseo/team-session.json` and `.paseo/team-queue.md`; both are ignored.
They are not prerequisites for a clean clone. When absent, use the coordinator's
assignment and supplied session context. Never infer identities from display
names, publish runtime IDs or credentials, or create replacement agents merely
because local state is missing. Do not create extra agents or recurring wakeups
without explicit owner authorization.

Use one writer per file. Main delegates concrete scope and acceptance checks;
Dev carries authorized work through verification and sends a reviewable result.
Report actual measurements, changed files, failed gates, recovery and remaining
limits. Ask only when a material ambiguity cannot be resolved within the
assignment; routine reversible choices do not need repeated owner approval.
External messages and deployment still require applicable authorization.

## Delivery policy

Create scoped branches from `origin/dev` and open pull requests targeting `dev`.
Required checks and Main's source/merge review must pass before merging. A dev
merge triggers the existing development deployment; a PR branch push does not.
Do not publish or merge to `main`, synchronize main with dev, or deploy production
without a **new explicit owner instruction**. Historical release/sync approvals
do not authorize later work. Keep main unchanged during ordinary dev delivery.

Work in the designated clean checkout. Preserve unrelated dirty work and private
files; do not blanket-stage another contributor's files or revive older source
from a preserved snapshot. A portable handoff belongs in tracked documentation;
raw session state, credentials, backups, captured content and scratch logs do not.
Promote sanitized evidence summaries and durable artifact links instead.

Read [the goal index](goals/README.md) and the selected goal's own Status/gates.
Native capture and later UX remain owner-paused; measured halts are not queues to
resume. Do not mark a human, provider, deployment or operational gate passed from
unit tests or source review alone. Verify actual DB identity before mutations;
mutable tests use fresh explicit disposable loopback databases.

See the [accepted release handoff](reviews/production-deploy-receipt-2026-11-11.md)
and [current real-user launch checklist](reviews/production-launch-2026-11-11.md).
Those distinguish a successful deployment from full launch readiness. `main` pushes
trigger production CI/deployment; `dev` pushes trigger their independent stage
pipeline. Keep each checked/deployed immutable SHA intact, and account for those
side effects before publishing docs or static assets too.
