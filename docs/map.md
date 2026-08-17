# The map

For someone who has never opened this repository. It answers three questions
and nothing else: what the three packages are, what happens end to end when a
person saves something, and which six files to read first.

Everything here was checked against the code at the commit that added it, by
following calls rather than by trusting the surrounding documents. Where a
document and the code disagree today, the disagreement is written down at the
bottom rather than quietly smoothed over — a map that is confidently wrong is
worse than no map.

## Read these two first

- **`docs/data-model.md`** — the vocabulary of record. Three layers, owned by a
  profile: **inspiration** (a save), **signal** (an evidence-backed pattern
  distilled from saves), **top of mind** (one synthesized artifact per profile).
  When the code and that document disagree, the code is the side that is wrong.
- **`docs/architecture.md`** — where things live, and the three vocabularies.

### The three vocabularies, because everything below depends on them

This repo deliberately keeps three sets of words for the same three things, and
flattening them is how the last round of naming debt started.

| Register | Words | Where it is legal |
| --- | --- | --- |
| **canon** | inspiration, signal, top of mind, profile, group | every identifier, every column, every payload — both packages |
| **world** | the field, the sky, headquarters, the ground, an orb, a wall | prose and UI only, naming **where** a layer is drawn, never a type or function name |
| **human** | "room", "kept", "let go", "held" | strings a person reads on screen |

A signal is a signal in the database, in the route, in the client, and in the
view model. It is drawn *in the sky*, and a person on screen reads about their
*rooms*. `packages/web/scripts/check-vocabulary.mjs` enforces the first column
mechanically over `packages/web/src` — it reads identifiers only, and leaves
comments and user-facing strings alone on purpose, because a gate that fires on
prose teaches people to write less prose.

---

## 1. The three packages

`pnpm-workspace.yaml` globs `packages/*`. There are three, and they are not
peers in size. Measured under `src/` at this commit: the API is 17,608 lines of
TypeScript plus 6,947 of tests beside it; the web app is 20,526 lines of
TypeScript — **10,110 of them in one file** — plus 6,005 of CSS; admin is 833
lines across four files.

### `packages/api` — the server, the schema, and the generation pipeline

A Hono app on a single AWS Lambda Function URL, over Neon Postgres via Drizzle.
It owns every noun in `docs/data-model.md`, every rule about who may read whose
memory, and both model calls that turn saves into signals and signals into a top
of mind. It is also the queue: there is no broker, work is a row in
`background_jobs`.

Two deployed entry points, and neither is the file you would guess:
`packages/api/src/lambda.ts` is the API handler and
`packages/api/src/background-worker.ts` is the cron-driven worker
(`sst.config.ts` names both). `packages/api/src/index.ts` is where the app is
actually assembled — read that one; it is 94 lines and it is the API's table of
contents.

### `packages/web` — the product, and it is one screen

Vite + React 18 + React Router, shipped as an SST `StaticSite`. Home (`/`) is a
full-viewport canvas the three layers are drawn into vertically — signals
overhead, the one artifact where you stand, every inspiration as an orb on the
ground below — with a horizontal axis for *whose* wall you are standing on:
agents to the left, you at the origin, rooms to the right. A handful of
deliberately flat screens (`/login`, `/profile`, `/onboarding`, `/:handle`) sit
outside the canvas because text that reflows at 200% and real focus traps are
things in-canvas UI cannot give.

### `packages/admin` — an internal queue inspector

Four source files, no SST entry, not deployed. It lists rows from
`background_jobs` through `/api/admin/background-jobs` so an operator can see
which work is stuck. It shows operational facts and the ids a payload names, and
deliberately does not resolve those ids into the rows behind them — debugging a
queue must not become a way to read a person's saves.

---

## 2. The one path, end to end

A person types a sentence into the mouth at the bottom of Home and presses keep.
This is what actually happens, in file order. Every hop below was read.

### Out: the browser to the row

1. **`packages/web/src/pages/Home.tsx` → `keepIt()`.** The orb is born on the
   canvas *before* the network is asked, because that is the payoff and because
   a save that only appears once a server agreed teaches you the world is
   somewhere else. Any `https://` links in the text are pulled out here, to be
   sent as attachments in step 8 once the row has an id. If the request fails
   the orb is retracted and the words come back.
2. **`packages/web/src/lib/api.ts` → `createInspiration()`.** The only place in
   the web package where HTTP happens — there is no `fetch` anywhere else under
   `packages/web/src`, and that is checkable in one grep. It POSTs to
   `apiPath("/inspirations")` with `credentials: "include"`, so the httpOnly
   session cookie rides along.
3. **`packages/api/src/index.ts`** mounts `inspirationsRoutes` at
   `/api/inspirations`, under an app-wide `Cache-Control: no-store, private` —
   every response here is scoped to one session's profile, so a shared cache
   keyed on the URL would serve one person's answer to another. It has.
4. **`packages/api/src/routes/inspirations.ts` → `POST /`.** `requireAuth`
   (from `packages/api/src/lib/middleware.ts`) resolves the session and the
   **one profile it is bound to**; `resolveTargetProfile` decides whether this
   session may capture into the profile named by `?profile=`. Two rules worth
   knowing before you touch this handler: a browser session's `source` is always
   `"app"` (a browser cannot claim to be an agent by sending a field), and an
   agent capturing *into someone else's* profile silently loses the ability to
   set `visibility: "public"` — relaying your words is the point of the tool,
   publishing under your name is a different permission wearing the same
   request.
5. **The row lands** in `inspirations`
   (`packages/api/src/db/schema-inspirations.ts`) inside one transaction with
   any same-submit reflections, through the lazy Drizzle client in
   `packages/api/src/lib/db.ts`. The response is 201 with the canonical row, and
   the browser adopts the server's id so a reload finds one memory rather than
   two.

### Across: the inspiration becomes evidence for a signal

6. **`packages/api/src/lib/queue.ts` → `enqueueDeriveSignals()`**, called by the
   route as `requestSignalDerivation`. Postgres is the queue: a `derive_signals`
   row in `background_jobs`, idempotency-keyed on
   `derive_signals:<inspirationId>:<reason>` so a route that fires on every save
   need not know whether it already fired. A failed enqueue is logged and never
   thrown into the person's write.
7. **The worker wakes.** In a deployed stage the API invokes
   `packages/api/src/background-worker.ts` asynchronously so derivation starts
   in the same second; locally an in-process timer drains instead; once a day a
   cron sweeps for whatever a missed wake-up left behind. The worker drains
   until the queue is dry rather than one batch, because the pipeline enqueues
   as it goes.
8. *(when the text contained a link, or the person attached an image)* **A
   second, later branch joins here, and its order surprises people.** The
   attachment is a *separate request*: Home calls `finalizeAttachment` only
   after the capture returns an id, so `POST /api/attachments`
   (`packages/api/src/routes/attachments.ts`) enqueues `enrich_attachment`
   *after* the first derivation was already queued. Enrichment —
   `packages/api/src/lib/signal-enrichment.ts` for page bodies,
   `packages/api/src/lib/image-description.ts` for a one-time cached vision
   description — then enqueues **another** `derive_signals`, this one with
   `reason: "edited"`. So a link-bearing save is normally read twice: once as
   bare text, and again once the page behind the link is in the database. That
   matters, because without the second pass a bare link is mute to everything
   above it — the argument that moved someone lives inside that page.
9. **`packages/api/src/lib/queue.ts` → `processBackgroundJob()`** dispatches
   `derive_signals` to **`packages/api/src/lib/signal-derivation.ts` →
   `deriveSignalsForInspiration()`**. One pass: load the save with its
   reflections and its attachments' enrichment; ask the provider for 0–3
   candidate statements; embed the save and each candidate; then **match or
   mint** — cosine each candidate against the profile's existing signal vectors
   (`packages/api/src/scoring/vector.ts`), and above `0.86` the save becomes
   *evidence for* a signal that already exists, below it a new `emerging` signal
   is written. Rows land in `signals` and `signal_evidence`
   (`packages/api/src/db/schema-signals.ts`), vectors in
   `packages/api/src/db/schema-embeddings.ts` via
   `packages/api/src/lib/inspiration-embeddings.ts`.
   Only the candidate step is a model call. Everything that decides what the
   profile ends up holding is deterministic, which is what makes the thresholds
   tunable rather than mysterious.
10. **The model call itself** goes `lib/model-provider.ts` (the interface) →
    `lib/gemini-model-provider.ts` (the binding) →
    **`packages/api/src/queue/gemini.ts`** (prompts, request body, envelope
    parse, Zod re-validation) → `lib/gemini-http.ts` (the wire). User text is
    fenced in delimiters at every point it appears; nothing the model returns is
    trusted without re-checking it against rows the database owns.
11. **Promotion** to `active` happens at **three** pieces of evidence. It is
    enforced twice on purpose: in the derivation pass, and by a Postgres trigger
    (`drizzle/migrations/0003…`, narrowed to the transition by `0005…`). The
    trigger is why `packages/api/src/db/signal-promotion-guard.db.test.ts`
    exists and why it opens a real database — no mocked query builder can see a
    trigger fire.

### Up: the signal becomes part of a top of mind

12. **Back in `processBackgroundJob`**, a derivation that actually moved the
    signal set enqueues `refresh_top_of_mind`. A pass that yielded nothing does
    not — a save that changed nothing must not cost a synthesis. The refresh job
    is debounced by a partial unique index, so a burst of saves collapses into
    one synthesis.
13. **`packages/api/src/lib/top-of-mind-synthesis.ts` →
    `refreshTopOfMindForProfile()`** takes an advisory lock
    (`lib/top-of-mind-family-lock.ts`), selects the profile's strongest signals
    deterministically, asks for the **whole artifact** in one call, and then
    validates it: a citation the model invented is dropped, an entry left with
    no citation goes with it, and entries the owner locked, pinned or dismissed
    are copied forward from the stored rows rather than from the reply. Nothing
    is mutated in place — a new version is written and the old one points
    forward at it (`packages/api/src/db/schema-top-of-mind.ts`). A pass where
    nothing moved still writes a version, with `reason: "no_change"`, because a
    silent empty pass and a broken generator look identical from outside.

### Back: how the person sees it

14. **`packages/web/src/pages/Home.tsx` on mount** calls three loaders in
    `packages/web/src/lib/data.ts`: `loadInspirations()` (which follows the
    server's cursor — throwing it away silently capped the ground at one page),
    `loadSignals()`, `loadTopOfMind()`. Those call `fetchInspirationPage`,
    `fetchSignals`, `fetchTopOfMind` in `packages/web/src/lib/api.ts`, which hit
    `GET /api/inspirations`, `GET /api/signals`
    (`packages/api/src/routes/signals.ts`) and `GET /api/top-of-mind`
    (`packages/api/src/routes/top-of-mind.ts`).
15. **`lib/data.ts` turns payloads into view models** — `toInspiration`,
    `toSignal`, `toEntry`. This is the layer where dates become milliseconds and
    the canon's `visibility` enum flattens into a boolean, and it is documented
    as lossy where it is lossy.
16. **The drawing.** Home builds one `Ball` per inspiration with `makeBall`
    (`packages/web/src/space/inspiration/orb.ts`) and lights it with `colorBall`
    (`packages/web/src/space/inspiration/field.ts`); signals become the sky
    through `packages/web/src/space/signal/sky.ts` and its frame step in
    `sky-engine.ts`; the artifact becomes the poster through
    `packages/web/src/space/top-of-mind/board.ts` and `poster.tsx`.
17. **Generation is asynchronous, so the screen is not live.** The person sees
    their orb immediately (step 1). The signal it fed appears on the next read:
    a reload, or coming back to the tab after long enough away — Home re-reads
    the ground, the agents and the sky on `visibilitychange`. Nothing polls. If
    a save seems to have produced no signal, that is the first thing to check
    before suspecting the pipeline.

**A group changes only the middle of this.** Members share *signals* to a group
(`POST /api/signals/:signalId/shares`), and the group's own artifact is
synthesized from those shared statements via `refresh_group_top_of_mind`. A
group's *ground* is a separate thing: the public saves of its current members,
served by `GET /api/groups/:groupId/field`. Evidence never crosses — a shared
statement may cite memories its author kept private, so a room can show a
statement whose grounds are not all visible in that room.

---

## 3. The six files to read first

In this order. The first three are 1,059 lines together; the first five are
3,260. The sixth is read in two pieces and never linearly.

1. **`packages/api/src/index.ts`** (94 lines) — every route mount on one page,
   in layer order, each with a sentence saying what it is for. Read it and you
   know the entire API surface and can find any handler in one hop.
2. **`packages/api/src/db/schema-signals.ts`** (233 lines) — the middle layer,
   which is the one that explains the other two. `signal_evidence` is M:N to
   inspirations (so a signal is a *pattern*, not a per-save fragment) and
   `signal_shares` is per-signal, per-group (so sharing is a layer-2 act). The
   two tables beside it, `schema-inspirations.ts` and `schema-top-of-mind.ts`,
   read in ten minutes once this one has landed.
3. **`packages/api/src/lib/queue.ts`** (732 lines — skim the header and
   `processBackgroundJob`) — the header explains why Postgres is the queue, and
   the four job types *are* the generation pipeline. The dispatch function is
   the shortest place in the repo where you can watch layer 1 become layer 2
   become layer 3.
4. **`packages/web/src/lib/api.ts`** (1,745 lines — read as a directory, not a
   narrative) — the only place the browser does HTTP, and the whole client
   surface typed in canon words. It is the mirror of file 1; read them together
   and the two packages stop being two vocabularies.
5. **`packages/web/src/lib/data.ts`** (456 lines) — where payloads become the
   things the canvas draws. Its header is also the clearest short statement in
   the repo of the world-words rule: `field`, `sky` and `headquarters` are words
   for *where a layer is drawn* and may not be type or function names.
6. **`packages/web/src/pages/Home.tsx`** (10,110 lines) — read the file header
   and the `SimApi` interface (~line 839), then stop. The header is the
   product's design brief; `SimApi` is the boundary between React and the
   canvas, which React calls into and the canvas never calls back through. Do
   not attempt this file linearly; open it with a symbol in hand.

Two short files worth a seventh and eighth minute:
`packages/web/src/space-kinds/index.ts` defines **space** — the one word this
frontend invents, for the thing that owns a full set of three layers — and
`packages/api/src/lib/middleware.ts` (165 lines) holds the cross-profile access
matrix that every route defers to.

And if you are about to open either `space/` or `space-kinds/`, read
`packages/web/src/space/README.md` first. It is one page, and it exists because
the two names are near-synonyms that do not say which holds what — including the
one trap a reader reliably falls into, which is that the `Space` type lives in
`space-kinds/`, not in `space/`.

---

## 4. Every directory under `packages/*/src`

### `packages/api/src`

| Directory | What lives there |
| --- | --- |
| `.` (root) | The entry points: `index.ts` assembles the Hono app, `lambda.ts` is the deployed API handler, `background-worker.ts` the cron worker, `server.ts` + `local-web.ts` the single-origin local stack. |
| `db/` | The Drizzle schema, one file per concept, re-exported by `index.ts` as the single import path. Also `client.ts`, which is **not** the client the app uses — see the disagreements below. |
| `lib/` | Everything that is neither a route nor a table: the live database client (`db.ts`), auth and sessions, the access matrix, the queue, and the three generation modules (`signal-enrichment`, `signal-derivation`, `top-of-mind-synthesis`) plus the model-provider seam. Layer 2 is five files, one per stage: `signal-derivation` reads the capture and asks the model for candidates, `signal-match-or-mint` decides by cosine which are new, `signal-lifecycle` recomputes confidence and status, `signal-embeddings` keeps the vectors true, and `signal-derivation-thresholds` holds the numbers all of them tune by. |
| `queue/` | The model wire protocol — `gemini.ts` builds both prompts, posts them, and re-validates what comes back. Prompt iteration is a single-file diff on purpose. |
| `routes/` | One Hono router per resource, mounted by `index.ts`. Handlers only; anything reusable belongs in `lib/`. |
| `scoring/` | The two pure numeric decisions: cosine similarity (`vector.ts`) and choosing which readings make a board (`board-selection.ts`). No I/O, no model. |

### `packages/web/src`

| Directory | What lives there |
| --- | --- |
| `.` (root) | `main.tsx` — React root, the route table, and the stylesheet import order that `styles/layers.css` exists to make irrelevant. Plus `sst-env.d.ts`, generated typings for the deploy-time bindings. |
| `canvas/` | The machinery half of the drawing: baked sprites, bloom, dither, colour ramps. Knows orbs and light; does not know what an inspiration is. |
| `character/` | The companion — what it *is* (`body.ts`) and how it is rasterized (`raster.ts`). How it moves still lives in Home's frame loop. |
| `components/` | Plain React components outside the canvas. Currently `RequireAuth.tsx`, the route guard. |
| `components/layout/` | Page furniture for the flat screens; `BackgroundField.tsx` is the decorative wash behind them. |
| `lib/` | The web package's non-visual core: `api.ts` (all HTTP), `data.ts` (payloads → view models), auth context, the dev fixture, and the small pure helpers — `num`, `words`, `when`, `aliveness`, `appearance`. |
| `lib/i18n/` | Locale list, storage key, and the `t()` lookup. `lib/locales.ts` is a one-line re-export of it. |
| `lib/i18n/messages/` | The translation catalogues, `en-US.json` and `ko-KR.json`. |
| `pages/` | One file per route: `Home.tsx` (the canvas) and the four flat screens — `Login`, `Onboarding`, `Profile`, `PublicProfile`. |
| `space/` | No source files of its own — a container for the three layers, one subdirectory each, plus settings, and a `README.md`. **This is the axis that divides it from `space-kinds/`: `space/` is split by LAYER, `space-kinds/` by WHOSE space it is.** The README is the long form, and it names the trap: the `Space` type is declared in `space-kinds/`, so reading the two names cold gets it exactly backwards. |
| `space/inspiration/` | Layer 1: what a save *is* on screen (`orb.ts` — the `Ball`, and `agentId`, which decides which wall it stands on) and what the ground does with one (`field.ts` — brightness, size band, packing, scatter). |
| `space/signal/` | Layer 2: `sky.ts` is the model (a candidate, its light, its evidence in orbit); `sky-engine.ts` is the frame step, lifted out of Home only after measuring that it needs three of the loop's eleven state groups. `sky-engine.ts` is over the 800-line limit and carries the header G1 asks for instead: its 1,051 lines are 583 of code and 446 of prose, and all three of its state interfaces are needed by both sides of every cut that was measured, so every split would need a third file holding nothing but the contract. |
| `space/top-of-mind/` | Layer 3: `board.ts` is the artifact's entries and which sentence leads; `poster.tsx` is the one part that needs markup — which words survived the last rewrite stay lit, and only new words arrive. |
| `space/settings/` | `SpaceSettings.tsx` — what a space is and every verb you can apply to it. A layer-shaped directory holding a screen, which is the one place this tree's own rule bends. |
| `space-kinds/` | What differs by KIND of space: `index.ts` (the three kinds and what follows from each, **and the `Space` type itself**), `agent.ts`, `group.ts`, `GroupPanel.tsx`. A fourth kind should be a new entry here, not a hunt through the page. The name is wrong and the fix is recorded in `space/README.md`: it should be `space/` and its sibling should be `layers/`, blocked only because `Home.tsx` holds 11 of the 18 imports that cross into the two directories. |
| `styles/` | Five stylesheets. `layers.css` must be imported first — it declares the `@layer` order so precedence is decided here and not by the bundler, which is a bug that already cost a whole design pass. |

### `packages/admin/src`

| Directory | What lives there |
| --- | --- |
| `.` (root) | `main.tsx`, `App.tsx`, `styles.css` — the whole inspector: filters, a job list, a detail view, retry. |
| `lib/` | `admin-api.ts` — the typed client for `/api/admin/background-jobs`, and the only place this app talks to the server. |

---

## 5. Where the documents and the code disagree today

Written down rather than fixed, because this is a documentation change. Each was
verified by opening the file.

- **`docs/architecture.md` names `packages/web/src/lib/world-data.ts` as "the
  ONLY translation between the canon's words and the world's". That file does
  not exist.** Its successor is `packages/web/src/lib/data.ts`, and the header
  there says the translation was deliberately *removed*: the second vocabulary
  (`WorldCapture`, `WorldPattern`, `loadField`/`loadSky`/`loadHeadquarters`) is
  gone and one word now runs from the Postgres column to the view model. The
  seam is real, the name and the description are stale.
- **`packages/api/src/db/client.ts` is imported by nothing.** The live client is
  `packages/api/src/lib/db.ts`; every route and every generation module imports
  `getDb` from there. `db/index.ts` does not re-export `client.ts` either. Two
  files describing themselves as the one Drizzle client is exactly the "one
  concept, two names" failure `db/index.ts`'s own header warns about.
- **`packages/api/src/index.ts` exports a `handler` that nothing invokes.**
  `sst.config.ts` deploys `packages/api/src/lambda.ts`, which re-wraps the same
  app. Harmless, but a reader looking for the entry point will find the wrong
  one first.
- **`packages/web/src/main.tsx` contradicts itself about the list screens.** One
  comment says "`/inspirations` and `/signals` remain addressable"; a comment
  forty lines below says the archive is gone and its paths deliberately fall to
  the catch-all. The route table agrees with the second comment — there are no
  such routes.
- **`packages/web/src/styles/home.css` says it is "imported by Jar.tsx only".**
  There is no `Jar.tsx`; `pages/Home.tsx` imports it.
- **`docs/codebase.md` puts `space-kinds/` underneath `space/` in the dependency
  order — "pure predicates and constants", read by the layers and reading
  nothing back. The imports go both ways.** `space/signal/sky-engine.ts` takes
  `makeGroupBall` from `space-kinds/group.ts`, and `space-kinds/group.ts` takes
  `colorBall`, `scatterSeed`, `Ball` and `formingWords` back out of
  `space/inspiration/` and `space/top-of-mind/`. The cycle is not an accident:
  a group's evidence has to exist as a real field orb before the sky can hang
  it. Trace dependencies from the imports, not from that list. The same
  document also names a `space-kinds/self.ts` that was never written — nothing
  about your own space differs yet, which is the right outcome and a stale
  sentence. Both are written up at length in `packages/web/src/space/README.md`.
- **`docs/architecture.md` says "tests need a local database whose name contains
  `test`".** No such check exists. `packages/api/test/helpers/db.ts` creates a
  schema on the shared Neon database named by `DB_CONNECTION_URL` and never
  inspects the database name — it cannot, because the Seed contract forbids
  provisioning a second database. A reader who acts on that sentence will look
  for a database that is not there.
- **`packages/api/test/helpers/db.ts` says "there is one file today" of migration
  SQL.** There are seven, and the loop it describes does read all of them in
  lexical order — so the behaviour is right and only the sentence is stale. It
  matters because the promotion trigger lives in migrations `0003` and `0005`,
  and the claim as written would mean no test schema ever has it.

## 6. Running it, and what green means

- `pnpm dev:local` — the real stack on one origin, API and web together. This is
  the one that matters.
- `pnpm --filter @waka/web dev` — Vite alone. Without a session the canvas
  renders a dev-only fixture, which is how wall-specific behaviour gets looked
  at at all. It is gated on `import.meta.env.DEV`, which is statically false in
  a production build, so the invented rows are dead code the bundler drops.

  That guarantee is one line deep and was broken until this branch. The gate
  used to read `DEV === true || VITE_SHOW_INTERNAL === "1"`, borrowed from
  `showsDebug()`. `VITE_SHOW_INTERNAL` is a build-time variable Vite INLINES,
  so `VITE_SHOW_INTERNAL=1 vite build` shipped a production bundle showing
  fabricated agent memories to real people as their own — and nothing in the
  repo guarded it. `packages/web/test/fixture-says-so.test.ts` now reads the
  gate's source text and fails if that flag comes back. Two rules that look
  alike are not one rule: "show me the internals" and "invent data that does
  not exist" have different blast radii and no longer share a condition.
- `pnpm --filter @waka/web test` runs the vocabulary gate **and** the web suite;
  the gate is not optional and not separate.
- `pnpm --filter @waka/api test:unit` is the no-database subset;
  `pnpm --filter @waka/api test` is everything.
- `npx tsc --noEmit` per package. Run it as its own command — chaining a
  typecheck into a commit with `&&` lets a failure commit, and that has happened
  here.
- **Database-backed tests do not use a separate database.** They create a fresh
  Postgres *schema* named `waka_test_<random>` on the same Neon instance
  `DB_CONNECTION_URL` points at, replay every file in `drizzle/migrations` into
  it, and drop it afterwards (`packages/api/test/helpers/db.ts`). The four
  suites named `*.db.test.ts` are the ones that do this, and they exist because
  a trigger or a partial index is invisible to anything that mocks Drizzle —
  which is what the great majority of this repo's tests do. If a rule lives in
  SQL, only a real connection can prove it.
