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
 * profiles and connections alike (and room members, when there were rooms),
 * and `ProfileScoped` is the
 * `?profile=` convention that three layer endpoints honour. Putting either in
 * one resource file would make the other resources import from a module they
 * have nothing to do with, so they sit with the plumbing that is already
 * everybody's.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
import {invalidateSourceRequest} from '../inspiration-snapshots';
import { apiFetch } from './transport';
import { MAX_MESSAGE_ATTACHMENTS } from './file-accept';

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
  readonly code?: string;
  /** A chat send refused as `attachment_not_ready` names the attachment ids
      the server no longer has staged, so the composer can drop just those. */
  readonly missingAttachmentIds?: string[];
  /** The failure came from this app (a JSON body with our `error` field),
      not from a gateway, a proxy or a crashed process in front of it. A
      save treats only the app's own 500 as an answer about its write. */
  readonly fromApp?: boolean;

  constructor(input: {
    status: number;
    message: string;
    fieldErrors?: ApiFieldErrors;
    code?: string;
    missingAttachmentIds?: string[];
    fromApp?: boolean;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.status = input.status;
    this.fieldErrors = input.fieldErrors;
    this.code = input.code;
    if (input.missingAttachmentIds) this.missingAttachmentIds = input.missingAttachmentIds;
    if (input.fromApp) this.fromApp = true;
  }
}

/** Ids, or nothing: a refusal's list is read only when it is a list of strings
    no longer than a message can carry. */
const idList = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.length <= MAX_MESSAGE_ATTACHMENTS && value.every((item) => typeof item === "string") ? value as string[] : undefined;

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
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      ...(signal ? { signal } : {}),
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
    const errorBody = (body ?? {}) as { error?: string; details?: ApiFieldErrors; code?: string };
    throw new ApiError({
      status: res.status,
      message:
        errorBody.error ?? `${fallbackMessage} (HTTP ${res.status}). Please try again.`,
      fieldErrors: errorBody.details,
      code: typeof errorBody.code === 'string' ? errorBody.code : undefined,
    });
  }

  return body as T;
}

export async function postJson<T>(
  path: string,
  payload: unknown,
  fallbackMessage: string,
  signal?: AbortSignal,
  requestId?: string,
): Promise<T> {
  return writeJson<T>("POST", path, payload, fallbackMessage, signal, requestId);
}

export async function patchJson<T>(
  path: string,
  payload: unknown,
  fallbackMessage: string,
  signal?: AbortSignal,
): Promise<T> {
  return writeJson<T>("PATCH", path, payload, fallbackMessage, signal);
}

/** A versioned removal whose response is the current resource, not an empty ack. */
export async function deleteJson<T>(path:string,payload:unknown,fallbackMessage:string,signal?:AbortSignal):Promise<T>{
  return writeJson<T>('DELETE',path,payload,fallbackMessage,signal);
}

export async function writeJson<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  payload: unknown,
  fallbackMessage: string,
  signal?: AbortSignal,
  requestId?: string,
): Promise<T> {
  /* THE ONE FETCH IN THIS FILE THAT WAS NOT WRAPPED.
     `getJson` and `requestVoid` each catch a dead connection and rethrow it as
     `ApiError { status: 0 }`, which is what `whyFailed` reads to say "the
     server could not be reached". This one did not, so a `TypeError` walked
     straight through it, hit `whyFailed`'s plain-Error branch, and put the
     browser's own words on a person's screen:

         "That name did not stick — Failed to fetch"

     That is every POST and PATCH in the product — keeping a memory, renaming a
     room, leaving one, proposing a change, issuing a key — speaking developer
     under exactly the condition a person is least able to interpret it.

     Found by `e2e:when-it-fails --kind drop`: the same six acts that all speak
     properly under a 500 split into two voices under a dropped connection, and
     the odd one out (`close this room`, on `requestVoid`) was the one that read
     correctly. Two shapes of the same failure, one wrapped and one not. */
  let res: Response;
  invalidateSourceRequest(path);
  try {
    res = await apiFetch(path, {
      method,
      ...(signal ? { signal } : {}),
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(requestId !== undefined ? { 'Idempotency-Key': requestId } : {}) },
      body: JSON.stringify(payload),
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
    const errorBody = (body ?? {}) as {
      error?: string;
      details?: ApiFieldErrors;
      code?: string;
      missingAttachmentIds?: unknown;
    };
    const missingAttachmentIds = idList(errorBody.missingAttachmentIds);
    throw new ApiError({
      status: res.status,
      message:
        errorBody.error ??
        `${fallbackMessage} (HTTP ${res.status}). Please try again.`,
      fieldErrors: errorBody.details,
      code: typeof errorBody.code === 'string' ? errorBody.code : undefined,
      ...(missingAttachmentIds ? { missingAttachmentIds } : {}),
      fromApp: typeof errorBody.error === 'string',
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
  signal?: AbortSignal,
  /** Let the request outlive the page — for a delete sent as the tab closes. */
  keepalive?: boolean,
): Promise<void> {
  let res: Response;
  invalidateSourceRequest(path);
  try {
    res = await apiFetch(path, {
      method,
      ...(signal ? { signal } : {}),
      ...(keepalive ? { keepalive: true } : {}),
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
  const errorBody = (body ?? {}) as { error?: string; details?: ApiFieldErrors; code?: string };
  throw new ApiError({
    status: res.status,
    message:
      errorBody.error ?? `${fallbackMessage} (HTTP ${res.status}). Please try again.`,
    fieldErrors: errorBody.details,
    code: typeof errorBody.code === 'string' ? errorBody.code : undefined,
  });
}
