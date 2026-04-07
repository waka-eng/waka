# Waka — Inspiration & Context Engine: Technical Specification

> **Purpose**: This document serves as the authoritative input for ralph execution loops.
> Each section defines a self-contained loop with clear scope, acceptance criteria, and test plans.

---

## 1. Product Summary

Waka is a ubiquitous capture and synthesis engine. It ingests inspirations from any surface (terminal CLI, mobile PWA, URL import), semantically clusters them over time, and resurfaces surprising connections between thoughts — transforming fleeting ideas into a persistent, evolving personal knowledge graph.

### V1 Scope (This Spec)

| In Scope | Out of Scope (Future) |
|---|---|
| Web app (Next.js PWA, responsive) | Social matching / 잡소리 sessions |
| CLI capture tool (terminal conversations) | OS-level cursor integration |
| URL import (fetch & save from any URL) | Environments of Ambition |
| Semantic clustering & resurfacing | Multi-provider auth (only Google for v1) |
| Adaptive reflection (LLM-based) | Real-time sync |
| Shareable inspiration cards | Native mobile apps |
| Google OAuth login | Browser extension |

### Non-Functional Requirements

- **Privacy**: All inspirations are private by default. No data shared without explicit user action.
- **Consistency**: Eventual consistency on refresh (no real-time sync required).
- **Auth extensibility**: Google OAuth v1, but auth layer must support adding providers without schema changes.

---

## 2. Technical Architecture

### Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS v4 |
| PWA | next-pwa / Serwist |
| Backend | Next.js API Routes + Server Actions |
| Database | Neon (Serverless Postgres) |
| ORM | Prisma |
| Auth | NextAuth.js v5 (Auth.js) — Google provider, extensible |
| AI/LLM | Provider-agnostic adapter (OpenAI + Google Gemini) |
| Embeddings | OpenAI `text-embedding-3-small` or Google `text-embedding-004` |
| Vector Search | pgvector extension on Neon |
| Deployment | SST (Ion) on AWS (Lambda + CloudFront) |
| CLI | Node.js CLI package (npm-installable) |

### High-Level Architecture

```
┌─────────────┐  ┌──────────────┐
│  CLI Tool    │  │  PWA / Web   │
│  (Node.js)  │  │  (Next.js)   │
└──────┬──────┘  └──────┬───────┘
       │                │
       └────────┬───────┘
                │ HTTPS
                ▼
      ┌──────────────────┐
      │  Next.js API     │
      │  (SST / Lambda)  │
      └────────┬─────────┘
               │
  ┌────────────┼────────────┐
  ▼            ▼            ▼
┌───────────┐ ┌──────────┐ ┌──────────────┐
│   Neon    │ │ pgvector │ │ LLM Adapter  │
│ (Postgres)│ │ (search) │ │ (OpenAI/     │
│           │ │          │ │  Gemini)     │
└───────────┘ └──────────┘ └──────────────┘
```

### Data Model (Core)

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  accounts      Account[] // NextAuth
  sessions      Session[] // NextAuth
  inspirations  Inspiration[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model Inspiration {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])

  // Content
  title         String?
  rawContent    String    // Original text/transcript/URL
  summary       String?   // AI-generated summary
  sourceType    SourceType
  sourceUrl     String?   // URL if web clip or AI chat link
  sourceMeta    Json?     // Flexible metadata (app name, chat title, etc.)

  // AI-generated
  embedding     Unsupported("vector(1536)")?
  tags          String[]  // AI-extracted tags
  reflectionPrompt String? // Generated reflection question
  reflectionAnswer String? // User's answer to reflection

  // Clustering
  clusterId     String?
  cluster       Cluster?  @relation(fields: [clusterId], references: [id])

  // Sharing
  isPublic      Boolean   @default(false)
  shareSlug     String?   @unique

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([userId, createdAt(sort: Desc)])
}

model Cluster {
  id            String    @id @default(cuid())
  userId        String
  label         String    // AI-generated cluster name
  description   String?   // AI-generated cluster summary
  inspirations  Inspiration[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([userId])
}

model Connection {
  id              String    @id @default(cuid())
  userId          String
  sourceId        String    // Inspiration A
  targetId        String    // Inspiration B
  similarityScore Float
  explanation     String    // AI-generated explanation of the connection
  surfacedAt      DateTime  @default(now())
  dismissed       Boolean   @default(false)

  @@unique([sourceId, targetId])
  @@index([userId, surfacedAt(sort: Desc)])
}

enum SourceType {
  CLI_CONVERSATION
  VOICE_NOTE
  TEXT_NOTE
  URL_IMPORT       // Saved from a URL (article, video, blog, etc.)
  PHOTO
  VIDEO
}
```

### LLM Adapter Interface

```typescript
interface LLMProvider {
  generateEmbedding(text: string): Promise<number[]>;
  classify(prompt: string): Promise<string>;
  summarize(content: string): Promise<string>;
  generateReflection(content: string): Promise<string>;
  explainConnection(a: string, b: string): Promise<string>;
}

// Implementations: OpenAIProvider, GeminiProvider
// Selected via environment variable: LLM_PROVIDER=openai|gemini
```

---

## 3. Ralph Execution Loops

Each loop is designed to be independently executable and verifiable. Loops are ordered by dependency — each builds on the previous.

---

### Loop 1: Project Foundation & Auth

**Goal**: Bootable Next.js app with Google OAuth, Neon database, and basic Prisma schema deployed via SST.

#### Scope

- Initialize Next.js 15 project with App Router, TypeScript, Tailwind v4
- Configure Prisma with Neon connection (connection pooling via `@neondatabase/serverless`)
- Set up Auth.js v5 with Google OAuth provider
- Implement sign-in / sign-out flow with protected route middleware
- Configure SST Ion for AWS deployment
- Create all Prisma models from Section 2
- Enable pgvector extension on Neon

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 1.1 | `npm run dev` starts without errors | Automated: `npm run dev` exits cleanly |
| 1.2 | Google OAuth sign-in redirects and creates a User record | Manual: Sign in → check DB for user row |
| 1.3 | Unauthenticated requests to `/dashboard` redirect to `/auth/signin` | Test: HTTP GET `/dashboard` → 302 to signin |
| 1.4 | Prisma schema migrates successfully to Neon | Automated: `npx prisma migrate deploy` exits 0 |
| 1.5 | pgvector extension is enabled | Test: `SELECT 'test'::vector(3)` succeeds |
| 1.6 | SST dev mode (`sst dev`) runs without errors | Manual: `sst dev` boots and serves the app |

#### Tests

```
Unit:
- [ ] Auth middleware redirects unauthenticated users
- [ ] Auth middleware allows authenticated users through
- [ ] Prisma client connects to Neon and runs a basic query

Integration:
- [ ] Google OAuth flow completes end-to-end (mock OAuth in test)
- [ ] User record created on first sign-in, reused on subsequent sign-ins
- [ ] All Prisma models can be created/read (seed test)

E2E:
- [ ] Visit / → see landing page
- [ ] Click "Sign in with Google" → OAuth redirect → return to /dashboard
- [ ] Sign out → redirected to /
```

---

### Loop 2: LLM Adapter & Embedding Pipeline

**Goal**: Provider-agnostic LLM layer that supports OpenAI and Gemini, with embedding generation and vector storage in pgvector.

#### Scope

- Implement `LLMProvider` interface with OpenAI and Gemini adapters
- Embedding generation function (normalize to 1536-dim for OpenAI, handle Gemini dims)
- Vector storage and cosine similarity search via pgvector
- Summarization function
- Environment-based provider selection
- Rate limiting and error handling with retries

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 2.1 | `LLMProvider` interface is implemented for both OpenAI and Gemini | Unit test: both providers instantiate and respond |
| 2.2 | Embedding generated from text and stored in DB | Test: insert inspiration → embedding column is non-null |
| 2.3 | Cosine similarity search returns top-K nearest vectors | Test: insert 10 embeddings → query returns correct top-3 |
| 2.4 | Provider switch via env var works without code changes | Test: toggle `LLM_PROVIDER` → same interface works |
| 2.5 | Summarize function returns a < 280 char summary | Test: pass long text → summary.length <= 280 |
| 2.6 | Graceful degradation on API failure (retry 3x, then error) | Test: mock API failure → retries 3x → throws typed error |

#### Tests

```
Unit:
- [ ] OpenAI adapter generates embedding of correct dimensions
- [ ] Gemini adapter generates embedding of correct dimensions
- [ ] Summarize returns concise output for various input lengths
- [ ] Provider factory returns correct adapter based on env var
- [ ] Retry logic fires on transient errors, gives up after max retries

Integration:
- [ ] End-to-end: text → embedding → store in Neon → similarity query returns it
- [ ] Switching providers yields comparable (not identical) results
```

---

### Loop 3: Core Capture API

**Goal**: RESTful API for creating, reading, updating, and deleting inspirations. Every new inspiration triggers embedding generation and summary.

#### Scope

- `POST /api/inspirations` — create new inspiration (triggers async embedding + summary)
- `GET /api/inspirations` — list user's inspirations (paginated, sorted by createdAt desc)
- `GET /api/inspirations/:id` — get single inspiration with connections
- `PUT /api/inspirations/:id` — update inspiration
- `DELETE /api/inspirations/:id` — soft delete or hard delete
- `GET /api/inspirations/search?q=` — semantic search via embedding similarity
- All endpoints require authentication
- Input validation with Zod

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 3.1 | POST creates inspiration and returns 201 with the object | Test: POST valid payload → 201 + body has id |
| 3.2 | Embedding is generated asynchronously after creation | Test: POST → wait → GET → embedding is non-null |
| 3.3 | Summary is auto-generated for rawContent > 100 chars | Test: POST long content → summary field populated |
| 3.4 | GET list is paginated (default 20, max 100) | Test: create 25 → GET → returns 20 + cursor |
| 3.5 | Semantic search returns relevant results | Test: save "machine learning" note → search "AI" → returns it |
| 3.6 | Users can only access their own inspirations | Test: User A's inspiration → User B GET → 404 |
| 3.7 | Invalid payloads return 400 with Zod error details | Test: POST missing rawContent → 400 + error body |

#### Tests

```
Unit:
- [ ] Zod schemas validate correct payloads
- [ ] Zod schemas reject invalid payloads with correct error messages
- [ ] Pagination cursor encoding/decoding

Integration:
- [ ] Full CRUD lifecycle: create → read → update → delete → verify gone
- [ ] Embedding pipeline triggers on creation (mock LLM, verify call)
- [ ] Semantic search returns results sorted by similarity
- [ ] Authorization: cross-user access denied

E2E:
- [ ] Authenticated user creates inspiration via API → appears in DB with embedding
```

---

### Loop 4: Web App — Dashboard & Capture UI

**Goal**: Responsive PWA with a minimal dashboard showing inspirations, a quick capture input, and semantic search.

#### Scope

- Dashboard page (`/dashboard`) showing inspiration feed (infinite scroll)
- Quick capture component — floating input bar for text notes (title optional)
- Inspiration detail view — full content, tags, summary, connections
- Semantic search bar with results
- PWA manifest and service worker (offline shell, online-only data)
- Responsive design: mobile-first, works on all screen sizes
- Empty states and loading skeletons

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 4.1 | Dashboard loads and displays inspirations | E2E: login → dashboard shows saved items |
| 4.2 | Quick capture: type text → submit → appears in feed without refresh | E2E: type in capture bar → submit → new item at top of feed |
| 4.3 | Inspiration detail shows summary, tags, and connections | E2E: click item → detail view has all fields |
| 4.4 | Search returns semantically relevant results | E2E: search "AI" → results include "machine learning" note |
| 4.5 | PWA installable on mobile Chrome/Safari | Manual: "Add to Home Screen" prompt appears |
| 4.6 | Responsive: usable on 375px (iPhone SE) through 1440px | Visual regression: screenshots at 375, 768, 1440 |
| 4.7 | Offline shell loads (app shell cached by service worker) | Test: go offline → reload → app shell renders with "offline" state |

#### Tests

```
Unit:
- [ ] Capture component calls API with correct payload
- [ ] Inspiration card renders all fields
- [ ] Pagination hook fetches next page on scroll threshold

Integration:
- [ ] Create inspiration via UI → API called → item appears in feed
- [ ] Search query → API called → results rendered

E2E (Playwright):
- [ ] Full capture flow: login → capture → see in feed → click → detail view
- [ ] Search flow: capture item → search → find it
- [ ] Mobile viewport: all interactions work at 375px width
- [ ] PWA: manifest present, service worker registered
```

---

### Loop 5: CLI Capture Tool

**Goal**: An npm-installable CLI tool that captures terminal conversations and sends them to Waka.

#### Scope

- `npx waka-cli capture` — reads last N lines from terminal scrollback or piped stdin
- `npx waka-cli capture --file <path>` — captures content from a file
- `echo "thought" | npx waka-cli save` — pipe any text directly
- `npx waka-cli auth` — opens browser for Google OAuth, stores token locally
- `npx waka-cli list` — shows recent inspirations in terminal
- Published as a separate npm package (`waka-cli`)
- Stores auth token in `~/.waka/config.json`

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 5.1 | `npx waka-cli auth` opens browser and completes OAuth | Manual: run command → browser opens → token saved |
| 5.2 | `echo "test" \| npx waka-cli save` creates an inspiration | Test: pipe text → CLI exits 0 → API receives the inspiration |
| 5.3 | `npx waka-cli capture --file ./chat.txt` saves file content | Test: create file → capture → inspiration created with file content |
| 5.4 | `npx waka-cli list` shows recent inspirations formatted in terminal | Test: create items → list → output contains titles |
| 5.5 | Unauthenticated commands show helpful error message | Test: without auth → run save → stderr contains "Please run waka auth first" |
| 5.6 | CLI works on macOS, Linux, and Windows (Node 18+) | CI: test matrix across OS + Node versions |

#### Tests

```
Unit:
- [ ] Auth token storage/retrieval from ~/.waka/config.json
- [ ] stdin reading correctly captures piped input
- [ ] File reading handles missing files gracefully
- [ ] API client sends correct headers and payload

Integration:
- [ ] Full flow: auth → save → list → verify item appears
- [ ] Error handling: network failure → retry → meaningful error message

E2E:
- [ ] Install from npm → auth → pipe text → save → list → see it
```

---

### Loop 6: URL Import (Save from URL)

**Goal**: In-app feature to save inspirations from any URL. Waka fetches the page content, extracts meaningful text, and creates an inspiration.

#### Scope

- **URL input**: Paste a URL into the capture bar (or dedicated "Import from URL" field) in the web app
- **Server-side fetching**: API route fetches the URL, extracts title, meta description, Open Graph data, and main body text
- **Content extraction**: Use a readability parser (e.g., `@mozilla/readability` or `cheerio`) to strip nav/ads and extract the article body
- **Auto-summarization**: Extracted content is passed through the LLM summarize pipeline
- **Source metadata**: Store original URL, page title, OG image, and domain in `sourceMeta`
- **SourceType**: `URL_IMPORT`
- **CLI support**: `npx waka-cli save --url <url>` also triggers URL import via the same API

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 6.1 | Pasting a URL in the capture bar triggers URL import flow | E2E: paste URL → system detects it's a URL → imports content |
| 6.2 | Server extracts page title and body text | Test: POST URL of a known article → title and rawContent populated |
| 6.3 | Extracted content excludes navigation, ads, and boilerplate | Test: import a news article → rawContent contains article text only |
| 6.4 | OG metadata (image, description) is stored in sourceMeta | Test: import URL with OG tags → sourceMeta has og:image, og:description |
| 6.5 | Auto-summary is generated from extracted content | Test: import long article → summary field is populated and < 280 chars |
| 6.6 | Invalid/unreachable URLs return a clear error | Test: POST invalid URL → 400 with "Could not fetch URL" message |
| 6.7 | CLI `--url` flag triggers the same import | Test: `waka-cli save --url <url>` → inspiration created with URL_IMPORT type |
| 6.8 | Inspiration card in dashboard shows URL domain and OG image | E2E: import URL → card shows favicon/domain and thumbnail |

#### Tests

```
Unit:
- [ ] URL detection regex correctly identifies URLs vs. plain text
- [ ] Content extractor strips boilerplate from HTML
- [ ] OG tag parser extracts title, description, image
- [ ] Graceful handling of non-HTML responses (PDF, images, etc.)

Integration:
- [ ] Full flow: paste URL → fetch → extract → summarize → store with embedding
- [ ] Import from CLI --url flag → same result as web app
- [ ] Timeout handling: slow URLs timeout after 10s with meaningful error

E2E (Playwright):
- [ ] Paste article URL in capture bar → inspiration appears with title, summary, and thumbnail
- [ ] Paste invalid URL → error toast shown, no inspiration created
- [ ] Imported inspiration appears in semantic search results
```

---

### Loop 7: Synthesis Engine — Clustering & Connection Surfacing

**Goal**: When a new inspiration is saved, automatically find connections to past inspirations, cluster related ones, and surface surprising links.

#### Scope

- **On new inspiration**: After embedding is generated, run similarity search against all user's inspirations
- **Connection creation**: If similarity > threshold (0.82), create a `Connection` with AI-generated explanation
- **Clustering**: Periodic re-clustering of user's inspirations using k-means or DBSCAN on embeddings
- **Surprise resurfacing**: When a connection is found, generate a natural-language explanation (e.g., "This ties into your note from October about AI interpretability")
- **Dashboard integration**: Show connections on inspiration detail page, and a "Discoveries" feed of new connections

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 7.1 | New inspiration triggers connection search | Test: add inspiration → connections table has new rows |
| 7.2 | Connections have AI-generated explanations | Test: connection.explanation is non-empty, coherent |
| 7.3 | Similar inspirations are grouped into clusters | Test: add 5 related notes → they share a clusterId |
| 7.4 | Cluster labels are descriptive | Test: cluster.label is a human-readable topic phrase |
| 7.5 | Dashboard shows "Discoveries" feed | E2E: save related items → discoveries section shows connection |
| 7.6 | Connections below threshold are not created | Test: add unrelated inspiration → no spurious connections |
| 7.7 | User can dismiss a connection | Test: dismiss → connection.dismissed = true → hidden from feed |

#### Tests

```
Unit:
- [ ] Similarity threshold correctly filters connections
- [ ] Clustering algorithm groups similar embeddings
- [ ] Cluster labeling produces coherent names
- [ ] Connection explanation generation (mock LLM)

Integration:
- [ ] Full pipeline: save inspiration → embedding → similarity search → connection created → explanation generated
- [ ] Clustering runs on 50+ inspirations without timeout
- [ ] Re-clustering after new additions updates cluster assignments

E2E:
- [ ] Save "quantum computing" note → save "quantum entanglement" note → connection surfaces in Discoveries
- [ ] Dismiss connection → no longer shown
```

---

### Loop 8: Adaptive Reflection

**Goal**: When the system detects a nuanced or significant inspiration, prompt the user with a reflection question instead of silently saving.

#### Scope

- **Classification**: LLM classifies each new inspiration as `quick_save` or `reflect`
- Classification based on: content complexity, novelty relative to existing inspirations, emotional indicators
- **Reflection UI**: Modal/inline prompt showing the AI's question (e.g., "What exactly sparked your thought here?")
- User can answer or skip
- Reflection answer stored on the inspiration and included in embedding

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 8.1 | Simple URL/link saves are classified as `quick_save` | Test: save a URL → no reflection prompt |
| 8.2 | Complex/nuanced text triggers `reflect` classification | Test: save a paragraph about a breakthrough idea → reflection prompt shown |
| 8.3 | Reflection modal shows a relevant, non-generic question | Test: question references specific content from the inspiration |
| 8.4 | User can answer the reflection | Test: type answer → saved to inspiration.reflectionAnswer |
| 8.5 | User can skip reflection | Test: skip → inspiration saved without reflectionAnswer |
| 8.6 | Reflection answer is incorporated into embedding | Test: answer reflection → embedding re-generated → differs from pre-answer |
| 8.7 | Classification latency < 3 seconds | Test: time from save to classification response < 3s |

#### Tests

```
Unit:
- [ ] Classification prompt produces valid enum output
- [ ] Reflection question generation references input content
- [ ] Skip flow saves without reflection

Integration:
- [ ] URL input → classified quick_save → no reflection
- [ ] Long-form idea → classified reflect → question shown → answer saved → embedding updated

E2E:
- [ ] Capture a deep thought via web app → reflection modal appears → answer → see reflection on detail page
- [ ] Capture a link → no reflection modal → saved immediately
```

---

### Loop 9: Shareable Inspiration Cards

**Goal**: Users can make individual inspirations or clusters public via a shareable link with an attractive card preview.

#### Scope

- Toggle `isPublic` on an inspiration → generates a unique `shareSlug`
- Public page at `/s/:shareSlug` — no auth required, renders a styled card
- Open Graph meta tags for social sharing previews
- Card shows: title, summary, tags, source type icon, and creation date
- Cluster sharing: shareable link for an entire cluster

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 9.1 | Toggle public → shareSlug generated | Test: PUT isPublic=true → shareSlug is non-null |
| 9.2 | Public page renders without authentication | Test: GET `/s/:slug` in incognito → 200 + card content |
| 9.3 | OG meta tags present for social previews | Test: parse HTML → og:title, og:description, og:image present |
| 9.4 | Private inspirations return 404 on public URL | Test: isPublic=false → GET `/s/:slug` → 404 |
| 9.5 | Cluster share page shows all inspirations in the cluster | Test: share cluster → page lists all cluster items |

#### Tests

```
Unit:
- [ ] Share slug generation is unique and URL-safe
- [ ] OG tag generation from inspiration data

Integration:
- [ ] Make public → fetch public URL → content matches
- [ ] Make private again → public URL returns 404
- [ ] Cluster share → all items in cluster shown

E2E:
- [ ] Share inspiration → copy link → open in incognito → card renders correctly
- [ ] Share link preview renders correctly on social platforms (OG tag validator)
```

---

## 4. Loop Dependency Graph

```
Loop 1: Foundation & Auth
  │
  ▼
Loop 2: LLM Adapter & Embeddings
  │
  ▼
Loop 3: Core Capture API
  │
  ├──────────────┬──────────────┐
  ▼              ▼              ▼
Loop 4:        Loop 5:       Loop 6:
Web App        CLI Tool      URL Import
  │              │              │
  └──────────────┴──────────────┘
                 │
                 ▼
           Loop 7: Synthesis Engine
                 │
                 ▼
           Loop 8: Adaptive Reflection
                 │
                 ▼
           Loop 9: Shareable Cards
```

Loops 4, 5, 6 can execute **in parallel** after Loop 3 is complete.
Loop 6 (URL Import) also integrates into Loop 4 (Web App UI) and Loop 5 (CLI `--url` flag).

---

## 5. Environment Variables

```env
# Database
DATABASE_URL=postgresql://...@neon.tech/waka?sslmode=require

# Auth
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# LLM
LLM_PROVIDER=openai  # openai | gemini
OPENAI_API_KEY=...
GEMINI_API_KEY=...

# Deployment
AWS_REGION=us-east-1
```

---

## 6. Project Structure

```
waka/
├── apps/
│   ├── web/                  # Next.js app
│   │   ├── app/
│   │   │   ├── (auth)/       # Auth pages
│   │   │   ├── (app)/        # Protected app routes
│   │   │   │   ├── dashboard/
│   │   │   │   └── inspiration/[id]/
│   │   │   ├── s/[slug]/     # Public share pages
│   │   │   └── api/          # API routes
│   │   ├── components/
│   │   ├── lib/
│   │   │   ├── llm/          # LLM adapter
│   │   │   ├── auth/         # Auth utilities
│   │   │   └── db/           # Prisma client
│   │   └── public/
│   └── cli/                  # waka-cli npm package
│       ├── src/
│       │   ├── commands/
│       │   ├── auth.ts
│       │   └── api-client.ts
│       └── package.json
├── packages/
│   └── shared/               # Shared types & Zod schemas
│       ├── types.ts
│       └── schemas.ts
├── prisma/
│   └── schema.prisma
├── sst.config.ts
├── package.json              # Monorepo root (pnpm workspaces)
└── turbo.json
```
