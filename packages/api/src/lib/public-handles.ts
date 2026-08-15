/**
 * Public handle rules for the public profile surface.
 *
 * The handle belongs to a profile, not to an account: a public page is a
 * profile's surface, and one account can own several profiles.
 *
 * Every comparison runs on the normalised form, so "@Mina", "Mina" and
 * " MINA " are one handle. The normalised form is also what gets stored and
 * what the public route resolves, so the URL a visitor types and the row the
 * server finds can never drift apart.
 */

import { and, eq, ne } from "drizzle-orm";

import { profiles } from "../db/index.js";
import { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;

const HANDLE_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;

const RESERVED_HANDLES = new Set([
  "admin",
  "api",
  "auth",
  "health",
  "login",
  "logout",
  "me",
  "onboarding",
  "profile",
  "public",
  "settings",
  "signin",
  "signup",
  "top-of-mind",
  "u",
  "user",
  "waka",
]);

export function normalizePublicHandle(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

export function validatePublicHandle(input: string): string | null {
  const handle = normalizePublicHandle(input);
  if (!HANDLE_PATTERN.test(handle)) {
    return "Handle must be 3-24 letters, numbers, hyphens, or underscores with no spaces";
  }
  if (RESERVED_HANDLES.has(handle)) {
    return "That handle is reserved";
  }
  return null;
}

/**
 * Is this handle already claimed by a different profile?
 *
 * A profile keeping its own handle is not a clash, so the claiming profile is
 * excluded from the lookup. This is a courtesy check that produces a field
 * error instead of a raw constraint violation — the unique index on
 * `profiles.public_handle` is still the arbiter, since two claims can race
 * between this read and the write.
 */
export async function isPublicHandleTaken(input: {
  handle: string;
  claimingProfileId: string;
  db?: WakaDb;
}): Promise<boolean> {
  const handle = normalizePublicHandle(input.handle);
  if (!handle) return false;

  const db = input.db ?? getDb();
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.publicHandle, handle),
        ne(profiles.id, input.claimingProfileId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}
