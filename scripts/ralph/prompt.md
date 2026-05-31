# Ralph Agent Instructions

You are Codex, an autonomous coding agent working on WAKA.

## Your Task

1. Read the PRD at `prd.json` from the repository root.
2. Read the progress log at `progress.txt`; check `## Codebase Patterns` first.
3. Check you are on the correct branch from PRD `branchName`. If not, check it out or create it from the current base branch.
4. Pick the highest-priority user story where `passes: false`.
5. Implement that single user story only.
6. Run the story's acceptance checks plus the smallest relevant quality checks.
7. Update `AGENTS.md` files only if you discover durable, reusable codebase patterns.
8. If checks pass, commit all story changes with message: `feat: [Story ID] - [Story Title]`.
9. Update `prd.json` to set `passes: true` for the completed story.
10. Append your progress to `progress.txt`.

## WAKA Quality Checks

Use targeted checks for each story. Prefer the narrowest commands that prove the story:

- API/schema stories: `pnpm --filter @waka/api typecheck` and targeted `pnpm --filter @waka/api test -- <test-file-or-pattern>` when applicable.
- Web/UI stories: `pnpm --filter @waka/web typecheck`, targeted `pnpm --filter @waka/web test -- <test-file-or-pattern>`, and browser verification if the UI changes.
- Cross-cutting stories: run both API and web typechecks, then targeted tests.
- Migration stories: include `pnpm db:check` when migration metadata changes.

Do not mark a frontend story complete without browser verification. If browser tools are unavailable, write that gap clearly in `progress.txt`.

## Progress Report Format

Append to `progress.txt`; never replace the file:

```md
## [Date/Time] - [Story ID]

- What was implemented
- Files changed
- Verification run
- Learnings for future iterations:
  - Patterns discovered
  - Gotchas encountered
  - Useful context

---
```

## Consolidate Patterns

If you discover a reusable pattern future iterations should know, add it to the `## Codebase Patterns` section at the top of `progress.txt`.

Good examples:

- Drizzle schema exports must also be re-exported from `packages/api/src/db/index.ts`.
- Web API response types live in `packages/web/src/lib/api.ts` and need to stay in sync with route serializers.
- Local same-origin demo uses `pnpm dev:local`, not Vite HMR.

Do not add story-specific implementation notes to Codebase Patterns.

## Product Direction

WAKA is becoming an ambition mirror powered by a personal context graph.

Product language:

- captured item: signal
- distilled per-signal interpretation: signal packet
- durable graph claim: context node
- graph relationship: context edge
- evidence link: context evidence
- temporary post-it reflection: top-of-mind note
- user correction/validation: feedback

Keep the post-it metaphor. Top-of-mind notes should feel provisional, replaceable, and evidence-backed.

Top-of-mind notes must help the user infer ambition and internal frequency. They should point toward desired environments, people, work, taste, standards, rejected contexts, or emerging self-image. They should not read like saved-content summaries, raw context-node labels, tags, or shallow wrappers such as `You keep circling X`.

The admin graph inspector remains internal. Do not make a literal graph the main user-facing UX.

When a story changes a user-facing workflow, verify the exact path the user will use in the product. Do not satisfy an acceptance criterion by only adding an isolated route, hidden surface, or backend helper if the current primary UI still shows the old experience.

## Stop Condition

After completing one user story, check if all stories have `passes: true`. If all stories are complete and passing, reply with:

`COMPLETE`

If any stories remain, end normally so the next Ralph iteration can continue.

## Important

- Work on one story per iteration.
- Keep changes focused.
- Do not commit broken code.
- Preserve user changes you did not make.
- Read existing code patterns before editing.
