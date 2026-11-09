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

/* A public page lives at `/<handle>`, and the web app's own top-level pages
   (`packages/web/src/main.tsx`) are matched before it — so a handle spelled
   like one of them would leave its owner's public page unreachable. Every
   such page is here; `public-handles.test.ts` lists them. */
const RESERVED_HANDLES = new Set([
  "admin",
  "api",
  "auth",
  "chat",
  "days",
  "health",
  "inspirations",
  "login",
  "logout",
  "me",
  "mobile-check",
  "onboarding",
  "principles",
  "profile",
  "public",
  "settings",
  "share",
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

/** Could this ever be a stored handle? The shape only — reservation aside. */
export function isWellFormedPublicHandle(input: string): boolean {
  return HANDLE_PATTERN.test(normalizePublicHandle(input));
}

/**
 * Why a handle cannot be CLAIMED, or null.
 *
 * `keeping` is the handle the profile already holds. Reservation stops new
 * claims; it never takes a handle away from a profile that held it before the
 * word was reserved — every profile write that does not mention the handle
 * carries the current one, so refusing it there would lock the owner out of
 * renaming, changing language, or finishing onboarding.
 */
export function validatePublicHandle(input: string, options: { keeping?: string | null } = {}): string | null {
  const handle = normalizePublicHandle(input);
  if (!HANDLE_PATTERN.test(handle)) {
    return "Handle must be 3-24 letters, numbers, hyphens, or underscores with no spaces";
  }
  const kept = options.keeping ? normalizePublicHandle(options.keeping) : null;
  if (RESERVED_HANDLES.has(handle) && handle !== kept) {
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
