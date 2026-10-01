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

import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { backgroundJobs, inspirations, reflections } from "../db/index.js";
import { getDb } from "../lib/db.js";
import type { AuthEnv } from "../lib/middleware.js";
import { enqueueReflectionQuestion, reflectionQuestionJobKey, wakeCommittedBackgroundJobs } from "../lib/queue.js";
import { validationDetails } from "../lib/validation.js";
import { requestSignalDerivation } from "../lib/inspiration-derivation-requests.js";
import { InspirationSaveError, inspirationSaveFailure, parseInspirationSaveRequestId, runInspirationSave } from '../lib/inspiration-save-requests.js';
import { readSavedReflection } from './inspirations-save-requests.js';
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
  enqueueQuestion: typeof enqueueReflectionQuestion = enqueueReflectionQuestion,
): void {
  const followUpRequestSchema = z.object({ afterReflectionId: uuidSchema, retry: z.boolean().optional() }).strict();

  const loadLatestAnswer = async (db: ReturnType<typeof getDb>, profileId: string, inspirationId: string) => {
    const [parent, latest] = await Promise.all([
      db.select({ id: inspirations.id }).from(inspirations)
        .where(and(eq(inspirations.id, inspirationId), eq(inspirations.profileId, profileId))).limit(1),
      db.select({ id: reflections.id }).from(reflections)
        .where(and(eq(reflections.inspirationId, inspirationId), eq(reflections.profileId, profileId),
          eq(reflections.skipped, false), isNotNull(reflections.answer)))
        .orderBy(desc(reflections.createdAt), desc(reflections.id)).limit(1),
    ]);
    return { exists: Boolean(parent[0]), latestId: latest[0]?.id ?? null };
  };

  const readQuestionJob = async (db: ReturnType<typeof getDb>, profileId: string, inspirationId: string,
    afterReflectionId: string) => {
    const [job] = await db.select({ status: backgroundJobs.status, payload: backgroundJobs.payload })
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.profileId, profileId),
        eq(backgroundJobs.idempotencyKey, reflectionQuestionJobKey(profileId, inspirationId, afterReflectionId))))
      .limit(1);
    const question = job?.payload && typeof job.payload === "object" && "question" in job.payload &&
      typeof job.payload.question === "string" ? job.payload.question : null;
    return !job ? { phase: "idle" as const }
      : job.status === "succeeded" && question ? { phase: "ready" as const, question }
      : job.status === "failed" || job.status === "succeeded" ? { phase: "failed" as const }
      : { phase: "processing" as const };
  };

  /** Only enqueue here; the worker holds the model budget and the answer. */
  routes.post("/:id/reflection-question", async (c) => {
    const idCheck = uuidSchema.safeParse(c.req.param("id"));
    if (!idCheck.success) return c.json({ error: "Invalid inspiration id" }, 400);
    let rawBody: unknown;
    try { rawBody = await c.req.json(); }
    catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
    const body = followUpRequestSchema.safeParse(rawBody);
    if (!body.success) return c.json({ error: "A saved reflection is required" }, 400);
    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "Invalid query" }, 400);

    const session = c.get("session");
    const db = getDatabase();
    const target = await resolveTargetProfile(db, session, query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);
    const material = await loadLatestAnswer(db, target.profileId, idCheck.data);
    if (!material.exists) return c.json({ error: "Inspiration not found" }, 404);
    if (material.latestId !== body.data.afterReflectionId) {
      return c.json({ error: "That is not the latest saved reflection" }, 409);
    }
    const current = await readQuestionJob(db, target.profileId, idCheck.data, body.data.afterReflectionId);
    if (current.phase === "ready" || current.phase === "processing" ||
      (current.phase === "failed" && !body.data.retry)) {
      return c.json(current, current.phase === "processing" ? 202 : 200);
    }
    await enqueueQuestion(target.profileId, idCheck.data, body.data.afterReflectionId);
    return c.json({ phase: "processing" as const }, 202);
  });

  routes.get("/:id/reflection-question/status", async (c) => {
    const idCheck = uuidSchema.safeParse(c.req.param("id"));
    const afterCheck = uuidSchema.safeParse(c.req.query("afterReflectionId"));
    if (!idCheck.success || !afterCheck.success) return c.json({ error: "Invalid reflection question request" }, 400);
    const query = profileQuerySchema.safeParse({ profile: c.req.query("profile") });
    if (!query.success) return c.json({ error: "Invalid query" }, 400);
    const db = getDatabase();
    const target = await resolveTargetProfile(db, c.get("session"), query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);
    const material = await loadLatestAnswer(db, target.profileId, idCheck.data);
    if (!material.exists) return c.json({ error: "Inspiration not found" }, 404);
    if (material.latestId !== afterCheck.data) return c.json({ error: "That is not the latest saved reflection" }, 409);
    return c.json(await readQuestionJob(db, target.profileId, idCheck.data, afterCheck.data), 200);
  });

  /**
   * POST /api/inspirations/:id/reflections
   *
   * A reflection is human-authored layer-1 detail, and it is some of the
   * strongest context a capture carries — the person saying why this mattered.
   * Adding one therefore asks for re-derivation, the same as editing the text.
   */
  routes.post("/:id/reflections", async (c) => {
    c.header('Cache-Control', 'private, no-store');
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
          details: validationDetails(parsed.error),
        },
        400,
      );
    }

    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: "Invalid query", details: validationDetails(query.error) },
        400,
      );
    }

    const session = c.get("session");
    const db = getDatabase();
    const target = await resolveTargetProfile(db, session, query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);

    try {
      const saved = await runInspirationSave(db, {
        profileId: target.profileId,
        requestId: parseInspirationSaveRequestId(c.req.header('Idempotency-Key')),
        operation: 'reflection',
        material: { inspirationId: idCheck.data.toLowerCase(), question: parsed.data.question,
          answer: parsed.data.answer ?? null, skipped: parsed.data.skipped ?? false },
      }, async (tx) => {
        const [parent] = await tx.select({ id: inspirations.id }).from(inspirations)
          .where(and(eq(inspirations.id, idCheck.data), eq(inspirations.profileId, target.profileId))).limit(1);
        if (!parent) throw new InspirationSaveError(404, 'inspiration_not_found', 'Inspiration not found');
        const [row] = await tx.insert(reflections).values({
          profileId: target.profileId,
          inspirationId: parent.id,
          question: parsed.data.question,
          answer: parsed.data.answer ?? null,
          skipped: parsed.data.skipped ?? false,
        }).returning(reflectionSelection);
        if (!row) throw new Error('Failed to create reflection');
        const processing = await requestSignalDerivation({ profileId: target.profileId, inspirationId: parent.id,
          reason: "edited", changedSource: "reflection" }, tx);
        return { inspirationId: parent.id, reflectionId: row.id, processing: processing.receipt,
          response: { reflection: serializeReflection(row), processing: processing.receipt } };
      }, (tx, record) => readSavedReflection(tx, target.profileId, record));

      await wakeCommittedBackgroundJobs();
      return c.json({ ...saved.response, ...(saved.saveRequest ? { saveRequest: saved.saveRequest } : {}) }, saved.replayed ? 200 : 201);
    } catch (error) {
      const failure = inspirationSaveFailure(error);
      if (failure) return c.json({ error: failure.message, code: failure.code }, failure.status);
      const code = (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
      if (code === '23503') return c.json({ error: 'Inspiration not found' }, 404);
      throw error;
    }
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
        { error: "Invalid query", details: validationDetails(query.error) },
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
        { error: "Invalid query", details: validationDetails(query.error) },
        400,
      );
    }

    const session = c.get("session");
    const db = getDatabase();
    const target = await resolveTargetProfile(db, session, query.data.profile, "write");
    if (!target.ok) return c.json(target.body, target.status);

    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
      .delete(reflections)
      .where(
        and(
          eq(reflections.id, reflectionIdCheck.data),
          eq(reflections.inspirationId, idCheck.data),
          eq(reflections.profileId, target.profileId),
        ),
      )
      .returning({ id: reflections.id });
      if (row) await requestSignalDerivation({ profileId: target.profileId, inspirationId: idCheck.data,
        reason: "edited", changedSource: "reflection" }, tx);
      return row;
    });

    if (!deleted) return c.json({ error: "Reflection not found" }, 404);

    await wakeCommittedBackgroundJobs();

    return c.json({ deleted: true, id: deleted.id }, 200);
  });
}
