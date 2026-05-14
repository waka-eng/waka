/**
 * Google OAuth credential resolver.
 *
 * Centralises the "where do GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
 * SESSION_SECRET come from?" question so route handlers don't each grow
 * their own ad-hoc fallback chain. There are three layers we read in order:
 *
 *   1. SST Resource bindings — `Resource.GoogleClientId.value` and friends.
 *      This is the production / `sst dev` path: secrets live in SSM, never
 *      ship in code, and rotate without redeploys.
 *
 *   2. SST environment passthrough — SST also exports the linked Secret as
 *      a process.env value (e.g. process.env.GOOGLE_CLIENT_ID). We accept
 *      that name for forward-compatibility.
 *
 *   3. Legacy .env names from the existing repo — AUTH_GOOGLE_ID /
 *      AUTH_GOOGLE_SECRET / AUTH_SECRET. These keep `tsx` smoke tests and
 *      drizzle migrations working without booting the full SST stack.
 *
 * The resolver throws loudly when a secret is missing rather than returning
 * an empty string, because silently signing a session with `""` or sending
 * Google an empty client_id is a security bug, not a recoverable error.
 */

/**
 * Read the SST-bound Resource value if available, otherwise undefined.
 *
 * We import `sst` lazily and inside a try/catch because the package is only
 * present at runtime when invoked from `sst dev` / a deployed Lambda.
 * Vitest unit runs and bare `tsx` invocations never load it, and we don't
 * want a missing module to take down auth.
 */
function readSstResource(name: string): string | undefined {
  try {
    // The shape SST v3 exposes is `import { Resource } from "sst"`.
    // We require it dynamically to avoid a hard build-time dependency for
    // contexts where SST isn't on the runtime classpath.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("sst") as {
      Resource?: Record<string, { value?: string }>;
    };
    const value = mod.Resource?.[name]?.value;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a secret across the three lookup layers. The `legacyEnv` argument
 * lists fallback env-var names in priority order; the first non-empty match
 * wins.
 */
function resolveSecret(
  resourceName: string,
  primaryEnv: string,
  legacyEnv: readonly string[],
): string {
  const fromResource = readSstResource(resourceName);
  if (fromResource) return fromResource;

  const fromPrimary = process.env[primaryEnv];
  if (fromPrimary && fromPrimary.length > 0) return fromPrimary;

  for (const name of legacyEnv) {
    const v = process.env[name];
    if (v && v.length > 0) return v;
  }

  throw new Error(
    `Missing secret: tried Resource.${resourceName}.value, env.${primaryEnv}, and ${legacyEnv
      .map((n) => `env.${n}`)
      .join(", ")}. Configure it in .env or via \`pnpm sst secret set ${resourceName} ...\`.`,
  );
}

/**
 * Google OAuth 2.0 client id. Public-ish (it's sent to the browser as part
 * of the authorize URL) but still resolved through the secrets pipeline so
 * staging vs production credentials never collide.
 */
export function getGoogleClientId(): string {
  return resolveSecret("GoogleClientId", "GOOGLE_CLIENT_ID", [
    "AUTH_GOOGLE_ID",
  ]);
}

/**
 * Google OAuth 2.0 client secret. Server-only — must never reach the
 * frontend bundle.
 */
export function getGoogleClientSecret(): string {
  return resolveSecret("GoogleClientSecret", "GOOGLE_CLIENT_SECRET", [
    "AUTH_GOOGLE_SECRET",
  ]);
}

/**
 * Session signing secret used by SST OpenAuth (and any cookie HMAC we add
 * later). Distinct from JWT_SECRET so the two can rotate independently.
 */
export function getSessionSecret(): string {
  return resolveSecret("SessionSecret", "SESSION_SECRET", [
    "AUTH_SECRET",
    "NEXTAUTH_SECRET",
  ]);
}

/**
 * Origin the OAuth callback should redirect to. Used to build
 * `${origin}/api/auth/google/callback` for the `redirect_uri` param. We accept
 * an explicit override (PUBLIC_API_URL) for cases where the API is
 * fronted by a custom domain; otherwise we fall back to the Function URL
 * SST exposes via VITE_API_URL or the local dev origin.
 */
export function getOAuthRedirectOrigin(): string {
  const explicit =
    process.env.PUBLIC_API_URL ??
    process.env.VITE_API_URL ??
    process.env.API_URL;
  if (explicit && explicit.length > 0) return explicit.replace(/\/$/, "");
  // Local fallback. Matches the Vite proxy target in packages/web/vite.config.ts.
  return "http://localhost:3001";
}

/**
 * Build the canonical Google OAuth callback URL. Whatever is returned here
 * MUST be added verbatim to "Authorized redirect URIs" in Google Cloud
 * Console — see docs/google-oauth-setup.md.
 */
export function getGoogleRedirectUri(): string {
  return `${getOAuthRedirectOrigin()}/api/auth/google/callback`;
}
