/**
 * The plumbing every resource module shares.
 *
 * One thin wrapper over `fetch` so every page in the app talks to the Hono
 * Lambda the same way:
 *   - JSON in / JSON out,
 *   - `credentials: "include"` so the httpOnly session cookie set by the
 *     server is sent on subsequent requests,
 *   - shape-stable error objects { error: string; details?: ... } the UI
 *     can render directly without each caller reinventing the parse.
 *
 * WHY THE VERB HELPERS ARE EXPORTED AND THE BARREL STILL HIDES THEM.
 *
 * `getJson` and friends were private to the single file this client used to
 * be. Splitting that file by resource means the resource modules must be able
 * to reach them, so they carry `export` now — but `index.ts` deliberately does
 * NOT re-export them. `docs/architecture.md` names this client "the only place
 * HTTP happens", and that stays true only while a page cannot reach a raw verb
 * and start deciding request shapes for itself. Package-internal, not public.
 *
 * WHAT ELSE LIVES HERE, AND WHY IT IS NOT IN A RESOURCE FILE.
 *
 * Two wire types below name no single route: `ApiProfileType` is stamped on
 * profiles, connections and group members alike, and `ProfileScoped` is the
 * `?profile=` convention that three layer endpoints honour. Putting either in
 * one resource file would make the other resources import from a module they
 * have nothing to do with, so they sit with the plumbing that is already
 * everybody's.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Field-level validation errors as emitted by Hono handlers via zod's
 * `flatten().fieldErrors`. Keys map 1:1 to form field names; an unknown
 * key is acceptable so the UI can degrade to a banner-level error rather
 * than crashing on an unexpected field.
 */
export type ApiFieldErrors = Record<string, string[] | undefined>;

/**
 * Normalised error thrown by every API helper on non-2xx responses. The UI
 * catches this, branches on `status`, and surfaces `fieldErrors` next to the
 * relevant input when present.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors?: ApiFieldErrors;

  constructor(input: {
    status: number;
    message: string;
    fieldErrors?: ApiFieldErrors;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.status = input.status;
    this.fieldErrors = input.fieldErrors;
  }
}

// ---------------------------------------------------------------------------
// API path helper
// ---------------------------------------------------------------------------

const API_ROUTE_PREFIX = "/api";

function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
}

export function apiPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiBaseUrl()}${API_ROUTE_PREFIX}${normalizedPath}`;
}

// ---------------------------------------------------------------------------
// Wire vocabulary no single resource owns
// ---------------------------------------------------------------------------

export type ApiProfileType = "human" | "agent";

/**
 * WHOSE STACK TO READ.
 *
 * Every layer endpoint accepts `?profile=<id>` and answers to the canon's
 * access matrix server-side (`resolveTargetProfile`): a human-profile session
 * is admin over every profile in its account, an agent session may read the
 * human's but never edit it, and nothing crosses an account boundary. Omit it
 * and the server uses the session's own bound profile, which is the common
 * case and stays a one-argument call.
 */
export interface ProfileScoped {
  /** The profile to act on. Omit for the session's own. */
  profile?: string;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Shared GET/POST/PATCH/DELETE helpers. Centralise the credential-include /
 * JSON-parse / ApiError-translation dance so each endpoint helper above stays
 * small and consistent.
 */
export async function getJson<T>(
  path: string,
  fallbackMessage: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError({
      status: 0,
      message: `${fallbackMessage}: network unreachable`,
    });
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response — handled below.
  }

  if (!res.ok) {
    const errorBody = (body ?? {}) as { error?: string; details?: ApiFieldErrors };
    throw new ApiError({
      status: res.status,
      message:
        errorBody.error ?? `${fallbackMessage} (HTTP ${res.status}). Please try again.`,
      fieldErrors: errorBody.details,
    });
  }

  return body as T;
}

export async function postJson<T>(
  path: string,
  payload: unknown,
  fallbackMessage: string,
): Promise<T> {
  return writeJson<T>("POST", path, payload, fallbackMessage);
}

export async function patchJson<T>(
  path: string,
  payload: unknown,
  fallbackMessage: string,
): Promise<T> {
  return writeJson<T>("PATCH", path, payload, fallbackMessage);
}

export async function writeJson<T>(
  method: "POST" | "PATCH",
  path: string,
  payload: unknown,
  fallbackMessage: string,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response — handled below.
  }

  if (!res.ok) {
    const errorBody = (body ?? {}) as {
      error?: string;
      details?: ApiFieldErrors;
    };
    throw new ApiError({
      status: res.status,
      message:
        errorBody.error ??
        `${fallbackMessage} (HTTP ${res.status}). Please try again.`,
      fieldErrors: errorBody.details,
    });
  }

  return body as T;
}

/**
 * A write whose answer is only "it worked". Accepts any 2xx — including the
 * 202 a queued refresh returns and the empty body a delete returns — and
 * surfaces the server's own message when it refuses.
 */
export async function requestVoid(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  payload: unknown,
  fallbackMessage: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      headers:
        payload === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch {
    throw new ApiError({
      status: 0,
      message: `${fallbackMessage}: network unreachable`,
    });
  }

  if (res.ok) return;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error body — fall back to the caller's message.
  }
  const errorBody = (body ?? {}) as { error?: string; details?: ApiFieldErrors };
  throw new ApiError({
    status: res.status,
    message:
      errorBody.error ?? `${fallbackMessage} (HTTP ${res.status}). Please try again.`,
    fieldErrors: errorBody.details,
  });
}
