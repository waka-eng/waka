/**
 * /api/inspirations/:id/reflections — the human's own words about a capture.
 *
 * A reflection is layer-1 detail hanging off an inspiration, so every handler
 * here has two ownership questions to answer, not one: the reflection must
 * belong to the profile, *and* it must belong to the capture named in the
 * path. Both predicates appear in every statement below. Checking only the
 * parent and then trusting the child id would let a caller read or delete one
 * of their own reflections through someone else's capture id — harmless-
 * looking, and still a confirmation that the other capture exists.
 *
 * Reading is a "read"; writing and deleting are "write", which an agent
 * session does not hold over its human's profile.
 */

import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { inspirations, reflections } from "../db/index.js";
import { getDb } from "../lib/db.js";
import type { AuthEnv } from "../lib/middleware.js";
import { requestSignalDerivation } from "./inspirations-derivation.js";
import {
  reflectionSelection,
  serializeReflection,
} from "./inspirations-serialization.js";
import { resolveTargetProfile } from "./inspirations-tenancy.js";
import {
  profileQuerySchema,
  reflectionInputSchema,
  uuidSchema,
} from "./inspirations-validation.js";

export function registerReflectionRoutes(
  routes: Hono<AuthEnv>,
  getDatabase: typeof getDb,
): void {
  /**
   * POST /api/inspirations/:id/reflections
   *
   * A reflection is human-authored layer-1 detail, and it is some of the
   * strongest context a capture carries — the person saying why this mattered.
   * Adding one therefore asks for re-derivation, the same as editing the text.
   */
  routes.post("/:id/reflections", async (c) => {
    const idCheck = uuidSchema.safeParse(c.req.param("id"));
    if (!idCheck.success) {
      return c.json({ error: "Invalid inspiration id" }, 400);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const parsed = reflectionInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid reflection payload",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: "Invalid query", details: query.error.flatten().fieldErrors },
        400,
      );
    }

    const session = c.get("session");
    const db = getDatabase();
    const target = await resolveTargetProfile(db, session, query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);

    const [parent] = await db
      .select({ id: inspirations.id })
      .from(inspirations)
      .where(
        and(
          eq(inspirations.id, idCheck.data),
          eq(inspirations.profileId, target.profileId),
        ),
      )
      .limit(1);

    if (!parent) return c.json({ error: "Inspiration not found" }, 404);

    const [inserted] = await db
      .insert(reflections)
      .values({
        profileId: target.profileId,
        inspirationId: parent.id,
        question: parsed.data.question,
        answer: parsed.data.answer ?? null,
        skipped: parsed.data.skipped ?? false,
      })
      .returning(reflectionSelection);

    if (!inserted) return c.json({ error: "Failed to create reflection" }, 500);

    await requestSignalDerivation({
      profileId: target.profileId,
      inspirationId: parent.id,
      reason: "edited",
    });

    return c.json({ reflection: serializeReflection(inserted) }, 201);
  });

  /**
   * GET /api/inspirations/:id/reflections
   *
   * Authored order, so the thread reads the way it was written. An inspiration
   * with no reflections is an empty list, never a 404.
   */
  routes.get("/:id/reflections", async (c) => {
    const idCheck = uuidSchema.safeParse(c.req.param("id"));
    if (!idCheck.success) {
      return c.json({ error: "Invalid inspiration id" }, 400);
    }

    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: "Invalid query", details: query.error.flatten().fieldErrors },
        400,
      );
    }

    const session = c.get("session");
    const db = getDatabase();
    const target = await resolveTargetProfile(db, session, query.data.profile, "read");
    if (!target.ok) return c.json(target.body, target.status);

    const [parent] = await db
      .select({ id: inspirations.id })
      .from(inspirations)
      .where(
        and(
          eq(inspirations.id, idCheck.data),
          eq(inspirations.profileId, target.profileId),
        ),
      )
      .limit(1);

    if (!parent) return c.json({ error: "Inspiration not found" }, 404);

    const rows = await db
      .select(reflectionSelection)
      .from(reflections)
      .where(
        and(
          eq(reflections.inspirationId, parent.id),
          eq(reflections.profileId, target.profileId),
        ),
      )
      // The id tie-breaker keeps a multi-answer save deterministic even where
      // several rows share a timestamp.
      .orderBy(asc(reflections.createdAt), asc(reflections.id));

    return c.json({ reflections: rows.map(serializeReflection) }, 200);
  });

  /** DELETE /api/inspirations/:id/reflections/:reflectionId */
  routes.delete("/:id/reflections/:reflectionId", async (c) => {
    const idCheck = uuidSchema.safeParse(c.req.param("id"));
    const reflectionIdCheck = uuidSchema.safeParse(c.req.param("reflectionId"));
    if (!idCheck.success) {
      return c.json({ error: "Invalid inspiration id" }, 400);
    }
    if (!reflectionIdCheck.success) {
      return c.json({ error: "Invalid reflection id" }, 400);
    }

    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: "Invalid query", details: query.error.flatten().fieldErrors },
        400,
      );
    }

    const session = c.get("session");
    const db = getDatabase();
    const target = await resolveTargetProfile(db, session, query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);

    const [deleted] = await db
      .delete(reflections)
      .where(
        and(
          eq(reflections.id, reflectionIdCheck.data),
          eq(reflections.inspirationId, idCheck.data),
          eq(reflections.profileId, target.profileId),
        ),
      )
      .returning({ id: reflections.id });

    if (!deleted) return c.json({ error: "Reflection not found" }, 404);

    return c.json({ deleted: true, id: deleted.id }, 200);
  });
}
