/**
 * Client for `/api/signals` — mirrors `packages/api/src/routes/signals.ts`.
 *
 * Layer 2: what was read out of the archive. A signal is a statement the
 * server distilled and keeps attaching evidence to; the two share verbs at the
 * bottom are how one crosses into a group, and they send the statement only —
 * the captures underneath it never leave the account.
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

// ---------------------------------------------------------------------------
// What a signal is
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
  /** Thrown out by its owner — the row and evidence stay, and the server
      refuses new candidates near it, on the record. Reads as `retired`. */
  dismissed: boolean;
  sharedGroupIds: string[];
  createdAt: string;
}

/** One capture standing behind a signal, and why it was read that way. */
export interface ApiSignalEvidence {
  inspirationId: string;
  preview: string;
  quote: string | null;
  /**
   * Whose words the quote is: the person's own ("own") or the page behind
   * their link ("enrichment"). Null means no quote — or a quote written
   * before the server verified spans, which a surface must treat as
   * unverified rather than light up as the person's words.
   */
  quoteSource: "own" | "enrichment" | null;
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

// ---------------------------------------------------------------------------
// Reading and editing them
// ---------------------------------------------------------------------------

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

/**
 * POST /signals/:id/release
 *
 * The lock's other half: the words stay exactly as the person left them, and
 * from the next pass on the generator may reword or retire them like any of
 * its own. Releasing words that were standing on no evidence retires the
 * signal in the same act — no evidence and no lock means no signal.
 */
export async function releaseSignal(id: string): Promise<ApiSignal> {
  const body = await postJson<{ signal: ApiSignal }>(
    apiPath(`/signals/${encodeURIComponent(id)}/release`),
    {},
    "Failed to hand this sentence back",
  );
  return body.signal;
}

/**
 * POST /signals/:id/dismiss
 *
 * Throwing a pattern out, without deletion: the row, its evidence and its
 * vector all stay, the signal reads as retired — and from this act on the
 * server refuses any new candidate near it, writing every refusal down.
 */
export async function dismissSignal(id: string): Promise<ApiSignal> {
  const body = await postJson<{ signal: ApiSignal }>(
    apiPath(`/signals/${encodeURIComponent(id)}/dismiss`),
    {},
    "Failed to let this signal go",
  );
  return body.signal;
}

/**
 * POST /signals/:id/restore
 *
 * The dismissal's undo: the refusals stop and the pattern returns to the
 * loop's sight, standing wherever its evidence puts it.
 */
export async function restoreSignal(id: string): Promise<ApiSignal> {
  const body = await postJson<{ signal: ApiSignal }>(
    apiPath(`/signals/${encodeURIComponent(id)}/restore`),
    {},
    "Failed to put this signal back",
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

// ---------------------------------------------------------------------------
// Sharing one into a group
// ---------------------------------------------------------------------------

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
