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
import type { ApiInspirationSaveReceipt, InspirationSaveOptions } from './inspiration-save-requests';
import { fetchInspirationSaveRequest } from './inspiration-save-requests';

// ---------------------------------------------------------------------------
// What a capture is
// ---------------------------------------------------------------------------

export type ApiInspirationKind = "note" | "link" | "image" | "mixed" | "audio";

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
  saveRequest?: ApiInspirationSaveReceipt;
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
  /** Current owned material, including reflections and effective media. */
  materialRevision?:string;
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
  conversationOrigin?:{conversationId:string|null;messageId:string|null;authorship:'user'|'adopted'}|null;
  saveRequest?: ApiInspirationSaveReceipt;
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
  fromConversation?:{conversationId:string;messageId:string;selectedText:string;adopted:boolean};
  attachments?: Array<{ type: 'link'; url: string; name?: string } | { type: 'image' | 'audio'; key: string; contentType: string; size: number; name?: string }>;
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

export async function fetchInspirationSnapshot(profileId:string,signal?:AbortSignal):Promise<{profileId:string;total:number;fingerprint:string|null}>{
  const row=await getJson<{profileId:string;total:number;fingerprint:string|null}>(apiPath(`/inspirations/snapshot?profile=${encodeURIComponent(profileId)}`),'Could not validate the archive',signal);
  if(!row||row.profileId!==profileId||!Number.isSafeInteger(row.total)||row.total<0||row.fingerprint!==null&&!/^[a-f0-9]{64}$/.test(row.fingerprint))throw new ApiError({status:200,code:'invalid_snapshot',message:'Could not validate the archive'});
  return row;
}

// ---------------------------------------------------------------------------
// The archive
// ---------------------------------------------------------------------------

/** Reconcile a keyed, explicitly scoped write once. The caller owns the frozen
 * payload and identity; looking up a receipt never authorizes a fresh create. */
async function reconcileInspirationSave<T>(write: () => Promise<T>, options: InspirationSaveOptions,
  operation: 'inspiration' | 'reflection', inspirationId?: string): Promise<T> {
  try { return await write(); }
  catch (original) {
    if (!options.requestId || !options.profile || options.signal?.aborted || !(original instanceof ApiError) ||
      !(original.status === 0 || original.status === 408 || original.status >= 500 || original.code === 'save_in_progress')) throw original;
    let saved;
    try { saved = await fetchInspirationSaveRequest(options.requestId, options, options.signal); }
    catch (check) {
      if (check instanceof ApiError && [401, 403, 410].includes(check.status)) throw check;
      // Missing/in-flight is not proof of failure. Keep the ambiguous outcome
      // so the pending intent can be resumed; never manufacture a fresh key.
      throw original;
    }
    if (saved.operation !== operation || (inspirationId && saved.inspirationId !== inspirationId)) {
      throw new ApiError({ status: 409, code: 'save_request_conflict', message: 'This save request was already used for different content.' });
    }
    // Lookup identifies committed work, but cannot prove its original payload
    // matches this call. One replay with the SAME identity lets the server
    // verify the input hash and return current words, without another create.
    // This is bounded: a second ambiguous response returns to the caller.
    return write();
  }
}

/** First saves return 201; a replay returns the current row without another
 * capture. Processing is separate from either save acknowledgment. */
export async function createInspiration(
  input: CreateInspirationRequest,
  options: InspirationSaveOptions = {},
): Promise<ApiInspiration> {
  const intent = { ...options };
  const payload = JSON.parse(JSON.stringify(input)) as CreateInspirationRequest;
  const path = apiPath(`/inspirations${intent.profile ? `?profile=${encodeURIComponent(intent.profile)}` : ''}`);
  const body = await reconcileInspirationSave(() => postJson<{ inspiration: ApiInspiration; processing?: ApiInspirationProcessingReceipt; saveRequest?: ApiInspirationSaveReceipt }>(
    path,
    payload,
    "Failed to save this capture",
    intent.signal,
    intent.requestId,
  ), intent, 'inspiration');
  return { ...body.inspiration, ...(body.processing ? { processing: body.processing } : {}), ...(body.saveRequest ? { saveRequest: body.saveRequest } : {}) };
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
  signal?: AbortSignal,
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
    signal,
  );
  if (!Array.isArray(body.inspirations)) throw new ApiError({ status: 200, code: 'invalid_response', message: 'Could not read your inspirations' });
  return {
    inspirations: body.inspirations,
    nextCursor: body.nextCursor,
    total: typeof body.total === "number" ? body.total : undefined,
  };
}

/** GET /inspirations/:id — one capture with its attachments and reflections. */
export async function fetchInspiration(id: string, options: ProfileScoped = {}, signal?: AbortSignal): Promise<ApiInspiration> {
  const body = await getJson<{ inspiration: ApiInspiration }>(
    apiPath(`/inspirations/${encodeURIComponent(id)}${options.profile ? `?profile=${encodeURIComponent(options.profile)}` : ''}`),
    "Failed to load this capture",
    signal,
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
export async function deleteInspiration(id: string, options: ProfileScoped & { sourceRevision?: string; signal?: AbortSignal } = {}): Promise<void> {
  await requestVoid(
    apiPath(`/inspirations/${encodeURIComponent(id)}${options.profile ? `?profile=${encodeURIComponent(options.profile)}` : ''}`),
    "DELETE",
    options.sourceRevision ? { sourceRevision: options.sourceRevision } : undefined,
    "Failed to delete this capture",
    options.signal,
  );
}

// ---------------------------------------------------------------------------
// Reflections — the Q&A on one capture
// ---------------------------------------------------------------------------

/** POST /inspirations/:id/reflections */
export async function createReflection(
  inspirationId: string,
  input: CreateReflectionRequest,
  options: InspirationSaveOptions = {},
): Promise<ApiReflection> {
  const intent = { ...options };
  const payload = JSON.parse(JSON.stringify(input)) as CreateReflectionRequest;
  const path = apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/reflections${intent.profile ? `?profile=${encodeURIComponent(intent.profile)}` : ''}`);
  const body = await reconcileInspirationSave(() => postJson<{ reflection: ApiReflection; processing?: ApiInspirationProcessingReceipt; saveRequest?: ApiInspirationSaveReceipt }>(
    path,
    payload,
    "Failed to save reflection",
    intent.signal,
    intent.requestId,
  ), intent, 'reflection', inspirationId);
  return { ...body.reflection, ...(body.processing ? { processing: body.processing } : {}), ...(body.saveRequest ? { saveRequest: body.saveRequest } : {}) };
}

export interface ApiReflectionQuestionStatus {
  phase: "idle" | "processing" | "ready" | "failed";
  question?: string;
}

/** Queue one metered follow-up grounded in the latest saved answer. */
export async function requestReflectionQuestion(
  inspirationId: string, afterReflectionId: string, retry = false,
  options: {signal?: AbortSignal; profile?: string} = {},
): Promise<ApiReflectionQuestionStatus> {
  return postJson<ApiReflectionQuestionStatus>(
    apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/reflection-question${options.profile ? `?profile=${encodeURIComponent(options.profile)}` : ''}`),
    { afterReflectionId, ...(retry ? { retry: true } : {}) },
    "Could not start a follow-up question",
    options.signal,
  );
}

export async function fetchReflectionQuestionStatus(
  inspirationId: string, afterReflectionId: string,
  options: {signal?: AbortSignal; profile?: string} = {},
): Promise<ApiReflectionQuestionStatus> {
  return getJson<ApiReflectionQuestionStatus>(
    apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/reflection-question/status` +
      `?afterReflectionId=${encodeURIComponent(afterReflectionId)}${options.profile ? `&profile=${encodeURIComponent(options.profile)}` : ''}`),
    "Could not load the follow-up question",
    options.signal,
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
