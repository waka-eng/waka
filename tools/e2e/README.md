# tools/e2e — the organic harness

Drives the real stack over HTTP the way a client does: sign up, capture,
search, edit, delete, save a link, save an image. Everything below the API is
real — Postgres, the queue, S3, the model. Unit tests prove each piece behaves
when handed the arguments a test chose; this proves a person gets their memory
back.

Two files:

- `fixture-server.ts` — a dependency-free HTTP server for the two enrichment
  fixtures. Local so the gates cannot fail because a website changed.
- `organic.ts` — the harness. A **library** (Phases 4–6 import its helpers) and
  a **CLI** (the Phase 3 gate scenario).

## Running it

```bash
pnpm dev:local                 # one origin: API + web on http://localhost:3010
pnpm e2e:organic               # in another terminal
```

Flags: `--base-url <url>` (default `http://localhost:3010`), `--keep-data`
(skip erasing the accounts the run creates), `--filler <n>` (how many captures
step 4 buries its marker under, default 205), `--enrichment-timeout-ms <n>`
(default 90000), `--fixture-port <n>`, `--fixture-url <url>`.

Serve the fixtures alone — to look at them, or to point another tool at them:

```bash
pnpm e2e:fixtures              # prints its URL; --port and --host accepted
```

Nothing here prints a password, a token, or a connection string; quoted
response bodies are redacted first.

## Connected personal loop, without model spend

`connected-learning.ts` connects the production-build browser to the real Hono
app, authentication, disposable Postgres and queue workers. Provider output
and embeddings are deterministic, and provider network access is blocked.
It checks capture → three saved answers → owned reading → explicit adoption
→ reopening without reload → exact cited-answer retraction at desktop/mobile
sizes. API transport is an in-process bridge, not a deployed-network check.

Build the web app and serve its production preview on `127.0.0.1:3012`, then
run with an explicit disposable local database (its name must contain `test`
or `disposable`):

```bash
pnpm --filter @waka/web build
pnpm --filter @waka/web exec vite preview --host 127.0.0.1 --port 3012
DB_CONNECTION_URL=postgres://agi@127.0.0.1:5432/waka_agent_test pnpm e2e:connected-learning
```

The harness creates and drops an isolated schema. It never loads an env file,
refuses remote database URLs and emits only synthetic fixture diagnostics.
This is a manual gate; it adds no automatic browser Actions runs.

## What each step proves

| # | Step | What a failure means |
|---|---|---|
| 1 | `/api/health` reports `service: "waka"` | The thing answering on that port is not this API, or the stack is not up. |
| 2 | Signup returns an account **and** a human profile; `/api/auth/me` agrees | Profiles are not first-class in the auth path: an account exists with no memory owner, or the session is not bound to one. |
| 3 | Three captures return 201 and appear in the archive | Capture or recall is broken end to end (as opposed to in a mock). |
| 4 | A marked capture buried under 205 newer ones is still found by `?q=` | **The regression this step exists for**: recall filtering a fetched window instead of querying the archive. Past the window, search silently stops finding things that are there — indistinguishable, from outside, from the memory not holding them. The step first asserts the marked row is genuinely *outside* the newest 200, so a passing search cannot be an accident of paging. |
| 5 | `PATCH` is readable back; `DELETE` then answers 404 | Layer 1 is not editable/deletable as the canon requires. |
| 6 | A second account gets 404/403 on the first's capture, and an empty archive | Tenant isolation. The one failure in this list that is a security incident. |
| 7 | The fixture link enriches to `ready` / `page_body`, text contains the body marker and **not** the boilerplate marker | Link enrichment did not read the page body. The fixture's title and meta tags are deliberately generic, so a summarizer that never opened the body cannot pass; the boilerplate assertion catches the opposite failure, chrome swept up as prose. |
| 8 | The fixture image enriches to `ready` / `image_description`, text transcribes the rendered words (case-insensitive) | Image enrichment did not describe the picture, or did not transcribe its legible text verbatim. |

Steps 1 and 2 are critical: if either fails the rest are skipped, because
nothing after them can mean anything. Every other step runs even after an
earlier one failed, so one run reports everything that is broken. A skipped
step counts as a failure for the exit code.

## Steps 7 and 8 need more than the API

**The background worker must be draining.** Enrichment is a queued job, not
part of the write. The local server drains in-process (`pnpm dev:local`);
against a deployed stage the cron worker does it. With
`WAKA_BACKGROUND_JOB_AUTODRAIN=0` set on the server, both steps time out with
the attachment still `pending` — which the timeout message says verbatim.

**Step 8 needs an attachments bucket.** Images take the real upload path:
presign → PUT to S3 → finalize. A stack with no `ATTACHMENTS_BUCKET` (or SST
`Attachments` link) fails the presign call, and the step says so rather than
leaving you to decode a 500.

**Step 7 needs the fixture to be reachable by the API's own fetch.** Enrichment
refuses private-range addresses on purpose — that guard is what stops a saved
link from reading the cloud metadata endpoint. The fixture server binds
127.0.0.1, which that guard blocks, so the step fails with
`enrichment refused the fixture as a private address` unless one of these is
true:

- the stack under test allows the fixture host explicitly (a dev-only
  allowance in `packages/api/src/lib/signal-enrichment.ts`), or
- `--fixture-url` points at a routable address that reaches this machine.

## Using it as a library

Phases 4–6 import from `organic.ts` rather than re-deriving how to talk to the
API:

```ts
import { signUp, capture, listSignals, waitFor } from "../e2e/organic.js";

const session = await signUp({ baseUrl: "http://localhost:3010" });
await capture(session, { text: "…", kind: "note" });

const signals = await waitFor(
  async (ctx) => {
    const rows = await listSignals(session);
    ctx.note(`${rows.length} signals so far`);
    return rows.length > 0 ? rows : null;
  },
  { timeoutMs: 300_000, label: "the first signal to be derived" },
);
```

Every helper takes plain typed objects and throws `ApiError` (method, path,
status, redacted body) on a non-2xx. `waitFor` names what it was waiting for
and what it last saw — a gate is only as useful as the sentence it prints when
it fails.

Helpers: `health`, `signUp`, `login`, `me`, `deleteAccount`, `capture`,
`listInspirations`, `getInspiration`, `updateInspiration`, `deleteInspiration`,
`statusOfInspirationRead`, `listSignals`, `getTopOfMind`, `attachLink`,
`attachImage`, `getAttachment`, `waitFor`, `waitForEnrichment`, `statusOf`,
`redact`, `generateTestEmail`.

Fixture exports: `startFixtureServer`, `FIXTURE_ARTICLE_MARKER`,
`FIXTURE_ARTICLE_BOILERPLATE_MARKER`, `FIXTURE_IMAGE_MARKER`,
`buildArticleHtml`, `renderTextPng`, `fixtureImageBytes`.

## Cost

Every capture enqueues signal derivation, and derivation spends model calls.
Step 4's 205 filler captures therefore queue 205 derivations on a stack with a
live key and a draining worker. They are flash-lite/embedding tier — cents —
but a congested queue also delays the enrichment jobs steps 7 and 8 wait on.
For quick iterations use a smaller `--filler`; the gate itself runs the full
205.
