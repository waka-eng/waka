# WAKA

WAKA is a memory system. You save what moved you; WAKA works out what those
saves have in common, and keeps one short account of what currently matters to
you. Agents can do the same thing alongside you, into a memory of their own.

It is built in three layers, each owned by a **profile**:

1. **Inspiration** — a raw capture. Text, a link, an image. Never leaves your
   account.
2. **Signal** — an evidence-backed pattern WAKA derives from your captures. The
   only thing that can be shared to a group, and it shares the statement, never
   the evidence behind it.
3. **Top of mind** — one versioned artifact per profile, made of entries that
   cite signals.

An account has one **human** profile and any number of **agent** profiles. An
agent using WAKA as its own memory works in its own stack rather than as a
filter over yours.

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

## The stack

| Layer | Tech |
| --- | --- |
| Frontend | Vite + React 18 + React Router (SST `StaticSite`) |
| API | Hono on an AWS Lambda Function URL (SST `Function`) |
| Async work | Postgres `background_jobs`, drained by a cron and an in-process tick |
| Generation | Gemini — extraction, embeddings, synthesis, image description |
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
- A **Gemini API key** from <https://aistudio.google.com/app/apikey>.
- For deploys only: an **AWS account** (region `us-west-2`, matching
  `sst.config.ts`) and a **Google OAuth** client — see
  [`docs/google-oauth-setup.md`](docs/google-oauth-setup.md).

### Environment

Development reads `.env.local`. The variables that matter:

| Variable | Used by | Notes |
| --- | --- | --- |
| `DB_CONNECTION_URL` | API, worker, `drizzle-kit` | `DATABASE_URL` is accepted as a fallback name. |
| `AUTH_SECRET`, `JWT_SECRET` | session signing | `openssl rand -base64 48` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | `/api/auth/google` | Redirect URI must match the running API. |
| `GEMINI_API_KEY` | generation | Never reaches the browser. |
| `ATTACHMENTS_BUCKET`, `ATTACHMENTS_REGION` | uploads | Only needed for S3-backed attachments. |
| `WAKA_ENRICHMENT_ALLOWED_HOSTS` | enrichment | Empty by default. See "Enrichment and private addresses". |

> At Lambda runtime, secrets come from SST rather than from a file. Mirror each
> one with `pnpm sst secret set <Name> "$VALUE"` — `GoogleClientId`,
> `GoogleClientSecret`, `SessionSecret`, `JwtSecret`, `DbConnectionUrl`,
> `GeminiApiKey`.

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
pnpm --filter @waka/api typecheck
pnpm --filter @waka/api test:unit     # no database, ~1s
pnpm --filter @waka/web typecheck && pnpm --filter @waka/web test && pnpm --filter @waka/web build
pnpm typecheck:admin
pnpm db:check
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
