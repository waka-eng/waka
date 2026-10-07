/**
 * Who you are, and every field of it that leaves the server.
 *
 * Six handlers in this namespace answer the same question in the same shape —
 * `{ account, profile }` — and all six build that answer here. That is the
 * reason this file exists rather than the line count: an account row carries
 * `passwordHash`, and the two functions below are the only place a response
 * body about an identity is assembled, so there is exactly one file to read to
 * know what a client can see about a person.
 *
 * The discipline is the same negative one `inspirations-serialization.ts`
 * states: nothing here spreads a row into a response. `{...account}` would
 * ship the password hash today and whatever column is added to `accounts`
 * next, and no line of that change would mention the API surface. A field is
 * returned because somebody typed its name.
 *
 * `loadIdentity` lives beside the serializers for the same reason — the column
 * lists it selects with are the column lists the serializers expect, and when
 * those two drift the symptom is a `undefined` in a response rather than a
 * compile error.
 */

import { eq } from "drizzle-orm";

import { accounts, profiles, type ProfileType } from "../db/index.js";
import { isAdminUser } from "../lib/admin-auth.js";
import { getDb } from "../lib/db.js";
import { normalizeSupportedLocale } from "../lib/locales.js";

export type WakaDb = ReturnType<typeof getDb>;

/** Columns of the auth identity. Reused by every query that answers /me. */
export const accountColumns = {
  id: accounts.id,
  email: accounts.email,
  onboardingCompletedAt: accounts.onboardingCompletedAt,
} as const;

/** Columns of the profile a session acts as. */
export const profileColumns = {
  id: profiles.id,
  accountId: profiles.accountId,
  type: profiles.type,
  name: profiles.name,
  avatarUrl: profiles.avatarUrl,
  preferredLocale: profiles.preferredLocale,
  publicHandle: profiles.publicHandle,
  publicProfileEnabled: profiles.publicProfileEnabled,
  publicTopOfMindEnabled: profiles.publicTopOfMindEnabled,
} as const;

export interface AccountRow {
  id: string;
  email: string;
  onboardingCompletedAt: Date | null;
}

export interface ProfileRow {
  id: string;
  accountId: string;
  type: ProfileType;
  name: string;
  avatarUrl: string | null;
  preferredLocale: string;
  publicHandle: string | null;
  publicProfileEnabled: boolean;
  publicTopOfMindEnabled: boolean;
}

/**
 * Narrow a profiles row into the session shape, holding the invariant that
 * makes it safe: A ROOM'S MIND CANNOT BE A SESSION. Since 2026-08-24 a
 * profile may belong to a room instead of an account (`type = 'group'`,
 * null `accountId`), and every identity path here reaches profiles through
 * an account — a join on accounts, or an insert that wrote the account in
 * the same transaction — so a null can only mean a bug upstream, and it is
 * an error rather than a shrug.
 */
export function sessionProfileRow(
  row: Omit<ProfileRow, "accountId"> & { accountId: string | null },
): ProfileRow {
  if (row.accountId === null) {
    throw new Error("a room's mind cannot act as a session profile");
  }
  return { ...row, accountId: row.accountId };
}

export function serializeAccount(account: AccountRow) {
  return {
    id: account.id,
    email: account.email,
    onboardingCompletedAt: account.onboardingCompletedAt?.toISOString() ?? null,
    isAdmin: isAdminUser({ email: account.email }),
  };
}

export function serializeProfile(profile: ProfileRow) {
  return {
    id: profile.id,
    accountId: profile.accountId,
    type: profile.type,
    name: profile.name,
    avatarUrl: profile.avatarUrl ?? null,
    preferredLocale: normalizeSupportedLocale(profile.preferredLocale),
    publicHandle: profile.publicHandle ?? null,
    publicProfileEnabled: profile.publicProfileEnabled === true,
    publicTopOfMindEnabled: profile.publicTopOfMindEnabled === true,
  };
}

/**
 * The answer to "who am I": the account that signed in, and the profile this
 * session acts as. Read fresh rather than served from the session, because
 * the session carries only what authorization needs — the display identity
 * can change under it at any time.
 */
export async function loadIdentity(
  db: Pick<WakaDb, 'select'>,
  profileId: string,
): Promise<{ account: AccountRow; profile: ProfileRow } | null> {
  const [row] = await db
    .select({
      account: accountColumns,
      /* accountId through the JOIN: the join is on accounts.id, so the type
         system learns what the join already proves — this row has one. */
      profile: { ...profileColumns, accountId: accounts.id },
    })
    .from(profiles)
    .innerJoin(accounts, eq(accounts.id, profiles.accountId))
    .where(eq(profiles.id, profileId))
    .limit(1);

  return row ?? null;
}
