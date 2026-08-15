# WAKA Agent Notes

> **The three-layers rebuild is in progress.** The vocabulary of record is
> [`docs/data-model.md`](docs/data-model.md), which **supersedes the Product
> Direction vocabulary below** — read the canon first. In short: an
> *inspiration* is the raw capture (what the `signals` table holds today), a
> *signal* is a WAKA-derived evidence-backed pattern, and a *top of mind* is
> one versioned artifact per profile. Sparks, WOW vocabulary, lens boards, and
> the context-edge graph are being removed. The rebuild is
> [`docs/goals/three-layers.md`](docs/goals/three-layers.md); this banner and
> the section below are rewritten at its Phase 8.

## Product Direction

WAKA is pivoting from an inspirations capture app into an ambition mirror powered by a personal context graph.

Use this product vocabulary for new code:

- `signal`: a captured item or high-intent personal context event
- `signal_packet`: a compact interpretation of one signal
- `context_node`: a durable graph claim about themes, values, people, environments, aesthetics, tensions, projects, open questions, or hypotheses
- `context_edge`: a relationship between context nodes
- `context_evidence`: provenance linking graph claims back to signals
- `top_of_mind_note`: a temporary post-it-style reflection generated from graph context
- `feedback`: user validation or correction that improves future graph state

The post-it metaphor is important: top-of-mind notes should feel provisional, replaceable, and easy to correct.

## How work is chosen

Work comes from **goals** in [`docs/goals/`](docs/goals/), run by
[`.claude/commands/goal.md`](.claude/commands/goal.md).

A goal is not a task list. It is a body of work with **gates** — points where a
measurement decides whether the next phase is worth doing, or whether the
honest answer is to stop. Halting at a gate with a recorded number is a
success. Sailing past one because continuing was easier is a failure, however
much code it produced.

`progress.txt` is append-only memory across sessions; the goal command writes
to it when a goal completes.

> The `snarktank/ralph` loop that preceded this is retired and lives in
> [`docs/archive/ralph/`](docs/archive/ralph/). **`prd.json` is not a queue.**
> Its two remaining `passes: false` stories shipped months ago, so treating it
> as state means re-implementing working features. See that directory's README.

## Verification

Prefer targeted checks:

- API/schema: `pnpm --filter @waka/api typecheck`
- API tests: `pnpm --filter @waka/api test:unit` — 46 files, ~4s, no database.
  Add a single file with
  `pnpm --filter @waka/api exec vitest run --config vitest.unit.config.ts <path>`.
- Web: `pnpm --filter @waka/web typecheck`
- Web tests: `pnpm --filter @waka/web test`
- Web bundle: `pnpm --filter @waka/web build`
- Local demo: `pnpm dev:local`

> `pnpm --filter @waka/api test` runs the full suite, which needs a live
> Postgres and exits non-zero without one. `test:unit` is the one to reach for
> by default.
>
> `vitest.unit.config.ts` is a hand-maintained **allowlist** of file paths. A
> new test file does not run until it is added there — a test that never runs
> looks exactly like a test that passes.

Frontend stories require browser verification before they are marked complete.
Note that the harnesses in `tools/e2e/` predate the one-surface rewrite and no
longer get past their first post-login selector, so this currently means
verifying by hand.
