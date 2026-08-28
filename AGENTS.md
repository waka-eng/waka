# WAKA Agent Notes

## The model

WAKA is a memory system built in three layers. Every layer is owned by a
**profile**, and the whole vocabulary is defined in
[`docs/data-model.md`](docs/data-model.md) — that document is the source of
truth, and this section is its summary.

- **account** — the auth identity: one login, one person. Owns profiles, owns
  no memory of its own.
- **profile** — the unit that owns memory. Each account has one **human**
  profile and any number of **agent** profiles. An agent's observations live in
  the agent's own stack, not as a filter over the person's.
- **inspiration** (layer 1) — a raw capture: text, a link, an image. Editable,
  deletable, and never distilled in place. Never leaves its account.
- **signal** (layer 2) — an evidence-backed pattern WAKA derives, citing
  inspirations as evidence (M:N). The **only** thing that can be shared to a
  group; a share exposes the statement, never the evidence.
- **top of mind** (layer 3) — one versioned artifact per profile and per group,
  made of typed entries that cite signals.
- **feedback** — a reader's verdict on a signal or an entry. Pin, dismiss, and
  lock are *not* feedback; they are columns on the entry.

Naming follows [`GLOSSARY.md`](GLOSSARY.md): data/API identifiers stay
infrastructure English (no metaphors in the schema), UI strings speak the
world's language with a plain-line explanation, and a metaphor must exist
in the glossary's table before it is used.

Two rules that decide most arguments:

1. **Human edits lock.** A locked signal statement or top-of-mind entry is
   never rewritten by regeneration. Evidence and confidence keep accruing; the
   words are the person's.
2. **One name per concept.** No table has two identifiers, and no alias is
   re-exported for convenience. A concept that needs a new word gets added to
   the canon first.

## How work is chosen

Work comes from **goals** in [`docs/goals/`](docs/goals/), run by
[`.claude/commands/goal.md`](.claude/commands/goal.md).
[`docs/goals/README.md`](docs/goals/README.md) sorts all 28 by status — which
are in flight, which are finished records, which were superseded. Read that
before picking one up; a gate keeps it complete.

A goal is not a task list. It is a body of work with **gates** — points where a
measurement decides whether the next phase is worth doing, or whether the
honest answer is to stop. Halting at a gate with a recorded number is a
success. Sailing past one because continuing was easier is a failure, however
much code it produced.

`progress.txt` is append-only memory across sessions; the goal command writes
to it when a goal completes.

## Verification

Prefer targeted checks:

- API/schema: `pnpm --filter @waka/api typecheck`
- API tests: `pnpm --filter @waka/api test:unit` — no database, ~1s. Add a
  single file with
  `pnpm --filter @waka/api exec vitest run --config vitest.unit.config.ts <path>`.
- Web: `pnpm --filter @waka/web typecheck`, `test`, `build`
- Admin: `pnpm typecheck:admin`
- Migrations: `pnpm db:check`
- Local stack: `pnpm dev:local` (API + web on http://localhost:3010)

> `pnpm --filter @waka/api test` runs the full suite, which needs a live
> Postgres. `test:unit` is the one to reach for by default — it globs
> `src/**/*.test.ts` and `test/**/*.test.ts`, so a new test file runs without
> being registered anywhere.

### End-to-end

`tools/e2e/` holds the scenarios that prove the layers work against a running
stack. They need `pnpm dev:local` up, and the enrichment steps need the
fixture host allowlisted:

```bash
WAKA_ENRICHMENT_ALLOWED_HOSTS="127.0.0.1:8791,localhost:8791" pnpm dev:local
pnpm tsx tools/e2e/organic.ts --fixture-port 8791   # layer 1 + enrichment
pnpm tsx tools/e2e/signals.ts                       # layer 2
pnpm tsx tools/e2e/top-of-mind.ts                   # layer 3
pnpm tsx tools/e2e/groups.ts                        # sharing boundaries
```

`tools/e2e/fixture-server.ts` serves a page whose salient sentence exists only
in its body and an image containing legible text, so enrichment is tested
against known content rather than the live internet.

These scenarios cost model calls (extraction, embedding, synthesis, vision).
A full pass of all four is well under a dollar.

## Things that will bite you

- **Attachment enrichment refuses private addresses.** That is deliberate —
  the fetcher follows user-supplied URLs from inside the network. Loopback
  fixtures need `WAKA_ENRICHMENT_ALLOWED_HOSTS`, which is empty by default and
  set by nothing in the deployed configuration.
- **`.env.development` and `.env.production` point at the same Neon database.**
  Local work uses `.env.local`, which points at local Postgres.
- **Composite foreign keys carry the tenant.** Child rows reference
  `(profile_id, parent_id)`, so a cross-profile link is refused by Postgres
  rather than by a query someone remembered to scope.
