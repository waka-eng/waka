# WAKA

WAKA is a memory system. You save what moved you; WAKA works out what those
saves have in common, and keeps one short account of what currently matters to
you. Agents can do the same thing alongside you, into a memory of their own.

It is built in four layers, each owned by a **profile**:

1. **Inspiration** — a raw capture. Text, a link, an image. Never leaves your
   account.
2. **Signal** — an evidence-backed pattern WAKA derives from your captures. The
   only thing that can be shared to a group, and it shares the statement, never
   the evidence behind it.
3. **Top of mind** — one versioned artifact per profile, made of entries that
   cite signals.
4. **Principle** — how the profile chooses, stripped of context: a growing,
   ranked set of durable directives, minted nightly from what keeps surviving
   the layers below — or declared in the owner's own words. Served to agents
   as one canonical markdown document (`GET /api/principles.md`).

An account has one **human** profile and any number of **agent** profiles. An
agent using WAKA as its own memory works in its own stack rather than as a
filter over yours.

## Finding your way in

| Doc | What it owns |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | **Where things live** — the three layers as the three sections of the world, one column per mind, and the four seams that carry the coupling. Read it before `Home.tsx`; that file assumes this map. |
| [`docs/codebase.md`](docs/codebase.md) | **How the codebase is organised, and the plan for making it easier to build on.** Read it before a change that spans more than one file. |
| [`docs/goals/README.md`](docs/goals/README.md) | **What is being built, and what already was.** 28 goal documents sorted by status — start here rather than in the directory, where finished work and work in flight look alike. |

## Naming

[`GLOSSARY.md`](GLOSSARY.md) — one skeleton, three dialects. Every name
crosses one of three dialects (data/API infrastructure English, the world's
UI language with its plain-line explanations, sales/docs English), and the
glossary's translation table is where a metaphor must exist before it may
be used. The product speaks English only (founder ruling, 2026-08-22).
`docs/data-model.md` stays the schema's truth; the glossary is the dialect
boundary's.

## The two canonical docs

| Doc | What it owns |
| --- | --- |
| [`docs/data-model.md`](docs/data-model.md) | The **vocabulary and structure** — what the layers are, who owns what, the access matrix. Read it before changing anything that stores or names data. |
| [`docs/generation.md`](docs/generation.md) | The **mechanics** — the life of an inspiration, how signals are derived (extraction, match-or-mint, confidence, promotion, lifecycle), how the top of mind is synthesized (selection, scoring, time decay, validation, versioning), and every tuning constant with its value. Read it before changing generation logic. |

`docs/generation.md` cannot silently drift from the code:
`packages/api/src/lib/generation-doc.test.ts` runs in the normal unit suite
and fails CI if any documented constant, cited file path, checked structural
claim, or this very README link disagrees with the implementation. When you
add or change generation logic, change the doc in the same diff — the build
holds you to the numbers, reviewers hold you to the prose.

## What becomes a principle

The five qualification tests, in simple words — the enforced mechanics and
the authoritative bars live in [`docs/generation.md`](docs/generation.md):

1. **Context** — it still makes sense after every name, number, and project
   in it is deleted. "Keep budgets under $100 for LLM testing" dies without
   its specifics — that is a rule, and it is kept as evidence. "Have
   something working before spending more" survives the deletion.
2. **Directive** — it tells you what to *do* next, not what you are *like*.
   "I prefer small tools" describes you — that is a signal. "Choose the
   small tool over the platform" points at the next decision.
3. **Evidence** — your own history backs it, in at least three distinct
   signals. A value nobody has ever seen you live is a horoscope.
4. **Support** — the citing theme appears in at least one meaningful version
   of your top of mind. There is no fixed calendar wait for an initial
   principle; repeated choices across contexts can qualify, while a burst of
   saved quotes or temporary intentions does not establish a lasting guide.
5. **Completion** — it can never be finished. "Ship the museum app by June"
   can someday be checked off — that is a goal. A principle keeps applying
   to every choice after this one.

Minting runs in the background when material changes, with a nightly recovery
pass at 08:00 UTC. It enforces all five, with support computed over the union
of the citing signals. Declaring one yourself skips evidence and support —
your word stands immediately, marked *aspirational*
until your history demonstrates it — but context, directive, and completion
still apply, silently: a declaration that fails them is kept with your
inspirations, and no refusal is ever shown.

## The stack

| Layer | Tech |
| --- | --- |
| Frontend | Vite + React 18 + React Router (SST `StaticSite`) |
| API | Hono on an AWS Lambda Function URL (SST `Function`) |
| Async work | Postgres `background_jobs`, drained by a cron and an in-process tick |
| Generation | OpenRouter (DeepSeek V4.1 Flash, pinned) — extraction, judges, synthesis and chat; Gemini — embeddings, image description, audio transcription, and the fallback road |
| Storage | S3, presigned PUT only (SST `Bucket`) |
| Database | Neon Postgres via Drizzle ORM (not provisioned by SST) |
| Auth | Email + password, Google OAuth, and a loopback flow for CLI/MCP clients |

Packages: `packages/api` (Hono + schema + generation), `packages/web` (the
single surface), `packages/admin` (a small, undeployed queue inspector).

---

## Getting it running

### Prerequisites

- **Node** 20+ and **pnpm** 9+ (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- **Postgres**. Local is the default for development; `.env.local` points at it.
- A **Gemini API key** from <https://aistudio.google.com/app/apikey>
  (embeddings and image description always run here).
- An **OpenRouter API key** from <https://openrouter.ai/keys> — the
  generation road; without it everything falls back to Gemini.
- For deploys only: an **AWS account** (region `us-west-2`, matching
  `sst.config.ts`) and a **Google OAuth** client — see
  [`docs/google-oauth-setup.md`](docs/google-oauth-setup.md).

### Environment

Development reads `.env.local`. Start it from the template:

```bash
cp .env.example .env.local
```

That one file is what `pnpm dev:local` reads, and what `pnpm demo:seed` reads
first. `pnpm dev:local` only *warns* when it is missing and starts anyway —
which is right for CI, where the variables are exported inline, and is why a
missing file shows up later as a database error rather than as a missing file.

> `drizzle-kit` reads `.env.local` too, and prefers it — `drizzle.config.ts`
> loads it *over* `.env` unless you chose a URL deliberately, so
> `pnpm db:migrate` and `pnpm db:studio` work from the one file as well. A
> repo-root `.env` is only for `pnpm sst secret set` and other one-off
> operator commands; local development needs nothing in it.

The variables that matter:

| Variable | Used by | Notes |
| --- | --- | --- |
| `DB_CONNECTION_URL` | API, worker, `drizzle-kit` | `DATABASE_URL` is accepted as a fallback name. |
| `AUTH_SECRET`, `JWT_SECRET` | session signing | `openssl rand -base64 48` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | `/api/auth/google` | Redirect URI must match the running API. |
| `GEMINI_API_KEY` | embeddings, vision, fallback generation | Never reaches the browser. |
| `OPENROUTER_API_KEY` | generation (DeepSeek V4 Flash) | Never reaches the browser. |
| `ATTACHMENTS_BUCKET`, `ATTACHMENTS_REGION` | uploads | Only needed for S3-backed attachments. |
| `WAKA_ENRICHMENT_ALLOWED_HOSTS` | enrichment | Empty by default. See "Enrichment and private addresses". |

> At Lambda runtime, secrets come from SST rather than from a file. Mirror each
> one with `pnpm sst secret set <Name> "$VALUE"` — `GoogleClientId`,
> `GoogleClientSecret`, `SessionSecret`, `JwtSecret`, `DbConnectionUrl`,
> `GeminiApiKey`.

### A database

Any Postgres 16 will do — nothing here needs an extension. Embeddings are
`jsonb` and cosine similarity is computed in application code, which
`packages/api/src/db/schema-embeddings.ts` explains and no migration
contradicts. There is a compose file so you do not have to think about it:

```bash
docker compose up -d --wait
```

`--wait` matters on a cold start: without it the command returns while initdb
is still running, and the next thing you type is refused.

The URL it serves is already the default in `.env.example`, so a
`cp .env.example .env.local` needs no edit:

```
DB_CONNECTION_URL=postgres://waka:waka@127.0.0.1:5432/waka
```

**If you want to run the full API suite** (`pnpm --filter @waka/api test`,
the database-backed one CI gates on), add its database once:

```bash
psql postgres://waka:waka@127.0.0.1:5432/waka -c 'CREATE DATABASE waka_test;'
```

That suite refuses any target whose name does not contain `test`
(`packages/api/test/setup.ts`) — a guard against pointing it at a database
someone cares about, since it migrates and truncates what it is given. Point
`DB_CONNECTION_URL` at `.../waka_test` for that run only; `pnpm test` and
everything above need none of this.

### Install and migrate

```bash
pnpm install
pnpm db:migrate
```

The schema is a single baseline migration. `pnpm db:studio` opens a browser
view of it; you should see `accounts`, `profiles`, `inspirations`, `signals`,
`signal_evidence`, `top_of_minds`, `top_of_mind_entries`, and the rest.

### Run it

```bash
pnpm dev:local
```

One process serves the API and the built web app on <http://localhost:3010>.
It is not a hot-reload setup — it builds the client once, then serves it. Use
`pnpm dev` (SST) when you want a sandbox stack in AWS instead.

Seed a realistic account to look at:

```bash
pnpm demo:seed -- --email=demo@example.test --create-user --password='local-only-demo-password'
```

The seeder refuses non-local database hosts unless you pass `--allow-remote`,
and never prints secrets.

---

## Verifying

```bash
pnpm test        # all three packages: typecheck, unit tests, web build
```

Everything it runs works on a bare checkout with no database. The pieces, when
you want one of them on its own:

```bash
pnpm typecheck                        # all three packages
pnpm --filter @waka/api test:unit     # no database, ~1s
pnpm --filter @waka/web test
pnpm --filter @waka/web build
pnpm db:check                         # migrations; needs DB_CONNECTION_URL
```

`test:unit` globs every test file, so a new one runs without being registered
anywhere.

### End to end

`tools/e2e/` proves the layers work against a running stack. The enrichment
steps use a local fixture server rather than the live internet, so they need
its host allowlisted:

```bash
WAKA_ENRICHMENT_ALLOWED_HOSTS="127.0.0.1:8791,localhost:8791" pnpm dev:local

pnpm tsx tools/e2e/organic.ts --fixture-port 8791   # capture, search, enrichment
pnpm tsx tools/e2e/signals.ts                       # derivation, locking, cascade
pnpm tsx tools/e2e/top-of-mind.ts                   # synthesis, versions, citations
pnpm tsx tools/e2e/groups.ts                        # sharing, and what must not cross
```

Each prints a numbered PASS/FAIL line per step and exits non-zero on failure.
They spend model calls; a full pass of all four is well under a dollar.

---

## Things worth knowing

**Enrichment and private addresses.** A saved link is fetched server-side to
read its page body, and a saved image is described so its text is searchable.
That fetcher follows user-supplied URLs from inside the network, so it refuses
private and loopback ranges outright, re-checking after every redirect. Test
fixtures on loopback need `WAKA_ENRICHMENT_ALLOWED_HOSTS`, which names hosts
explicitly, is empty by default, and is set by nothing in the deployed
configuration.

**Tenancy is enforced by the database.** Child rows carry composite
`(profile_id, parent_id)` foreign keys, so a row belonging to one profile
cannot reference a parent in another — it is refused by Postgres rather than by
a query someone remembered to scope.

**Connecting a terminal.** A CLI or MCP client logs in through
`/api/auth/cli/start`, which renders a consent page with a profile picker. The
credential it mints binds to the profile chosen there and is revocable without
touching the browser session. The client side lives in the companion
`waka-mcp` repository.

**Internal queue inspector.** `packages/admin` is a small undeployed app for
watching background jobs. It needs the API gate enabled:

```bash
WAKA_ENABLE_BACKGROUND_JOBS_ADMIN=true pnpm dev:local   # terminal A
pnpm dev:admin                                          # terminal B, port 5174
```

Sign into WAKA normally first so the admin app can send the session cookie.
