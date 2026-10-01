/**
 * Client for `/api/inspirations` — mirrors `packages/api/src/routes/inspirations.ts`.
 *
 * Layer 1: what a person kept. The archive itself, plus the short Q&A that
 * hangs off one capture, which the server treats as part of the same row
 * rather than a resource of its own — so the reflection verbs live here too,
 * exactly as they do on the route file this mirrors.
 */

import {
  ApiError,
  apiPath,
  getJson,
  patchJson,
  postJson,
  requestVoid,
  type ProfileScoped,
} from "./http";
import type { ApiAttachment, ApiAttachmentSummary } from "./attachments";
import type { ApiInspirationProcessingReceipt } from './inspiration-processing';

// ---------------------------------------------------------------------------
// What a capture is
// ---------------------------------------------------------------------------

export type ApiInspirationKind = "note" | "link" | "image" | "mixed";

/**
 * Whose initiative the content was: the person's words (typed here, or relayed
 * by an agent on their behalf) versus an agent's own observation. Distinct
 * from which session captured it, which the server audits separately.
 */
export type ApiInspirationSource = "app" | "agent";

/** Whether a capture may appear in the fields of rooms this account is in. */
export type ApiInspirationVisibility = "private" | "public";

/**
 * The short human-authored Q&A hanging off a capture. Layer-1 detail: kept,
 * the person's own words, and input to extraction.
 */
export interface ApiReflection {
  processing?: ApiInspirationProcessingReceipt;
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
  /** Completed answers; offered-but-skipped questions do not mark this reflected. */
  reflectionCount: number;
}

/** One capture, opened: the full text and everything hanging off it. */
export interface ApiInspiration {
  processing?: ApiInspirationProcessingReceipt;
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
  /** How many the archive holds under this query — not how many were sent.
      Absent from an older server, which is why every reader treats a missing
      total as "no better information than the length of what arrived". */
  total?: number;
}

// ---------------------------------------------------------------------------
// The archive
// ---------------------------------------------------------------------------

/**
 * POST /inspirations
 *
 * Persists a capture owned by the acting profile. The server returns 201 with
 * the canonical row; signal derivation happens in the background afterwards.
 */
export async function createInspiration(
  input: CreateInspirationRequest,
  options: ProfileScoped = {},
): Promise<ApiInspiration> {
  const body = await postJson<{ inspiration: ApiInspiration; processing?: ApiInspirationProcessingReceipt }>(
    apiPath(`/inspirations${options.profile ? `?profile=${encodeURIComponent(options.profile)}` : ''}`),
    input,
    "Failed to save this capture",
  );
  return { ...body.inspiration, ...(body.processing ? { processing: body.processing } : {}) };
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
    total: typeof body.total === "number" ? body.total : undefined,
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
  const body = await patchJson<{ inspiration: ApiInspiration; processing?: ApiInspirationProcessingReceipt }>(
    apiPath(`/inspirations/${encodeURIComponent(id)}`),
    input,
    "Failed to update this capture",
  );
  return { ...body.inspiration, ...(body.processing ? { processing: body.processing } : {}) };
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

// ---------------------------------------------------------------------------
// Reflections — the Q&A on one capture
// ---------------------------------------------------------------------------

/** POST /inspirations/:id/reflections */
export async function createReflection(
  inspirationId: string,
  input: CreateReflectionRequest,
  options: ProfileScoped = {},
): Promise<ApiReflection> {
  const body = await postJson<{ reflection: ApiReflection; processing?: ApiInspirationProcessingReceipt }>(
    apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/reflections${options.profile ? `?profile=${encodeURIComponent(options.profile)}` : ''}`),
    input,
    "Failed to save reflection",
  );
  return { ...body.reflection, ...(body.processing ? { processing: body.processing } : {}) };
}

export interface ApiReflectionQuestionStatus {
  phase: "idle" | "processing" | "ready" | "failed";
  question?: string;
}

/** Queue one metered follow-up grounded in the latest saved answer. */
export async function requestReflectionQuestion(
  inspirationId: string, afterReflectionId: string, retry = false,
): Promise<ApiReflectionQuestionStatus> {
  return postJson<ApiReflectionQuestionStatus>(
    apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/reflection-question`),
    { afterReflectionId, ...(retry ? { retry: true } : {}) },
    "Could not start a follow-up question",
  );
}

export async function fetchReflectionQuestionStatus(
  inspirationId: string, afterReflectionId: string,
): Promise<ApiReflectionQuestionStatus> {
  return getJson<ApiReflectionQuestionStatus>(
    apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/reflection-question/status` +
      `?afterReflectionId=${encodeURIComponent(afterReflectionId)}`),
    "Could not load the follow-up question",
  );
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
