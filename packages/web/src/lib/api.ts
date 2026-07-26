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
 * The `signup` helper is the first endpoint we wire up because the /login
 * page needs it. As more endpoints come online (login, inspirations, ...),
 * each gets its own typed function here so callers stay decoupled from the
 * URL surface.
 */

import type { SupportedLocale } from "./locales";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  preferredLocale: SupportedLocale;
  onboardingCompletedAt: string | null;
  publicHandle: string | null;
  publicProfileEnabled: boolean;
  publicTopOfMindEnabled: boolean;
  isAdmin: boolean;
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

export interface SignupResponse {
  user: ApiUser;
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
 * Creates an email+password account and establishes a session. On success
 * the server has already set the `waka_session` cookie; the returned object
 * is mostly useful for displaying "Welcome, <name>" and routing the user to
 * the home page.
 *
 * Throws `ApiError` on any non-2xx response so callers get a single,
 * predictable failure path (try/catch instead of a discriminated union).
 */
export async function signup(input: SignupRequest): Promise<SignupResponse> {
  return postJson<SignupResponse>(apiPath("/auth/signup"), input, "Signup failed");
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: ApiUser;
  token: string;
}

/**
 * POST /auth/login
 *
 * Authenticate an existing email+password account. Server sets the
 * `waka_session` cookie; the user object is returned for UI rendering.
 *
 * The endpoint may not yet be implemented on the backend in earlier
 * sub-ACs — in that case the call returns an `ApiError` with a 404 status
 * which the auth context surfaces to the caller without crashing.
 */
export async function login(input: LoginRequest): Promise<LoginResponse> {
  return postJson<LoginResponse>(apiPath("/auth/login"), input, "Login failed");
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/**
 * POST /auth/logout
 *
 * Asks the server to clear the session cookie. We swallow non-2xx responses
 * here because client-side state (the in-memory user, localStorage cache)
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
// Current user
// ---------------------------------------------------------------------------

/**
 * GET /auth/me
 *
 * Returns the authenticated user implied by the session cookie, or `null`
 * if the cookie is missing/invalid/expired. Used by `<AuthProvider>` on
 * mount to hydrate state from the server (the cookie is httpOnly so JS
 * cannot read it directly — the server must tell us who it sees).
 *
 * A 401 response is treated as "no session" rather than an error: it's the
 * expected outcome for an anonymous visitor. Genuine network failures throw
 * `ApiError` so the caller can decide whether to retry.
 */
export async function fetchCurrentUser(): Promise<ApiUser | null> {
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

  if (res.status === 401 || res.status === 404) {
    // 401 = no/expired cookie. 404 = endpoint not yet wired up server-side
    // (earlier sub-ACs). Both translate to "no authenticated user" so the
    // UI can render the /login route without exploding.
    return null;
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through
  }

  if (!res.ok) {
    const errorBody = (body ?? {}) as { error?: string };
    throw new ApiError({
      status: res.status,
      message:
        errorBody.error ?? `Failed to load session (HTTP ${res.status}).`,
    });
  }

  // Tolerate either { user: {...} } or the user object directly so the
  // server contract has room to evolve without breaking the client.
  const payload = body as { user?: ApiUser } | ApiUser | null;
  if (!payload) return null;
  if ("user" in payload && payload.user) return payload.user;
  if ("id" in payload && "email" in payload) return payload as ApiUser;
  return null;
}

export interface UpdateAuthPreferencesRequest {
  preferredLocale: SupportedLocale;
}

export interface UpdateAuthPreferencesResponse {
  user: ApiUser;
}

/**
 * PATCH /auth/preferences
 *
 * Persists account-level preferences that should follow the user across
 * devices. Today that is only preferredLocale, which also drives future
 * AI-generated WOW copy server-side.
 */
export async function updateAuthPreferences(
  input: UpdateAuthPreferencesRequest,
): Promise<UpdateAuthPreferencesResponse> {
  return patchJson<UpdateAuthPreferencesResponse>(
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

export interface UpdateAuthProfileResponse {
  user: ApiUser;
}

export async function updateAuthProfile(
  input: UpdateAuthProfileRequest,
): Promise<UpdateAuthProfileResponse> {
  return patchJson<UpdateAuthProfileResponse>(
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

// ---------------------------------------------------------------------------
// Inspirations
// ---------------------------------------------------------------------------

/**
 * Cluster taxonomy. Mirrors the `cluster` Postgres enum exposed by the API
 * (see `packages/api/src/db/schema.ts`). The classifier worker fills this in
 * asynchronously; until then the column is `null` and the UI renders an
 * "uncategorised" state.
 */
export type ClusterKind =
  | "outlier"
  | "bridge"
  | "morph"
  | "convergence"
  | "tension"
  | "loop";

/**
 * Canonical inspiration row as the API returns it from POST /inspirations
 * (and, eventually, GET /inspirations).
 *
 * Field shape mirrors the Drizzle insert `.returning(...)` clause exactly so
 * the UI can render the just-saved row without a follow-up GET, satisfying
 * the seed's optimistic-save contract.
 */
export type ApiInspirationKind = "note" | "link" | "image" | "mixed";

export type ApiSignalScoreName =
  | "resonance"
  | "recurrence"
  | "agency"
  | "identitySignal"
  | "decisionRelevance";

export type ApiSignalScores = Record<ApiSignalScoreName, number>;

export interface ApiSignal {
  id: string;
  userId: string;
  text: string;
  kind: ApiInspirationKind | null;
  category: number | null;
  scores: ApiSignalScores;
  capturedAt: string;
  updatedAt: string;
  interpretation: {
    cluster: ClusterKind | null;
    classifiedAt: string | null;
  };
  legacy: {
    inspirationId: string;
    importanceScore: number;
    wowScore: number;
  };
}

export interface ApiInspiration {
  id: string;
  userId: string;
  text: string;
  kind: ApiInspirationKind | null;
  category: number | null;
  importanceScore: number;
  wowScore: number;
  cluster: ClusterKind | null;
  classifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Populated by GET /inspirations; omitted on older create/update responses. */
  attachments?: ApiAttachment[];
  /** Signal-facing compatibility layer over the current inspiration row. */
  signal?: ApiSignal;
  signalScores?: ApiSignalScores;
}

export interface ApiInspirationScoreBreakdown {
  inspirationId: string;
  displayedWowScore: number;
  persistedCoreWowScore: number;
  importanceScore: number;
  freshnessAdjustment: {
    ageDays: number;
    freshnessScore: number;
    displayedMinusCore: number;
    source: "read_time";
  };
  stored: {
    importanceScore: number;
    coreWowScore: number;
  };
  factors: {
    content: {
      score: number;
      textDepthScore: number;
      contextScore: number;
      meaningfulLinkCount: number;
      nonLinkAttachmentCount: number;
      reflectionTextChars: number;
    };
    processing: { score: number; hasReflection: boolean };
    revisit: {
      score: number;
      uniqueRevisitDays: number;
      totalRevisitCount: number;
      recentRevisitCount: number;
      uniqueRevisitDaysScore: number;
      totalRevisitCountScore: number;
      revisitedInLast7DaysScore: number;
    };
    relationship: {
      available: boolean;
      score: number | null;
      topSimilaritySignal: number | null;
      topSurpriseSimilaritySignal: number | null;
      timeDistanceSignal: number | null;
      relatedCandidateCount: number;
      note: string;
    };
  };
  formulas: {
    importance: string;
    coreWow: string;
    displayedWow: string;
    relationship?: string;
  };
}

export interface CreateInspirationRequest {
  text: string;
  kind?: ApiInspirationKind;
  category?: number;
  selectedText?: string;
  selectionStart?: number;
  selectionEnd?: number;
  sparks?: Array<{
    text: string;
    source?: ApiInspirationSparkSource;
    startOffset?: number;
    endOffset?: number;
    confidence?: number;
    isPrimary?: boolean;
    note?: string;
  }>;
  /** Optional Reflect Deeper Q/A saved with the inspiration to avoid a partial post-save gap. */
  reflections?: CreateReflectionRequest[];
  /**
   * How long the composer was open before this save, in milliseconds. The
   * pulse-speed proxy: a fast save is a reaction, a slow one a composition.
   * Optional everywhere — a save must never depend on having timed it.
   */
  captureElapsedMs?: number;
}

export interface UpdateInspirationRequest {
  text: string;
}

export type ApiInspirationSparkSource =
  | "user_selected"
  | "user_written"
  | "user_added_later"
  | "auto_detected"
  | "confirmed_auto";

export interface ApiInspirationSpark {
  id: string;
  userId: string;
  inspirationId: string;
  text: string;
  source: ApiInspirationSparkSource;
  startOffset: number | null;
  endOffset: number | null;
  confidence: number;
  isPrimary: boolean;
  note: string | null;
  whatMovedUser: string | null;
  impliedValues: string[];
  worldviewClaims: string[];
  tensions: string[];
  decisionRelevance: string[];
  emotionalCharge: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateInspirationResponse {
  inspiration: ApiInspiration;
  /** Present when Reflect Deeper Q/A was submitted in the create request. */
  reflections?: ApiReflection[];
}

export interface UpdateInspirationResponse {
  inspiration: ApiInspiration;
}

export type InspirationRevisitEventType =
  | "detail_opened"
  | "detail_returned"
  | "reflection_created"
  | "inspiration_updated";

export interface CreateInspirationRevisitResponse {
  revisit: {
    id: string;
    eventType: InspirationRevisitEventType;
    createdAt: string;
  };
  inspiration: ApiInspirationScorePatch | null;
}

export interface GetInspirationScoreBreakdownResponse {
  scoreBreakdown: ApiInspirationScoreBreakdown;
}

/**
 * POST /inspirations
 *
 * Persists a new inspiration owned by the authenticated user. The server
 * returns 201 with the canonical row and `cluster = null`; the SST queue
 * worker fills the cluster later. Throws `ApiError` on non-2xx.
 */
export async function createInspiration(
  input: CreateInspirationRequest,
): Promise<ApiInspiration> {
  const body = await postJson<CreateInspirationResponse>(
    apiPath("/inspirations"),
    input,
    "Failed to save signal",
  );
  return body.inspiration;
}

/**
 * PATCH /inspirations/:id
 *
 * Updates the editable details for one caller-owned inspiration. The server
 * enforces tenant scope; callers only pass the row id and text body.
 */
export async function updateInspiration(
  id: string,
  input: UpdateInspirationRequest,
): Promise<ApiInspiration> {
  const body = await patchJson<UpdateInspirationResponse>(
    apiPath(`/inspirations/${encodeURIComponent(id)}`),
    input,
    "Failed to update signal",
  );
  return body.inspiration;
}

/**
 * POST /inspirations/:id/revisits
 *
 * Logs a meaningful user return/open interaction separately from list loading.
 * The server scopes the event by both session user and inspiration id, then
 * refreshes only that inspiration's local score best-effort.
 */
export async function recordInspirationRevisit(
  id: string,
  eventType: InspirationRevisitEventType,
): Promise<CreateInspirationRevisitResponse> {
  return postJson<CreateInspirationRevisitResponse>(
    apiPath(`/inspirations/${encodeURIComponent(id)}/revisits`),
    { eventType },
    "Failed to record signal revisit",
  );
}

export async function fetchInspirationSparks(
  inspirationId: string,
): Promise<ApiInspirationSpark[]> {
  const body = await getJson<{ sparks: ApiInspirationSpark[] }>(
    apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/sparks`),
    "Failed to load signal highlights",
  );
  return Array.isArray(body.sparks) ? body.sparks : [];
}

export async function createInspirationSpark(
  inspirationId: string,
  input: {
    text: string;
    source?: ApiInspirationSparkSource;
    startOffset?: number;
    endOffset?: number;
    confidence?: number;
    isPrimary?: boolean;
    note?: string;
  },
): Promise<ApiInspirationSpark> {
  const body = await postJson<{ spark: ApiInspirationSpark }>(
    apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/sparks`),
    input,
    "Failed to save spark",
  );
  return body.spark;
}

export async function deleteInspirationSpark(
  inspirationId: string,
  sparkId: string,
): Promise<void> {
  const path = apiPath(
    `/inspirations/${encodeURIComponent(inspirationId)}/sparks/${encodeURIComponent(sparkId)}`,
  );
  let res: Response;
  try {
    res = await fetch(path, {
      method: "DELETE",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError({
      status: 0,
      message: "Network unreachable while removing highlight",
    });
  }

  if (res.ok) return;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response — handled below.
  }
  const errorBody = (body ?? {}) as { error?: string };
  throw new ApiError({
    status: res.status,
    message:
      errorBody.error ??
      `Failed to remove highlight (HTTP ${res.status}). Please try again.`,
  });
}

export async function fetchInspirationScoreBreakdown(
  id: string,
): Promise<ApiInspirationScoreBreakdown> {
  const body = await getJson<GetInspirationScoreBreakdownResponse>(
    apiPath(`/inspirations/${encodeURIComponent(id)}/score-breakdown`),
    "Failed to load score breakdown",
  );
  return body.scoreBreakdown;
}

/** Response shape for GET /inspirations. */
export interface ListInspirationsResponse {
  inspirations: ApiInspiration[];
}

/**
 * GET /inspirations
 *
 * Returns the authenticated user's inspirations, newest first. The server
 * unconditionally scopes by `user_id`, so the caller never has to (and
 * cannot) filter by user — this client function is intentionally
 * argument-less for that reason.
 *
 * On a 401 (e.g. the cookie expired between mount and fetch) we surface an
 * `ApiError` so the caller can route the user back to /login. The
 * `<RequireAuth>` boundary normally prevents this code path from running
 * without a session, but the network can still race a server-side
 * invalidation, so callers should still handle the error.
 */
export async function fetchInspirations(): Promise<ApiInspiration[]> {
  let res: Response;
  try {
    res = await fetch(apiPath("/inspirations"), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError({
      status: 0,
      message: "Network unreachable while loading signals",
    });
  }

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
        errorBody.error ??
        `Failed to load inspirations (HTTP ${res.status}). Please try again.`,
    });
  }

  const payload = (body ?? {}) as Partial<ListInspirationsResponse>;
  return Array.isArray(payload.inspirations) ? payload.inspirations : [];
}

/**
 * DELETE /inspirations/:id
 *
 * Permanently removes one of the caller's inspirations along with every
 * attachment row, reflection row, and S3 object the server can identify.
 * Server enforces tenant ownership; on a 404 (parent missing or owned by
 * someone else) we surface an `ApiError` so the caller can roll back any
 * optimistic UI state. Throws `ApiError` on non-2xx so the caller has a
 * single failure path (try/catch instead of a discriminated union).
 *
 * The inspiration delete is *not* idempotent in HTTP terms — calling it
 * twice surfaces a 404 the second time — but is idempotent from the
 * data-store perspective: after the first 200, the row and all of its
 * children are gone. Callers that want HTTP-level idempotency can swallow
 * the 404 themselves.
 */
export async function deleteInspiration(id: string): Promise<void> {
  const path = apiPath(`/inspirations/${encodeURIComponent(id)}`);
  let res: Response;
  try {
    res = await fetch(path, {
      method: "DELETE",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError({
      status: 0,
      message: "Network unreachable while deleting signal",
    });
  }

  if (res.ok) return;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response — handled below.
  }
  const errorBody = (body ?? {}) as { error?: string };
  throw new ApiError({
    status: res.status,
    message:
      errorBody.error ??
      `Failed to delete signal (HTTP ${res.status}). Please try again.`,
  });
}

export type WowKind =
  | "recurrence"
  | "bridge"
  | "surprise_bridge"
  | "tension"
  | "outlier";

export type ApiTopOfMindNoteType =
  | "pattern"
  | "tension"
  | "question"
  | "hypothesis"
  | "action";

export type ApiTopOfMindNoteStatus =
  | "active"
  | "dismissed"
  | "stale"
  | "replaced"
  | "unavailable";

export type ApiAmbitionDimension =
  | "place"
  | "people"
  | "work"
  | "taste"
  | "tension"
  | "identity"
  | "rejection"
  | "next_experiment";

export interface ApiTopOfMindCompatibilitySignal {
  inspirationId: string;
  role: string;
  reason: string;
  text: string;
  kind: string | null;
  createdAt: string;
  wowScore: number;
}

export interface ApiTopOfMindNote {
  id: string;
  userId: string;
  title: string;
  ambitionDimension: ApiAmbitionDimension;
  ambientSignal: string;
  matchedEnvironment: string;
  antiEnvironment: string;
  evidenceRationale: string;
  rejectedAlternativeInterpretation: string | null;
  type: ApiTopOfMindNoteType;
  body: string;
  prompt: string | null;
  guidance: string | null;
  confidence: number;
  status: ApiTopOfMindNoteStatus;
  isPinned: boolean;
  userFeedbackValue: ApiFeedbackValue | null;
  relatedSignalIds: string[];
  relatedContextNodeIds: string[];
  createdAt: string;
  updatedAt: string;
  source: "wow_moment_compatibility";
  isProvisional: true;
  legacy: {
    wowMomentId: string;
    wowKind: WowKind;
    wowScore: number;
  };
}

export interface ApiTopOfMindEvidencePreview {
  signalId: string;
  role: string;
  reason: string;
  textPreview: string;
  kind: string | null;
  createdAt: string;
  resonanceScore: number;
}

export interface ApiTopOfMindRelatedSignalReference {
  id: string;
  preview: string;
  kind: string | null;
  createdAt: string;
  resonanceScore: number;
}

export type ApiTopOfMindNoteSurface = ApiTopOfMindNote & {
  evidencePreviews: ApiTopOfMindEvidencePreview[];
  relatedSignals: ApiTopOfMindRelatedSignalReference[];
};

export interface ApiTopOfMindCompatibilityMoment {
  id: string;
  userId: string;
  title: string;
  kind: WowKind;
  why: string;
  beliefStatement: string | null;
  reflectionQuestion: string | null;
  reflectionGuide: string | null;
  wowScore: number;
  createdAt: string;
  updatedAt: string;
  relatedInspirations: ApiTopOfMindCompatibilitySignal[];
  topOfMindNote?: ApiTopOfMindNote;
}

export interface ListTopOfMindCompatibilityMomentsResponse {
  wowMoments: ApiTopOfMindCompatibilityMoment[];
}

export interface ListTopOfMindNotesResponse {
  topOfMindNotes: ApiTopOfMindNoteSurface[];
  topOfMind?: ApiTopOfMind;
}

export interface GetTopOfMindNoteResponse {
  topOfMindNote: ApiTopOfMindNoteSurface;
}

export interface UpdateTopOfMindNoteRequest {
  title: string;
}

export interface UpdateTopOfMindNoteResponse {
  topOfMindNote: ApiTopOfMindNoteSurface;
}

export type ApiPublicTopOfMindEvidencePreview = Omit<
  ApiTopOfMindEvidencePreview,
  "signalId"
>;

export type ApiPublicTopOfMindRelatedSignalReference = Omit<
  ApiTopOfMindRelatedSignalReference,
  "id"
>;

export type ApiPublicTopOfMindNoteSurface = Omit<
  ApiTopOfMindNoteSurface,
  | "id"
  | "userId"
  | "relatedSignalIds"
  | "relatedContextNodeIds"
  | "legacy"
  | "evidencePreviews"
  | "relatedSignals"
> & {
  evidencePreviews: ApiPublicTopOfMindEvidencePreview[];
  relatedSignals: ApiPublicTopOfMindRelatedSignalReference[];
};

export interface ApiPublicProfile {
  name: string;
  handle: string;
  preferredLocale: SupportedLocale;
}

export interface FetchPublicProfileResponse {
  profile: ApiPublicProfile;
  topOfMindNotes: ApiPublicTopOfMindNoteSurface[];
}

export type ApiFeedbackTarget =
  | "signal"
  | "context_node"
  | "top_of_mind_note"
  | "hypothesis";
export type ApiFeedbackValue =
  | "true"
  | "partly"
  | "not_true"
  | "important"
  | "not_important";
export type ApiFeedbackEmotion =
  | "admire"
  | "envy"
  | "want"
  | "fear"
  | "curious"
  | "aesthetic_only";

export interface ApiFeedbackRecord {
  id: string;
  userId: string;
  targetType: ApiFeedbackTarget;
  targetId: string;
  value: ApiFeedbackValue;
  emotionLabel: ApiFeedbackEmotion | null;
  correctionText: string | null;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFeedbackRequest {
  targetType: ApiFeedbackTarget;
  targetId: string;
  value: ApiFeedbackValue;
  emotionLabel?: ApiFeedbackEmotion;
  correctionText?: string;
}

export interface CreateFeedbackResponse {
  feedback: ApiFeedbackRecord;
}

export interface FetchTopOfMindCompatibilityMomentsOptions {
  limit?: number;
}

export interface FetchTopOfMindNotesOptions {
  limit?: number;
}

export type SavedSignalArchiveFilter =
  | "all"
  | "highlighted"
  | "high_resonance"
  | "tensions"
  | "questions"
  | "people_places"
  | "recently_resurfaced";

export type SavedSignalArchiveSort = "recent" | "resonance" | "revisited";

export interface ApiSavedSignalSearchResult {
  id: string;
  userId: string;
  textPreview: string;
  kind: string | null;
  capturedAt: string;
  updatedAt: string;
  resonanceScore: number;
  signalScores: ApiSignalScores;
  highlightedSnippets: Array<{
    id: string;
    text: string;
    source: string;
    confidence: number;
    isPrimary: boolean;
  }>;
  matchingSnippets: string[];
  relatedContextTerms: string[];
  relatedTopOfMindNoteTitles: string[];
  attachmentSummary: Array<{
    id: string;
    type: AttachmentType;
    label: string;
    url?: string;
  }>;
  relevanceReasons: string[];
}

export interface ApiSavedSignalDetail extends ApiSavedSignalSearchResult {
  rawText: string;
  attachments: Array<{
    id: string;
    type: AttachmentType;
    url?: string;
    label: string;
    contentType: string | null;
    size: number | null;
  }>;
  resonanceFeedback: Array<{
    id: string;
    value: ApiFeedbackValue;
    emotionLabel: ApiFeedbackEmotion | null;
    correctionText: string | null;
    createdAt: string;
  }>;
  signalPacket: {
    id: string;
    text: string;
    primarySpark: string;
    artifactExcerpt: string;
    updatedAt: string;
  } | null;
  relatedContextNodes: Array<{
    id: string;
    type: string;
    label: string;
    description: string;
    confidence: number;
    evidenceReason: string;
  }>;
  relatedTopOfMindNotes: Array<{
    id: string;
    title: string;
    type: ApiTopOfMindNoteType;
    body: string;
    confidence: number;
    status: "active";
  }>;
}

export interface FetchSavedSignalsOptions {
  q?: string;
  filter?: SavedSignalArchiveFilter;
  sort?: SavedSignalArchiveSort;
  limit?: number;
}

export interface ListSavedSignalsResponse {
  signals: ApiSavedSignalSearchResult[];
}

export interface GetSavedSignalResponse {
  signal: ApiSavedSignalDetail;
}

export type BackgroundJobType = "process_inspiration";
export type BackgroundJobStatus = "pending" | "running" | "succeeded" | "failed";

export interface ApiBackgroundJob {
  id: string;
  userId?: string;
  type: BackgroundJobType;
  status: BackgroundJobStatus;
  attempts?: number;
  maxAttempts?: number;
  runAfter?: string;
  lockedAt?: string | null;
  lastError?: string | null;
  idempotencyKey?: string | null;
  createdAt: string;
  updatedAt: string;
  payloadSummary?: {
    inspirationId?: string;
    [key: string]: unknown;
  };
}

export interface FetchBackgroundJobsOptions {
  type?: BackgroundJobType;
  limit?: number;
}

export interface ListBackgroundJobsResponse {
  jobs: ApiBackgroundJob[];
}

export interface ApiWowStatusRow {
  inspiration: {
    id: string;
    textPreview: string;
    kind: string | null;
    category: number | null;
    cluster: ClusterKind | null;
    classifiedAt: string | null;
    importanceScore: number;
    wowScore: number;
    createdAt: string;
    updatedAt: string;
  };
  job: {
    id: string;
    status: BackgroundJobStatus;
    attempts: number;
    maxAttempts: number;
    updatedAt: string;
    lastError: string | null;
  } | null;
  embedded: boolean;
  generatedWowMomentCount: number;
  debugReason: {
    code:
      | "linked_wow_ready"
      | "waiting_for_job"
      | "missing_embedding"
      | "job_failed"
      | "no_generated_wow"
      | "not_wow_judgment";
    label: string;
    detail: string;
    rawGeminiPreview?: string;
    parseFailureStage?: string;
    finishReason?: string;
    schemaIssueSummary?: string;
  };
}

export interface ListWowStatusResponse {
  rows: ApiWowStatusRow[];
}

export async function fetchWowStatus(limit = 12): Promise<ApiWowStatusRow[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const body = await getJson<ListWowStatusResponse>(
    apiPath(`/wow-status?${params.toString()}`),
    "Failed to load top-of-mind status",
  );
  return Array.isArray(body.rows) ? body.rows : [];
}

export async function fetchLegacyTopOfMindCompatibilityMoments(
  options: FetchTopOfMindCompatibilityMomentsOptions = {},
): Promise<ApiTopOfMindCompatibilityMoment[]> {
  const params = new URLSearchParams();
  if (typeof options.limit === "number") params.set("limit", String(options.limit));
  const query = params.toString();

  let res: Response;
  try {
    res = await fetch(apiPath(`/wow-moments${query ? `?${query}` : ""}`), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError({
      status: 0,
      message: "Network unreachable while loading top-of-mind compatibility notes",
    });
  }

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
        errorBody.error ??
        `Failed to load top-of-mind compatibility notes (HTTP ${res.status}). Please try again.`,
    });
  }

  const payload = body as Partial<ListTopOfMindCompatibilityMomentsResponse> | null;
  if (!payload || !Array.isArray(payload.wowMoments)) {
    throw new ApiError({
      status: res.status,
      message: "Malformed top-of-mind compatibility response",
    });
  }
  return payload.wowMoments;
}

export async function fetchTopOfMindNotes(
  options: FetchTopOfMindNotesOptions = {},
): Promise<ApiTopOfMindNoteSurface[]> {
  const params = new URLSearchParams();
  if (typeof options.limit === "number") params.set("limit", String(options.limit));
  const query = params.toString();
  const body = await getJson<ListTopOfMindNotesResponse>(
    apiPath(`/top-of-mind${query ? `?${query}` : ""}`),
    "Failed to load top-of-mind notes",
  );

  if (!Array.isArray(body.topOfMindNotes)) {
    throw new ApiError({
      status: 200,
      message: "Malformed top-of-mind notes response",
    });
  }

  return body.topOfMindNotes;
}

export async function fetchTopOfMindNote(
  noteId: string,
): Promise<ApiTopOfMindNoteSurface> {
  const body = await getJson<GetTopOfMindNoteResponse>(
    apiPath(`/top-of-mind/${noteId}`),
    "Failed to load top-of-mind note",
  );

  if (!body.topOfMindNote) {
    throw new ApiError({
      status: 200,
      message: "Malformed top-of-mind note response",
    });
  }

  return body.topOfMindNote;
}

export async function updateTopOfMindNote(
  noteId: string,
  input: UpdateTopOfMindNoteRequest,
): Promise<ApiTopOfMindNoteSurface> {
  const body = await patchJson<UpdateTopOfMindNoteResponse>(
    apiPath(`/top-of-mind/${encodeURIComponent(noteId)}`),
    input,
    "Failed to update top-of-mind note",
  );

  if (!body.topOfMindNote) {
    throw new ApiError({
      status: 200,
      message: "Malformed top-of-mind note update response",
    });
  }

  return body.topOfMindNote;
}

export async function fetchPublicProfile(
  handle: string,
  options: FetchTopOfMindNotesOptions = {},
): Promise<FetchPublicProfileResponse> {
  const normalizedHandle = handle.trim().replace(/^@+/, "");
  const params = new URLSearchParams();
  if (typeof options.limit === "number") params.set("limit", String(options.limit));
  const query = params.toString();
  const body = await getJson<FetchPublicProfileResponse>(
    apiPath(`/public/profiles/${encodeURIComponent(normalizedHandle)}${query ? `?${query}` : ""}`),
    "Failed to load public profile",
  );

  if (!body.profile || !Array.isArray(body.topOfMindNotes)) {
    throw new ApiError({
      status: 200,
      message: "Malformed public profile response",
    });
  }

  return body;
}

export async function fetchSavedSignals(
  options: FetchSavedSignalsOptions = {},
): Promise<ApiSavedSignalSearchResult[]> {
  const params = new URLSearchParams();
  if (options.q) params.set("q", options.q);
  if (options.filter && options.filter !== "all") params.set("filter", options.filter);
  if (options.sort && options.sort !== "recent") params.set("sort", options.sort);
  if (typeof options.limit === "number") params.set("limit", String(options.limit));
  const query = params.toString();
  const body = await getJson<ListSavedSignalsResponse>(
    apiPath(`/signals${query ? `?${query}` : ""}`),
    "Failed to load saved signals",
  );

  if (!Array.isArray(body.signals)) {
    throw new ApiError({
      status: 200,
      message: "Malformed saved signals response",
    });
  }

  return body.signals;
}

export async function fetchSavedSignalDetail(
  signalId: string,
): Promise<ApiSavedSignalDetail> {
  const body = await getJson<GetSavedSignalResponse>(
    apiPath(`/signals/${encodeURIComponent(signalId)}`),
    "Failed to load saved signal",
  );

  if (!body.signal) {
    throw new ApiError({
      status: 200,
      message: "Malformed saved signal response",
    });
  }

  return body.signal;
}

export async function createFeedback(
  input: CreateFeedbackRequest,
): Promise<ApiFeedbackRecord> {
  const body = await postJson<CreateFeedbackResponse>(
    apiPath("/feedback"),
    input,
    "Failed to save feedback",
  );

  if (!body.feedback) {
    throw new ApiError({
      status: 200,
      message: "Malformed feedback response",
    });
  }

  return body.feedback;
}

export async function fetchBackgroundJobs(
  options: FetchBackgroundJobsOptions = {},
): Promise<ApiBackgroundJob[]> {
  const params = new URLSearchParams();
  if (options.type) params.set("type", options.type);
  if (typeof options.limit === "number") params.set("limit", String(options.limit));
  const query = params.toString();
  const path = apiPath(`/admin/background-jobs${query ? `?${query}` : ""}`);

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
      message: "Network unreachable while loading background jobs",
    });
  }

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
        errorBody.error ??
        `Failed to load background jobs (HTTP ${res.status}). Please try again.`,
    });
  }

  const payload = (body ?? {}) as Partial<ListBackgroundJobsResponse>;
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}

export type ApiMeaningGraphMemoryState =
  | "emerging"
  | "active"
  | "fading"
  | "dormant"
  | "reactivated"
  | "contradicted"
  | "needs_testing";

export interface ApiMeaningGraphMemory {
  state: ApiMeaningGraphMemoryState;
  firstSeenAt: string;
  lastSeenAt: string;
  reinforcementCount: number;
  recentReinforcementCount: number;
  currentWeight: number;
  confidence: number;
  decay: number;
  supportingSignalIds: string[];
  movementScore: number;
}

export interface ApiMeaningGraphQualityIndicator {
  type:
    | "raw_graph_label"
    | "shallow_summary"
    | "generic_ambition_wrapper"
    | "unsupported_synthesis"
    | "healthy_specificity";
  severity: "ok" | "watch" | "risk";
  label: string;
  detail: string;
}

export interface ApiMeaningGraphNode {
  id: string;
  type: string;
  contextType: string;
  ambitionDimension:
    | "place"
    | "people"
    | "work"
    | "taste"
    | "identity"
    | "rejection"
    | "next_experiment";
  label: string;
  description: string;
  status: string;
  source: string;
  weight: number;
  confidence: number;
  evidenceCount: number;
  firstSeenAt: string;
  lastReinforcedAt: string;
  createdAt: string;
  updatedAt: string;
  memory: ApiMeaningGraphMemory;
  qualityIndicators: ApiMeaningGraphQualityIndicator[];
  relatedTopOfMindNotes: Array<{
    id: string;
    title: string;
    why: string;
    score: number;
    ambitionDimension: ApiTopOfMindNote["ambitionDimension"];
    ambientSignal: string;
    matchedEnvironment: string;
    antiEnvironment: string;
    evidenceRationale: string;
    rejectedAlternativeInterpretation: string | null;
    whyNow: string;
    changedRecently: string;
    feedback: Array<{
      id: string;
      targetType: "top_of_mind_note";
      value: ApiFeedbackValue;
      emotionLabel: ApiFeedbackEmotion | null;
      correctionText: string | null;
      source: string;
      createdAt: string;
    }>;
    qualityIndicators: ApiMeaningGraphQualityIndicator[];
    createdAt: string;
  }>;
  feedback: Array<{
    id: string;
    targetType: "context_node" | "hypothesis";
    value: ApiFeedbackValue;
    emotionLabel: ApiFeedbackEmotion | null;
    correctionText: string | null;
    source: string;
    createdAt: string;
  }>;
  evidence: Array<{
    inspirationId: string;
    packetId: string;
    reason: string;
    weight: number;
    confidence: number;
    source: string;
    preview: string;
    packetPreview: string;
    tokenEstimate: number;
    inspirationCreatedAt: string;
    createdAt: string;
  }>;
}

export interface ApiMeaningGraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: string;
  weight: number;
  confidence: number;
  evidenceCount: number;
  evidenceInspirationIds: string[];
  status: string;
  source: string;
  lastReinforcedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiMeaningGraphRecentInspiration {
  id: string;
  preview: string;
  cluster: ClusterKind | null;
  createdAt: string;
  packetCreatedAt: string | null;
  meaningNotes: Array<{
    id: string;
    label: string;
    type: string;
    contextType?: string;
    reason: string;
  }>;
  relationshipEdges: Array<{
    id: string;
    kind: string;
    sourceNodeId: string;
    sourceLabel: string;
    sourceReason: string;
    targetNodeId: string;
    targetLabel: string;
    targetReason: string;
  }>;
}

export type ApiMeaningGraphHealthStatus =
  | "no_data"
  | "writer_failed"
  | "sparse"
  | "stale"
  | "healthy";

export interface ApiMeaningGraphHealthWarning {
  type: ApiMeaningGraphHealthStatus | "no_packets";
  message: string;
}

export interface ApiMeaningGraphHealth {
  inspirationCount: number;
  packetCount: number;
  nodeCount: number;
  edgeCount: number;
  evidenceCount: number;
  inspirationsWithoutPackets: number;
  nodesWithoutEvidence: number;
  edgeDensity: number;
  status: ApiMeaningGraphHealthStatus;
  warnings: ApiMeaningGraphHealthWarning[];
}

export interface ApiMeaningGraph {
  nodes: ApiMeaningGraphNode[];
  edges: ApiMeaningGraphEdge[];
  recentInspirations: ApiMeaningGraphRecentInspiration[];
  meta: {
    nodeCount: number;
    edgeCount: number;
    evidenceCount: number;
    limit: number;
    health: ApiMeaningGraphHealth;
  };
}

export interface ApiMeaningGraphRebuildResult {
  inspirations: number;
  nodesTouched: number;
  evidenceTouched: number;
  edgesTouched: number;
}

export type ApiBackgroundJobStatus = "pending" | "running" | "succeeded" | "failed";

export interface ApiMeaningGraphRebuildPayload extends Partial<ApiMeaningGraphRebuildResult> {
  requestedByUserId?: string;
  phase?: "queued" | "counting" | "clearing" | "processing" | "completed";
  totalInspirations?: number;
  processedInspirations?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface ApiMeaningGraphRebuildJob {
  id: string;
  type: "meaning_graph_rebuild";
  status: ApiBackgroundJobStatus;
  payload: ApiMeaningGraphRebuildPayload;
  attempts: number;
  maxAttempts: number;
  runAfter: string | null;
  lockedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchMeaningGraph(limit = 120): Promise<ApiMeaningGraph> {
  const params = new URLSearchParams({ limit: String(limit) });
  const body = await getJson<{ graph: ApiMeaningGraph }>(
    apiPath(`/admin/meaning-graph?${params.toString()}`),
    "Failed to load context graph",
  );
  return body.graph;
}

export async function rebuildMeaningGraph(): Promise<{
  job: ApiMeaningGraphRebuildJob;
  statusUrl?: string;
}> {
  return postJson(apiPath("/admin/meaning-graph/rebuild"), {}, "Failed to enqueue context graph rebuild");
}

export async function fetchMeaningGraphRebuildJob(jobId?: string): Promise<{
  job: ApiMeaningGraphRebuildJob | null;
}> {
  const path = jobId
    ? `/admin/meaning-graph/rebuild/${encodeURIComponent(jobId)}`
    : "/admin/meaning-graph/rebuild";
  return getJson(apiPath(path), "Failed to load context graph rebuild status");
}

export function formatMeaningGraphRebuildError(err: unknown, locale: SupportedLocale = "en-US"): string {
  const timeoutMessage = locale === "ko-KR"
    ? "다시 만들기 상태 요청 시간이 초과되었거나 원격 프록시가 HTTP 502/504를 반환했습니다. 서버에서 작업이 계속 진행 중일 수 있습니다. 잠시 뒤 새로고침으로 그래프를 확인한 다음 다시 시작하세요."
    : "The rebuild status request timed out or the remote proxy returned HTTP 502/504. " +
      "The rebuild job may still be running server-side. Wait a minute, then click Refresh to check the graph before starting another rebuild.";

  if (err instanceof ApiError && [0, 502, 504].includes(err.status)) {
    return timeoutMessage;
  }

  if (err instanceof TypeError) {
    return timeoutMessage;
  }

  if (locale === "ko-KR") {
    if (err instanceof ApiError && err.status === 409) {
      return "다시 만들기 실패: 로컬 데이터베이스 마이그레이션이 필요합니다. Drizzle 마이그레이션을 실행한 뒤 다시 시도하세요.";
    }
    return "다시 만들기 실패: 그래프를 다시 만들지 못했습니다. 잠시 뒤 다시 시도하세요.";
  }

  const message = err instanceof Error ? err.message : "Failed to rebuild context graph";
  return `Rebuild failed: ${message}`;
}

export interface ApiTopOfMindSupportingInspiration {
  id: string;
  preview: string;
  reason: string;
  createdAt: string;
}

export interface ApiTopOfMindSignal {
  nodeId: string;
  label: string;
  type: string;
  reason: string;
  evidenceCount: number;
  lastReinforcedAt: string;
  supportingInspirations: ApiTopOfMindSupportingInspiration[];
}

export interface ApiTopOfMindRelationshipSignal {
  edgeId: string;
  kind: string;
  sourceNodeId: string;
  sourceLabel: string;
  targetNodeId: string;
  targetLabel: string;
  reason: string;
  evidenceCount: number;
  lastReinforcedAt: string;
}

export interface ApiTopOfMind {
  generatedAt: string;
  headline: string;
  activeThemes: ApiTopOfMindSignal[];
  activeQuestions: ApiTopOfMindSignal[];
  relationshipSignals: ApiTopOfMindRelationshipSignal[];
  summary: {
    inspirationCount: number;
    meaningNoteCount: number;
    relationshipEdgeCount: number;
  };
}

export async function fetchTopOfMind(): Promise<ApiTopOfMind> {
  const body = await getJson<{ topOfMind: ApiTopOfMind }>(
    apiPath("/top-of-mind"),
    "Failed to load top of mind",
  );
  return body.topOfMind;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/** Attachment kinds — mirrors the Postgres `attachment_type` enum. */
export type AttachmentType = "link" | "image" | "file";
export type AttachmentEnrichmentStatus = "pending" | "ready" | "failed" | "unavailable";

export interface ApiAttachmentEnrichment {
  status: AttachmentEnrichmentStatus;
  source: string | null;
  sourceUrl: string | null;
  errorReason: string | null;
  checkedAt: string | null;
  link: {
    originalUrl: string;
    finalUrl: string | null;
    hostname: string | null;
    title: string | null;
    description: string | null;
    siteName: string | null;
    previewImageUrl: string | null;
  } | null;
  image: {
    filename: string | null;
    contentType: string | null;
    size: number | null;
    width: number | null;
    height: number | null;
  } | null;
}

/**
 * Canonical attachment row. POST /attachments returns `url` and `s3Key` for
 * the finalize flow, but refreshed inspiration list/detail payloads only expose
 * safe, renderable fields: link rows keep their public URL; private S3-backed
 * image/file rows omit raw keys and canonical bucket URLs.
 */
export interface ApiAttachment {
  id: string;
  inspirationId: string;
  type: AttachmentType;
  url?: string;
  name: string | null;
  s3Key?: string | null;
  contentType: string | null;
  size: number | null;
  createdAt: string;
  enrichment?: ApiAttachmentEnrichment;
}

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

export interface FinalizeAttachmentResponse {
  attachment: ApiAttachment;
}

/**
 * POST /attachments
 *
 * Finalize an attachment after the S3 PUT has succeeded (image / file) or
 * record a pasted link directly (link). The server enforces inspiration
 * ownership; on success it returns the canonical row.
 */
export async function finalizeAttachment(
  input: FinalizeAttachmentRequest,
): Promise<ApiAttachment> {
  const body = await postJson<FinalizeAttachmentResponse>(
    apiPath("/attachments"),
    input,
    "Failed to record attachment",
  );
  return body.attachment;
}

// ---------------------------------------------------------------------------
// Guided reflection question generation
// ---------------------------------------------------------------------------

export interface GuidedReflectionQuestionRequest {
  locale?: SupportedLocale;
  inspiration: {
    text: string;
    kind: ApiInspirationKind;
    links?: string[];
    attachmentKinds?: Array<"link" | "image" | "file">;
    highlights?: string[];
    resonance?: string | null;
    resonanceNote?: string | null;
  };
  priorAnswers: Array<{ question: string; answer: string }>;
}

export interface GuidedReflectionQuestionResponse {
  question: string;
  source: "model" | "fallback";
  fallbackReason?:
    | "no_model_config"
    | "model_http_error"
    | "model_network_error"
    | "invalid_model_response"
    | "empty_model_response";
}

/**
 * POST /guided-reflection/question
 *
 * Generates the next Reflect Deeper prompt from the current capture payload and
 * all prior guided answers. The server owns the LLM JSON contract and returns a
 * deterministic fallback question when model generation is unavailable.
 */
export async function generateGuidedReflectionQuestion(
  input: GuidedReflectionQuestionRequest,
): Promise<GuidedReflectionQuestionResponse> {
  return postJson<GuidedReflectionQuestionResponse>(
    apiPath("/guided-reflection/question"),
    input,
    "Failed to generate reflection question",
  );
}

// ---------------------------------------------------------------------------
// Reflections
// ---------------------------------------------------------------------------

/**
 * Canonical reflection row as returned by POST /inspirations/:id/reflections
 * and GET /inspirations/:id/reflections. Field shape mirrors the Drizzle
 * insert `.returning(...)` clause exactly so the SPA can render the just-
 * persisted row without a follow-up GET, satisfying the optimistic-update
 * contract for the inspiration detail view.
 */
export interface ApiReflection {
  id: string;
  inspirationId: string;
  userId: string;
  question: string;
  answer: string | null;
  skipped: boolean;
  createdAt: string;
}

/**
 * Field-level validation errors as emitted by the Hono reflections handler.
 */
export interface ReflectionFieldErrors extends ApiFieldErrors {
  question?: string[];
  answer?: string[];
  skipped?: string[];
}

export interface CreateReflectionRequest {
  /** Required, trimmed, max 4 KB. */
  question: string;
  /** Optional. Empty / whitespace becomes `null` server-side. */
  answer?: string;
  /** Optional. When `true` the row is recorded as a deliberate "no answer". */
  skipped?: boolean;
}

export interface ApiInspirationScorePatch {
  id: string;
  importanceScore?: number;
  wowScore?: number;
}

export interface CreateReflectionResponse {
  reflection: ApiReflection;
  /** Added by newer API versions after score recomputation; older responses omit it. */
  inspiration?: ApiInspirationScorePatch;
}

/**
 * POST /inspirations/:id/reflections
 *
 * Attach a reflection (a question + optional answer / skipped flag) to one of
 * the caller's inspirations. Server enforces ownership of the parent
 * inspiration via the path id; we never send `userId` from the client. Throws
 * `ApiError` on non-2xx so the form can surface a single failure path.
 */
export async function createReflection(
  inspirationId: string,
  input: CreateReflectionRequest,
): Promise<CreateReflectionResponse> {
  // Encode the path component so a malformed id doesn't smuggle a `?` /
  // `#` into the URL. The server validates as a uuid and 400s on a miss.
  const path = apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/reflections`);
  const body = await postJson<CreateReflectionResponse>(
    path,
    input,
    "Failed to save reflection",
  );
  return body;
}

/** Response shape for GET /inspirations/:id/reflections. */
export interface ListReflectionsResponse {
  reflections: ApiReflection[];
}

/**
 * GET /inspirations/:id/reflections
 *
 * Returns the caller's reflections for the given inspiration, ordered by
 * `created_at` ascending. The server enforces ownership; on a 404 (parent
 * missing or owned by someone else) we surface an `ApiError` so the caller
 * can route the user back to the list.
 */
export async function fetchReflections(
  inspirationId: string,
): Promise<ApiReflection[]> {
  const path = apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/reflections`);
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
      message: "Network unreachable while loading reflections",
    });
  }

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
        errorBody.error ??
        `Failed to load reflections (HTTP ${res.status}). Please try again.`,
    });
  }

  const payload = (body ?? {}) as Partial<ListReflectionsResponse>;
  return Array.isArray(payload.reflections) ? payload.reflections : [];
}

export async function deleteReflection(
  inspirationId: string,
  reflectionId: string,
): Promise<void> {
  const path = apiPath(
    `/inspirations/${encodeURIComponent(inspirationId)}/reflections/${encodeURIComponent(reflectionId)}`,
  );
  let res: Response;
  try {
    res = await fetch(path, {
      method: "DELETE",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError({
      status: 0,
      message: "Network unreachable while deleting reflection",
    });
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON response — handled below.
    }
    const errorBody = (body ?? {}) as { error?: string };
    throw new ApiError({
      status: res.status,
      message:
        errorBody.error ??
        `Failed to delete reflection (HTTP ${res.status}). Please try again.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Shared POST/PATCH JSON helpers. Centralise the credential-include /
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
