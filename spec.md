# Waka — Inspiration & Context Engine: Technical Specification

> **Purpose**: This document serves as the authoritative input for ralph execution loops.
> Each section defines a self-contained loop with clear scope, acceptance criteria, and test plans.

---

## 1. Product Summary

Waka is a personal knowledge engine inspired by the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern. You throw things in — thoughts, URLs, voice notes, photos, AI conversations — and Waka's backend carefully places each one into an evolving knowledge graph, maintaining living documents called **threads** that synthesize your thinking over time. The frontend never exposes the graph. Instead, you see your threads: documents that know more about your thinking than you do, surfacing forgotten connections and unexpected relationships between ideas you didn't know were related.

### Architecture: Three Layers

Waka operates on three distinct layers, mirroring the LLM Wiki architecture:

1. **Raw Layer — Inspirations**: Immutable captures from any surface (CLI, web, voice, photo, URL, AI conversations). These are your raw inputs. They are never modified after save.
2. **Synthesis Layer — Threads**: Living, LLM-maintained documents that evolve every time a new inspiration is placed into them. A thread isn't a folder or a tag — it's a synthesized narrative of related thinking that gets rewritten as new inspirations arrive. When you open a thread, you read your own thinking back, woven together with connections you missed, referencing things you forgot you ever saved.
3. **Bridge Layer — Cross-references**: LLM-maintained relationships between threads. When a new inspiration creates a link between two previously unrelated threads, a bridge is formed. Bridges surface the "oh, I didn't realize these were connected" moments.

### Primary JTBD: Capture-First

Waka is **capture-first**. The app opens to a prominent capture bar ready for input. The entire UX is designed around one goal: **saving an inspiration must feel as reliable and instant as Apple Notes.** Nothing typed into Waka should ever be lost.

### Secondary JTBD: Surprising Discovery

The value of Waka is not organization — it's **unexpected resonance**. The moment when something you saved today surfaces a forgotten thought from six months ago. The moment when two ideas you thought were unrelated turn out to share a deep connection. Discovery happens inside threads: you open one and find a paragraph that weaves together things you didn't know were related, written in a way that makes you think differently.

Key capture behaviors:
- **Minimum viable inspiration**: A single word, a bare URL, or a one-line thought are all valid. Low-signal inputs get fewer AI-generated metadata fields, but they are always accepted and saved.
- **Optimistic save**: Inspirations appear in the feed immediately on submit. AI-generated fields (title, summary, tags, embedding) render as skeleton placeholders that animate in as they resolve — the card should feel *loading*, never *incomplete*.
- **Persistent capture bar**: The capture bar is always visible across all views (home, thread detail, inspiration detail). Even while browsing, a new thought can be captured without navigating away.
- **Explicit submit, zero-failure guarantee**: Pressing enter/submit saves instantly. This is not auto-save-on-keystroke (which would persist half-formed sentences), but the submit action itself must never fail silently. If the server is unreachable, the capture bar retains the text, queues it locally, and retries on reconnection — the user's input is never cleared without confirmation of persistence.
- **Post-save feedback**: After saving, the user sees confirmation inline. If the inspiration was placed into an existing thread, the placement is shown: "Placed in *Emergence & Complex Systems*". If it created a new thread or bridge, that's surfaced too. The feed remains the primary view — no navigation away.

### Information Architecture

Three levels, simple and clean:

1. **Home** — Capture bar + scrollable feed. The feed has two card types: **capture cards** (lightweight, muted — your raw inputs) and **discovery cards** (richer, bolder — things the system found in your thinking). The user doesn't need to distinguish between thread updates, bridge formations, or new thread creations — they're all discovery cards. Capture cards sit at the top until the backend processes them; discovery cards surface whenever the knowledge graph evolves.
2. **Thread Detail** — Tap a discovery card to open the relevant thread. Read the full synthesized document — the living narrative that weaves your inspirations together, surfacing connections and forgotten references. Individual inspirations that compose the thread are listed below. "Deepen" action available to add more context.
3. **Inspiration Detail** — Tap an individual inspiration to see the raw capture, AI-generated metadata, and which thread(s) it belongs to.

The frontend never shows a graph, nodes, or edges. The complexity lives in the backend. The user just sees: a place to throw things in (capture cards), and things the system found (discovery cards).

### Cold Start: Reflection as the Bridge

Before the graph is dense enough for connections (roughly 0–20 captures), the system uses **adaptive reflection** as the primary post-capture response. After saving, Waka asks a reflective question: "What sparked this?" — and the answer becomes a new inspiration. Reflection is a capture multiplier that fills the graph faster than the user realizes. As the graph densifies (20+ captures), reflections fade and thread placements + bridge discoveries take over. The user never sees a phase transition — there's always something responding to their input.

### V1 Scope (This Spec)

| In Scope | Out of Scope (Future) |
|---|---|
| Web app (Next.js PWA, responsive) | Social graph agents (잡소리 — followers' AI agents commenting on your threads with resonant thinking from their graph) |
| CLI capture tool (terminal conversations) | Active suggestion engine (system proposes new inspirations to deepen the graph) |
| URL import (fetch & save from any URL) | OS-level cursor integration |
| Voice note capture (record + transcribe) | Environments of Ambition |
| Photo capture (image + OCR/description) | Multi-provider auth (only Google for v1) |
| AI conversation import (Claude, GPT, Gemini) | Native mobile apps |
| LLM Wiki-style thread synthesis & placement | Browser extension |
| Bridge detection (cross-thread connections) | Real-time sync |
| Adaptive reflection (post-save, non-blocking) | Contradiction detection & maintenance linting |
| Shareable inspiration cards & threads | |
| Google OAuth login | |
| Offline capture queue (local persistence) | |
| "Deepen" flow (expand existing inspirations) | |

### Non-Functional Requirements

- **Privacy**: All inspirations are private by default. No data shared without explicit user action.
- **Consistency**: Eventual consistency on refresh (no real-time sync required).
- **Auth extensibility**: Google OAuth v1, but auth layer must support adding providers without schema changes.
- **Capture reliability**: Inspirations must never be silently lost. The system must persist input locally before attempting server save, and retry on failure.

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
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim, locked for V1) |
| Vector Search | pgvector extension on Neon |
| File Storage | AWS S3 (voice recordings, photos) via SST Bucket |
| Job Queue | SQS via SST Queue → Lambda subscriber (async embedding, summarization, reflection) |
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
  ┌────────┬───┼───────┬────────────┐
  ▼        ▼   ▼       ▼            ▼
┌───────┐ ┌──────┐ ┌────────┐ ┌─────────┐
│ Neon  │ │pgvec-│ │  LLM   │ │  S3     │
│(Postg-│ │ tor  │ │Adapter │ │(voice,  │
│ res)  │ │      │ │(OpenAI/│ │ photo)  │
│       │ │      │ │Gemini) │ │         │
└───────┘ └──────┘ └────────┘ └─────────┘
                        ▲
                        │
                  ┌─────────┐
                  │  SQS    │
                  │ (async  │
                  │ pipeline│
                  │  jobs)  │
                  └─────────┘
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
  threads       Thread[]
  bridges       Bridge[]
  connections   Connection[]
  apiKeys       ApiKey[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model Inspiration {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])

  // Content
  title         String?   // AI-generated if not provided
  rawContent    String    // Original text/transcript/URL (min: 1 char)
  summary       String?   // AI-generated summary
  sourceType    SourceType
  sourceUrl     String?   // URL if web clip, AI chat link, or media file
  sourceMeta    Json?     // Flexible metadata (see SourceMeta types below)

  // Media (voice/photo)
  mediaUrl      String?   // S3 URL for voice recordings or photos
  transcript    String?   // Transcription of voice note or OCR of photo

  // AI-generated metadata
  embedding     Unsupported("vector(1536)")?
  tags          String[]  // AI-extracted tags
  domain        String?   // AI-classified domain (tech, philosophy, personal, work, etc.)
  mood          String?   // AI-detected mood (curious, excited, frustrated, reflective, etc.)
  actionability String?   // AI-classified: idea, observation, question, decision, reference

  // Reflection (always post-save, never blocks capture)
  reflectionPrompt  String?  // Generated reflection question
  reflectionAnswer  String?  // User's answer to reflection
  reflectionStatus  ReflectionStatus @default(PENDING)

  // Deepening (linked expansions)
  parentId      String?   // If this is a deepening of another inspiration
  parent        Inspiration? @relation("InspirationDepth", fields: [parentId], references: [id])
  expansions    Inspiration[] @relation("InspirationDepth")

  // Thread placement
  threadId      String?
  thread        Thread?   @relation(fields: [threadId], references: [id])

  // Sharing
  isPublic      Boolean   @default(false)
  shareSlug     String?   @unique

  // Soft delete
  deletedAt     DateTime?

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // Connections
  connectionsAsSource Connection[] @relation("ConnectionSource")
  connectionsAsTarget Connection[] @relation("ConnectionTarget")

  @@index([userId, createdAt(sort: Desc)])
  @@index([userId, deletedAt])
}

model Thread {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  title         String    // AI-generated thread title (e.g., "Emergence & Complex Systems")
  synthesis     String    // AI-generated living document — rewritten when inspirations are added/removed
  inspirations  Inspiration[]
  bridgesAsSource Bridge[] @relation("BridgeSource")
  bridgesAsTarget Bridge[] @relation("BridgeTarget")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([userId])
}

model Bridge {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  sourceThreadId  String
  sourceThread    Thread    @relation("BridgeSource", fields: [sourceThreadId], references: [id])
  targetThreadId  String
  targetThread    Thread    @relation("BridgeTarget", fields: [targetThreadId], references: [id])
  explanation     String    // AI-generated explanation of how the threads connect
  surfacedAt      DateTime  @default(now())
  dismissed       Boolean   @default(false)

  @@unique([sourceThreadId, targetThreadId])
  @@index([userId, surfacedAt(sort: Desc)])
}

model Connection {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  sourceId        String
  source          Inspiration @relation("ConnectionSource", fields: [sourceId], references: [id])
  targetId        String
  target          Inspiration @relation("ConnectionTarget", fields: [targetId], references: [id])
  similarityScore Float
  explanation     String    // AI-generated explanation of the connection
  surfacedAt      DateTime  @default(now())
  dismissed       Boolean   @default(false)

  @@unique([sourceId, targetId])
  @@index([userId, surfacedAt(sort: Desc)])
}

model ApiKey {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  name          String    // User-defined label (e.g., "MacBook CLI", "Work laptop")
  hashedKey     String    @unique // SHA-256 hash of the API key (plain key shown only once on creation)
  lastUsedAt    DateTime?
  createdAt     DateTime  @default(now())

  @@index([userId])
}

enum SourceType {
  CLI_CONVERSATION
  VOICE_NOTE
  TEXT_NOTE
  URL_IMPORT
  PHOTO
  AI_CONVERSATION  // Saved from Claude, GPT, Gemini, etc.
}

enum ReflectionStatus {
  PENDING    // Not yet classified
  PROMPTED   // Reflection question generated, awaiting answer
  ANSWERED   // User answered the reflection
  SKIPPED    // User skipped the reflection
  NOT_NEEDED // Classified as quick_save, no reflection
}
```

#### SourceMeta Shapes

`sourceMeta` is a flexible JSON field. Each `SourceType` has a defined shape:

```typescript
// URL_IMPORT
interface UrlImportMeta {
  domain: string;          // e.g., "nytimes.com"
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;        // URL to Open Graph image
  favicon?: string;
  contentType: string;     // "article" | "video" | "pdf" | "image" | "other"
}

// AI_CONVERSATION
interface AiConversationMeta {
  provider: "claude" | "chatgpt" | "gemini" | "other";
  conversationTitle?: string;
  conversationUrl?: string; // Share link if available
  turnCount?: number;
  model?: string;          // e.g., "claude-opus-4-6", "gpt-4o"
}

// VOICE_NOTE
interface VoiceNoteMeta {
  durationSeconds: number;
  mimeType: string;        // e.g., "audio/webm"
}

// PHOTO
interface PhotoMeta {
  mimeType: string;
  width?: number;
  height?: number;
  ocrText?: string;        // Extracted text from image
}

// CLI_CONVERSATION
interface CliConversationMeta {
  shell?: string;          // e.g., "zsh", "bash"
  cwd?: string;            // Working directory at capture time
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
  generateTitle(content: string): Promise<string>;
  classifyMetadata(content: string): Promise<{
    tags: string[];
    domain: string;
    mood: string;
    actionability: string;
  }>;
  transcribeAudio(audioUrl: string): Promise<string>;
  describeImage(imageUrl: string): Promise<string>;
}

// Implementations: OpenAIProvider, GeminiProvider
// Selected via environment variable: LLM_PROVIDER=openai|gemini
// Note: Embeddings are locked to OpenAI text-embedding-3-small (1536-dim) for V1
// regardless of LLM_PROVIDER setting, to avoid vector dimension mismatches.
```

---

## 3. Ralph Execution Loops

Each loop is designed to be independently executable and verifiable. Loops are ordered by dependency — each builds on the previous.

---

### Loop 1: Project Foundation & Auth

**Goal**: Bootable Next.js app with Google OAuth, Neon database, basic Prisma schema, S3 bucket, SQS queue deployed via SST, and API key management for CLI auth.

#### Scope

- Initialize Next.js 15 project with App Router, TypeScript, Tailwind v4
- Configure Prisma with Neon connection (connection pooling via `@neondatabase/serverless`)
- Set up Auth.js v5 with Google OAuth provider
- Implement sign-in / sign-out flow with protected route middleware
- Configure SST Ion for AWS deployment (Lambda + CloudFront + S3 Bucket + SQS Queue)
- Create all Prisma models from Section 2 (including `ApiKey` model)
- Enable pgvector extension on Neon
- Settings page (`/settings`) with API key management: create (show plain key once), list, revoke
- API key authentication middleware: validate `Authorization: Bearer <key>` header by hashing and comparing against `ApiKey.hashedKey`, update `lastUsedAt` on use

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 1.1 | `npm run dev` starts without errors | Automated: `npm run dev` exits cleanly |
| 1.2 | Google OAuth sign-in redirects and creates a User record | Manual: Sign in → check DB for user row |
| 1.3 | Unauthenticated requests to `/dashboard` redirect to `/auth/signin` | Test: HTTP GET `/dashboard` → 302 to signin |
| 1.4 | Prisma schema migrates successfully to Neon | Automated: `npx prisma migrate deploy` exits 0 |
| 1.5 | pgvector extension is enabled | Test: `SELECT 'test'::vector(3)` succeeds |
| 1.6 | SST dev mode (`sst dev`) runs without errors | Manual: `sst dev` boots and serves the app |
| 1.7 | S3 bucket is provisioned and accessible | Test: upload/download a test file via SST bucket binding |
| 1.8 | SQS queue is provisioned | Test: send/receive a test message via SST queue binding |
| 1.9 | Settings page allows creating and revoking API keys | Test: create key → plain key shown once → listed in settings → revoke → key no longer works |
| 1.10 | API key auth works for API routes | Test: `Authorization: Bearer <key>` header → authenticated request succeeds |

#### Tests

```
Unit:
- [ ] Auth middleware redirects unauthenticated users
- [ ] Auth middleware allows authenticated users through
- [ ] Prisma client connects to Neon and runs a basic query
- [ ] API key hashing and validation logic
- [ ] API key auth middleware accepts valid key, rejects invalid/revoked key

Integration:
- [ ] Google OAuth flow completes end-to-end (mock OAuth in test)
- [ ] User record created on first sign-in, reused on subsequent sign-ins
- [ ] All Prisma models can be created/read (seed test)
- [ ] API key lifecycle: create → use → revoke → rejected

E2E:
- [ ] Visit / → see landing page
- [ ] Click "Sign in with Google" → OAuth redirect → return to /dashboard
- [ ] Sign out → redirected to /
```

---

### Loop 2: LLM Adapter & Embedding Pipeline

**Goal**: Provider-agnostic LLM layer that supports OpenAI and Gemini, with embedding generation and vector storage in pgvector. Embeddings are locked to OpenAI `text-embedding-3-small` (1536-dim) for V1.

#### Scope

- Implement `LLMProvider` interface with OpenAI and Gemini adapters
- Embedding generation locked to OpenAI `text-embedding-3-small` (1536-dim) regardless of `LLM_PROVIDER` — this avoids vector dimension mismatches when switching LLM providers
- Vector storage and cosine similarity search via pgvector
- Summarization function
- Title generation function
- Metadata classification function (tags, domain, mood, actionability)
- Environment-based provider selection for non-embedding LLM tasks
- Rate limiting and error handling with retries (3x retry with exponential backoff)
- SQS consumer as Lambda subscriber (SST Queue → Lambda trigger pattern) for async processing jobs

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 2.1 | `LLMProvider` interface is implemented for both OpenAI and Gemini | Unit test: both providers instantiate and respond |
| 2.2 | Embedding generated from text and stored in DB | Test: insert inspiration → embedding column is non-null |
| 2.3 | Cosine similarity search returns top-K nearest vectors | Test: insert 10 embeddings → query returns correct top-3 |
| 2.4 | Provider switch via env var works for non-embedding tasks | Test: toggle `LLM_PROVIDER` → summarize/classify use correct provider |
| 2.5 | Embeddings always use OpenAI regardless of LLM_PROVIDER | Test: set LLM_PROVIDER=gemini → embeddings still 1536-dim OpenAI |
| 2.6 | Summarize function returns a < 280 char summary | Test: pass long text → summary.length <= 280 |
| 2.7 | Title generation returns a < 80 char title | Test: pass content → title is concise and descriptive |
| 2.8 | Metadata classification returns valid domain/mood/actionability | Test: pass content → all fields are populated with valid values |
| 2.9 | Graceful degradation on API failure (retry 3x, then error) | Test: mock API failure → retries 3x → throws typed error |
| 2.10 | SQS consumer processes jobs from queue | Test: enqueue a job → consumer picks it up and processes |

#### Tests

```
Unit:
- [ ] OpenAI adapter generates embedding of 1536 dimensions
- [ ] Gemini adapter handles non-embedding LLM tasks
- [ ] Summarize returns concise output for various input lengths
- [ ] Title generation produces concise, descriptive titles
- [ ] Metadata classification returns valid enum values
- [ ] Provider factory returns correct adapter based on env var
- [ ] Retry logic fires on transient errors, gives up after max retries

Integration:
- [ ] End-to-end: text → embedding → store in Neon → similarity query returns it
- [ ] SQS job: enqueue embedding job → consumer processes → embedding stored
- [ ] Switching LLM_PROVIDER doesn't affect embedding dimensions
```

---

### Loop 3: Core Capture API

**Goal**: RESTful API for creating, reading, updating, and deleting inspirations. Every new inspiration triggers async embedding, summary, title generation, and metadata classification via SQS.

#### Scope

- `POST /api/inspirations` — create new inspiration (returns 201 immediately, enqueues async processing to SQS)
- `GET /api/inspirations` — list user's inspirations (paginated, sorted by createdAt desc, excludes soft-deleted)
- `GET /api/inspirations/:id` — get single inspiration with connections and expansions
- `PUT /api/inspirations/:id` — update inspiration (re-triggers embedding if rawContent changed)
- `DELETE /api/inspirations/:id` — soft delete (sets deletedAt timestamp)
- `GET /api/inspirations/search?q=` — semantic search via embedding similarity
- `POST /api/inspirations/:id/deepen` — create a linked expansion of an existing inspiration
- All endpoints require authentication
- Input validation with Zod
- Minimum valid rawContent: 1 character (single word, bare URL, anything)

#### API: Deepen Flow

`POST /api/inspirations/:id/deepen` creates a new Inspiration with `parentId` set to the original. The expansion inherits the parent's `threadId` initially but may be re-assigned during thread placement. When the user deepens an inspiration:

1. A new Inspiration is created with `parentId = original.id`
2. The original's embedding is re-generated from the combined content of itself + all expansions
3. Tags, summary, and thread assignment on the parent are re-evaluated
4. The parent's `updatedAt` is touched so it surfaces in recent feeds

This means deepening enriches the *original* inspiration's signal rather than creating disconnected fragments.

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 3.1 | POST creates inspiration and returns 201 with the object (id, rawContent, sourceType) immediately | Test: POST valid payload → 201 + body has id, response time < 500ms |
| 3.2 | Async pipeline generates embedding, title, summary, tags, domain, mood, actionability | Test: POST → poll GET → all AI fields populated within 30s |
| 3.3 | Summary is auto-generated for rawContent > 100 chars | Test: POST long content → summary field populated |
| 3.4 | Title is auto-generated when not provided by user | Test: POST without title → title field populated after processing |
| 3.5 | Single-word inputs are accepted and processed | Test: POST rawContent="serendipity" → 201, tags generated |
| 3.6 | GET list is paginated (default 20, max 100), excludes soft-deleted | Test: create 25 → GET → returns 20 + cursor; soft-deleted excluded |
| 3.7 | Semantic search returns relevant results | Test: save "machine learning" note → search "AI" → returns it |
| 3.8 | Users can only access their own inspirations | Test: User A's inspiration → User B GET → 404 |
| 3.9 | Invalid payloads return 400 with Zod error details | Test: POST empty rawContent → 400 + error body |
| 3.10 | DELETE soft-deletes (sets deletedAt) | Test: DELETE → GET returns 404 → DB row still exists with deletedAt set |
| 3.11 | Deepen creates linked child and re-processes parent | Test: POST deepen → child has parentId → parent embedding updated |

#### Tests

```
Unit:
- [ ] Zod schemas validate correct payloads (including single-char rawContent)
- [ ] Zod schemas reject invalid payloads with correct error messages
- [ ] Pagination cursor encoding/decoding
- [ ] Soft delete filtering logic

Integration:
- [ ] Full CRUD lifecycle: create → read → update → soft-delete → verify filtered from list
- [ ] Async pipeline triggers on creation (verify SQS job enqueued)
- [ ] Semantic search returns results sorted by similarity
- [ ] Authorization: cross-user access denied
- [ ] Deepen flow: create parent → deepen → verify parent re-processed

E2E:
- [ ] Authenticated user creates inspiration via API → appears in DB → AI fields populate async
```

---

### Loop 4: Web App — Capture-First Feed with Threads

**Goal**: Responsive PWA with a capture-first layout. Persistent multi-modal capture bar, optimistic UI, thread-oriented feed, and offline capture queue. The frontend is clean and simple — the LLM Wiki complexity lives entirely in the backend.

#### Scope

##### Capture Bar (Always Visible)
- Persistent capture bar visible on all authenticated views — pinned to top of the screen
- iMessage-style multi-modal input: text field with attachment icons for voice and photo
- **Text**: Type and press Enter to save. Single word, bare URL, or paragraph — all accepted
- **URL detection**: If pasted text is a URL (or contains a URL alongside commentary), auto-detect and split into `rawContent` (commentary) + `sourceUrl` (URL) with `URL_IMPORT` source type. Pure URLs save with the URL as `rawContent`
- **Voice**: Tap mic icon → browser MediaRecorder API → stop recording → upload audio to S3 → transcribe via LLM → save with `VOICE_NOTE` type, both audio URL and transcript stored
- **Photo**: Tap camera icon → file picker or camera capture → upload to S3 → LLM describes/OCRs image → save with `PHOTO` type
- **AI conversation**: Tap brain/chat icon → paste transcript or share link → save with `AI_CONVERSATION` type. If a share link is pasted (e.g., ChatGPT share URL), fetch and extract the conversation. If raw transcript text is pasted, save directly. The full transcript is stored as `rawContent`; the LLM generates a focused summary for the embedding (so the embedding isn't diluted across 50 conversation turns)
- On mobile (< 768px), when the keyboard opens, the capture bar transforms into a full-width input above the keyboard (the persistent bar itself hides since the keyboard input *is* the capture surface)

##### Optimistic UI & Save Feedback
- On submit, inspiration immediately appears at the top of the feed as a lightweight card with skeleton placeholders
- Skeleton placeholders pulse/animate to indicate "loading" state (not "missing" state)
- As AI fields resolve (via polling at 3-second intervals), they fade into the card
- **Thread placement feedback**: Once the backend places the inspiration into a thread, the card shows inline: "Placed in *Emergence & Complex Systems*" — linking to the thread. If a new thread was created, or a new bridge between threads was formed, that's surfaced too.
- If the server is unreachable: the card appears with a "queued" indicator, text is persisted to IndexedDB, and the app retries when connectivity returns

##### Feed & Layout
- **Capture-first layout**: App opens to the capture bar prominently at top, scrollable feed below
- **Two card types in the feed**: capture cards and discovery cards. No tabs, no sidebar, no separate sections. Sorted by last updated.
- **Capture cards** (lightweight, muted): Raw inputs — showing content, source type icon, timestamp. Visually compact. These are stream-of-consciousness entries that sit at the top of the feed until the backend processes them.
- **Discovery cards** (richer, bolder): A single card type that surfaces any meaningful event from the knowledge graph. The user doesn't need to know whether the backend triggered a thread synthesis update or a bridge formation — they just see "something interesting happened to your thinking." Discovery cards may include:
  - A thread's synthesis was updated by a new placement: "Your thinking about *Emergence & Complex Systems* just got deeper" — with an excerpt from the updated synthesis and a link to the full thread.
  - A new bridge formed between threads: "Your thinking about *AI Safety* now connects to *Design Systems* — both explore transparency in complex systems."
  - A new thread was created from recent captures: "*Swarm Intelligence* — a new thread just formed from 3 of your recent saves."
  - All rendered as the same card type with the same visual weight. The content varies, but the form is consistent.
- **Visual distinction**: Capture cards feel like inputs. Discovery cards feel like outputs — things the system generated from your inputs. The difference is communicated through visual weight (size, typography, chrome), not labels or categories.
- Semantic search bar (above the feed)

##### Thread Detail View
- Full synthesized document — the living narrative that weaves together related inspirations
- This is where discovery happens: the document references forgotten inspirations, surfaces unexpected connections, and evolves every time new inspirations are placed into it
- List of individual inspirations that compose this thread
- Bridges to other threads shown as contextual links within the synthesis
- "Deepen" action to add more context to this thread
- Thread's `updatedAt` and inspiration count visible

##### Inspiration Detail View
- Full raw content, AI-generated title, summary, tags, domain, mood, actionability
- Which thread(s) this inspiration belongs to (linked)
- Expansions (deepened inspirations) shown below the original
- "Deepen" button to add more context to this inspiration
- Reflection prompt (if classified as `reflect`) shown as a non-intrusive inline section — never a blocking modal

##### Offline Capture Queue
- Service worker caches app shell for offline loading
- When offline, the capture bar still works: submitted inspirations are saved to IndexedDB with a `queued` status
- When connectivity returns, queued inspirations are synced to the server automatically (last-write-wins; no deduplication in V1 — duplicates can be manually deleted by user)
- Visual indicator on queued items: subtle "waiting to sync" badge

##### Other
- PWA manifest and service worker
- Responsive design: mobile-first, works on all screen sizes (375px — 1440px)
- Empty states and loading skeletons

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 4.1 | App opens to capture bar + feed (capture cards + discovery cards) | E2E: login → capture bar is focused/prominent, feed below |
| 4.2 | Text capture: type → submit → capture card appears immediately with skeletons | E2E: type text → submit → lightweight card at top with loading placeholders |
| 4.3 | AI fields fade in as they resolve | E2E: wait after capture → title, tags animate in |
| 4.4 | Discovery card appears when thread is updated by new placement | E2E: save related text → discovery card appears: "Your thinking about X just got deeper" |
| 4.5 | Discovery card appears when new bridge forms between threads | E2E: save inspiration bridging threads → discovery card shows the connection |
| 4.6 | Discovery card appears when new thread is created | E2E: save several related notes → discovery card: "New thread formed" |
| 4.7 | URL detection: paste URL → auto-detected → saved as URL_IMPORT | E2E: paste URL → card shows domain + thumbnail after processing |
| 4.8 | URL with commentary: "Great article: https://..." splits correctly | E2E: paste text+URL → rawContent has commentary, sourceUrl has URL |
| 4.9 | Voice capture: tap mic → record → stop → transcribed and saved | E2E: record audio → card appears with transcript |
| 4.10 | Photo capture: select image → uploaded → described and saved | E2E: pick photo → card appears with AI description |
| 4.11 | AI conversation import: paste transcript → saved with summary | E2E: paste conversation → card shows conversation summary |
| 4.12 | Capture bar visible on all views (home, thread detail, inspiration detail) | E2E: navigate to different pages → capture bar always present |
| 4.13 | Thread detail shows full synthesized document + composing inspirations | E2E: open thread via discovery card → synthesized narrative + list of inspirations |
| 4.14 | Visual distinction between capture cards and discovery cards | Visual: capture cards are compact/muted (inputs), discovery cards are richer/bolder (outputs) |
| 4.15 | Deepen button creates linked expansion | E2E: click "Deepen" → type expansion → saved as child of original |
| 4.16 | Search returns semantically relevant results | E2E: search "AI" → results include "machine learning" note |
| 4.17 | Offline capture: go offline → capture → queued → go online → synced | E2E: disconnect → capture → reconnect → item synced to server |
| 4.18 | PWA installable on mobile Chrome/Safari | Manual: "Add to Home Screen" prompt appears |
| 4.19 | Responsive: usable on 375px through 1440px | Visual regression: screenshots at 375, 768, 1440 |
| 4.20 | Reflection prompt appears inline on inspiration detail (not as a blocking modal) | E2E: save deep thought → open detail → reflection section visible, non-blocking |

#### Tests

```
Unit:
- [ ] URL detection regex: pure URL, URL with commentary, non-URL text
- [ ] Offline queue: add to IndexedDB, retrieve, mark as synced
- [ ] Skeleton placeholder renders for each AI field independently
- [ ] Capture bar state management across routes
- [ ] Feed sorting: capture cards and discovery cards sorted by updatedAt

Integration:
- [ ] Text capture → capture card → API called → AI fields resolve → discovery card appears
- [ ] Voice capture → S3 upload → transcription → card updated
- [ ] Photo capture → S3 upload → description → card updated
- [ ] AI conversation paste → summary generated → card updated
- [ ] Offline capture → queue → reconnect → sync → card updated
- [ ] Deepen → child created → parent re-processed
- [ ] Discovery card surfaces when thread is updated by new placement

E2E (Playwright):
- [ ] Full capture flow: login → capture text → capture card appears → discovery card appears → open thread
- [ ] Multi-modal: capture voice → capture photo → capture URL → all in feed
- [ ] Thread formation: save 5 related notes → discovery card: "new thread formed" → open thread → coherent synthesis
- [ ] Bridge formation: save inspiration bridging threads → discovery card shows connection
- [ ] Offline flow: go offline → capture → go online → item appears
- [ ] Mobile viewport: all interactions work at 375px width
- [ ] PWA: manifest present, service worker registered
- [ ] Search flow: capture item → search → find it
```

---

### Loop 5: CLI Capture Tool

**Goal**: An npm-installable CLI tool that captures text, files, and AI conversations and sends them to Waka. Supports post-save reflection prompts in the terminal.

#### Scope

- `npx waka-cli save` — opens an interactive prompt for the user to type a thought (default command when no stdin and no flags)
- `npx waka-cli save --file <path>` — captures content from a file
- `echo "thought" | npx waka-cli save` — pipe any text directly
- `npx waka-cli save --url <url>` — triggers URL import via the same API as the web app
- `npx waka-cli auth` — starts a temporary local server (localhost callback), opens browser for Google OAuth, receives token via callback, stores API token in `~/.waka/config.json`
- `npx waka-cli auth --token <WAKA_API_KEY>` — manual token entry for remote/headless environments
- `npx waka-cli list` — shows recent inspirations in terminal with auto-generated titles
- `npx waka-cli deepen <id>` — opens interactive prompt to add context to an existing inspiration
- Published as a separate npm package (`waka-cli`)
- Auth token stored in `~/.waka/config.json`, with `WAKA_API_KEY` environment variable as fallback (for SSH, devcontainers, CI)

#### CLI Post-Save Reflection

After saving, the CLI checks the reflection classification (returned by the API). If classified as `reflect`:
1. Print the saved confirmation: `✓ Saved: "your text..." (id: abc123)`
2. Print the generated auto-title: `  Title: "AI-generated title"`
3. Print the reflection question: `💭 "What exactly sparked this thought?"`
4. Wait for user input (with a timeout of 60s, or skip with Enter)
5. If the user answers, send the reflection answer to the API
6. If the user skips or times out, the reflection remains in `PROMPTED` status for later

For `quick_save` inspirations, just print confirmation + auto-title and exit.

#### CLI Save Feedback

After saving, the CLI always prints:
- Confirmation with a preview of the saved content
- Auto-generated title (once resolved)
- A web app link to view/deepen the inspiration: `  View: ${APP_URL}/inspiration/abc123` (APP_URL from environment variable)

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 5.1 | `npx waka-cli auth` opens browser and completes OAuth | Manual: run command → browser opens → token saved |
| 5.2 | `WAKA_API_KEY` env var works as auth fallback | Test: unset config.json → set env var → save works |
| 5.3 | `echo "test" \| npx waka-cli save` creates an inspiration | Test: pipe text → CLI exits 0 → API receives the inspiration |
| 5.4 | `npx waka-cli save` with no input opens interactive prompt | Test: run without pipe → prompt appears → type text → saved |
| 5.5 | `npx waka-cli save --file ./chat.txt` saves file content | Test: create file → capture → inspiration created with file content |
| 5.6 | `npx waka-cli save --url <url>` triggers URL import | Test: save with URL → inspiration created with URL_IMPORT type |
| 5.7 | `npx waka-cli list` shows recent inspirations with titles | Test: create items → list → output contains auto-generated titles |
| 5.8 | `npx waka-cli deepen <id>` creates linked expansion | Test: deepen → child inspiration created with parentId |
| 5.9 | Post-save reflection prompt appears for complex inspirations | Test: save complex text → reflection question printed → answer sent |
| 5.10 | Post-save reflection can be skipped | Test: save complex text → press Enter → exits without answer |
| 5.11 | Unauthenticated commands show helpful error message | Test: without auth → run save → stderr contains "Please run waka auth first" |
| 5.12 | CLI works on macOS, Linux, and Windows (Node 18+) | CI: test matrix across OS + Node versions |

#### Tests

```
Unit:
- [ ] Auth token resolution: config.json > WAKA_API_KEY env var
- [ ] stdin reading correctly captures piped input
- [ ] Interactive prompt activates when no stdin detected
- [ ] File reading handles missing files gracefully
- [ ] API client sends correct headers and payload
- [ ] Reflection prompt timeout and skip behavior

Integration:
- [ ] Full flow: auth → save → list → verify item appears with title
- [ ] Deepen flow: save → deepen → list → verify expansion linked
- [ ] Reflection flow: save complex text → answer reflection → verify stored
- [ ] Error handling: network failure → retry → meaningful error message

E2E:
- [ ] Install from npm → auth → pipe text → save → list → see it with title
- [ ] Headless auth: set WAKA_API_KEY → save → works without config.json
```

---

### Loop 6: URL Import & AI Conversation Import

**Goal**: Save inspirations from any URL or AI conversation. Waka fetches page content, extracts meaningful text, and creates a rich inspiration. AI conversations are summarized to avoid embedding dilution.

#### Scope

##### URL Import
- **URL input**: Paste a URL into the capture bar (or use CLI `--url`). The capture bar auto-detects URLs.
- **Mixed input**: If user pastes "Great article: https://example.com/post", the commentary ("Great article") becomes `rawContent` and the URL becomes `sourceUrl`. Both are stored.
- **Server-side fetching**: API route fetches the URL, extracts title, meta description, Open Graph data, and main body text
- **Content extraction**: Use `@mozilla/readability` + `cheerio` to strip nav/ads and extract article body
- **Non-HTML content**: PDFs → extract text via `pdf-parse`. Images → store URL, describe via LLM. Other → store URL + metadata only, no body extraction.
- **Auto-summarization**: Extracted content is passed through the LLM summarize pipeline
- **Source metadata**: Store original URL, page title, OG image, domain, and content type in `sourceMeta` (see `UrlImportMeta`)

##### AI Conversation Import
- **Input methods**: (1) Paste a share link (e.g., ChatGPT share URL) — Waka fetches and extracts the conversation. (2) Paste raw transcript text — saved directly.
- **Full storage**: The entire transcript is stored as `rawContent` for reference
- **Smart embedding**: The LLM generates a focused summary of the conversation's key insights, and the *summary* (not the full transcript) is used for embedding generation. This prevents a 50-turn conversation from diluting across too many topics.
- **Metadata**: Store provider, conversation title, model used, and turn count in `sourceMeta` (see `AiConversationMeta`)

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 6.1 | Pure URL in capture bar triggers URL import | E2E: paste URL → system detects it → imports content |
| 6.2 | URL with commentary splits correctly | Test: POST "Great read: https://..." → rawContent = "Great read", sourceUrl = URL |
| 6.3 | Server extracts page title and body text | Test: POST URL of a known article → title and rawContent populated |
| 6.4 | Extracted content excludes navigation, ads, and boilerplate | Test: import a news article → rawContent contains article text only |
| 6.5 | OG metadata stored in sourceMeta | Test: import URL with OG tags → sourceMeta has ogImage, ogDescription, domain |
| 6.6 | PDF content extracted as text | Test: import PDF URL → rawContent contains extracted text |
| 6.7 | Non-extractable URLs stored with metadata only | Test: import binary file URL → stored with URL and content type, no body |
| 6.8 | Auto-summary generated from extracted content | Test: import long article → summary field populated and < 280 chars |
| 6.9 | Invalid/unreachable URLs return clear error | Test: POST invalid URL → 400 with "Could not fetch URL" message |
| 6.10 | CLI `--url` flag triggers the same import | Test: `waka-cli save --url <url>` → inspiration created with URL_IMPORT type |
| 6.11 | AI conversation transcript saved with full text | Test: POST transcript → rawContent has full transcript |
| 6.12 | AI conversation embedding uses summary, not full transcript | Test: POST long conversation → embedding generated from summary |
| 6.13 | AI conversation share link fetched and extracted | Test: POST ChatGPT share link → conversation extracted and saved |
| 6.14 | Inspiration card shows URL domain, favicon, and OG image | E2E: import URL → card shows domain + thumbnail |
| 6.15 | URL import times out after 10s for slow URLs | Test: mock slow URL → timeout → meaningful error |

#### Tests

```
Unit:
- [ ] URL detection: pure URL, URL with commentary, non-URL text, multiple URLs
- [ ] Content extractor strips boilerplate from HTML
- [ ] OG tag parser extracts title, description, image, domain
- [ ] PDF text extraction
- [ ] AI conversation summary generation (summary is focused, not full transcript)
- [ ] Share link detection and provider identification

Integration:
- [ ] Full URL flow: paste URL → fetch → extract → summarize → store with embedding
- [ ] Full AI conversation flow: paste transcript → summarize → embed summary → store
- [ ] Import from CLI --url flag → same result as web app
- [ ] Timeout handling: slow URLs timeout after 10s with meaningful error

E2E (Playwright):
- [ ] Paste article URL in capture bar → inspiration appears with title, summary, and thumbnail
- [ ] Paste "Check this: <url>" → commentary and URL both stored, card shows both
- [ ] Paste AI conversation → card shows conversation summary, not full transcript
- [ ] Paste invalid URL → error toast shown, no inspiration created
- [ ] Imported inspirations appear in semantic search results
```

---

### Loop 7: Synthesis Engine — Thread Placement & Bridge Detection

**Goal**: When a new inspiration is saved, the LLM carefully places it into the knowledge graph — deciding which thread it belongs to, rewriting the thread's synthesis, and detecting new bridges between threads. This is the LLM Wiki engine: the backend that makes threads come alive.

#### Scope

##### Placement (Inspired by LLM Wiki Ingestion)

When a new inspiration arrives (after embedding is generated via SQS consumer), the LLM performs **careful placement** — not just cosine similarity matching, but a deliberate decision about where this inspiration belongs in the user's knowledge graph:

1. **Thread matching**: Run embedding similarity against existing thread centroids + LLM evaluation. The LLM reads the inspiration, reads candidate thread syntheses, and decides: does this belong in an existing thread, or does it warrant a new one?
2. **Thread placement**: If placed in an existing thread, the thread's `synthesis` document is **rewritten** by the LLM to incorporate the new inspiration. This isn't appending — it's re-synthesis. The document may reorganize, surface new connections between inspirations within the thread, and reference the new addition in context of older ones.
3. **New thread creation**: If the inspiration doesn't fit existing threads (or the user has < 3 inspirations total), create a new thread. The initial synthesis is generated from the placed inspiration(s). Minimum 1 inspiration to form a thread (unlike DBSCAN's min_samples=3), because even a single deep thought deserves a home.
4. **Multi-thread placement**: An inspiration can belong to one thread in V1 (single `threadId`). Future versions may support multi-thread membership.

##### Thread Synthesis

Each thread's `synthesis` field is a living document maintained entirely by the LLM. It should:
- Read as a coherent narrative, not a list of bullet points
- Weave together the inspirations in the thread, highlighting how they relate
- Surface surprising connections between inspirations the user may not have noticed
- Reference specific inspirations by content (e.g., "your October note about interpretability")
- Evolve meaningfully each time a new inspiration is placed — not just append a sentence, but potentially restructure the whole narrative

##### Bridge Detection

After placement, the LLM checks whether the updated thread now has meaningful connections to other threads:

- **Bridge creation**: If a new inspiration creates a conceptual link between two threads that weren't previously connected, create a `Bridge` with an AI-generated explanation. E.g., "Your 'Emergence & Complex Systems' thread now connects to 'AI Safety' through the shared concept of controllability in emergent behavior."
- **Bridge updates**: Existing bridges may have their explanations updated if new inspirations strengthen or change the connection.
- **Max 3 new bridges per placement** to cap LLM costs.
- **Similarity threshold**: V1 default cosine similarity > 0.72 between thread centroids as a pre-filter before LLM evaluation. Threshold is a server config constant.

##### Thread Lifecycle
- Threads with all inspirations removed (via soft delete) are themselves soft-deleted
- Thread title is re-generated when the synthesis changes significantly (LLM decides)
- Thread `updatedAt` is touched on every re-synthesis, causing it to re-surface in the feed

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 7.1 | New inspiration triggers thread placement | Test: add inspiration → threadId is set (existing or new thread) |
| 7.2 | Placement into existing thread rewrites synthesis | Test: add inspiration to thread → synthesis changes, incorporates new content |
| 7.3 | New thread created when inspiration doesn't fit existing threads | Test: add unrelated inspiration → new thread created with initial synthesis |
| 7.4 | Thread synthesis reads as coherent narrative, not bullet list | Test: thread.synthesis is prose, references multiple inspirations contextually |
| 7.5 | Thread synthesis references older inspirations when relevant | Test: add 3rd inspiration to thread → synthesis mentions all 3, not just the new one |
| 7.6 | Bridge detected between threads when new connection forms | Test: add inspiration that conceptually links two threads → bridge created |
| 7.7 | Bridge has meaningful AI-generated explanation | Test: bridge.explanation is non-empty, references both threads specifically |
| 7.8 | Max 3 bridges per placement | Test: add inspiration relevant to 5 threads → only top 3 bridges created |
| 7.9 | Empty threads are soft-deleted | Test: remove all inspirations from thread → thread deleted |
| 7.10 | Thread title re-generated when synthesis changes significantly | Test: add inspiration that shifts thread topic → title updated |
| 7.11 | Thread re-surfaces in feed after update | Test: add inspiration to thread → thread.updatedAt touched → appears higher in feed |
| 7.12 | User can dismiss a bridge | Test: dismiss → bridge.dismissed = true → hidden from feed |

#### Tests

```
Unit:
- [ ] Thread matching: embedding similarity pre-filter + LLM placement decision
- [ ] Synthesis generation produces coherent narrative from multiple inspirations
- [ ] Synthesis re-writing incorporates new inspiration without losing existing content
- [ ] Bridge detection between thread centroids (0.72 threshold pre-filter)
- [ ] Bridge explanation generation (mock LLM)
- [ ] Max 3 bridges cap enforced
- [ ] Empty thread cleanup

Integration:
- [ ] Full pipeline: save inspiration → embedding → thread placement → synthesis rewritten → bridge check
- [ ] New thread: save unrelated inspiration → new thread created with synthesis
- [ ] Re-synthesis: add 5th inspiration to thread → synthesis weaves all 5 together
- [ ] Bridge: save inspiration that conceptually links two threads → bridge created with explanation
- [ ] Thread title update when topic shifts

E2E:
- [ ] Save "quantum computing" note → save "quantum entanglement" note → both placed in same thread → synthesis connects them
- [ ] Save inspiration bridging two threads → bridge notification appears in feed
- [ ] Dismiss bridge → no longer shown in feed
```

---

### Loop 8: Adaptive Reflection (Post-Save)

**Goal**: After saving, the system classifies whether the inspiration warrants deeper reflection. If so, it surfaces a reflection question — **never blocking the initial save.**

#### Design Principle

Reflection is always **post-save**. The inspiration is saved and confirmed before any reflection prompt appears. The user must trust that capture is instant and reliable. Reflection is an invitation to go deeper, not a gate on saving.

#### Scope

- **Classification**: LLM classifies each new inspiration's `ReflectionStatus` as part of the async pipeline (SQS job):
  - `NOT_NEEDED` — simple saves (URLs, single words, quick references)
  - `PROMPTED` — complex/nuanced content that would benefit from deeper thinking
- Classification based on: content complexity, novelty relative to existing inspirations, emotional indicators
- **Web reflection UI**: On the inspiration detail page, a non-intrusive inline section shows the reflection question below the content. Not a modal. Not a popup. Just a gentle "💭 Something to think about..." section with a text input. User can answer or dismiss.
- **CLI reflection**: After save confirmation, the CLI prints the reflection question and waits for input (60s timeout). User can answer inline or skip with Enter.
- Reflection answer stored on the inspiration and triggers re-embedding (the answer enriches the semantic signal)

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 8.1 | Save always completes before reflection is shown | Test: POST → 201 returned → reflection classification happens async |
| 8.2 | URL/link saves are classified as `NOT_NEEDED` | Test: save a URL → reflectionStatus = NOT_NEEDED |
| 8.3 | Complex/nuanced text classified as `PROMPTED` | Test: save breakthrough idea → reflectionStatus = PROMPTED |
| 8.4 | Web: reflection shown as inline section on detail page | E2E: save complex text → open detail → reflection section visible (not a modal) |
| 8.5 | CLI: reflection question printed after save confirmation | Test: save via CLI → confirmation printed first → then reflection question |
| 8.6 | Reflection question references specific content | Test: question is contextual, not generic |
| 8.7 | User can answer the reflection (web + CLI) | Test: type answer → saved to inspiration.reflectionAnswer, status = ANSWERED |
| 8.8 | User can skip reflection (web + CLI) | Test: skip/dismiss → reflectionStatus = SKIPPED |
| 8.9 | Reflection answer triggers re-embedding | Test: answer reflection → embedding re-generated → differs from pre-answer |
| 8.10 | Classification latency < 3 seconds | Test: time from SQS job start to classification < 3s |

#### Tests

```
Unit:
- [ ] Classification prompt produces valid ReflectionStatus
- [ ] Reflection question generation references input content
- [ ] Skip/dismiss flow updates status correctly

Integration:
- [ ] URL input → classified NOT_NEEDED → no reflection section
- [ ] Long-form idea → classified PROMPTED → question generated → answer saved → embedding updated
- [ ] CLI reflection: save → confirmation → question → answer → stored

E2E:
- [ ] Web: capture deep thought → navigate to detail → reflection section visible → answer → see on page
- [ ] Web: capture a link → detail page → no reflection section
- [ ] CLI: pipe complex text → save confirmation → reflection prompt → type answer → stored
```

---

### Loop 9: Shareable Inspiration Cards

**Goal**: Users can make individual inspirations or threads public via a shareable link with an attractive card preview.

#### Scope

- Toggle `isPublic` on an inspiration → generates a unique `shareSlug`
- Public page at `/s/:shareSlug` — no auth required, renders a styled card
- Open Graph meta tags for social sharing previews
- OG image: dynamically generated card image (using `@vercel/og` or Satori) showing title, summary snippet, and Waka branding. Falls back to the source's OG image for URL imports.
- Card shows: title, summary, tags, source type icon, domain (if URL), and creation date
- Thread sharing: shareable link for an entire thread showing the synthesized document and all public inspirations within it. Inspirations set to private within a shared thread are excluded from the shared view.

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 9.1 | Toggle public → shareSlug generated | Test: PUT isPublic=true → shareSlug is non-null |
| 9.2 | Public page renders without authentication | Test: GET `/s/:slug` in incognito → 200 + card content |
| 9.3 | OG meta tags present for social previews | Test: parse HTML → og:title, og:description, og:image present |
| 9.4 | OG image is dynamically generated card | Test: GET og:image URL → returns rendered card image with title |
| 9.5 | Private inspirations return 404 on public URL | Test: isPublic=false → GET `/s/:slug` → 404 |
| 9.6 | Thread share page shows synthesis + only public inspirations | Test: share thread → 1 private item → page shows synthesis + all except private item |
| 9.7 | Unsharing removes access | Test: toggle isPublic=false → GET `/s/:slug` → 404 |

#### Tests

```
Unit:
- [ ] Share slug generation is unique and URL-safe
- [ ] OG tag generation from inspiration data
- [ ] Dynamic OG image rendering

Integration:
- [ ] Make public → fetch public URL → content matches
- [ ] Make private again → public URL returns 404
- [ ] Thread share → private items excluded, public items shown

E2E:
- [ ] Share inspiration → copy link → open in incognito → card renders correctly
- [ ] Share link preview renders correctly (OG tag validator)
- [ ] Thread share with mixed public/private items → only public shown
```

---

## 4. Loop Dependency Graph

```
Loop 1: Foundation & Auth (+ S3 + SQS)
  │
  ▼
Loop 2: LLM Adapter & Embeddings (+ async pipeline)
  │
  ▼
Loop 3: Core Capture API (+ Deepen flow)
  │
  ├──────────────┬──────────────┐
  ▼              ▼              ▼
Loop 4:        Loop 5:       Loop 6:
Web App        CLI Tool      URL + AI Conv
(capture-      (reflection   Import
 first,        in terminal,
 threads,      env var auth)
 offline
 queue)
  │              │              │
  └──────────────┴──────────────┘
                 │
                 ▼
           Loop 7: Synthesis Engine
                 │ (LLM Wiki-style thread
                 │  placement, synthesis
                 │  rewriting, bridge
                 │  detection)
                 ▼
           Loop 8: Adaptive Reflection
                 │ (post-save only,
                 │  never blocking,
                 │  cold start bridge)
                 ▼
           Loop 9: Shareable Cards & Threads
                   (dynamic OG images)
```

Loops 4, 5, 6 can execute **in parallel** after Loop 3 is complete.
Loop 6 (URL + AI Conversation Import) integrates into Loop 4 (Web App capture bar) and Loop 5 (CLI `--url` flag).

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
LLM_PROVIDER=openai  # openai | gemini (affects summarization/classification only)
OPENAI_API_KEY=...    # Always required (embeddings are locked to OpenAI for V1)
GEMINI_API_KEY=...    # Required only if LLM_PROVIDER=gemini

# Deployment
AWS_REGION=us-east-1

# App URL (used by CLI for inspiration links, dynamic OG images, etc.)
APP_URL=http://localhost:3000  # In production: https://your-domain.com

# CLI Auth (alternative to OAuth flow for headless environments)
# Users can generate this from the web app settings page (Loop 1)
WAKA_API_KEY=...
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
│   │   │   │   ├── inspiration/[id]/
│   │   │   │   └── settings/  # API key generation for CLI
│   │   │   ├── s/[slug]/     # Public share pages
│   │   │   ├── api/
│   │   │   │   ├── inspirations/
│   │   │   │   │   ├── route.ts        # GET (list), POST (create)
│   │   │   │   │   ├── [id]/
│   │   │   │   │   │   ├── route.ts    # GET, PUT, DELETE
│   │   │   │   │   │   └── deepen/
│   │   │   │   │   │       └── route.ts # POST (create expansion)
│   │   │   │   │   └── search/
│   │   │   │   │       └── route.ts    # GET (semantic search)
│   │   │   │   ├── import/
│   │   │   │   │   └── url/
│   │   │   │   │       └── route.ts    # POST (URL import)
│   │   │   │   └── auth/
│   │   │   │       └── [...nextauth]/
│   │   │   └── og/
│   │   │       └── [slug]/
│   │   │           └── route.tsx       # Dynamic OG image generation
│   │   ├── components/
│   │   │   ├── capture-bar/   # Multi-modal capture bar
│   │   │   ├── feed/          # Mixed feed (captures + threads + bridges)
│   │   │   ├── thread/        # Thread card, thread detail view
│   │   │   ├── inspiration/   # Capture card, detail view, skeleton
│   │   │   └── reflection/    # Inline reflection UI
│   │   ├── lib/
│   │   │   ├── llm/          # LLM adapter
│   │   │   ├── auth/         # Auth utilities
│   │   │   ├── db/           # Prisma client
│   │   │   ├── import/       # URL + AI conversation extractors
│   │   │   ├── synthesis/    # Thread placement, synthesis rewriting, bridge detection
│   │   │   ├── offline/      # IndexedDB queue for offline capture
│   │   │   └── media/        # S3 upload, voice recording, photo capture
│   │   └── public/
│   └── cli/                  # waka-cli npm package
│       ├── src/
│       │   ├── commands/
│       │   │   ├── save.ts    # save (text, file, url, stdin)
│       │   │   ├── list.ts
│       │   │   ├── deepen.ts
│       │   │   └── auth.ts
│       │   ├── reflection.ts  # CLI reflection prompt
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
