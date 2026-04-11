# Waka

A capture-first inspiration engine that saves fleeting thoughts from any surface and uses AI to organize them into a semantic knowledge graph.

## What it does

1. **Capture instantly** — text, voice, photos, URLs, AI conversation links. Offline-capable PWA with optimistic UI.
2. **Enrich asynchronously** — generates embeddings, titles, summaries, tags, and classifications via OpenAI/Gemini.
3. **Cluster & connect** — DBSCAN groups related ideas; cosine similarity surfaces surprising connections.
4. **Reflect adaptively** — AI prompts contextual follow-up questions (never blocking capture).
5. **Share selectively** — public card links with dynamic OG images.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, Tailwind CSS v4, PWA (Serwist) |
| Backend | Next.js API routes on AWS Lambda |
| Database | Neon Postgres, Prisma, pgvector (1536-dim embeddings) |
| Auth | Auth.js v5 + Google OAuth |
| AI/LLM | OpenAI embeddings, pluggable text models (OpenAI / Gemini) |
| Async jobs | AWS SQS → Lambda enrichment pipeline |
| Media storage | AWS S3 (voice recordings, photos) |
| Infrastructure | SST Ion (Lambda, S3, SQS, CloudFront) |
| Monorepo | pnpm workspaces + Turborepo |

## Repo structure

```
apps/web/          Next.js web app (capture UI, API routes, PWA)
apps/cli/          CLI tool (save, list, deepen, auth)
packages/shared/   Types, Zod schemas, LLM provider adapters
prisma/            Database schema and migrations
infra/             SST stacks (S3, SQS, Lambda, CloudFront)
scripts/           Dev, build, and verification scripts
tests/             Test suite
```

## Prerequisites

- Node.js 20+
- pnpm 10.30+
- AWS credentials configured (for SST)
- Neon Postgres database with pgvector enabled
- Google OAuth client ID/secret
- OpenAI API key (required for embeddings)

## Getting started

```bash
# Install dependencies
pnpm install

# Start the full dev environment (SST + web)
pnpm dev

# Or run just the web app
pnpm dev:web
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start SST dev environment |
| `pnpm dev:web` | Start only the Next.js web app |
| `pnpm build` | Build the web app |
| `pnpm test` | Run tests (skips typecheck) |
| `pnpm verify` | Run full verification (tests + typecheck) |
| `pnpm typecheck` | TypeScript type checking |

## How it works

```
User captures a thought
  → POST /api/inspirations
  → Saved to DB immediately (< 500ms)
  → SQS job enqueued for async enrichment
  → Lambda pipeline: summarize → embed → classify → find connections → cluster
  → Frontend polls until enrichment completes
```

Clustering runs after every 5th new inspiration using DBSCAN on vector embeddings. Connections between inspirations are surfaced when cosine similarity exceeds 0.78.

## CLI

```bash
# Authenticate
npx waka-cli auth

# Save a thought
npx waka-cli save "an interesting idea"

# Save from stdin
echo "piped thought" | npx waka-cli save

# List recent inspirations
npx waka-cli list

# Deepen an existing inspiration
npx waka-cli deepen <id>
```
