/**
 * Internal/dev-only meaning graph inspector API.
 *
 * This reads the promoted meaning graph written by PR5. Inspirations are
 * evidence; nodes are durable meanings; edges are relationships between those
 * meanings. This route is for debugging backend state, not user navigation.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";

import {
  inspirations,
  meaningEdges,
  meaningEvidence,
  meaningNodes,
  meaningPackets,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";

const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 300;
const MAX_PREVIEW_LENGTH = 180;

export interface AdminMeaningGraphRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  adminGate?: MiddlewareHandler<AuthEnv>;
}

export function isAdminMeaningGraphEnabled(): boolean {
  return (
    process.env.WAKA_ENABLE_ADMIN_ROUTES === "true" ||
    process.env.WAKA_SHOW_INTERNAL_STATUS === "true" ||
    process.env.NODE_ENV === "development"
  );
}

export const requireAdminMeaningGraphEnabled: MiddlewareHandler<AuthEnv> = async (
  c,
  next,
) => {
  if (!isAdminMeaningGraphEnabled()) {
    return c.notFound();
  }
  await next();
};

function parseLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function truncatePreview(value: string, maxLength = MAX_PREVIEW_LENGTH): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function createAdminMeaningGraphRoutes(
  deps: AdminMeaningGraphRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;

  routes.use("*", deps.adminGate ?? requireAdminMeaningGraphEnabled);
  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const userId = c.get("user").id;
    const limit = parseLimit(c.req.query("limit"));
    const db = getDatabase();

    const nodeRows = await db
      .select()
      .from(meaningNodes)
      .where(and(eq(meaningNodes.userId, userId), eq(meaningNodes.status, "active")))
      .orderBy(desc(meaningNodes.weight), desc(meaningNodes.lastReinforcedAt))
      .limit(limit);

    const nodeIds = nodeRows.map((node) => node.id);
    const edgeRows =
      nodeIds.length === 0
        ? []
        : await db
            .select()
            .from(meaningEdges)
            .where(
              and(
                eq(meaningEdges.userId, userId),
                eq(meaningEdges.status, "active"),
                inArray(meaningEdges.sourceNodeId, nodeIds),
                inArray(meaningEdges.targetNodeId, nodeIds),
              ),
            )
            .orderBy(desc(meaningEdges.weight), desc(meaningEdges.lastReinforcedAt))
            .limit(limit * 3);

    const evidenceRows =
      nodeIds.length === 0
        ? []
        : await db
            .select({
              meaningNodeId: meaningEvidence.meaningNodeId,
              inspirationId: meaningEvidence.inspirationId,
              packetId: meaningEvidence.packetId,
              reason: meaningEvidence.reason,
              weight: meaningEvidence.weight,
              confidence: meaningEvidence.confidence,
              source: meaningEvidence.source,
              createdAt: meaningEvidence.createdAt,
              inspirationText: inspirations.text,
              inspirationCreatedAt: inspirations.createdAt,
              sparkText: meaningPackets.sparkText,
              packetText: meaningPackets.packetText,
              tokenEstimate: meaningPackets.tokenEstimate,
            })
            .from(meaningEvidence)
            .innerJoin(
              inspirations,
              and(
                eq(inspirations.id, meaningEvidence.inspirationId),
                eq(inspirations.userId, meaningEvidence.userId),
              ),
            )
            .innerJoin(
              meaningPackets,
              and(
                eq(meaningPackets.id, meaningEvidence.packetId),
                eq(meaningPackets.userId, meaningEvidence.userId),
              ),
            )
            .where(and(eq(meaningEvidence.userId, userId), inArray(meaningEvidence.meaningNodeId, nodeIds)))
            .orderBy(desc(meaningEvidence.weight), desc(meaningEvidence.createdAt))
            .limit(limit * 4);

    const evidenceByNodeId = new Map<string, typeof evidenceRows>();
    for (const row of evidenceRows) {
      const rows = evidenceByNodeId.get(row.meaningNodeId) ?? [];
      rows.push(row);
      evidenceByNodeId.set(row.meaningNodeId, rows);
    }

    return c.json({
      graph: {
        nodes: nodeRows.map((node) => ({
          id: node.id,
          type: node.type,
          label: node.label,
          description: node.description,
          status: node.status,
          source: node.source,
          weight: node.weight,
          confidence: node.confidence,
          evidenceCount: node.evidenceCount,
          firstSeenAt: node.firstSeenAt.toISOString(),
          lastReinforcedAt: node.lastReinforcedAt.toISOString(),
          createdAt: node.createdAt.toISOString(),
          updatedAt: node.updatedAt.toISOString(),
          evidence: (evidenceByNodeId.get(node.id) ?? []).slice(0, 8).map((evidence) => ({
            inspirationId: evidence.inspirationId,
            packetId: evidence.packetId,
            reason: evidence.reason,
            weight: evidence.weight,
            confidence: evidence.confidence,
            source: evidence.source,
            preview: truncatePreview(evidence.sparkText || evidence.inspirationText),
            packetPreview: truncatePreview(evidence.packetText, 260),
            tokenEstimate: evidence.tokenEstimate,
            inspirationCreatedAt: evidence.inspirationCreatedAt.toISOString(),
            createdAt: evidence.createdAt.toISOString(),
          })),
        })),
        edges: edgeRows.map((edge) => ({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          kind: edge.kind,
          weight: edge.weight,
          confidence: edge.confidence,
          evidenceCount: edge.evidenceCount,
          evidenceInspirationIds: edge.evidenceInspirationIds,
          status: edge.status,
          source: edge.source,
          lastReinforcedAt: edge.lastReinforcedAt.toISOString(),
          createdAt: edge.createdAt.toISOString(),
          updatedAt: edge.updatedAt.toISOString(),
        })),
        meta: {
          nodeCount: nodeRows.length,
          edgeCount: edgeRows.length,
          evidenceCount: evidenceRows.length,
          limit,
        },
      },
    });
  });

  return routes;
}

export const adminMeaningGraphRoutes = createAdminMeaningGraphRoutes();
