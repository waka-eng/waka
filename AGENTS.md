# WAKA Agent Notes

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

## Ralph

This repo uses the `snarktank/ralph` loop format, with a local `codex` tool mode added:

- `prd.json` is the source of story state.
- `progress.txt` is append-only memory between iterations.
- `scripts/ralph/ralph.sh` runs one fresh AI instance per iteration.
- Each iteration should complete exactly one highest-priority story with `passes: false`.

Run with:

```bash
./scripts/ralph/ralph.sh --tool codex 10
```

or:

```bash
./scripts/ralph/ralph.sh --tool claude 10
```

## Verification

Prefer targeted checks:

- API/schema: `pnpm --filter @waka/api typecheck`
- API tests: `pnpm --filter @waka/api test -- <pattern>`
- Web: `pnpm --filter @waka/web typecheck`
- Web tests: `pnpm --filter @waka/web test -- <pattern>`
- Local demo: `pnpm dev:local`

Frontend stories require browser verification before they are marked complete.
