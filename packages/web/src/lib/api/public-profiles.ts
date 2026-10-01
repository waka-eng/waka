/**
 * Client for `/api/public/profiles` — mirrors
 * `packages/api/src/routes/public-profiles.ts`.
 *
 * The only unauthenticated surface in this client: what a stranger sees at
 * `/@handle`. Its types are deliberately thinner than the signed-in ones —
 * statements carry no entry ids and no cited signals, so nothing here can be
 * traced back to the memories it was built from.
 */

import { ApiError, apiPath, getJson } from "./http";
import type { SupportedLocale } from "../locales";
import type { ApiTopOfMindEntryType } from "./top-of-mind";

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
  supportChanged?: boolean;
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
