# Google OAuth Setup (Sub-AC 2.1.1)

This runbook covers **provisioning** a Google OAuth 2.0 client in Google
Cloud Console and **wiring** the resulting credentials into the WAKA SST
app as runtime secrets bound to the Hono API Lambda.

> The values currently in `.env`
> (`AUTH_GOOGLE_ID=211425047387-...apps.googleusercontent.com`,
> `AUTH_GOOGLE_SECRET=GOCSPX-...`) are real and were created for `https://waka.im`.
> If you only need a local run, you may reuse them by adding the callback for
> whichever local stack you use to that client's authorized redirect URIs — see
> the table under "Authorized redirect URIs" below. For any new stage (preview,
> prod-2, …) provision a fresh client per the steps below.

> **You do not need Google at all to run WAKA locally.** `/login` has a sign-up
> tab that takes an email and a password and writes straight to your local
> database. Every walk in `tools/e2e` uses it. Reach for the Console only when
> the thing you are testing IS the Google flow.

---

## 1. Provision the OAuth client

1. Open **Google Cloud Console → APIs & Services → Credentials**.
2. (Once per project) Configure the **OAuth consent screen**:
   - User type: **External**.
   - App name: `WAKA Inspirations`.
   - Support email + developer contact: any address you control.
   - Scopes: `openid`, `email`, `profile`. Nothing else — we only need a
     verified email and display name.
3. **Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: `WAKA <stage>` (e.g. `WAKA dev`, `WAKA prod`).
   - **Authorized JavaScript origins** — add every origin the SPA will be
     served from:
     ```
     http://localhost:5173        # Vite dev server
     http://localhost:3010        # pnpm dev:local (the usual local stack)
     http://localhost:3001        # Hono Function URL (local SST dev)
     https://<sst-staticsite-url> # printed by `sst dev` once it’s up
     ```
   - **Authorized redirect URIs** — add the exact callback URL the API
     handler will receive `code` on:
     ```
     http://localhost:3010/api/auth/callback/google
     http://localhost:3001/api/auth/callback/google
     https://<sst-function-url>/api/auth/callback/google
     ```
     **`/api/auth/callback/google`, in that order** — the last two segments the
     other way round from what this document used to say. Both paths are in
     fact SERVED (`authRoutes.route("/google", …)` gives one and
     `authRoutes.get("/callback/google", …)` the other, `packages/api/src/routes/auth.ts`),
     so the old line was not pointing at a dead route — it was pointing at the
     one the app never ASKS Google for, which fails in exactly the same way and
     is harder to see. `getGoogleRedirectUri()` sends
     `/api/auth/callback/google` and only that string can be registered. The
     shape is deliberate: it follows the historical NextAuth/Auth.js Google
     provider callback, because the existing client already has it registered.

     **And the port is whatever your stack is serving on.** `getOAuthRedirectOrigin()`
     reads `PUBLIC_API_URL`, which `scripts/dev-local.sh` sets to
     `http://localhost:$PORT` — 3010 by default, or whatever `WAKA_LOCAL_PORT`
     says. The banner `dev:local` prints on start names it. Only the old
     `sst dev` path uses 3001.

     Both halves **must** match `getGoogleRedirectUri()` in
     `packages/api/src/lib/google-oauth.ts`. That function is the authority;
     this list is a copy, and a copy is the thing that goes stale.
4. Save. Google returns a **Client ID** (`*.apps.googleusercontent.com`)
   and a **Client secret** (`GOCSPX-...`). Copy both — the secret is shown
   exactly once.

## 2. Wire the credentials into SST

`sst.config.ts` already declares three SST Secrets and `link`s them to the
`Api` Function:

| SST Secret name      | Purpose                              | Legacy `.env` fallback |
| -------------------- | ------------------------------------ | ---------------------- |
| `GoogleClientId`     | OAuth client id                      | `AUTH_GOOGLE_ID`       |
| `GoogleClientSecret` | OAuth client secret                  | `AUTH_GOOGLE_SECRET`   |
| `SessionSecret`      | Cookie/session HMAC signing key      | `AUTH_SECRET`          |

Set them once per stage. From the repo root:

```bash
# load .env into your shell first if you want to copy current values
set -a; source .env; set +a

pnpm sst secret set GoogleClientId      "$AUTH_GOOGLE_ID"
pnpm sst secret set GoogleClientSecret  "$AUTH_GOOGLE_SECRET"
pnpm sst secret set SessionSecret       "$AUTH_SECRET"

# while you're here, set the rest of the runtime secrets too:
pnpm sst secret set JwtSecret           "$JWT_SECRET"
pnpm sst secret set DbConnectionUrl     "$DB_CONNECTION_URL"
pnpm sst secret set GeminiApiKey        "$GEMINI_API_KEY"
```

Re-running `sst secret set` rotates the value without touching code.
Inspect with `pnpm sst secret list`.

## 3. Verify the binding

After `pnpm dev` (alias for `sst dev`) is running:

```bash
curl -s "$API_URL/api/health"          # → {"ok":true,"service":"waka","capabilities":[...]}
```

…and inside the Hono handler the secrets are visible as either:

- `Resource.GoogleClientId.value` (preferred, typed via SST), or
- `process.env.GOOGLE_CLIENT_ID` (also exported by SST), or
- the legacy `process.env.AUTH_GOOGLE_ID` from `.env` (only when running
  outside SST, e.g. `tsx` smoke tests).

`packages/api/src/lib/google-oauth.ts` resolves them in that order so a
single import works in every environment.

## 4. Common pitfalls

- **`redirect_uri_mismatch`**: the URL Google sees and the URL registered in
  Authorized redirect URIs differ by even one character (trailing slash,
  http vs https, port, segment order). Re-check `getGoogleRedirectUri()` and
  the Console list. The two that have actually bitten:
  - the **port** — `dev:local` serves 3010, not the 3001 of `sst dev`, and it
    changes again if `WAKA_LOCAL_PORT` is set;
  - the **segment order** — the app SENDS `/api/auth/callback/google`. It also
    serves `/api/auth/google/callback`, so registering that one looks right,
    answers when visited by hand, and still fails the round-trip.

  If you are only trying to reach the world, sign up with an email and a
  password at `/login` instead and leave the Console alone.
- **`origin_mismatch`**: the SPA origin isn't in Authorized JavaScript
  origins. Add `http://localhost:5173` for local Vite.
- **Secret committed to git**: never. The values in `.env` were already
  exposed in the original interview transcript and should be rotated once
  this AC ships — track that as a follow-up.
- **Forgetting to set the secret per stage**: SST Secrets are per-stage.
  `sst secret set Foo bar --stage dev` does not populate the `prod` stage.
