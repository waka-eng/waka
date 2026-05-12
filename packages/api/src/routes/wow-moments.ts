/**
 * WOW moments routes.
 *
 * Foundation slice: authenticated users can list persisted WOW moments and the
 * inspirations that explain why each one matters. Generation/scoring workers are
 * intentionally out of scope for this PR.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";

import {
  inspirations,
  wowMomentInspirations,
  wowMoments,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";

const MAX_WOW_MOMENTS = 20;

export const wowMomentsRoutes = new Hono<AuthEnv>();

wowMomentsRoutes.use("*", requireAuth);

wowMomentsRoutes.get("/", async (c) => {
  const user = c.get("user");
  const db = getDb();

  const moments = await db
    .select({
      id: wowMoments.id,
      userId: wowMoments.userId,
      title: wowMoments.title,
      kind: wowMoments.kind,
      why: wowMoments.why,
      reflectionQuestion: wowMoments.reflectionQuestion,
      wowScore: wowMoments.wowScore,
      createdAt: wowMoments.createdAt,
      updatedAt: wowMoments.updatedAt,
    })
    .from(wowMoments)
    .where(eq(wowMoments.userId, user.id))
    .orderBy(desc(wowMoments.createdAt), desc(wowMoments.wowScore))
    .limit(MAX_WOW_MOMENTS);

  if (moments.length === 0) {
    return c.json({ wowMoments: [] });
  }

  const momentIds = moments.map((moment) => moment.id);
  const relatedRows = await db
    .select({
      wowMomentId: wowMomentInspirations.wowMomentId,
      inspirationId: wowMomentInspirations.inspirationId,
      role: wowMomentInspirations.role,
      reason: wowMomentInspirations.reason,
      sortOrder: wowMomentInspirations.sortOrder,
      inspirationText: inspirations.text,
      inspirationKind: inspirations.kind,
      inspirationCreatedAt: inspirations.createdAt,
    })
    .from(wowMomentInspirations)
    .innerJoin(
      inspirations,
      eq(wowMomentInspirations.inspirationId, inspirations.id),
    )
    .where(
      and(
        inArray(wowMomentInspirations.wowMomentId, momentIds),
        eq(inspirations.userId, user.id),
      ),
    )
    .orderBy(asc(wowMomentInspirations.sortOrder), asc(wowMomentInspirations.createdAt));

  const relatedByMomentId = new Map<string, typeof relatedRows>();
  for (const row of relatedRows) {
    const bucket = relatedByMomentId.get(row.wowMomentId) ?? [];
    bucket.push(row);
    relatedByMomentId.set(row.wowMomentId, bucket);
  }

  return c.json({
    wowMoments: moments.map((moment) => ({
      ...moment,
      relatedInspirations: (relatedByMomentId.get(moment.id) ?? []).map((row) => ({
        inspirationId: row.inspirationId,
        role: row.role,
        reason: row.reason,
        text: row.inspirationText,
        kind: row.inspirationKind,
        createdAt: row.inspirationCreatedAt,
      })),
    })),
  });
});
