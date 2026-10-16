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

/**
 * One save a claim was read from, in the person's own words.
 *
 * A claim with no material under it can only be agreed or disagreed with on
 * vibes; with the saves visible it can be CHECKED, which is the whole
 * difference between a reading and a horoscope. It also changes what "not
 * true" means — with the evidence on screen, rejecting a claim is correcting
 * a misreading rather than being told who you are and having to argue back.
 */
export interface ApiClaimSource {
  id: string;
  /** Enough to recognise it, never the whole save — see the route's cap. */
  preview: string;
}

export type ApiClaim = ApiSignal & {
  /** Present when this reading was answered yes or partly a season ago and
      is being asked again — "is this STILL true?". Absent on a first ask and
      on an older server. */
  askedAgain?: { lastAnsweredAt: string };
  /** Up to four of the saves behind it. Absent on an older server, and empty
      when every save it stood on has since been deleted. */
  from?: ApiClaimSource[];
};

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
  /* The sources are normalised here rather than trusted: a claim that
     arrives with a malformed `from` renders as a claim with no receipts,
     which is the old behaviour and still honest — never as a crash under a
     sentence someone is being asked to rule on. */
  const claims = (body.claims ?? []).map((claim) => ({
    ...claim,
    askedAgain: claim.askedAgain && typeof claim.askedAgain.lastAnsweredAt === "string" && Number.isFinite(Date.parse(claim.askedAgain.lastAnsweredAt))
      ? claim.askedAgain
      : undefined,
    from: Array.isArray(claim.from)
      ? claim.from.filter(
          (row): row is ApiClaimSource =>
            typeof row?.id === "string" && typeof row?.preview === "string" && row.preview.length > 0,
        )
      : [],
  }));
  return { claims, more: body.more ?? false };
}
