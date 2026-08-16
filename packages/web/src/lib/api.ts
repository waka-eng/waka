/**
 * Typed API client.
 *
 * One thin wrapper over `fetch` so every page in the app talks to the Hono
 * Lambda the same way:
 *   - JSON in / JSON out,
 *   - `credentials: "include"` so the httpOnly session cookie set by the
 *     server is sent on subsequent requests,
 *   - shape-stable error objects { error: string; details?: ... } the UI
 *     can render directly without each caller reinventing the parse.
 *
 * The vocabulary here is the vocabulary of `docs/data-model.md`, one name per
 * concept: an **account** logs in, a **profile** owns memory, and a profile's
 * memory is three layers — inspirations, signals, one top of mind. Nothing in
 * this file translates between two names for the same thing; if a name here
 * disagrees with that document, this file is the side that is wrong.
 */

import type { SupportedLocale } from "./locales";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * The auth identity: one login, one person. Everything on it answers "who
 * signed in and what may they reach", which is why the display fields live on
 * the profile instead — a person's name is a property of the memory they own,
 * and an account owns several.
 */
export interface ApiAccount {
  id: string;
  email: string;
  onboardingCompletedAt: string | null;
  isAdmin: boolean;
}

export type ApiProfileType = "human" | "agent";

/** The unit that owns memory. Every session acts as exactly one of these. */
export interface ApiProfile {
  id: string;
  accountId: string;
  type: ApiProfileType;
  name: string;
  avatarUrl: string | null;
  preferredLocale: SupportedLocale;
  publicHandle: string | null;
  publicProfileEnabled: boolean;
  publicTopOfMindEnabled: boolean;
}

/** Who the session is: the account that logged in, acting as one profile. */
export interface ApiViewer {
  account: ApiAccount;
  profile: ApiProfile;
}

/**
 * Field-level validation errors as emitted by Hono handlers via zod's
 * `flatten().fieldErrors`. Keys map 1:1 to form field names; an unknown
 * key is acceptable so the UI can degrade to a banner-level error rather
 * than crashing on an unexpected field.
 */
export type ApiFieldErrors = Record<string, string[] | undefined>;

/**
 * Field-level validation errors as emitted by the Hono signup handler.
 */
export interface SignupFieldErrors extends ApiFieldErrors {
  email?: string[];
  password?: string[];
  name?: string[];
}

/**
 * Field-level validation errors as emitted by the Hono login handler.
 * Distinct alias so call-sites can be specific even though the runtime
 * shape is a strict subset of `SignupFieldErrors`.
 */
export interface LoginFieldErrors extends ApiFieldErrors {
  email?: string[];
  password?: string[];
}

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
// Signup
// ---------------------------------------------------------------------------

export interface SignupRequest {
  email: string;
  password: string;
  name?: string;
  preferredLocale?: SupportedLocale;
}

export interface AuthSessionResponse extends ApiViewer {
  /**
   * Session JWT. Mirrored in the httpOnly cookie; included in the body so
   * non-browser clients (CLI, e2e tests) can authenticate too. The web app
   * deliberately does NOT persist this in localStorage — the cookie is the
   * source of truth — but having it here keeps the contract symmetric.
   */
  token: string;
}

/**
 * POST /auth/signup
 *
 * Creates an email+password account, its human profile, and a session. On
 * success the server has already set the `waka_session` cookie; the returned
 * object is what the app renders itself from until the next `/auth/me`.
 *
 * Throws `ApiError` on any non-2xx response so callers get a single,
 * predictable failure path (try/catch instead of a discriminated union).
 */
export async function signup(input: SignupRequest): Promise<AuthSessionResponse> {
  return postJson<AuthSessionResponse>(apiPath("/auth/signup"), input, "Signup failed");
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * POST /auth/login
 *
 * Authenticate an existing account. Server sets the `waka_session` cookie;
 * the account + acting profile are returned for UI rendering.
 */
export async function login(input: LoginRequest): Promise<AuthSessionResponse> {
  return postJson<AuthSessionResponse>(apiPath("/auth/login"), input, "Login failed");
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/**
 * POST /auth/logout
 *
 * Asks the server to clear the session cookie. We swallow non-2xx responses
 * here because client-side state (the in-memory viewer, localStorage cache)
 * MUST be cleared regardless of whether the network round-trip succeeds —
 * otherwise a flaky network leaves the UI showing a "logged in" state that
 * the server has already invalidated. The auth context handles that policy.
 */
export async function logout(): Promise<void> {
  await fetch(apiPath("/auth/logout"), {
    method: "POST",
    credentials: "include",
  }).catch(() => {
    // Network failure: still proceed; the caller wipes local state anyway.
  });
}

// ---------------------------------------------------------------------------
// Current viewer
// ---------------------------------------------------------------------------

/**
 * GET /auth/me
 *
 * Returns the account implied by the session cookie plus the profile that
 * session acts as, or `null` when the cookie is missing/invalid/expired. Used
 * by `<AuthProvider>` on mount to hydrate state from the server (the cookie is
 * httpOnly so JS cannot read it directly — the server must tell us who it
 * sees).
 *
 * A 401 response is treated as "no session" rather than an error: it's the
 * expected outcome for an anonymous visitor. Genuine network failures throw
 * `ApiError` so the caller can decide whether to retry.
 */
export async function fetchCurrentViewer(): Promise<ApiViewer | null> {
  let res: Response;
  try {
    res = await fetch(apiPath("/auth/me"), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError({
      status: 0,
      message: "Network unreachable while loading session",
    });
  }

  if (res.status === 401) return null;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response — handled below.
  }

  if (!res.ok) {
    const errorBody = (body ?? {}) as { error?: string };
    throw new ApiError({
      status: res.status,
      message:
        errorBody.error ?? `Failed to load session (HTTP ${res.status}).`,
    });
  }

  const payload = (body ?? {}) as Partial<ApiViewer>;
  if (!payload.account || !payload.profile) return null;
  return { account: payload.account, profile: payload.profile };
}

export interface UpdateAuthPreferencesRequest {
  preferredLocale: SupportedLocale;
}

/**
 * PATCH /auth/me/preferences
 *
 * Persists preferences that should follow the person across devices. Today
 * that is only preferredLocale, which also drives the language of everything
 * the server generates for this profile.
 */
export async function updateAuthPreferences(
  input: UpdateAuthPreferencesRequest,
): Promise<ApiViewer> {
  return patchJson<ApiViewer>(
    apiPath("/auth/me/preferences"),
    input,
    "Failed to update preferences",
  );
}

export interface UpdateAuthProfileRequest {
  name: string;
  preferredLocale: SupportedLocale;
  completeOnboarding?: boolean;
  publicHandle?: string | null;
  publicProfileEnabled?: boolean;
  publicTopOfMindEnabled?: boolean;
}

/**
 * PATCH /auth/me/profile
 *
 * The name, avatar, language and public surface all belong to the profile;
 * `completeOnboarding` is the one field here that lands on the account, which
 * is why the response carries both.
 */
export async function updateAuthProfile(
  input: UpdateAuthProfileRequest,
): Promise<ApiViewer> {
  return patchJson<ApiViewer>(
    apiPath("/auth/me/profile"),
    input,
    "Failed to update profile",
  );
}

export async function deleteAccount(): Promise<void> {
  const res = await fetch(apiPath("/auth/me"), {
    method: "DELETE",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore malformed error bodies
    }
    const errorBody = (body ?? {}) as { error?: string; details?: ApiFieldErrors };
    throw new ApiError({
      status: res.status,
      message: errorBody.error ?? `Failed to delete account (HTTP ${res.status}).`,
      fieldErrors: errorBody.details,
    });
  }
}

/**
 * GET /profiles — every profile this account owns, human first.
 *
 * A profile is the unit that owns memory: the person's own, and any agent
 * profiles they have added. Each owns a full three-layer stack. The layer
 * endpoints below are scoped to the session's *bound* profile, so this lists
 * who exists rather than handing over their contents.
 */
export async function fetchProfiles(): Promise<ApiProfile[]> {
  const body = await getJson<{ profiles: ApiProfile[] }>(
    apiPath("/profiles"),
    "Failed to load profiles",
  );
  return Array.isArray(body.profiles) ? body.profiles : [];
}

/**
 * POST /profiles
 *
 * Adds a profile to this account. An agent profile owns its own full three
 * layers — its captures, its patterns, its top of mind — kept separately from
 * the human's rather than filtered out of them. Only the account's human
 * profile may create one.
 */
export async function createProfile(input: {
  type: ApiProfileType;
  name: string;
}): Promise<ApiProfile> {
  const body = await postJson<{ profile: ApiProfile }>(
    apiPath("/profiles"),
    input,
    "Failed to add that profile",
  );
  return body.profile;
}

// ---------------------------------------------------------------------------
// Layer 1 — inspirations
// ---------------------------------------------------------------------------

/** Attachment kinds — mirrors the Postgres `attachment_type` enum. */
export type AttachmentType = "link" | "image" | "file";
export type AttachmentEnrichmentStatus = "pending" | "ready" | "failed" | "unavailable";
export type AttachmentEnrichmentKind = "page_body" | "image_description";

export type ApiInspirationKind = "note" | "link" | "image" | "mixed";

/**
 * Whose initiative the content was: the person's words (typed here, or relayed
 * by an agent on their behalf) versus an agent's own observation. Distinct
 * from which session captured it, which the server audits separately.
 */
export type ApiInspirationSource = "app" | "agent";

/**
 * Capture-time context the server derived from an attachment: a bounded fetch
 * of a link, or a one-time description of an image. It exists so signal
 * extraction can read what a person *saved* and not only what they typed, and
 * is never presented as their words.
 */
export interface ApiAttachmentEnrichment {
  status: AttachmentEnrichmentStatus | null;
  kind: AttachmentEnrichmentKind | null;
  text: string | null;
  errorReason: string | null;
  updatedAt: string | null;
  /** Present for link attachments; null for anything else. */
  link: {
    finalUrl: string | null;
    hostname: string | null;
    title: string | null;
    description: string | null;
    siteName: string | null;
    previewImageUrl: string | null;
  } | null;
  /** Present for image attachments; null for anything else. */
  image: { width: number | null; height: number | null } | null;
}

/**
 * Canonical attachment row. The S3 key never crosses to the browser — a link
 * carries the URL it was saved from, and an image or file carries the URL the
 * server is willing to serve it at.
 */
export interface ApiAttachment {
  id: string;
  inspirationId: string;
  type: AttachmentType;
  url: string;
  name: string | null;
  contentType: string | null;
  size: number | null;
  createdAt: string;
  enrichment: ApiAttachmentEnrichment;
}

/** Enough of an attachment to render a row without loading the detail. */
export interface ApiAttachmentSummary {
  id: string;
  type: AttachmentType;
  label: string;
}

/**
 * The short human-authored Q&A hanging off a capture. Layer-1 detail: kept,
 * the person's own words, and input to extraction.
 */
export interface ApiReflection {
  id: string;
  inspirationId: string;
  question: string;
  answer: string | null;
  skipped: boolean;
  createdAt: string;
}

/** One row of the archive: whatever the list needs, and nothing more. */
export interface ApiInspirationSummary {
  id: string;
  textPreview: string;
  kind: ApiInspirationKind | null;
  source: ApiInspirationSource;
  /* carried on the summary too: the field marks which of your own memories
     are out in the rooms, and it cannot do that from the detail alone */
  visibility: ApiInspirationVisibility;
  createdAt: string;
  updatedAt: string;
  attachmentSummary: ApiAttachmentSummary[];
  reflectionCount: number;
}

/** One capture, opened: the full text and everything hanging off it. */
export interface ApiInspiration {
  id: string;
  profileId: string;
  text: string;
  kind: ApiInspirationKind | null;
  source: ApiInspirationSource;
  /** Whether the rooms this account is in can see it. Never inferred. */
  visibility: ApiInspirationVisibility;
  createdAt: string;
  updatedAt: string;
  attachments: ApiAttachment[];
  reflections: ApiReflection[];
}

export interface CreateReflectionRequest {
  /** Required, trimmed, max 4 KB. */
  question: string;
  /** Optional. Empty / whitespace becomes `null` server-side. */
  answer?: string;
  /** Optional. When `true` the row is recorded as a deliberate "no answer". */
  skipped?: boolean;
}

/** Whether a capture may appear in the fields of rooms this account is in. */
export type ApiInspirationVisibility = "private" | "public";

export interface CreateInspirationRequest {
  text: string;
  kind?: ApiInspirationKind;
  source?: ApiInspirationSource;
  /**
   * Omitted means private. The server's column default decides what unset
   * means, so this stays optional rather than defaulting on the client —
   * one place decides, and it is the one furthest from a mistake.
   */
  visibility?: ApiInspirationVisibility;
  /** Reflections saved with the capture, so a save is never half-recorded. */
  reflections?: CreateReflectionRequest[];
}

export interface UpdateInspirationRequest {
  /** Opening a memory up, or closing it again. Editable in both directions. */
  visibility?: ApiInspirationVisibility;
  text?: string;
  kind?: ApiInspirationKind;
}

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

export interface FetchInspirationsOptions extends ProfileScoped {
  q?: string;
  limit?: number;
  /** Opaque, from a previous page's `nextCursor`. */
  cursor?: string;
}

/** One page, plus the way to ask for the next one. */
export interface ApiInspirationPage {
  inspirations: ApiInspirationSummary[];
  nextCursor?: string;
}

/**
 * POST /inspirations
 *
 * Persists a capture owned by the acting profile. The server returns 201 with
 * the canonical row; signal derivation happens in the background afterwards.
 */
export async function createInspiration(
  input: CreateInspirationRequest,
): Promise<ApiInspiration> {
  const body = await postJson<{ inspiration: ApiInspiration }>(
    apiPath("/inspirations"),
    input,
    "Failed to save this capture",
  );
  return body.inspiration;
}

/**
 * GET /inspirations
 *
 * The acting profile's private archive, newest first. The server scopes by
 * profile unconditionally, so the caller never passes an owner — `q` searches
 * the text and `limit` bounds the page.
 */
export async function fetchInspirations(
  options: FetchInspirationsOptions = {},
): Promise<ApiInspirationSummary[]> {
  const params = new URLSearchParams();
  if (options.profile) params.set("profile", options.profile);
  if (options.q) params.set("q", options.q);
  if (typeof options.limit === "number") params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  const query = params.toString();
  const body = await getJson<ApiInspirationPage>(
    apiPath(`/inspirations${query ? `?${query}` : ""}`),
    "Failed to load your captures",
  );
  return Array.isArray(body.inspirations) ? body.inspirations : [];
}

/**
 * One page WITH its cursor. `fetchInspirations` throws the cursor away, which
 * silently capped the field at the server's 200-per-page ceiling — a person
 * with three hundred memories saw two hundred and was told nothing. Callers
 * that must see everything use this and follow the cursor.
 */
export async function fetchInspirationPage(
  options: FetchInspirationsOptions = {},
): Promise<ApiInspirationPage> {
  const params = new URLSearchParams();
  if (options.profile) params.set("profile", options.profile);
  if (options.q) params.set("q", options.q);
  if (typeof options.limit === "number") params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  const query = params.toString();
  const body = await getJson<ApiInspirationPage>(
    apiPath(`/inspirations${query ? `?${query}` : ""}`),
    "Failed to load your captures",
  );
  return {
    inspirations: Array.isArray(body.inspirations) ? body.inspirations : [],
    nextCursor: body.nextCursor,
  };
}

/** GET /inspirations/:id — one capture with its attachments and reflections. */
export async function fetchInspiration(id: string): Promise<ApiInspiration> {
  const body = await getJson<{ inspiration: ApiInspiration }>(
    apiPath(`/inspirations/${encodeURIComponent(id)}`),
    "Failed to load this capture",
  );
  if (!body.inspiration) {
    throw new ApiError({ status: 200, message: "Malformed capture response" });
  }
  return body.inspiration;
}

/**
 * PATCH /inspirations/:id
 *
 * Editing a capture re-derives the signals it supports, which is why this is
 * a plain edit and not a new row: the evidence link is what carries forward.
 */
export async function updateInspiration(
  id: string,
  input: UpdateInspirationRequest,
): Promise<ApiInspiration> {
  const body = await patchJson<{ inspiration: ApiInspiration }>(
    apiPath(`/inspirations/${encodeURIComponent(id)}`),
    input,
    "Failed to update this capture",
  );
  return body.inspiration;
}

/**
 * DELETE /inspirations/:id
 *
 * Removes the capture, its attachments, its reflections, and its evidence
 * links. A signal that loses all of its evidence is retired unless a human
 * edit locked it, in which case its text stays and it is marked unsupported.
 */
export async function deleteInspiration(id: string): Promise<void> {
  await requestVoid(
    apiPath(`/inspirations/${encodeURIComponent(id)}`),
    "DELETE",
    undefined,
    "Failed to delete this capture",
  );
}

/** POST /inspirations/:id/reflections */
export async function createReflection(
  inspirationId: string,
  input: CreateReflectionRequest,
): Promise<ApiReflection> {
  const body = await postJson<{ reflection: ApiReflection }>(
    apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/reflections`),
    input,
    "Failed to save reflection",
  );
  return body.reflection;
}

/** GET /inspirations/:id/reflections — oldest first. */
export async function fetchReflections(
  inspirationId: string,
): Promise<ApiReflection[]> {
  const body = await getJson<{ reflections: ApiReflection[] }>(
    apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/reflections`),
    "Failed to load reflections",
  );
  return Array.isArray(body.reflections) ? body.reflections : [];
}

/** DELETE /inspirations/:id/reflections/:reflectionId */
export async function deleteReflection(
  inspirationId: string,
  reflectionId: string,
): Promise<void> {
  await requestVoid(
    apiPath(
      `/inspirations/${encodeURIComponent(inspirationId)}/reflections/${encodeURIComponent(reflectionId)}`,
    ),
    "DELETE",
    undefined,
    "Failed to delete reflection",
  );
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Response from POST /attachments/presign.
 *
 * `headers` MUST be forwarded verbatim with the browser PUT — the signature
 * is bound to Content-Type and Content-Length, so deviating from these
 * causes S3 to 403 the upload.
 */
export interface PresignResponse {
  uploadUrl: string;
  key: string;
  expiresAt: string;
  headers: {
    "Content-Type": string;
    "Content-Length": string;
  };
}

export interface PresignRequest {
  filename: string;
  contentType: string;
  size: number;
}

/**
 * POST /attachments/presign
 *
 * Mints a single-use presigned PUT URL the browser uses to upload an
 * attachment payload directly to S3. Returns the canonical key the caller
 * MUST echo back in the subsequent finalize call.
 */
export async function presignAttachment(
  input: PresignRequest,
): Promise<PresignResponse> {
  return postJson<PresignResponse>(
    apiPath("/attachments/presign"),
    input,
    "Failed to mint upload URL",
  );
}

/**
 * Browser-side PUT to S3. Surfaces a stable error so the caller's catch
 * branch can render a banner without parsing the SDK's network errors.
 *
 * We intentionally do NOT include credentials — the URL is presigned, the
 * cookie is irrelevant, and sending it to a non-same-origin host would just
 * be ignored by S3.
 */
export async function uploadToPresignedUrl(
  url: string,
  file: File | Blob,
  headers: Record<string, string>,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers,
      body: file,
    });
  } catch {
    throw new ApiError({
      status: 0,
      message: "Network unreachable while uploading attachment",
    });
  }
  if (!res.ok) {
    // S3 returns plain XML on failures; we don't try to parse it because the
    // useful detail (the AWS-side reason) is in `res.statusText`.
    throw new ApiError({
      status: res.status,
      message: `Upload failed (HTTP ${res.status}). Please try again.`,
    });
  }
}

/**
 * Discriminated union for POST /attachments. Mirrors the server zod schema
 * so a misuse here trips a typecheck error rather than a 400 at runtime.
 */
export type FinalizeAttachmentRequest =
  | {
      type: "link";
      inspirationId: string;
      url: string;
      name?: string;
    }
  | {
      type: "image" | "file";
      inspirationId: string;
      key: string;
      name?: string;
      contentType?: string;
      size?: number;
    };

/**
 * POST /attachments
 *
 * Finalize an attachment after the S3 PUT has succeeded (image / file) or
 * record a pasted link directly (link). The server enforces inspiration
 * ownership; on success it returns the canonical row and queues enrichment.
 */
export async function finalizeAttachment(
  input: FinalizeAttachmentRequest,
): Promise<ApiAttachment> {
  const body = await postJson<{ attachment: ApiAttachment }>(
    apiPath("/attachments"),
    input,
    "Failed to record attachment",
  );
  return body.attachment;
}

// ---------------------------------------------------------------------------
// Layer 2 — signals
// ---------------------------------------------------------------------------

export type ApiSignalStatus = "emerging" | "active" | "retired";

/**
 * An evidence-backed pattern: a durable distilled statement citing the
 * profile's captures. `locked` means a human edited the text, so the server
 * keeps attaching evidence to it but never rewrites it; `unsupported` means
 * every capture behind it is gone and only the lock is keeping it here.
 */
export interface ApiSignal {
  id: string;
  statement: string;
  status: ApiSignalStatus;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: string | null;
  locked: boolean;
  unsupported: boolean;
  sharedGroupIds: string[];
  createdAt: string;
}

/** One capture standing behind a signal, and why it was read that way. */
export interface ApiSignalEvidence {
  inspirationId: string;
  preview: string;
  quote: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ApiSignalDetail extends ApiSignal {
  evidence: ApiSignalEvidence[];
}

export interface FetchSignalsOptions extends ProfileScoped {
  status?: ApiSignalStatus;
  limit?: number;
}

/** GET /signals — the acting profile's distilled patterns. */
export async function fetchSignals(
  options: FetchSignalsOptions = {},
): Promise<ApiSignal[]> {
  const params = new URLSearchParams();
  if (options.profile) params.set("profile", options.profile);
  if (options.status) params.set("status", options.status);
  if (typeof options.limit === "number") params.set("limit", String(options.limit));
  const query = params.toString();
  const body = await getJson<{ signals: ApiSignal[] }>(
    apiPath(`/signals${query ? `?${query}` : ""}`),
    "Failed to load your signals",
  );
  return Array.isArray(body.signals) ? body.signals : [];
}

/** GET /signals/:id — the same statement, plus what it rests on. */
export async function fetchSignal(id: string): Promise<ApiSignalDetail> {
  const body = await getJson<{ signal: ApiSignalDetail }>(
    apiPath(`/signals/${encodeURIComponent(id)}`),
    "Failed to load this signal",
  );
  if (!body.signal) {
    throw new ApiError({ status: 200, message: "Malformed signal response" });
  }
  return body.signal;
}

/**
 * PATCH /signals/:id
 *
 * Rewriting a signal locks it: the person's words are frozen against
 * regeneration from here on, while its evidence and confidence keep moving.
 */
export async function updateSignal(
  id: string,
  input: { statement: string },
): Promise<ApiSignal> {
  const body = await patchJson<{ signal: ApiSignal }>(
    apiPath(`/signals/${encodeURIComponent(id)}`),
    input,
    "Failed to update this signal",
  );
  return body.signal;
}

/** DELETE /signals/:id */
export async function deleteSignal(id: string): Promise<void> {
  await requestVoid(
    apiPath(`/signals/${encodeURIComponent(id)}`),
    "DELETE",
    undefined,
    "Failed to delete this signal",
  );
}

/**
 * POST /signals/:id/shares
 *
 * Sharing is per-signal and per-group. What reaches the group is the
 * statement; the captures underneath it never leave the account.
 */
export async function shareSignal(id: string, groupId: string): Promise<void> {
  await requestVoid(
    apiPath(`/signals/${encodeURIComponent(id)}/shares`),
    "POST",
    { groupId },
    "Failed to share this signal",
  );
}

/** DELETE /signals/:id/shares/:groupId */
export async function unshareSignal(id: string, groupId: string): Promise<void> {
  await requestVoid(
    apiPath(
      `/signals/${encodeURIComponent(id)}/shares/${encodeURIComponent(groupId)}`,
    ),
    "DELETE",
    undefined,
    "Failed to stop sharing this signal",
  );
}

// ---------------------------------------------------------------------------
// Layer 3 — top of mind
// ---------------------------------------------------------------------------

export type ApiTopOfMindEntryType =
  | "pattern"
  | "tension"
  | "question"
  | "hypothesis"
  | "action";

export type ApiTopOfMindReason =
  | "initial"
  | "regenerated"
  | "no_change"
  | "member_proposal"
  | "human_edit";

/**
 * One statement inside the artifact. `locked` is the same rule as a signal's:
 * a human edit freezes the words and the server works around them.
 */
export interface ApiTopOfMindEntry {
  id: string;
  type: ApiTopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  locked: boolean;
  pinned: boolean;
  dismissed: boolean;
  sortOrder: number;
  /** What the entry rests on: signals this profile holds, named. */
  citedSignals: Array<{ id: string; statement: string }>;
  createdAt: string;
}

/**
 * The single synthesized artifact for a profile or a group. Entries compose
 * it, but the artifact is the unit: one identity, one current version, a
 * linear history. A regeneration writes a new version rather than mutating
 * this one.
 */
export interface ApiTopOfMind {
  id: string;
  version: number;
  reason: ApiTopOfMindReason;
  createdAt: string;
  entries: ApiTopOfMindEntry[];
}

export type ApiTopOfMindStatus = "live" | "superseded";

/** A row of the version history — the artifact without its entries. */
export interface ApiTopOfMindVersion {
  id: string;
  version: number;
  status: ApiTopOfMindStatus;
  reason: ApiTopOfMindReason;
  entryCount: number;
  replacedById: string | null;
  replacedAt: string | null;
  createdAt: string;
}

/**
 * GET /top-of-mind
 *
 * Null until the first synthesis lands, which is a real state rather than an
 * error: a profile with nothing to read has nothing on its board.
 */
export async function fetchTopOfMind(
  options: ProfileScoped = {},
): Promise<ApiTopOfMind | null> {
  const query = options.profile
    ? `?profile=${encodeURIComponent(options.profile)}`
    : "";
  const body = await getJson<{ topOfMind: ApiTopOfMind | null }>(
    apiPath(`/top-of-mind${query}`),
    "Failed to load your top of mind",
  );
  return body.topOfMind ?? null;
}

/** GET /top-of-mind/versions — newest first. */
export async function fetchTopOfMindVersions(): Promise<ApiTopOfMindVersion[]> {
  const body = await getJson<{ versions: ApiTopOfMindVersion[] }>(
    apiPath("/top-of-mind/versions"),
    "Failed to load earlier versions",
  );
  return Array.isArray(body.versions) ? body.versions : [];
}

/**
 * POST /top-of-mind/refresh
 *
 * Accepted, not done: synthesis runs in the background and the caller polls
 * `fetchTopOfMind` for the version that replaces the current one.
 */
export async function refreshTopOfMind(): Promise<void> {
  await requestVoid(
    apiPath("/top-of-mind/refresh"),
    "POST",
    {},
    "Failed to start a new reading",
  );
}

/** PATCH /top-of-mind/entries/:entryId — rewriting an entry locks it. */
export async function updateTopOfMindEntry(
  entryId: string,
  input: { body: string },
): Promise<ApiTopOfMindEntry> {
  const body = await patchJson<{ entry: ApiTopOfMindEntry }>(
    apiPath(`/top-of-mind/entries/${encodeURIComponent(entryId)}`),
    input,
    "Failed to update this entry",
  );
  return body.entry;
}

/**
 * POST /top-of-mind/entries/:entryId/pin
 *
 * Holding is one-directional by design: the generator reads a held entry on
 * every pass and carries it into the version it writes, so releasing it is
 * dismissing it rather than a second state to toggle back through.
 */
export async function holdTopOfMindEntry(
  entryId: string,
): Promise<ApiTopOfMindEntry> {
  const body = await postJson<{ entry: ApiTopOfMindEntry }>(
    apiPath(`/top-of-mind/entries/${encodeURIComponent(entryId)}/pin`),
    {},
    "Failed to hold that entry",
  );
  return body.entry;
}

/** POST /top-of-mind/entries/:entryId/dismiss */
export async function dismissTopOfMindEntry(
  entryId: string,
): Promise<ApiTopOfMindEntry> {
  const body = await postJson<{ entry: ApiTopOfMindEntry }>(
    apiPath(`/top-of-mind/entries/${encodeURIComponent(entryId)}/dismiss`),
    {},
    "Failed to take that entry down",
  );
  return body.entry;
}

/** POST /top-of-mind/entries/:entryId/restore */
export async function restoreTopOfMindEntry(
  entryId: string,
): Promise<ApiTopOfMindEntry> {
  const body = await postJson<{ entry: ApiTopOfMindEntry }>(
    apiPath(`/top-of-mind/entries/${encodeURIComponent(entryId)}/restore`),
    {},
    "Failed to put that entry back",
  );
  return body.entry;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export type ApiGroupRole = "owner" | "member";

export interface ApiGroupSummary {
  id: string;
  name: string;
  joinCode: string;
  role: ApiGroupRole;
  memberCount: number;
  createdAt: string;
}

export interface ApiGroupMember {
  profileId: string;
  name: string;
  initials: string;
  /** Human or agent — what kind of company this room keeps. */
  type: ApiProfileType;
  role: ApiGroupRole;
  joinedAt: string;
}

/**
 * A group wall row. The distilled statement crosses the account boundary;
 * the captures it rests on never do, which is why there is no evidence here.
 */
export interface ApiGroupWallSignal {
  signalId: string;
  statement: string;
  confidence: number;
  ownerProfileId: string;
  ownerName: string;
  sharedAt: string;
}

export type ApiGroupProposalKind = "edit_entry" | "add_entry" | "remove_entry";
export type ApiGroupProposalStatus = "open" | "accepted" | "declined";

/** How members change a group's top of mind together. */
export interface ApiGroupProposal {
  id: string;
  kind: ApiGroupProposalKind;
  status: ApiGroupProposalStatus;
  entryId: string | null;
  body: string | null;
  rationale: string | null;
  proposedByProfileId: string;
  proposedByName: string;
  affirmations: Array<{ profileId: string; name: string; createdAt: string }>;
  viewerAffirmed: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

/**
 * A group's artifact, which is not shaped like a profile's.
 *
 * Entries carry contributors rather than cited signals: a member may see that
 * someone's shared signal fed an entry, never which one, because the signal
 * belongs to the account that shared it.
 */
export interface ApiGroupTopOfMindEntry {
  id: string;
  type: ApiTopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  lockedAt: string | null;
  pinnedAt: string | null;
  sortOrder: number;
  createdAt: string;
  contributors: Array<{ profileId: string; name: string }>;
}

export interface ApiGroupTopOfMind {
  topOfMind: {
    id: string;
    version: number;
    status: ApiTopOfMindStatus;
    reason: ApiTopOfMindReason;
    createdAt: string;
  } | null;
  entries: ApiGroupTopOfMindEntry[];
}

/** GET /groups — the groups the acting profile belongs to. */
export async function fetchGroups(): Promise<ApiGroupSummary[]> {
  const body = await getJson<{ groups: ApiGroupSummary[] }>(
    apiPath("/groups"),
    "Failed to load groups",
  );
  return Array.isArray(body.groups) ? body.groups : [];
}

/** POST /groups — create one; the caller becomes its owner. */
export async function createGroup(name: string): Promise<ApiGroupSummary> {
  const body = await postJson<{ group: ApiGroupSummary }>(
    apiPath("/groups"),
    { name },
    "Failed to create group",
  );
  return body.group;
}

/** POST /groups/join — join by the shareable code. */
export async function joinGroup(
  joinCode: string,
): Promise<{ group: ApiGroupSummary; alreadyMember: boolean }> {
  const body = await postJson<{ group: ApiGroupSummary; alreadyMember?: boolean }>(
    apiPath("/groups/join"),
    { joinCode },
    "Failed to join group",
  );
  return { group: body.group, alreadyMember: Boolean(body.alreadyMember) };
}

/**
 * POST /groups/:id/leave
 *
 * Walk out. The signals you shared to this room stop appearing on its wall;
 * they remain yours, and the memories under them never went anywhere.
 */
export async function leaveGroup(groupId: string): Promise<void> {
  await postJson<unknown>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/leave`),
    {},
    "Failed to leave this room",
  );
}

/** GET /groups/:id/members */
export async function fetchGroupMembers(groupId: string): Promise<ApiGroupMember[]> {
  const body = await getJson<{ members: ApiGroupMember[] }>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/members`),
    "Failed to load members",
  );
  return Array.isArray(body.members) ? body.members : [];
}

/** GET /groups/:id/wall — the signals members have shared here. */
export async function fetchGroupWall(groupId: string): Promise<ApiGroupWallSignal[]> {
  const body = await getJson<{ wall: ApiGroupWallSignal[] }>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/wall`),
    "Failed to load this group's wall",
  );
  return Array.isArray(body.wall) ? body.wall : [];
}

/**
 * A room's field: every PUBLIC capture belonging to every current member,
 * each carrying whose it is and whether that profile is a person or an agent.
 *
 * This is the only place layer 1 crosses an account boundary, and it does so
 * only for captures their author marked public. Private ones are not filtered
 * on the client — they never leave the server.
 */
export interface ApiGroupFieldCapture {
  id: string;
  text: string;
  kind: ApiInspirationKind | null;
  source: ApiInspirationSource;
  createdAt: string;
  updatedAt: string;
  ownerProfileId: string;
  ownerName: string;
  ownerType: "human" | "agent";
}

export async function fetchGroupField(groupId: string): Promise<ApiGroupFieldCapture[]> {
  const body = await getJson<{ field: ApiGroupFieldCapture[] }>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/field`),
    "Failed to load this room's field",
  );
  return Array.isArray(body.field) ? body.field : [];
}

/** GET /groups/:id/top-of-mind — the group's own artifact. */
export async function fetchGroupTopOfMind(
  groupId: string,
): Promise<ApiGroupTopOfMind> {
  const body = await getJson<ApiGroupTopOfMind>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/top-of-mind`),
    "Failed to load this group's top of mind",
  );
  return { topOfMind: body.topOfMind ?? null, entries: body.entries ?? [] };
}

/** POST /groups/:id/top-of-mind/refresh */
export async function refreshGroupTopOfMind(groupId: string): Promise<void> {
  await requestVoid(
    apiPath(`/groups/${encodeURIComponent(groupId)}/top-of-mind/refresh`),
    "POST",
    {},
    "Failed to start a new group reading",
  );
}

/** GET /groups/:id/proposals */
export async function fetchGroupProposals(
  groupId: string,
): Promise<ApiGroupProposal[]> {
  const body = await getJson<{ proposals: ApiGroupProposal[] }>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/proposals`),
    "Failed to load proposals",
  );
  return Array.isArray(body.proposals) ? body.proposals : [];
}

export interface CreateGroupProposalRequest {
  kind: ApiGroupProposalKind;
  entryId?: string | null;
  body?: string;
  rationale?: string;
}

/** POST /groups/:id/proposals */
export async function createGroupProposal(
  groupId: string,
  input: CreateGroupProposalRequest,
): Promise<ApiGroupProposal> {
  const body = await postJson<{ proposal: ApiGroupProposal }>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/proposals`),
    input,
    "Failed to propose that change",
  );
  return body.proposal;
}

/**
 * POST /groups/:id/proposals/:proposalId/affirm
 *
 * Standing behind a proposal. Enough affirmations and the server accepts it,
 * which is what writes the group's next version — so the answer says whether
 * this press was the one that carried it.
 */
export async function affirmGroupProposal(
  groupId: string,
  proposalId: string,
): Promise<{ proposal: ApiGroupProposal; accepted: boolean }> {
  const body = await postJson<{ proposal: ApiGroupProposal; accepted?: boolean }>(
    apiPath(
      `/groups/${encodeURIComponent(groupId)}/proposals/${encodeURIComponent(proposalId)}/affirm`,
    ),
    {},
    "That was not saved",
  );
  return { proposal: body.proposal, accepted: Boolean(body.accepted) };
}

/** POST /groups/:id/proposals/:proposalId/decline */
export async function declineGroupProposal(
  groupId: string,
  proposalId: string,
): Promise<ApiGroupProposal> {
  const body = await postJson<{ proposal: ApiGroupProposal }>(
    apiPath(
      `/groups/${encodeURIComponent(groupId)}/proposals/${encodeURIComponent(proposalId)}/decline`,
    ),
    {},
    "That was not saved",
  );
  return body.proposal;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export type ApiFeedbackTarget = "signal" | "top_of_mind_entry";
export type ApiFeedbackValue = "true" | "partly" | "not_true";

export interface ApiFeedback {
  id: string;
  profileId: string;
  targetType: ApiFeedbackTarget;
  targetId: string;
  value: ApiFeedbackValue;
  correctionText: string | null;
  createdAt: string;
}

export interface CreateFeedbackRequest {
  targetType: ApiFeedbackTarget;
  targetId: string;
  value: ApiFeedbackValue;
  correctionText?: string;
}

/** POST /feedback — "true", "partly", or "not true", about one thing. */
export async function createFeedback(
  input: CreateFeedbackRequest,
): Promise<ApiFeedback> {
  const body = await postJson<{ feedback: ApiFeedback }>(
    apiPath("/feedback"),
    input,
    "Failed to save feedback",
  );
  if (!body.feedback) {
    throw new ApiError({ status: 200, message: "Malformed feedback response" });
  }
  return body.feedback;
}

// ---------------------------------------------------------------------------
// Public profile
// ---------------------------------------------------------------------------

export interface ApiPublicProfile {
  name: string;
  handle: string;
  preferredLocale: SupportedLocale;
}

/**
 * The public surface carries statements and nothing that identifies what they
 * were built from — no entry ids, no cited signals.
 */
export interface ApiPublicTopOfMindEntry {
  type: ApiTopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  pinned: boolean;
}

export interface ApiPublicTopOfMind {
  version: number;
  publishedAt: string;
  entries: ApiPublicTopOfMindEntry[];
}

export interface FetchPublicProfileResponse {
  profile: ApiPublicProfile;
  /** Null when the owner shares the page but not the board. */
  topOfMind: ApiPublicTopOfMind | null;
}

export async function fetchPublicProfile(
  handle: string,
): Promise<FetchPublicProfileResponse> {
  const normalizedHandle = handle.trim().replace(/^@+/, "");
  const body = await getJson<FetchPublicProfileResponse>(
    apiPath(`/public/profiles/${encodeURIComponent(normalizedHandle)}`),
    "Failed to load public profile",
  );

  if (!body.profile) {
    throw new ApiError({
      status: 200,
      message: "Malformed public profile response",
    });
  }

  return body;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Shared GET/POST/PATCH/DELETE helpers. Centralise the credential-include /
 * JSON-parse / ApiError-translation dance so each endpoint helper above stays
 * small and consistent.
 */
async function getJson<T>(
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

async function postJson<T>(
  path: string,
  payload: unknown,
  fallbackMessage: string,
): Promise<T> {
  return writeJson<T>("POST", path, payload, fallbackMessage);
}

async function patchJson<T>(
  path: string,
  payload: unknown,
  fallbackMessage: string,
): Promise<T> {
  return writeJson<T>("PATCH", path, payload, fallbackMessage);
}

async function writeJson<T>(
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
async function requestVoid(
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
