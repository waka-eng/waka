/**
 * Client for `/api/signals` — mirrors `packages/api/src/routes/signals.ts`.
 *
 * Layer 2: what was read out of the archive. A signal is a statement the
 * server distilled and keeps attaching evidence to.
 *
 * A SIGNAL USED TO BE ABLE TO LEAVE. Two share verbs at the bottom of this
 * file crossed one into a room, sending the statement alone — the captures
 * underneath it never left the account, which was the canon's privacy line
 * and the reason a room could say WHO fed an entry and never WHICH memory
 * did. The verbs went before rooms did; `sharedGroupIds` went with rooms, on
 * 2026-10-12 (founder: "방 없애"). Nothing a signal is can now be seen by
 * anybody but its owner.
 */

import {
  ApiError,
  apiPath,
  getJson,
  patchJson,
  postJson,
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
  inspirationIds?:string[];
  statement: string;
  status: ApiSignalStatus;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: string | null;
  locked: boolean;
  unsupported: boolean;
  /** Which wording a verdict would be about; see the API's own note. */
  statementRevision?: string;
  /** Thrown out by its owner — the row and evidence stay, and the server
      refuses new candidates near it, on the record. Reads as `retired`. */
  dismissed: boolean;
  /** Standing in an unresolved contradicts pair — awaiting the owner's
      arbitration, the only kind there is. */
  contested: boolean;
  /** Gave way when its owner settled a pair — a state, never a deletion. */
  yielded: boolean;
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
  quoteReflectionId?: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ApiSignalReviewEvidence {
  answerId: string;
  sessionId: string;
  preview: string;
  createdAt: string;
}

export interface ApiSignalDetail extends ApiSignal {
  evidence: ApiSignalEvidence[];
  reviewEvidence?: ApiSignalReviewEvidence[];
}

export interface FetchSignalsOptions extends ProfileScoped {
  status?: ApiSignalStatus;
  limit?: number;
  includeInspirationIds?:boolean;
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
  if(options.includeInspirationIds)params.set('include','inspirations');
  const query = params.toString();
  const body = await getJson<{ signals: ApiSignal[] }>(
    apiPath(`/signals${query ? `?${query}` : ""}`),
    "Failed to load your signals",
  );
  return Array.isArray(body.signals) ? body.signals : [];
}

/** GET /signals/:id — the same statement, plus what it rests on. */
export async function fetchSignal(id: string,signal?:AbortSignal, options: { profile?: string } = {}): Promise<ApiSignalDetail> {
  const body = await getJson<{ signal: ApiSignalDetail }>(
    apiPath(`/signals/${encodeURIComponent(id)}${options.profile ? `?profile=${encodeURIComponent(options.profile)}` : ''}`),
    "Failed to load this signal",
    signal,
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


/* `restoreSignal` WENT WITH THE ANTECHAMBER. It was the undo for a
   dismissal, and the only surface that listed dismissed signals was one of
   the three machinery doors on the settings page — see `SettingsPanel`'s
   header for why those went. The ROUTE is untouched; what is deleted is a
   client wrapper nothing calls, which `orphans.test.ts` reads as live code
   and which holds its own imports up with it. */
