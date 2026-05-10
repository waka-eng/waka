# Google OAuth Setup (Sub-AC 2.1.1)

This runbook covers **provisioning** a Google OAuth 2.0 client in Google
Cloud Console and **wiring** the resulting credentials into the WAKA SST
app as runtime secrets bound to the Hono API Lambda.

> The values currently in `.env`
> (`AUTH_GOOGLE_ID=211425047387-...apps.googleusercontent.com`,
> `AUTH_GOOGLE_SECRET=GOCSPX-...`) are real and were created for `https://waka.im`.
> If you only need a local `sst dev` run, you may reuse them by adding
> `http://localhost:3001/auth/google/callback` to that client's authorized
> redirect URIs. For any new stage (preview, prod-2, …) provision a fresh
> client per the steps below.

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
     http://localhost:3001        # Hono Function URL (local SST dev)
     https://<sst-staticsite-url> # printed by `sst dev` once it’s up
     ```
   - **Authorized redirect URIs** — add the exact callback URL the API
     handler will receive `code` on:
     ```
     http://localhost:3001/auth/google/callback
     https://<sst-function-url>/auth/google/callback
     ```
     The path **must** match `getGoogleRedirectUri()` in
     `packages/api/src/lib/google-oauth.ts`.
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
# dotenv-aware helper, preferred when copying all local env values into SST:
pnpm sst:secret:set:all

# or set individual SST secrets directly:
pnpm sst secret set GoogleClientId      "$AUTH_GOOGLE_ID"
pnpm sst secret set GoogleClientSecret  "$AUTH_GOOGLE_SECRET"
pnpm sst secret set SessionSecret       "$AUTH_SECRET"
pnpm sst secret set JwtSecret           "$JWT_SECRET"
pnpm sst secret set DbConnectionUrl     "$DB_CONNECTION_URL"
pnpm sst secret set GeminiApiKey        "$GEMINI_API_KEY"
```

Re-running `sst secret set` rotates the value without touching code.
Inspect with `pnpm sst secret list`.

## 3. Verify the binding

After `pnpm dev` (alias for `sst dev`) is running:

```bash
curl -s "$API_URL/health"          # → {"ok":true}
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
  http vs https, port). Re-check `getGoogleRedirectUri()` and the Console
  list.
- **`origin_mismatch`**: the SPA origin isn't in Authorized JavaScript
  origins. Add `http://localhost:5173` for local Vite.
- **Secret committed to git**: never. The values in `.env` were already
  exposed in the original interview transcript and should be rotated once
  this AC ships — track that as a follow-up.
- **Forgetting to set the secret per stage**: SST Secrets are per-stage.
  `sst secret set Foo bar --stage dev` does not populate the `prod` stage.
