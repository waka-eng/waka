/**
 * Client for `/api/profiles` — mirrors `packages/api/src/routes/profiles.ts`.
 *
 * The memories one account owns: the person's own, plus a profile for each of
 * retained legacy profiles. This is ownership, not session — who the caller currently acts
 * AS is `auth.ts`'s business.
 *
 * A NOTE ON THE TYPE BELOW, because it has already caused one collision.
 *
 * The client briefly carried two rival `fetchProfiles`/`createProfile` pairs:
 * one written for the layout, one from the account-management work. They were
 * resolved in favour of the latter — it is the one the server actually answers,
 * and it comes with rename and delete as well — and `ApiOwnedProfile` is that
 * winner's shape. Do not collapse it into `ApiProfile`; see its own comment.
 */

import {
  apiPath,
  getJson,
  type ApiProfileType,
} from "./http";
import type { SupportedLocale } from "../locales";

/**
 * A profile as the *ownership* endpoint reports it — deliberately not
 * `ApiProfile`, which is the session's own profile from `/auth/me` and
 * carries the public-sharing fields this list does not. Same rows, different
 * projections; collapsing them would make one of the two lie.
 */
export interface ApiOwnedProfile {
  id: string;
  accountId: string;
  type: ApiProfileType;
  name: string;
  avatarUrl: string | null;
  hasInspirations?: boolean;
  preferredLocale: SupportedLocale;
  createdAt: string;
}

/** GET /profiles — every profile the account owns, human first. */
export async function fetchProfiles(signal?: AbortSignal): Promise<ApiOwnedProfile[]> {
  const body = await getJson<{ profiles: ApiOwnedProfile[] }>(
    apiPath("/profiles"),
    "Failed to load your profiles",
    signal,
  );
  if (!Array.isArray(body.profiles)) throw new Error("Invalid profiles response");
  return body.profiles;
}
