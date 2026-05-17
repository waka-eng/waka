# WAKA inspirations

A multi-user inspirations capture app: paste a thought, attach links / images,
and a Gemini-powered classifier groups it into one of six clusters (`outlier`,
`bridge`, `morph`, `convergence`, `tension`, `loop`).

The stack is:

| Layer        | Tech                                                           |
| ------------ | -------------------------------------------------------------- |
| Frontend     | Vite + React 18 + React Router (SST `StaticSite`)              |
| API          | Hono on AWS Lambda Function URL (SST `Function`)               |
| Async work   | Postgres `background_jobs` → Gemini classifier/background worker |
| Storage      | S3 bucket, presigned PUT only (SST `Bucket`)                   |
| Database     | Existing **Neon** Postgres via Drizzle ORM (NOT provisioned by SST) |
| Auth         | Email + password and Google OAuth (custom OpenAuth-style cookie) |

The original 4282-line monolith lives at `index.html` for visual reference. The
shipped UI is the React decomposition under `packages/web/src/`.

---

## Local dev runbook

### 1. Prerequisites

- **Node** 20+ and **pnpm** 9+
  ```bash
  corepack enable && corepack prepare pnpm@9.12.0 --activate
  ```
- **AWS account** with permission to create Lambda / S3 / SSM resources.
  `sst dev` will deploy a personal sandbox stack into your account.
- **AWS credentials** discoverable by the SDK chain — either
  `AWS_PROFILE=...` exported in your shell, or `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` set directly. The region MUST be
  `us-west-2` (matches `AWS_REGION` in `sst.config.ts`).
- A **Neon Postgres** database. We do not provision a new one — the
  connection URL goes into `DB_CONNECTION_URL`.
- A **Google OAuth** client (web application). See
  [`docs/google-oauth-setup.md`](docs/google-oauth-setup.md) for the
  authorized-redirect-URI dance against the ephemeral `sst dev` URL.
- A **Gemini API key** from <https://aistudio.google.com/app/apikey>.

### 2. Environment variables

Copy the template and fill it in:

```bash
cp .env.example .env
```

The required variables and where each one is consumed:

| Variable                                                    | Used by                                         | Notes                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `DB_CONNECTION_URL`                                         | Hono API, background worker, `drizzle-kit`      | Neon pooled URL with `sslmode=require`. `DATABASE_URL` is accepted as a fallback name. |
| `AUTH_SECRET`                                               | Session cookie signing                          | `openssl rand -base64 48`                                                              |
| `JWT_SECRET`                                                | JWT bearer signing in `lib/auth.ts`             | `openssl rand -base64 48`                                                              |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`                     | `/api/auth/google` route                            | From Google Cloud Console; redirect URI must point at `sst dev`'s API URL.             |
| `GEMINI_API_KEY`                                            | Classifier/background worker                    | Never reaches the browser.                                                             |
| `AWS_REGION_APP` / `AWS_ACCESS_KEY_ID_APP` / `AWS_SECRET_ACCESS_KEY_APP` | `sst dev` and smoke tests          | Or use a named profile with `AWS_PROFILE=...`. Region pinned to `us-west-2`.           |

> `.env` is read by `drizzle-kit` and the `*.smoke.ts` harnesses. **At Lambda
> runtime, secrets come from SST**, not from `.env`. That's why step 4 below
> mirrors each secret into SST.

### 3. Install + apply database migrations

```bash
pnpm install
pnpm db:migrate          # apply drizzle/migrations/*.sql against Neon
```

You can sanity-check the schema in the browser:

```bash
pnpm db:studio
```

You should see `users`, `inspirations`, `attachments`, `reflections`,
`sessions`, and `background_jobs` tables.

### 4. Push secrets into SST

The Lambda Function does NOT read `.env` — it reads SST `Secret` resources
linked in `sst.config.ts`. One-time, per stage (the default stage is your AWS
username, e.g. `dev-jaegyu.lee`):

```bash
pnpm sst secret set GoogleClientId      "$AUTH_GOOGLE_ID"
pnpm sst secret set GoogleClientSecret  "$AUTH_GOOGLE_SECRET"
pnpm sst secret set SessionSecret       "$AUTH_SECRET"
pnpm sst secret set JwtSecret           "$JWT_SECRET"
pnpm sst secret set DbConnectionUrl     "$DB_CONNECTION_URL"
pnpm sst secret set GeminiApiKey        "$GEMINI_API_KEY"
```

(Convenience: `set -a; source .env; set +a` first so the variables are exported
into your shell.)

### 5. Run the dev stack

#### Option A — SST sandbox

```bash
pnpm dev    # alias for `sst dev`
```

SST prints two URLs:

- `apiUrl` — the Hono Function URL (something like `https://xxxx.lambda-url.us-west-2.on.aws`)
- `webUrl` — set during deploy; in `sst dev` the Vite dev server is at
  `http://localhost:5173` and proxies `/api/*` to the Function URL.

> If Google OAuth bounces with `redirect_uri_mismatch`, copy the printed
> `apiUrl` into your Google Cloud Console "Authorized redirect URIs" as
> `<apiUrl>/api/auth/google/callback` and try again.

#### Option B — one-command monolithic local server

Use this when you want the API and browser app running from the same local
origin without starting an SST sandbox:

```bash
pnpm dev:local
```

The tracked runner builds the Vite client, then starts one Hono/node-server
process that serves both the API routes and `packages/web/dist`. It stops the
server on `Ctrl+C` and does not print environment variable values or secrets.
Open one browser URL only:

- <http://localhost:3010>

The API health endpoint remains available at <http://localhost:3010/api/health>.

`pnpm dev:local` loads repo-root `.env.local` for the local API process, without
printing environment variable values or secrets. Variables already present in the
shell keep their values, and the runner's local development exports still win for
`PORT`, `PUBLIC_API_URL`, `PUBLIC_WEB_URL`, `VITE_API_URL`,
`VITE_SHOW_INTERNAL_STATUS`, `WAKA_SERVE_WEB_DIST`, and `WAKA_WEB_DIST_DIR`. The
local runner does not load root `.env` or `.env.production` for API development.

This mode intentionally clears `VITE_API_URL` before building the client so
browser API calls and Google OAuth navigation use same-origin paths such as
`/api/auth/google/login`. It also builds with `VITE_SHOW_INTERNAL_STATUS=true` so
the internal/demo-only WOW pipeline status strip is visible in the local
same-origin demo after a successful Inspiration First capture; normal production
builds keep the strip hidden unless that Vite env flag is explicitly set. API
routes are mounted before static assets; the SPA
fallback serves `index.html` only for non-API GET routes and will not intercept
`/api/auth/*`, `/api/inspirations/*`, `/api/attachments/*`, `/api/wow-moments/*`, or `/api/health`.

Because Option B serves a built Vite bundle from Hono, Vite hot reload is not
part of `pnpm dev:local`. Use the separate Vite/SST development flow when you
need HMR.

### Internal background jobs admin API and app

The background-jobs observability API is disabled by default and is intended only
for internal/dev debugging. Enable it explicitly with either:

```bash
WAKA_ENABLE_ADMIN_ROUTES=true
# or
WAKA_ENABLE_BACKGROUND_JOBS_ADMIN=true
```

All endpoints still require a normal authenticated session. When the env gate is
off, `/api/admin/background-jobs` returns 404 so the admin surface is not
advertised.

The authenticated Home page also has a compact internal/demo-only WOW pipeline
status strip after a successful inspiration capture. It renders in Vite dev mode,
in `pnpm dev:local`'s same-origin demo build, or when
`VITE_SHOW_INTERNAL_STATUS=true` is set explicitly for the web app. The strip only
shows safe fields (short inspiration id, timestamps, simple job/WOW status, WOW
count) and degrades gracefully if the admin background-jobs endpoint is disabled.

Endpoints:

- `GET /api/admin/background-jobs?status=&type=&userId=&limit=` lists newest jobs first. `limit` defaults to 50 and is clamped to 100. The list stays lightweight.
- `GET /api/admin/background-jobs/:id` returns one tenant-scoped job or 404. For `process_inspiration` jobs it also includes a bounded `pipeline` object with the visible inspiration preview, cluster/classification status, scores, and linked WOW moment previews (`titlePreview` and `explanationPreview`). Missing or cross-tenant inspirations are reported as `inspiration: null` with a missing reason rather than a 500.
- `POST /api/admin/background-jobs/:id/retry` resets a failed job to `pending`; non-failed jobs return 409.

Responses return safe job metadata plus `payloadSummary` only. For
`process_inspiration` jobs, `payloadSummary` includes `inspirationId`; raw
payload fields are not exposed. Detail `pipeline` text fields are previews only
and remain scoped to the authenticated user's tenant.

A separate minimal admin frontend lives in `packages/admin` and runs on port
5174. It uses a same-origin Vite `/api` proxy to the local API target, defaulting
to `http://localhost:3010`; set `VITE_API_URL` if your API is elsewhere.

Run it locally with two terminals:

```bash
# Terminal A: API/local user app with the admin API gate enabled
WAKA_ENABLE_BACKGROUND_JOBS_ADMIN=true pnpm dev:local

# Terminal B: admin app
pnpm --filter @waka/admin dev
# or: pnpm dev:admin
```

Then open <http://localhost:5174>. Sign into the normal WAKA app first so the
admin app can send the existing auth cookie. The UI lists background jobs, lets
you filter by status/type, opens a detail panel when you select a row, shows
safe pipeline previews for `process_inspiration` jobs, and only enables retry for
failed jobs.

### 6. Optional local demo seed

For quick UI review with a realistic 30-inspiration board plus persisted WOW
moments, seed a local/dev database for a specific demo user:

```bash
# Recommended: sign up locally first, then seed that email.
pnpm demo:seed -- --email=demo@example.test

# Or create a login-capable local demo user when the email does not exist yet.
pnpm demo:seed -- --email=demo@example.test --create-user --password='local-only-demo-password'

# Or seed an existing user id directly.
pnpm demo:seed -- --user-id=<uuid>

# Cleanup only: remove curated demo seed rows while preserving the account and
# normal user-created inspirations/WOW moments.
pnpm demo:seed -- --email=demo@example.test --cleanup-demo-data
```

The command reads `DB_CONNECTION_URL` or `DATABASE_URL` from the current
working directory's environment, `.env`, or `.env.development`, refuses non-local
database hosts by default, and requires the explicit CLI flag `--allow-remote`
as a deliberate override only for an explicitly disposable dev database. It does
not log secrets, does not mock production code, and only writes real
tenant-scoped rows for the selected user. By default each run replaces this
script's prior demo rows for the user so the account keeps exactly one
30-inspiration demo dataset plus its persisted WOW moments; pass
`--append-demo-data` only when you intentionally want duplicate demo datasets for
stress testing. If the `--email` user does not exist, the command fails unless
you pass `--create-user --password=...`; the password is stored as a bcrypt hash
via the existing API auth helper so the demo account can log in.

Cleanup-only mode never creates users and never reseeds data. It deletes only
`kind = "demo-seed"` inspirations for the selected user plus WOW moments whose
linked inspirations are all selected-user demo seed rows. Mixed WOW moments that
include any non-demo/user-created inspiration survive; deleting demo inspirations
only removes their join rows through the database's tenant-scoped foreign keys.

Safety warning: demo seed and cleanup are local/dev operations. Non-local
database hosts are refused by default. `--allow-remote` is only for an explicitly
disposable remote dev database; never point seed or cleanup at production,
staging, or any database containing real user data.

### 7. Organic WOW end-to-end validation

Use this after creating a login-capable local demo account when you want to prove
WAKA can generate WOW moments from organic captured inspirations without curated
demo rows.

Against an already-running local/dev stack:

```bash
WAKA_ORGANIC_EMAIL=demo@example.test WAKA_ORGANIC_PASSWORD='local-only-demo-password' WAKA_ORGANIC_CLEANUP_DEMO_DATA=1 pnpm e2e:organic-wow
```

Or let the boot helper start the stack first:

```bash
WAKA_ORGANIC_EMAIL=demo@example.test WAKA_ORGANIC_PASSWORD='local-only-demo-password' WAKA_ORGANIC_CLEANUP_DEMO_DATA=1 pnpm e2e:organic-wow:boot
```

The script signs in through `/login`, optionally runs the same guarded demo-data
cleanup for the existing account, captures multiple related organic notes with a
unique run marker, waits for classification/background WOW status, and passes
only when a generated/existing WOW moment links back to at least two captured
organic rows (by id or run-marker text). It does not create or delete users and
it avoids printing passwords, tokens, DB URLs, provider prompts, or full payloads.

If `WAKA_ORGANIC_CLEANUP_DEMO_DATA=1` is set, `DB_CONNECTION_URL` or
`DATABASE_URL` must point at a local/dev database. A remote disposable dev DB can
be used only by deliberately setting `WAKA_ORGANIC_ALLOW_REMOTE=1`; never use
that override for production, staging, or real-user data.

This organic smoke proves that seeded demo data can be removed, the account
remains login-capable, user-created inspirations remain, and the normal
capture/classification/background WOW pipeline can produce a WOW moment without
curated demo seed rows.

### 8. End-to-end browser flow (manual smoke)

Open the web URL for the stack you started: <http://localhost:5173> for Option A
or <http://localhost:3010> for Option B. The app should redirect you to
`/login`. Then:

1. **Sign up** with email + password from the Sign-up tab. Expect a redirect
   to `/` with the original WAKA UI rendered (gradient backdrop, capture
   modal trigger, history sidebar).
2. **Sign in with Google** — log out, return to `/login`, click "Continue
   with Google". You should land back on `/` as the same user.
3. **Capture an inspiration**:
   - Type some text, optionally paste a URL, optionally drag-drop an image.
   - Click Save. The list should update **immediately** with the row, and
     the cluster chip should be empty (cluster is async).
4. **Verify direct-to-S3 upload** (only if you attached a file):
   - Open DevTools → Network → look for a `PUT` to
     `https://<bucket>.s3.us-west-2.amazonaws.com/...`. The request body is
     the file bytes; the API Function URL never sees the file.
5. **Watch the classifier close the loop**:
   - Within ~5–15 seconds, refresh `/` (or wait for the next poll). The new
     inspiration should now show one of the six cluster chips.
   - Cross-check in `pnpm db:studio` → `inspirations` row → `cluster` column
     transitioned `NULL → outlier|bridge|morph|convergence|tension|loop` and
     `classified_at` is populated.
6. **Add a reflection** — open the inspiration detail panel, type a question
   + answer, save, refresh: the reflection persists.
7. **Delete an inspiration** — confirm the row disappears from the list and
   from the database.
8. **Tenant isolation check** — sign up as a *second* user in an incognito
   window. The first user's inspirations must NOT appear.

### 9. Run the test suite

```bash
pnpm test:dev-local-script       # syntax-check the tracked Option B runner
pnpm --filter @waka/api test         # vitest in-process Hono + background job tests
pnpm --filter @waka/api typecheck
pnpm --filter @waka/web typecheck
pnpm --filter @waka/web build
```

All four should exit `0`. Smoke tests stub AWS + Gemini by default; setting
real `AWS_*` / `GEMINI_API_KEY` in `.env` will exercise the live paths where
the harnesses opt in.

---

## Troubleshooting

| Symptom                                                     | Fix                                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `DB_CONNECTION_URL is not set` from drizzle-kit             | `.env` not at repo root, or `set -a; source .env; set +a` before running.                            |
| Browser PUT returns 301 PermanentRedirect                   | `AWS_REGION` mismatch. The bucket lives in `us-west-2`; presign with the same region.                |
| Browser PUT returns 403 SignatureDoesNotMatch / AccessDenied | Lambda role is missing `s3:PutObject` on the bucket. Check `link: [attachmentsBucket]` in `sst.config.ts`. |
| Cluster chip never appears                                  | Inspect the `background_jobs` table for pending/failed `process_inspiration` jobs; Gemini key invalid or out-of-quota errors are recorded there. |
| `redirect_uri_mismatch` from Google                         | The `sst dev` API URL changed. Update the authorized redirect URI in Google Cloud Console.           |

---

## Out of scope

Everything below the line is intentionally NOT built in this iteration:

- Production AWS deploy (`sst deploy --stage production`)
- Email verification / password reset flows
- Reflections AI auto-generation
- Live cluster updates streamed to the SPA (today: full reload reveals new cluster)
