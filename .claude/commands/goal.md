---
description: Drive a goal in docs/goals/ to completion, phase by phase, halting at its gates.
argument-hint: <goal-name> [--phase N] [--dry-run]
---

# Run a goal

Work the goal named `$ARGUMENTS` from `docs/goals/<goal-name>.md` to completion.

A goal is not a task list. It is a body of work with **gates** — points where a
measurement decides whether the next phase is worth doing, or whether the honest
answer is to stop. Your job is to work the phases in order and to **respect the
gates even when that means stopping with the goal unfinished**. A goal that
halts at a gate with a recorded number is a success. A goal that sails past one
because continuing was easier is a failure, however much code it produced.

## Before starting

1. Read `docs/goals/<goal-name>.md` in full. If it does not exist, stop and say
   so — do not invent the goal from the name.
2. Read `AGENTS.md` for the repo's verification conventions.
3. Check the branch named in the goal's header. Create it from `dev` if absent.
4. If the goal has a **Budget** section, check the running total recorded in the
   goal doc before spending more.

## Working a phase

For each phase, in the order written:

1. **Say which phase you are starting and what would make it fail.** Name the
   gate before doing the work, so the gate is not rationalised afterwards.
2. Do the work. Prefer the narrowest change that satisfies the phase.
3. Run the phase's own checks, plus the targeted repo checks from `AGENTS.md`:
   - API/schema: `pnpm --filter @waka/api typecheck`, then targeted tests
   - Web/UI: `pnpm --filter @waka/web typecheck`, then targeted tests
   - Migrations: `pnpm db:check`
   - Anything touching the judge or retrieval: the goal's own eval command
4. **Record the measurement in the goal doc** under `## Log`, with the date, the
   phase, and the actual numbers — not a summary of them. The numbers are what
   the next gate is judged against, and a number nobody wrote down is a number
   nobody can check.
5. Commit with the phase in the subject. Do not batch phases into one commit.

## At a gate

State the criterion, the measured value, and the verdict, in that order.

- **Pass** — continue to the next phase.
- **Fail** — stop. Write the result in the goal's `## Log`, set the status in the
  header, and report what you found and what you would do instead. Do not
  continue to the next phase. Do not soften the criterion so it passes.
- **Marginal** — treat as a fail. These evals are small-n; a result inside the
  noise is not a result. Say so plainly rather than shipping a coin flip.

## Rules that hold throughout

- **Never edit the acceptance criteria to fit the outcome.** If a criterion turns
  out to be wrong, stop and say why it is wrong. Changing the bar mid-run
  destroys the only thing the measurement was for.
- **Baseline before change.** If a phase compares against a baseline, that
  baseline must be measured in this run, not remembered from an earlier one.
- **Delete the losing branches.** Options added to compare variants are
  scaffolding. When a winner is chosen, the alternatives come out — an
  experiment left in as permanent configuration is the experiment failing
  slowly.
- **Spending money is a checkpoint.** Before any phase that costs API calls,
  state the expected count and cost. If a phase overruns its estimate by more
  than double, stop and report rather than continuing.
- **Report failures with their output.** If a check fails, show it. Do not
  describe it.

## Finishing

When every phase has passed:

1. Set `Status:` in the goal header to `done (<date>)`.
2. Append the final numbers to `## Log`.
3. Append a line to `progress.txt` following the existing format.
4. Summarise: what changed, what the numbers were before and after, what was
   deleted, and anything you could not verify.

## Flags

- `--phase N` — start at phase N, assuming earlier phases already passed. Say
  that you are skipping their gates.
- `--dry-run` — read the goal, print the phases, gates, and expected cost, and
  stop without changing anything or spending anything.
