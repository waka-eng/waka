# WAKA inspirations

A multi-user inspirations capture app: paste a thought, attach links / images,
and a Gemini-powered classifier groups it into one of six clusters (`outlier`,
`bridge`, `morph`, `convergence`, `tension`, `loop`).

The stack is:

| Layer        | Tech                                                           |
| ------------ | -------------------------------------------------------------- |
| Frontend     | Vite + React 18 + React Router (SST `StaticSite`)              |
| API          | Hono on AWS Lambda Function URL (SST `Function`)               |
| Async work   | SQS queue → Gemini classifier worker (SST `Queue` + DLQ)       |
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
- **AWS account** with permission to create Lambda / S3 / SQS / SSM resources.
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
| `DB_CONNECTION_URL`                                         | Hono API, classifier worker, `drizzle-kit`      | Neon pooled URL with `sslmode=require`. `DATABASE_URL` is accepted as a fallback name. |
| `AUTH_SECRET`                                               | Session cookie signing                          | `openssl rand -base64 48`                                                              |
| `JWT_SECRET`                                                | JWT bearer signing in `lib/auth.ts`             | `openssl rand -base64 48`                                                              |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`                     | `/auth/google` route                            | From Google Cloud Console; redirect URI must point at `sst dev`'s API URL.             |
| `GEMINI_API_KEY`                                            | Classifier queue worker                         | Never reaches the browser.                                                             |
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

You should see `users`, `inspirations`, `attachments`, `reflections`, and
`sessions` tables.

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

```bash
pnpm dev    # alias for `sst dev`
```

SST prints two URLs:

- `apiUrl` — the Hono Function URL (something like `https://xxxx.lambda-url.us-west-2.on.aws`)
- `webUrl` — set during deploy; in `sst dev` the Vite dev server is at
  `http://localhost:5173` and proxies `/api/*` to the Function URL.

> If Google OAuth bounces with `redirect_uri_mismatch`, copy the printed
> `apiUrl` into your Google Cloud Console "Authorized redirect URIs" as
> `<apiUrl>/auth/google/callback` and try again.

### 6. End-to-end browser flow (manual smoke)

Open <http://localhost:5173>. The app should redirect you to `/login`. Then:

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

### 7. Run the test suite

```bash
pnpm --filter @waka/api test         # vitest in-process Hono smoke + queue tests
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
| Cluster chip never appears                                  | Inspect `ClassifierDLQ` in the AWS SQS console — Gemini key invalid or out-of-quota messages land there. |
| `redirect_uri_mismatch` from Google                         | The `sst dev` API URL changed. Update the authorized redirect URI in Google Cloud Console.           |

---

## Out of scope

Everything below the line is intentionally NOT built in this iteration:

- Production AWS deploy (`sst deploy --stage production`)
- Email verification / password reset flows
- Reflections AI auto-generation
- Live cluster updates streamed to the SPA (today: full reload reveals new cluster)
