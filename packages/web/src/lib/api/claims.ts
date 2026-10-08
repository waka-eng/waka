/**
 * Client for `/api/claims` — mirrors `packages/api/src/routes/claims.ts`.
 *
 * The claims waiting for this person's word. A claim IS a signal — same row,
 * same shape — so this re-exports `ApiSignal` rather than declaring a parallel
 * type that could drift from it. What the endpoint adds is the selection: the
 * unanswered ones, reachable because they are unanswered rather than because
 * they ranked high enough to be cited in a top of mind.
 *
 * Answering is not here. A verdict is `createFeedback` with a `signal` target,
 * which already binds the answer to the wording it was given about — see
 * `./feedback`. This module only asks what is still waiting.
 */

import { apiPath, getJson, type ProfileScoped } from "./http";
import type { ApiSignal } from "./signals";

export type ApiClaim = ApiSignal;

export interface ApiClaimQueue {
  claims: ApiClaim[];
  /** More are waiting than this page returned — the badge still tells the truth. */
  more: boolean;
}

export interface ListClaimsRequest extends ProfileScoped {
  limit?: number;
}

/** GET /claims — the unanswered claims, most recently evidenced first. */
export async function listClaims(
  request: ListClaimsRequest = {},
): Promise<ApiClaimQueue> {
  const params = new URLSearchParams();
  if (request.limit !== undefined) params.set("limit", String(request.limit));
  if (request.profile) params.set("profile", request.profile);
  const query = params.toString();
  const body = await getJson<ApiClaimQueue>(
    apiPath(`/claims${query ? `?${query}` : ""}`),
    "Failed to load claims",
  );
  /* A malformed body reads as an empty queue rather than throwing: an empty
     Claims tab is an honest "nothing to confirm", and the alternative is a
     page that breaks because the shape moved. */
  return { claims: body.claims ?? [], more: body.more ?? false };
}
