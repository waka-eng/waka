/**
 * Internal/dev-only meaning graph inspector API.
 *
 * This reads the promoted meaning graph written by PR5. Inspirations are
 * evidence; nodes are durable meanings; edges are relationships between those
 * meanings. This route is for debugging backend state, not user navigation.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";

import {
  feedback,
  inspirations,
  meaningEdges,
  meaningEvidence,
  meaningNodes,
  meaningPackets,
  wowMoments,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { normalizeContextNodeType } from "../lib/context-node-types.js";
import { deriveMemoryPattern, type MemoryState } from "../lib/memory-movement.js";
import { requireAdminUser } from "../lib/admin-auth.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";
import {
  enqueueMeaningGraphRebuild,
  type BackgroundJobSummary,
  getMeaningGraphRebuildJob,
  getLatestMeaningGraphRebuildJob,
  scheduleBackgroundJobDrain,
} from "../lib/queue.js";
import { topOfMindNoteFromWowMoment } from "../lib/top-of-mind-notes.js";

const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 300;
const MAX_PREVIEW_LENGTH = 180;

function isMissingMeaningGraphRebuildJobType(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;

  while (current && !seen.has(current)) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    if (/invalid input value for enum background_job_type/i.test(message) && /meaning_graph_rebuild/i.test(message)) {
      return true;
    }
    current = typeof current === "object" && "cause" in current ? (current as { cause?: unknown }).cause : null;
  }

  return false;
}

function missingMeaningGraphRebuildJobTypeResponse(c: Context<AuthEnv>) {
  return c.json(
    {
      error: "Local database migration required",
      code: "MISSING_MEANING_GRAPH_REBUILD_JOB_TYPE",
      detail:
        "Run the repo Drizzle migrations so background_job_type includes meaning_graph_rebuild before rebuilding the admin meaning graph.",
    },
    409,
  );
}

function ambitionDimensionForContextType(
  type: ReturnType<typeof normalizeContextNodeType>,
):
  | "place"
  | "people"
  | "work"
  | "taste"
  | "identity"
  | "rejection"
  | "next_experiment" {
  switch (type) {
    case "environment":
      return "place";
    case "person":
      return "people";
    case "project":
      return "work";
    case "aesthetic":
      return "taste";
    case "tension":
      return "rejection";
    case "open_question":
    case "hypothesis":
      return "next_experiment";
    case "value":
      return "identity";
    case "theme":
    default:
      return "work";
  }
}

function contextNoteKey(userId: string, nodeId: string): string {
  return `top_of_mind_context_node:v1:${userId}:${nodeId}`;
}

function nodeIdFromContextNoteKey(userId: string, key: string): string | null {
  const prefix = contextNoteKey(userId, "");
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

type GraphHealthStatus = "no_data" | "writer_failed" | "sparse" | "stale" | "healthy";

interface GraphHealthWarning {
  type: GraphHealthStatus | "no_packets";
  message: string;
}

interface GraphHealth {
  inspirationCount: number;
  packetCount: number;
  nodeCount: number;
  edgeCount: number;
  evidenceCount: number;
  inspirationsWithoutPackets: number;
  nodesWithoutEvidence: number;
  edgeDensity: number;
  status: GraphHealthStatus;
  warnings: GraphHealthWarning[];
}

type QualitySeverity = "ok" | "watch" | "risk";

interface QualityIndicator {
  type:
    | "raw_graph_label"
    | "shallow_summary"
    | "generic_ambition_wrapper"
    | "unsupported_synthesis"
    | "healthy_specificity";
  severity: QualitySeverity;
  label: string;
  detail: string;
}

export interface AdminMeaningGraphRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  adminGate?: MiddlewareHandler<AuthEnv>;
  adminAuthorization?: MiddlewareHandler<AuthEnv>;
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

function qualityIndicatorsForTopOfMindNote(input: {
  title: string;
  ambientSignal: string;
  evidenceCount: number;
  relatedContextNodeLabels: string[];
  rejectedAlternativeInterpretation: string | null;
}): QualityIndicator[] {
  const title = input.title.replace(/\s+/g, " ").trim();
  const titleLower = title.toLowerCase();
  const indicators: QualityIndicator[] = [];

  if (
    input.relatedContextNodeLabels.some(
      (label) => label.trim().length > 0 && label.trim().toLowerCase() === titleLower,
    )
  ) {
    indicators.push({
      type: "raw_graph_label",
      severity: "risk",
      label: "Raw graph label",
      detail: "The post-it text exactly matches a context-node label.",
    });
  }

  if (/^(i need|i want|i am|i'm|i refuse|i am done with)\b/i.test(title)) {
    // First-person is expected, but a sentence that only names a broad topic still
    // needs evidence and a rejected alternative to be trusted as synthesis.
    if (!/\b(room|rooms|place|places|city|cities|people|peers|work|standard|environment|surroundings|self|version|test)\b/i.test(title)) {
      indicators.push({
        type: "shallow_summary",
        severity: "watch",
        label: "May be too topic-like",
        detail: "The primary text is first-person but does not name an environment, peers, standard, rejection, self-image, or test.",
      });
    }
  } else {
    indicators.push({
      type: "shallow_summary",
      severity: "risk",
      label: "Not post-it voice",
      detail: "The primary text does not read like a first-person Top of Mind post-it.",
    });
  }

  if (
    /\b(rooms where|work that turns|places where|environment where)\b/i.test(title) &&
    input.relatedContextNodeLabels.some((label) => titleLower.includes(label.toLowerCase()))
  ) {
    indicators.push({
      type: "generic_ambition_wrapper",
      severity: "risk",
      label: "Generic ambition wrapper",
      detail: "The note may be wrapping a graph label in ambition language instead of synthesizing the user's edge.",
    });
  }

  if (input.evidenceCount < 2 || !input.rejectedAlternativeInterpretation?.trim()) {
    indicators.push({
      type: "unsupported_synthesis",
      severity: "watch",
      label: "Thin synthesis support",
      detail: "This post-it has limited supporting signals or no rejected alternative interpretation.",
    });
  }

  if (indicators.length === 0) {
    indicators.push({
      type: "healthy_specificity",
      severity: "ok",
      label: "Specific and supported",
      detail: "The post-it has first-person ambition language, supporting signals, and a rejected shallow read.",
    });
  }

  return indicators;
}

function qualityIndicatorsForContextNode(input: {
  label: string;
  evidenceCount: number;
  relatedTopOfMindCount: number;
  feedbackCount: number;
  memoryState: MemoryState;
}): QualityIndicator[] {
  const indicators: QualityIndicator[] = [];

  if (input.evidenceCount === 0) {
    indicators.push({
      type: "unsupported_synthesis",
      severity: "risk",
      label: "No supporting signals",
      detail: "This context node is active without attached evidence.",
    });
  }

  if (
    input.relatedTopOfMindCount > 0 &&
    /^(startup|startups|cities|ai|productivity|comedy|inspiration|taste)$/i.test(input.label.trim())
  ) {
    indicators.push({
      type: "raw_graph_label",
      severity: "risk",
      label: "Shallow label risk",
      detail: "A broad topic label is currently feeding Top of Mind.",
    });
  }

  if ((input.memoryState === "fading" || input.memoryState === "dormant") && input.relatedTopOfMindCount > 0) {
    indicators.push({
      type: "unsupported_synthesis",
      severity: "watch",
      label: "Fading but surfaced",
      detail: "This pattern is fading or dormant but still connected to a Top of Mind note.",
    });
  }

  if (input.feedbackCount > 0 && indicators.length === 0) {
    indicators.push({
      type: "healthy_specificity",
      severity: "ok",
      label: "User-shaped",
      detail: "User feedback has shaped this graph claim.",
    });
  }

  return indicators;
}

function serializeJobDate(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function serializeBackgroundJob(job: BackgroundJobSummary) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    payload: job.payload,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: serializeJobDate(job.runAfter),
    lockedAt: serializeJobDate(job.lockedAt),
    lastError: job.lastError,
    createdAt: serializeJobDate(job.createdAt),
    updatedAt: serializeJobDate(job.updatedAt),
  };
}

async function countRows<T>(query: Promise<T[]>, key: keyof T): Promise<number> {
  const [row] = await query;
  const value = row?.[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

async function getMeaningGraphHealth(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<GraphHealth> {
  const [
    inspirationCount,
    packetCount,
    nodeCount,
    edgeCount,
    evidenceCount,
    inspirationsWithoutPackets,
    nodesWithoutEvidence,
  ] = await Promise.all([
    countRows(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(inspirations)
        .where(eq(inspirations.userId, userId)),
      "count",
    ),
    countRows(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(meaningPackets)
        .where(eq(meaningPackets.userId, userId)),
      "count",
    ),
    countRows(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(meaningNodes)
        .where(and(eq(meaningNodes.userId, userId), eq(meaningNodes.status, "active"))),
      "count",
    ),
    countRows(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(meaningEdges)
        .where(and(eq(meaningEdges.userId, userId), eq(meaningEdges.status, "active"))),
      "count",
    ),
    countRows(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(meaningEvidence)
        .where(eq(meaningEvidence.userId, userId)),
      "count",
    ),
    countRows(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(inspirations)
        .where(
          and(
            eq(inspirations.userId, userId),
            sql`not exists (
              select 1
              from ${meaningPackets}
              where ${meaningPackets.userId} = ${inspirations.userId}
                and ${meaningPackets.inspirationId} = ${inspirations.id}
            )`,
          ),
        ),
      "count",
    ),
    countRows(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(meaningNodes)
        .where(
          and(
            eq(meaningNodes.userId, userId),
            eq(meaningNodes.status, "active"),
            sql`not exists (
              select 1
              from ${meaningEvidence}
              where ${meaningEvidence.userId} = ${meaningNodes.userId}
                and ${meaningEvidence.meaningNodeId} = ${meaningNodes.id}
            )`,
          ),
        ),
      "count",
    ),
  ]);

  const possibleDirectedEdges = nodeCount * Math.max(0, nodeCount - 1);
  const edgeDensity =
    possibleDirectedEdges === 0
      ? 0
      : Math.round((edgeCount / possibleDirectedEdges) * 1000) / 1000;
  const warnings: GraphHealthWarning[] = [];

  if (inspirationCount === 0) {
    warnings.push({
      type: "no_data",
      message: "No inspirations exist for this user yet.",
    });
  } else if (packetCount === 0) {
    warnings.push({
      type: "no_packets",
      message: "Inspirations exist, but no meaning packets have been generated.",
    });
  }

  if (packetCount > 0 && (nodeCount === 0 || evidenceCount === 0)) {
    warnings.push({
      type: "writer_failed",
      message: "Packets exist, but the graph writer has not produced nodes with evidence.",
    });
  }

  if (inspirationsWithoutPackets > 0) {
    warnings.push({
      type: "stale",
      message: `${inspirationsWithoutPackets} inspiration${
        inspirationsWithoutPackets === 1 ? "" : "s"
      } do not have meaning packets.`,
    });
  }

  if (nodeCount > 0 && nodesWithoutEvidence > 0) {
    warnings.push({
      type: "writer_failed",
      message: `${nodesWithoutEvidence} active meaning node${
        nodesWithoutEvidence === 1 ? "" : "s"
      } have no evidence rows.`,
    });
  }

  if (
    packetCount >= 2 &&
    nodeCount > 0 &&
    (edgeCount === 0 || nodeCount < Math.min(3, packetCount) || edgeDensity < 0.02)
  ) {
    warnings.push({
      type: "sparse",
      message: "Graph state is sparse for the available packet count.",
    });
  }

  const status =
    inspirationCount === 0
      ? "no_data"
      : warnings.some((warning) => warning.type === "writer_failed" || warning.type === "no_packets")
        ? "writer_failed"
        : warnings.some((warning) => warning.type === "stale")
          ? "stale"
          : warnings.some((warning) => warning.type === "sparse")
            ? "sparse"
            : "healthy";

  return {
    inspirationCount,
    packetCount,
    nodeCount,
    edgeCount,
    evidenceCount,
    inspirationsWithoutPackets,
    nodesWithoutEvidence,
    edgeDensity,
    status,
    warnings,
  };
}

export function createAdminMeaningGraphRoutes(
  deps: AdminMeaningGraphRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;

  routes.use("*", deps.adminGate ?? requireAdminMeaningGraphEnabled);
  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", deps.adminAuthorization ?? requireAdminUser);

  routes.post("/rebuild", async (c) => {
    const userId = c.get("user").id;
    try {
      const { job } = await enqueueMeaningGraphRebuild(userId);
      return c.json(
        {
          job: serializeBackgroundJob(job),
          statusUrl: `/api/admin/meaning-graph/rebuild/${job.id}`,
        },
        202,
      );
    } catch (err) {
      if (isMissingMeaningGraphRebuildJobType(err)) {
        return missingMeaningGraphRebuildJobTypeResponse(c);
      }
      throw err;
    }
  });

  routes.get("/rebuild", async (c) => {
    const userId = c.get("user").id;
    try {
      const job = await getLatestMeaningGraphRebuildJob(userId);
      if (job?.status === "pending" || job?.status === "running") {
        scheduleBackgroundJobDrain();
      }
      return c.json({ job: job ? serializeBackgroundJob(job) : null });
    } catch (err) {
      if (isMissingMeaningGraphRebuildJobType(err)) {
        return missingMeaningGraphRebuildJobTypeResponse(c);
      }
      throw err;
    }
  });

  routes.get("/rebuild/:jobId", async (c) => {
    const userId = c.get("user").id;
    try {
      const job = await getMeaningGraphRebuildJob(userId, c.req.param("jobId"));
      if (!job) {
        return c.json({ error: "Meaning graph rebuild job not found" }, 404);
      }
      if (job.status === "pending" || job.status === "running") {
        scheduleBackgroundJobDrain();
      }
      return c.json({ job: serializeBackgroundJob(job) });
    } catch (err) {
      if (isMissingMeaningGraphRebuildJobType(err)) {
        return missingMeaningGraphRebuildJobTypeResponse(c);
      }
      throw err;
    }
  });

  routes.get("/", async (c) => {
    const userId = c.get("user").id;
    const limit = parseLimit(c.req.query("limit"));
    const db = getDatabase();

    const nodeRows = await db
      .select()
      .from(meaningNodes)
      .where(eq(meaningNodes.userId, userId))
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
    const evidenceByInspirationId = new Map<string, typeof evidenceRows>();
    const evidenceByInspirationAndNodeId = new Map<string, (typeof evidenceRows)[number]>();
    for (const row of evidenceRows) {
      const rows = evidenceByNodeId.get(row.meaningNodeId) ?? [];
      rows.push(row);
      evidenceByNodeId.set(row.meaningNodeId, rows);

      const inspirationRows = evidenceByInspirationId.get(row.inspirationId) ?? [];
      inspirationRows.push(row);
      evidenceByInspirationId.set(row.inspirationId, inspirationRows);

      const evidenceKey = `${row.inspirationId}|${row.meaningNodeId}`;
      const existingEvidence = evidenceByInspirationAndNodeId.get(evidenceKey);
      if (!existingEvidence || row.weight > existingEvidence.weight) {
        evidenceByInspirationAndNodeId.set(evidenceKey, row);
      }
    }

    const recentInspirationRows = await db
      .select({
        id: inspirations.id,
        text: inspirations.text,
        cluster: inspirations.cluster,
        createdAt: inspirations.createdAt,
        packetId: meaningPackets.id,
        packetCreatedAt: meaningPackets.createdAt,
      })
      .from(inspirations)
      .leftJoin(
        meaningPackets,
        and(
          eq(meaningPackets.userId, inspirations.userId),
          eq(meaningPackets.inspirationId, inspirations.id),
        ),
      )
      .where(eq(inspirations.userId, userId))
      .orderBy(desc(inspirations.createdAt))
      .limit(18);

    const nodeById = new Map(nodeRows.map((node) => [node.id, node] as const));
    const contextNoteKeys = nodeIds.map((nodeId) => contextNoteKey(userId, nodeId));
    const relatedTopOfMindRows =
      contextNoteKeys.length === 0
        ? []
        : await db
            .select({
              id: wowMoments.id,
              userId: wowMoments.userId,
              title: wowMoments.title,
              kind: wowMoments.kind,
              why: wowMoments.why,
              beliefStatement: wowMoments.beliefStatement,
              reflectionQuestion: wowMoments.reflectionQuestion,
              reflectionGuide: wowMoments.reflectionGuide,
              idempotencyKey: wowMoments.idempotencyKey,
              wowScore: wowMoments.wowScore,
              createdAt: wowMoments.createdAt,
              updatedAt: wowMoments.updatedAt,
            })
            .from(wowMoments)
            .where(
              and(
                eq(wowMoments.userId, userId),
                inArray(wowMoments.idempotencyKey, contextNoteKeys),
              ),
            )
            .orderBy(desc(wowMoments.wowScore), desc(wowMoments.createdAt));

    const topOfMindByNodeId = new Map<string, typeof relatedTopOfMindRows>();
    for (const note of relatedTopOfMindRows) {
      const nodeId = nodeIdFromContextNoteKey(userId, note.idempotencyKey);
      if (!nodeId) continue;
      const rows = topOfMindByNodeId.get(nodeId) ?? [];
      rows.push(note);
      topOfMindByNodeId.set(nodeId, rows);
    }

    const topOfMindIds = relatedTopOfMindRows.map((note) => note.id);
    const feedbackTargetIds = [...nodeIds, ...topOfMindIds];
    const feedbackRows =
      feedbackTargetIds.length === 0
        ? []
        : await db
            .select({
              id: feedback.id,
              targetId: feedback.targetId,
              targetType: feedback.targetType,
              value: feedback.value,
              emotionLabel: feedback.emotionLabel,
              correctionText: feedback.correctionText,
              source: feedback.source,
              createdAt: feedback.createdAt,
            })
            .from(feedback)
            .where(
              and(
                eq(feedback.userId, userId),
                inArray(feedback.targetType, ["context_node", "hypothesis", "top_of_mind_note"]),
                inArray(feedback.targetId, feedbackTargetIds),
              ),
            )
            .orderBy(desc(feedback.createdAt))
            .limit(limit * 3);

    const feedbackByNodeId = new Map<string, typeof feedbackRows>();
    const feedbackByTopOfMindId = new Map<string, typeof feedbackRows>();
    for (const row of feedbackRows) {
      if (row.targetType === "top_of_mind_note") {
        const rows = feedbackByTopOfMindId.get(row.targetId) ?? [];
        rows.push(row);
        feedbackByTopOfMindId.set(row.targetId, rows);
      } else {
        const rows = feedbackByNodeId.get(row.targetId) ?? [];
        rows.push(row);
        feedbackByNodeId.set(row.targetId, rows);
      }
    }

    return c.json({
      graph: {
        nodes: nodeRows.map((node) => {
          const contextType = normalizeContextNodeType(node.type);
          const nodeEvidence = evidenceByNodeId.get(node.id) ?? [];
          const relatedNotes = topOfMindByNodeId.get(node.id) ?? [];
          const nodeFeedback = feedbackByNodeId.get(node.id) ?? [];
          const memory = deriveMemoryPattern({
            node,
            evidence: nodeEvidence.map((row) => ({
              meaningNodeId: row.meaningNodeId,
              inspirationId: row.inspirationId,
              createdAt: row.createdAt,
              weight: row.weight,
            })),
            contradicted: nodeFeedback.some((item) => item.value === "not_true" || item.value === "not_important"),
            needsTesting: nodeFeedback.some((item) => item.value === "partly" && Boolean(item.correctionText?.trim())),
          });
          return {
            id: node.id,
            type: node.type,
            contextType,
            ambitionDimension: ambitionDimensionForContextType(contextType),
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
            memory: {
              state: memory.state,
              firstSeenAt: memory.firstSeenAt.toISOString(),
              lastSeenAt: memory.lastSeenAt.toISOString(),
              reinforcementCount: memory.reinforcementCount,
              recentReinforcementCount: memory.recentReinforcementCount,
              currentWeight: memory.currentWeight,
              confidence: memory.confidence,
              decay: memory.decay,
              supportingSignalIds: memory.supportingSignalIds,
              movementScore: Math.round(memory.movementScore),
            },
            qualityIndicators: qualityIndicatorsForContextNode({
              label: node.label,
              evidenceCount: node.evidenceCount,
              relatedTopOfMindCount: relatedNotes.length,
              feedbackCount: nodeFeedback.length,
              memoryState: memory.state,
            }),
            relatedTopOfMindNotes: relatedNotes.slice(0, 4).map((note) => {
              const topOfMindNote = topOfMindNoteFromWowMoment({
                moment: note,
                relatedSignalIds: nodeEvidence.map((row) => row.inspirationId),
                relatedContextNodeIds: [node.id],
              });
              const noteFeedback = feedbackByTopOfMindId.get(note.id) ?? [];
              const qualityIndicators = qualityIndicatorsForTopOfMindNote({
                title: topOfMindNote.title,
                ambientSignal: topOfMindNote.ambientSignal,
                evidenceCount: topOfMindNote.relatedSignalIds.length,
                relatedContextNodeLabels: [node.label],
                rejectedAlternativeInterpretation: topOfMindNote.rejectedAlternativeInterpretation,
              });
              return {
                id: note.id,
                title: topOfMindNote.title,
                why: truncatePreview(topOfMindNote.body, 220),
                score: note.wowScore,
                ambitionDimension: topOfMindNote.ambitionDimension,
                ambientSignal: topOfMindNote.ambientSignal,
                matchedEnvironment: topOfMindNote.matchedEnvironment,
                antiEnvironment: topOfMindNote.antiEnvironment,
                evidenceRationale: topOfMindNote.evidenceRationale,
                rejectedAlternativeInterpretation: topOfMindNote.rejectedAlternativeInterpretation,
                whyNow:
                  memory.state === "reactivated"
                    ? "This post-it exists now because an older pattern came back through recent evidence."
                    : memory.state === "contradicted"
                      ? "This post-it exists now because the pattern is being contradicted and needs inspection."
                      : memory.state === "fading" || memory.state === "dormant"
                        ? "This post-it is attached to a fading pattern; check whether it should remain active."
                        : "This post-it is attached to a current memory pattern with supporting evidence.",
                changedRecently:
                  memory.recentReinforcementCount > 0
                    ? `${memory.recentReinforcementCount} recent supporting signal${
                        memory.recentReinforcementCount === 1 ? "" : "s"
                      } reinforced this pattern.`
                    : `No supporting signal has reinforced this pattern recently; decay is ${memory.decay}.`,
                feedback: noteFeedback.slice(0, 5).map((item) => ({
                  id: item.id,
                  targetType: item.targetType,
                  value: item.value,
                  emotionLabel: item.emotionLabel,
                  correctionText: item.correctionText,
                  source: item.source,
                  createdAt: item.createdAt.toISOString(),
                })),
                qualityIndicators,
                createdAt: note.createdAt.toISOString(),
              };
            }),
            feedback: nodeFeedback.slice(0, 5).map((item) => ({
              id: item.id,
              targetType: item.targetType,
              value: item.value,
              emotionLabel: item.emotionLabel,
              correctionText: item.correctionText,
              source: item.source,
              createdAt: item.createdAt.toISOString(),
            })),
            evidence: nodeEvidence.slice(0, 8).map((evidence) => ({
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
          };
        }),
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
        recentInspirations: recentInspirationRows.map((inspiration) => {
          const evidence = evidenceByInspirationId.get(inspiration.id) ?? [];
          return {
            id: inspiration.id,
            preview: truncatePreview(inspiration.text, 220),
            cluster: inspiration.cluster,
            createdAt: inspiration.createdAt.toISOString(),
            packetCreatedAt: inspiration.packetCreatedAt?.toISOString() ?? null,
            meaningNotes: evidence.slice(0, 6).map((row) => {
              const node = nodeById.get(row.meaningNodeId);
              return {
                id: row.meaningNodeId,
                label: node?.label ?? "Unknown meaning note",
                type: node?.type ?? "unknown",
                contextType: normalizeContextNodeType(node?.type ?? ""),
                reason: row.reason,
              };
            }),
            relationshipEdges: edgeRows
              .filter((edge) => edge.evidenceInspirationIds.includes(inspiration.id))
              .slice(0, 6)
              .map((edge) => {
                const sourceEvidence = evidenceByInspirationAndNodeId.get(
                  `${inspiration.id}|${edge.sourceNodeId}`,
                );
                const targetEvidence = evidenceByInspirationAndNodeId.get(
                  `${inspiration.id}|${edge.targetNodeId}`,
                );
                return {
                  id: edge.id,
                  kind: edge.kind,
                  sourceNodeId: edge.sourceNodeId,
                  sourceLabel: nodeById.get(edge.sourceNodeId)?.label ?? "Unknown source",
                  sourceReason: sourceEvidence?.reason ?? "",
                  targetNodeId: edge.targetNodeId,
                  targetLabel: nodeById.get(edge.targetNodeId)?.label ?? "Unknown target",
                  targetReason: targetEvidence?.reason ?? "",
                };
              }),
          };
        }),
        meta: {
          nodeCount: nodeRows.length,
          edgeCount: edgeRows.length,
          evidenceCount: evidenceRows.length,
          limit,
          health: await getMeaningGraphHealth(db, userId),
        },
      },
    });
  });

  return routes;
}

export const adminMeaningGraphRoutes = createAdminMeaningGraphRoutes();
