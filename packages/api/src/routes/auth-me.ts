/**
 * The four routes that act on the identity you are already signed in as:
 * reading it, changing what it prefers, changing what it shows the open
 * internet, and destroying it.
 *
 * They are together because they share one rule that is easy to lose sight of
 * one handler at a time: **nothing here takes its target from the request
 * body.** Every read and every write is scoped by `session.profile.id` or
 * `session.account.id`. A body that names a profile is not a way to edit one,
 * and the handlers below never look for such a field — which is why a strict
 * schema is used throughout, so an unexpected key is a 400 rather than
 * something silently ignored that a later change might start honouring.
 *
 * The guards themselves are declared where the routes are mounted, in
 * `auth.ts`, so that the whole namespace's authentication can be read on one
 * page. Two of these four carry `humanSessionsOnly` on top of `requireAuth`,
 * and the reason is written at the mount.
 *
 * Locale sits on the profile rather than the account because generation is
 * locale-aware and generation is per-profile. Onboarding sits on the account
 * because it happens once per login. `PATCH /me/profile` is the one handler
 * that writes both, which is why it is the one that opens a transaction.
 */

import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";

import { accounts, profiles } from "../db/index.js";
import { eraseAccount } from "../lib/account-erasure.js";
import { buildSessionClearCookie } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { supportedLocaleSchema } from "../lib/locales.js";
import type { AuthEnv } from "../lib/middleware.js";
import {
  isPublicHandleTaken,
  normalizePublicHandle,
  validatePublicHandle,
} from "../lib/public-handles.js";
import { validationDetails } from "../lib/validation.js";
import {
  accountColumns,
  loadIdentity,
  profileColumns,
  serializeAccount,
  serializeProfile,
  sessionProfileRow,
} from "./auth-identity.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const preferencesSchema = z
  .object({
    preferredLocale: supportedLocaleSchema,
  })
  .strict();

export type PreferencesInput = z.infer<typeof preferencesSchema>;

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required")
  .max(120, "Display name is too long");

const profileSchema = z
  .object({
    name: displayNameSchema,
    preferredLocale: supportedLocaleSchema,
    completeOnboarding: z.boolean().optional(),
    publicHandle: z.string().trim().max(24, "Handle is too long").nullable().optional(),
    publicProfileEnabled: z.boolean().optional(),
    publicTopOfMindEnabled: z.boolean().optional(),
  })
  .strict();

export type ProfileInput = z.infer<typeof profileSchema>;

const deleteAccountSchema = z
  .object({
    confirmation: z.literal("DELETE"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/auth/me
 *
 * The account that signed in plus the profile this session acts as. Used by
 * the SPA on boot to decide whether to render the home view or bounce to
 * /login, which is why it answers 401 rather than 200-with-null when
 * unauthenticated: one status check settles it.
 */
export async function meHandler(c: Context<AuthEnv>): Promise<Response> {
  const session = c.get("session");
  const identity = await loadIdentity(getDb(), session.profile.id);
  if (!identity) {
    // The profile was erased between the session lookup and this read.
    return c.json({ error: "Authentication required" }, 401);
  }

  return c.json({
    account: serializeAccount(identity.account),
    profile: serializeProfile(identity.profile),
  });
}

/**
 * PATCH /api/auth/me/preferences
 *
 * Locale is a property of the memory, not of the login: generation is
 * locale-aware and generation is per-profile, so this writes the acting
 * profile.
 */
export async function preferencesHandler(c: Context<AuthEnv>): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = preferencesSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid preferences payload",
        details: validationDetails(parsed.error),
      },
      400,
    );
  }

  const session = c.get("session");
  const db = getDb();

  const updated = await db
    .update(profiles)
    .set({
      preferredLocale: parsed.data.preferredLocale,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, session.profile.id))
    .returning({ id: profiles.id });

  // RETURNING cannot reach across the join, so the answer is read back
  // through the one query that assembles the whole identity.
  const identity = updated.length > 0 ? await loadIdentity(db, session.profile.id) : null;
  if (!identity) {
    return c.json({ error: "Authentication required" }, 401);
  }

  return c.json({
    account: serializeAccount(identity.account),
    profile: serializeProfile(identity.profile),
  });
}

/**
 * PATCH /api/auth/me/profile
 *
 * Display identity and the public surface, both of which belong to the
 * acting profile. `completeOnboarding` is the one field that reaches the
 * account row — onboarding happens once per login, not once per profile — so
 * the two writes share a transaction.
 */
export async function profileHandler(c: Context<AuthEnv>): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = profileSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid profile payload",
        details: validationDetails(parsed.error),
      },
      400,
    );
  }

  const session = c.get("session");
  const db = getDb();

  const current = await loadIdentity(db, session.profile.id);
  if (!current) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const normalizedHandle =
    parsed.data.publicHandle === undefined
      ? current.profile.publicHandle
      : parsed.data.publicHandle
        ? normalizePublicHandle(parsed.data.publicHandle)
        : null;
  if (normalizedHandle) {
    const handleError = validatePublicHandle(normalizedHandle);
    if (handleError) {
      return c.json(
        {
          error: "Invalid public handle",
          details: { publicHandle: [handleError] },
        },
        400,
      );
    }
  }

  const publicProfileEnabled =
    parsed.data.publicProfileEnabled ?? current.profile.publicProfileEnabled;
  const publicTopOfMindEnabled =
    parsed.data.publicTopOfMindEnabled ?? current.profile.publicTopOfMindEnabled;
  if ((publicProfileEnabled || publicTopOfMindEnabled) && !normalizedHandle) {
    return c.json(
      {
        error: "Public handle is required before enabling a public profile",
        details: { publicHandle: ["Choose a public handle first"] },
      },
      400,
    );
  }

  // A field-level error reads better than a bare constraint violation. The
  // unique index still guards the race between this read and the write, and
  // its 23505 lands on the same response below.
  if (normalizedHandle && normalizedHandle !== current.profile.publicHandle) {
    const taken = await isPublicHandleTaken({
      handle: normalizedHandle,
      claimingProfileId: current.profile.id,
      db,
    });
    if (taken) {
      return c.json(
        {
          error: "That public handle is already taken",
          details: { publicHandle: ["That public handle is already taken"] },
        },
        409,
      );
    }
  }

  const now = new Date();
  const completeOnboarding =
    parsed.data.completeOnboarding === true &&
    current.account.onboardingCompletedAt === null;

  let account = current.account;
  let profile = current.profile;
  try {
    const written = await db.transaction(async (tx) => {
      const [updatedProfile] = await tx
        .update(profiles)
        .set({
          name: parsed.data.name,
          preferredLocale: parsed.data.preferredLocale,
          publicHandle: normalizedHandle,
          publicProfileEnabled,
          publicTopOfMindEnabled,
          updatedAt: now,
        })
        .where(eq(profiles.id, current.profile.id))
        .returning(profileColumns);

      if (!completeOnboarding) {
        return { account: null, profile: updatedProfile };
      }

      const [updatedAccount] = await tx
        .update(accounts)
        .set({ onboardingCompletedAt: now, updatedAt: now })
        .where(eq(accounts.id, current.account.id))
        .returning(accountColumns);

      return { account: updatedAccount, profile: updatedProfile };
    });

    account = written.account ?? account;
    /* the update wrote this session's own profile, which has an account by
       the CHECK constraint; the narrow restates that for the types */
    profile = written.profile ? sessionProfileRow(written.profile) : profile;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      return c.json(
        {
          error: "That public handle is already taken",
          details: { publicHandle: ["That public handle is already taken"] },
        },
        409,
      );
    }
    throw err;
  }

  return c.json({
    account: serializeAccount(account),
    profile: serializeProfile(profile),
  });
}

/**
 * DELETE /api/auth/me
 *
 * Erases the whole account: every profile it owns and every layer of memory
 * under them. The confirmation literal is required because this has no undo.
 */
export async function eraseAccountHandler(c: Context<AuthEnv>): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = deleteAccountSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid delete confirmation",
        details: validationDetails(parsed.error),
      },
      400,
    );
  }

  const session = c.get("session");
  await eraseAccount(session.account.id, { db: getDb() });
  c.header("Set-Cookie", buildSessionClearCookie());
  return c.json({ ok: true });
}
