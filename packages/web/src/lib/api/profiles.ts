/**
 * Client for `/api/profiles` — mirrors `packages/api/src/routes/profiles.ts`.
 *
 * The memories one account owns: the person's own, plus a profile for each of
 * their agents. This is ownership, not session — who the caller currently acts
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
  patchJson,
  postJson,
  requestVoid,
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
  preferredLocale: SupportedLocale;
  createdAt: string;
}

/** GET /profiles — every profile the account owns, human first. */
export async function fetchProfiles(): Promise<ApiOwnedProfile[]> {
  const body = await getJson<{ profiles: ApiOwnedProfile[] }>(
    apiPath("/profiles"),
    "Failed to load your profiles",
  );
  return Array.isArray(body.profiles) ? body.profiles : [];
}

/**
 * POST /profiles — mint an agent profile.
 *
 * Only a human-bound session may call this; the server refuses an agent
 * trying to give itself siblings. It also caps how many an account may hold,
 * and answers 409 at the ceiling — a message worth showing verbatim rather
 * than flattening into "could not create".
 */
export async function createProfile(name: string): Promise<ApiOwnedProfile> {
  const body = await postJson<{ profile: ApiOwnedProfile }>(
    apiPath("/profiles"),
    { name },
    "That profile could not be created",
  );
  return body.profile;
}

/** PATCH /profiles/:id — rename a profile the account owns. */
export async function renameProfile(
  profileId: string,
  name: string,
): Promise<ApiOwnedProfile> {
  const body = await patchJson<{ profile: ApiOwnedProfile }>(
    apiPath(`/profiles/${encodeURIComponent(profileId)}`),
    { name },
    "That profile could not be renamed",
  );
  return body.profile;
}

/**
 * DELETE /profiles/:id — remove an agent profile and everything it remembers.
 *
 * The whole stack goes by cascade: its inspirations, its signals, every
 * version of its top of mind. The human profile cannot be deleted here — it
 * is the account's own memory and outlives everything but the account.
 */
export async function deleteProfile(profileId: string): Promise<void> {
  await requestVoid(
    apiPath(`/profiles/${encodeURIComponent(profileId)}`),
    "DELETE",
    undefined,
    "That profile could not be removed",
  );
}
