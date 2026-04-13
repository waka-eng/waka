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

Waka is **capture-first**. The app opens to a floating capture island — always visible, always ready for input. The entire UX is designed around one goal: **saving an inspiration must feel as reliable and instant as Apple Notes.** Nothing typed into Waka should ever be lost.

### Secondary JTBD: Surprising Discovery

The value of Waka is not organization — it's **unexpected resonance**. The moment when something you saved today surfaces a forgotten thought from six months ago. The moment when two ideas you thought were unrelated turn out to share a deep connection. Discovery happens inside threads: you open one and find a paragraph that weaves together things you didn't know were related, written in a way that makes you think differently.

Key capture behaviors:
- **Minimum viable inspiration**: A single word, a bare URL, or a one-line thought are all valid. Low-signal inputs get fewer AI-generated metadata fields, but they are always accepted and saved.
- **Optimistic save**: Inspirations appear in the feed immediately on submit. AI-generated fields (title, summary, tags, embedding) render as skeleton placeholders that animate in as they resolve — the card should feel *loading*, never *incomplete*.
- **Floating capture island**: The capture bar is a floating element anchored to the bottom of the viewport — always visible as you scroll, on every view (home, thread detail, inspiration detail). It never scrolls away. Even while deep in a thread, a new thought can be captured without navigating or scrolling back up.
- **Explicit submit, zero-failure guarantee**: Pressing enter/submit saves instantly. This is not auto-save-on-keystroke (which would persist half-formed sentences), but the submit action itself must never fail silently. If the server is unreachable, the capture bar retains the text, queues it locally, and retries on reconnection — the user's input is never cleared without confirmation of persistence.
- **Conversational post-save**: After saving, the capture bar doesn't just reset — it responds. If the system has a reflection question, it appears right in the bar as a follow-up: "What sparked this?" The user can reply in the same bar (the answer becomes a new linked inspiration), or simply ignore it — the prompt fades after a few seconds and the bar resets, ready for the next capture. This makes the transition from capture to reflection feel like a natural conversation, not a separate feature. If you're in a rush, save and go. If you're in the mood to explore, keep talking to the bar.

### Information Architecture

Two levels. Extremely minimal.

1. **The Surface** — When you open WAKA, you see a living, breathing canvas of your thinking. Threads appear as soft, organic regions — not cards, not tiles, not a list. Each region is sized and colored by how active it is: threads with recent activity are **larger, warmer, and more visually present** (closer to center, gently pulsing). Dormant threads are **smaller, cooler, and pushed to the edges**. Each region shows the thread title and a line or two of the synthesis — enough to read the insight without tapping. Bridges between threads are expressed spatially: connected threads drift closer together, their edges overlapping. Unplaced captures appear as small, cool dots floating on the surface, waiting to be absorbed. A minimal "+" button sits at the bottom right corner for capture. The user's avatar sits in the top corner for settings (opens as a bottom sheet on mobile, modal on desktop). Search is a pull-down gesture from the top of the surface — pull down, type to filter threads semantically, release to dismiss.
2. **Thread Detail** — Tap a region to expand it. The region smoothly fills the screen, revealing the full synthesized document. Individual inspirations that compose the thread are listed below the synthesis. "Deepen" action available. Tap back or swipe to return to the surface. The other regions fade to background during the transition.

The frontend never shows a graph, nodes, or edges. This is not a node-and-line visualization — it's an ambient, organic representation of where your thinking is alive. No labels saying "Thread" or "Bridge." No section headers. No categories. The surface IS the product. The wow is visible the moment you open it — you see your own thinking breathing.

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

### Design Principles & Emotional Architecture

This section is the bridge between the spec and the `vendor-skills/taste-skill/SKILL.md`. It translates WAKA's product intent into design constraints that the taste skill can derive from. Every UI story must trace its design decisions back to these principles.

#### The Core Feeling

When you open WAKA, it should feel like looking at a living painting of your mind. Not a dashboard. Not a feed. Not a tool. A **surface that breathes** — warm where your thinking is active, cool where it's dormant, with regions that grow and drift and overlap as your ideas evolve.

The design is extremely minimal. Visually simple but interactionally rich. Every element earns its presence. No section headers, no labels, no badges, no categories. The content communicates what it is. Whitespace does the work.

#### The Two Modes

1. **Capture mode** — The user taps "+", a clean input sheet rises from the bottom. Type, submit, done. The sheet closes. On the surface, you watch the thought get absorbed — the region it's placed into grows slightly, warms, pulses. The conversational reflection ("What sparked this?") appears in the same input sheet. Ignore it and it fades. Answer it and it deepens the capture. The entire flow happens in one gesture without leaving the surface.

2. **Discovery mode** — The user is looking at the surface. The wow is already visible — synthesis text on each region, threads overlapping where bridges formed. Tap a region and it expands smoothly to fill the screen with the full synthesis. Tap back and you're at the surface again. No navigation hierarchy. Just zoom in, zoom out.

#### Screen-Specific Emotional Context

**The Surface**
- *Arriving state*: The user just opened WAKA. They might have something to capture, or they might be checking in.
- *Target feeling*: "My thinking is alive." The surface should feel like it's been breathing while you were away — regions have shifted, some grew, some new ones appeared. Calm but alive. Not demanding attention, just present.
- *Design constraint*: Organic shapes, not rectangles. Warm color temperature for active regions, cool for dormant. Gentle ambient motion (regions slowly drifting, pulsing). Extremely low visual density — the surface should feel spacious, not crowded. On mobile (375px), show 2-3 active regions. On desktop (1440px), show 5-8. The regions must render via canvas/WebGL/SVG for smooth organic shapes and animation — standard CSS boxes will not achieve this.

**The "+" Capture Button**
- *Arriving state*: The user has a thought.
- *Target feeling*: Instant trust. Tap "+", type, it's saved. Nothing else.
- *Design constraint*: The "+" button is the most minimal element on the screen — small, circular, bottom right. Tapping it opens a clean, full-width input sheet from the bottom. The sheet has: text input, voice icon, photo icon. Nothing else. No title, no labels, no workspace name. Submit closes the sheet. The reflection question slides in gently as placeholder text in the same input. Auto-fades after ~5s.

**Thread Detail (Expanded Region)**
- *Arriving state*: The user tapped a region. They're leaning in.
- *Target feeling*: Deep resonance. "This is my thinking, but organized in a way I couldn't have done myself."
- *Design constraint*: The region expands to fill the screen with a fluid spring animation. Other regions fade to background. The synthesis document dominates — generous typography (max-w-[65ch], relaxed leading). Individual inspirations listed below as supporting evidence. "Deepen" action available. Tap back or swipe to return to the surface. VISUAL_DENSITY ~2-3.

**Search (Pull-Down)**
- Pull the surface down slightly from the top. A search field appears. Type to semantically filter — the surface transforms, showing only matching threads and their regions. Clear the search or release to return to the full surface. On mobile, search can also be triggered by a small search icon near the avatar.

**Settings (Avatar)**
- The user's avatar in the top corner. Tap → bottom sheet (mobile) or modal (desktop) with: API keys, sign out, account info. Never a full page.

#### Palette & Typography Direction

- **Base**: Warm neutrals (Stone/Warm Gray), not cool (Slate/Zinc). WAKA is personal and reflective, not corporate or technical.
- **Accent**: A single, desaturated warm accent. Not purple (banned per taste skill), not blue (too generic). Consider: warm amber, muted terracotta, or deep sage — colors that feel like thought, not action.
- **Typography**: `Geist` for UI, `Geist Mono` for metadata (timestamps, counts). Thread synthesis should use a slightly more expressive weight to differentiate it from standard UI text.
- **Dark mode first**: WAKA is a reflective, personal space. Dark backgrounds with warm text feel more intimate than bright white screens.

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

### Loop 4: Web App — The Living Surface

**Goal**: Responsive PWA with an organic, breathing canvas that visualizes the user's thinking as warm/cool regions. Extremely minimal design. A "+" button for capture, pull-down for search, avatar for settings. The LLM Wiki complexity lives entirely in the backend — the frontend shows a living painting of the mind.

#### Scope

##### The Surface (Home View)
- **Organic regions**: Each thread is rendered as a soft, organic shape (blob/region) on a canvas — not a card, not a rectangle. Rendered via canvas, WebGL, or SVG for smooth organic shapes and fluid animation. Standard CSS boxes will not achieve this.
- **Warmth = activity**: Regions are sized and colored by recency and activity. Recently updated threads are larger, warmer in color (warm amber/terracotta tones), positioned closer to center, and gently pulsing with breathing animation. Dormant threads are smaller, cooler (muted stone/gray tones), and pushed to edges.
- **Text on regions**: Each region displays the thread title and 1-2 lines of synthesis excerpt directly on its surface. The insight is readable without tapping. The wow is visible at scroll level.
- **Bridges as proximity**: Connected threads (bridges) drift closer together, their edges overlapping. The connection is spatial, not drawn with lines or labels. Two overlapping regions = two threads that share a conceptual link.
- **Unplaced captures**: New captures that haven't been placed into threads appear as small, cool dots floating on the surface. When the backend places a capture, the dot animates toward its thread region and gets absorbed — the region grows slightly, warms, pulses.
- **Layout**: On mobile (375px) show 2-3 active regions filling the viewport. On desktop (1440px) show 5-8. The surface is pannable if more regions exist than fit in the viewport. Regions reflow organically — no grid, no fixed positions.
- **No headers, no labels, no sections, no categories.** The surface is the entire experience.

##### Capture ("+" Button)
- **Minimal trigger**: Small circular "+" button, bottom right corner. The most minimal element on the screen.
- **Input sheet**: Tapping "+" opens a clean, full-width sheet from the bottom. Contains: text input, voice icon, photo icon. Nothing else — no title, no workspace name, no labels.
- **Text**: Type and press Enter to save. Single word, bare URL, or paragraph — all accepted.
- **URL detection**: If pasted text is a URL (or contains a URL alongside commentary), auto-detect and split into `rawContent` (commentary) + `sourceUrl` (URL) with `URL_IMPORT` source type.
- **Voice**: Tap mic icon → browser MediaRecorder API → stop recording → upload audio to S3 → transcribe via LLM → save with `VOICE_NOTE` type.
- **Photo**: Tap camera icon → file picker or camera capture → upload to S3 → LLM describes/OCRs image → save with `PHOTO` type.
- **AI conversation**: Tap brain/chat icon → paste transcript or share link → save with `AI_CONVERSATION` type. Full transcript stored as `rawContent`; LLM generates focused summary for embedding.
- **Submit closes the sheet.** The user returns to the surface and watches their capture appear as a dot, then get absorbed into a region.

##### Conversational Post-Save Reflection
- After submit, the input sheet doesn't immediately close if the system has a reflection question (see Loop 8). Instead, the placeholder text becomes the question: "What sparked this?"
- The user can reply directly — the answer is saved as a linked inspiration (`parentId` pointing to the original).
- **Instant escape**: If ignored, the question fades after ~5 seconds and the sheet closes. No tap to dismiss required.
- If the server is unreachable: capture is persisted to IndexedDB, a "queued" indicator appears on the dot, and the app retries when connectivity returns.

##### Thread Detail (Expanded Region)
- Tap a region → it expands smoothly (fluid spring animation) to fill the screen. Other regions fade to background.
- Full synthesized document displayed — generous typography (max-w-[65ch], relaxed leading). The synthesis is the hero.
- Individual inspirations that compose the thread listed below as supporting evidence.
- Bridges to other threads shown as contextual links within the synthesis text.
- "Deepen" action to add more context to this thread.
- Thread's `updatedAt` and inspiration count visible.
- Tap back or swipe → region contracts, other regions fade back in. Return to the surface.

##### Search (Pull-Down)
- Pull the surface down from the top → a search field appears.
- Type to semantically filter threads — the surface transforms, showing only matching regions (non-matching regions fade/shrink).
- Clear or release → full surface returns.
- On mobile, also accessible via a small search icon near the avatar.

##### Settings (Avatar)
- User's avatar in the top corner.
- Tap → bottom sheet (mobile) or modal (desktop) with: API keys, sign out, account info.
- Never a full page.

##### Offline Capture Queue
- Service worker caches app shell for offline loading.
- When offline, the "+" capture sheet still works: submitted captures are saved to IndexedDB with a `queued` status.
- When connectivity returns, queued captures are synced automatically (last-write-wins).
- Queued dots on the surface show a subtle "waiting to sync" indicator.

##### Other
- PWA manifest and service worker
- Responsive design: mobile-first, works on all screen sizes (375px — 1440px)
- Empty state: when no threads exist yet, the surface is a calm, empty canvas with the "+" button and a gentle prompt: "Save your first thought"

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 4.1 | App opens to the living surface with organic thread regions | E2E: login → canvas renders with thread regions sized by activity |
| 4.2 | Thread regions show title + synthesis excerpt readable without tapping | E2E: thread region displays title and 1-2 lines of synthesis on its surface |
| 4.3 | Active threads are larger, warmer, closer to center | Visual: recently updated thread is visibly larger and warmer than dormant thread |
| 4.4 | Dormant threads are smaller, cooler, at edges | Visual: thread with no recent activity is small, muted, at periphery |
| 4.5 | Bridged threads overlap spatially | Visual: two threads with a bridge have overlapping region edges |
| 4.6 | "+" button opens clean capture sheet from bottom | E2E: tap "+" → sheet rises with text input + voice/photo icons, nothing else |
| 4.7 | Text capture: type → submit → sheet closes → dot appears on surface | E2E: type text → submit → dot animates onto surface |
| 4.8 | Dot gets absorbed into thread region when placed | E2E: save text → dot appears → backend places → dot animates into region → region grows/warms |
| 4.9 | URL auto-detection splits commentary + sourceUrl | E2E: paste text+URL → rawContent has commentary, sourceUrl has URL |
| 4.10 | Voice capture via MediaRecorder → S3 → transcription | E2E: record audio → dot appears with transcript |
| 4.11 | Photo capture → S3 → LLM description/OCR | E2E: pick photo → dot appears with AI description |
| 4.12 | AI conversation import with focused summary for embedding | E2E: paste conversation → dot appears with summary |
| 4.13 | Conversational reflection appears in capture sheet after save, auto-fades ~5s | E2E: save complex text → reflection question appears → ignore → fades → sheet closes |
| 4.14 | Reflection answer saved as linked inspiration | E2E: answer reflection → new inspiration with parentId created |
| 4.15 | Thread detail: tap region → expands to full synthesis + composing inspirations | E2E: tap region → smooth expand → synthesis readable → inspirations listed below |
| 4.16 | Thread detail: tap back → region contracts, surface returns | E2E: tap back → fluid contraction → all regions visible again |
| 4.17 | Search: pull down → type → surface filters semantically | E2E: pull down → type "AI" → only matching regions remain visible |
| 4.18 | Settings: avatar → bottom sheet with API keys, sign out | E2E: tap avatar → sheet with account info |
| 4.19 | Offline capture: go offline → capture → queued dot → go online → synced | E2E: disconnect → capture → dot shows queued → reconnect → synced |
| 4.20 | PWA installable on mobile Chrome/Safari | Manual: "Add to Home Screen" prompt appears |
| 4.21 | Responsive: surface works on 375px through 1440px | Visual: 2-3 regions on mobile, 5-8 on desktop |
| 4.22 | Empty state: no threads → calm canvas with "+" and gentle prompt | E2E: new user → empty surface → "Save your first thought" |
| 4.23 | No section headers, no labels, no categories anywhere on the surface | Visual: zero UI chrome beyond avatar, search, and "+" |

#### Tests

```
Unit:
- [ ] URL detection regex: pure URL, URL with commentary, non-URL text
- [ ] Offline queue: add to IndexedDB, retrieve, mark as synced
- [ ] Region sizing algorithm: activity score → size/warmth/position
- [ ] Bridge proximity: bridged threads have overlapping region bounds
- [ ] Capture sheet state management (open/close/reflection/fade)

Integration:
- [ ] Text capture → dot on surface → backend places → dot absorbed into region
- [ ] Voice capture → S3 upload → transcription → dot on surface
- [ ] Photo capture → S3 upload → description → dot on surface
- [ ] AI conversation paste → summary generated → dot on surface
- [ ] Offline capture → queue → reconnect → sync → dot absorbed
- [ ] Deepen → child created → parent re-processed → region updates
- [ ] Region grows/warms when new inspiration placed into thread

E2E (Playwright):
- [ ] Full capture flow: login → "+" → type → submit → dot → absorbed into region → region grows
- [ ] Multi-modal: capture voice → capture photo → capture URL → all appear as dots
- [ ] Thread formation: save 5 related notes → new region appears on surface
- [ ] Bridge formation: save inspiration bridging threads → regions drift together, overlap
- [ ] Thread detail: tap region → expand → read synthesis → tap back → contract
- [ ] Search: pull down → type → surface filters → clear → full surface returns
- [ ] Offline flow: go offline → capture → go online → dot synced
- [ ] Mobile viewport: surface works at 375px with 2-3 regions
- [ ] PWA: manifest present, service worker registered
- [ ] Empty state: new user sees calm canvas with prompt
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
- **Web reflection UI**: The primary reflection surface is the **floating capture island** itself. After saving, if the inspiration is classified as `PROMPTED`, the bar's placeholder text becomes the reflection question (e.g., "What sparked this?"). The user can reply right there — the answer is saved as a linked inspiration. If ignored, the prompt fades after ~5 seconds and the bar resets. Reflection is also accessible later on the inspiration detail page as a non-intrusive inline section. The key principle: reflection should feel like a conversational follow-up in the moment of capture, not a task to complete later.
- **CLI reflection**: After save confirmation, the CLI prints the reflection question and waits for input (60s timeout). User can answer inline or skip with Enter.
- Reflection answer stored on the inspiration and triggers re-embedding (the answer enriches the semantic signal)

#### Acceptance Criteria

| # | Criteria | Verification |
|---|----------|-------------|
| 8.1 | Save always completes before reflection is shown | Test: POST → 201 returned → reflection classification happens async |
| 8.2 | URL/link saves are classified as `NOT_NEEDED` | Test: save a URL → reflectionStatus = NOT_NEEDED |
| 8.3 | Complex/nuanced text classified as `PROMPTED` | Test: save breakthrough idea → reflectionStatus = PROMPTED |
| 8.4 | Web: reflection appears in floating capture island after save | E2E: save complex text → bar shows reflection question → reply saves linked inspiration |
| 8.4b | Web: reflection also accessible on inspiration detail page | E2E: save complex text → open detail → reflection section visible (not a modal) |
| 8.5 | CLI: reflection question printed after save confirmation | Test: save via CLI → confirmation printed first → then reflection question |
| 8.6 | Reflection question references specific content | Test: question is contextual, not generic |
| 8.7 | User can answer the reflection (web + CLI) | Test: type answer → saved to inspiration.reflectionAnswer, status = ANSWERED |
| 8.8 | User can skip reflection: web (ignore for ~5s, auto-fades) + CLI (Enter) | Test: skip/dismiss → reflectionStatus = SKIPPED |
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
