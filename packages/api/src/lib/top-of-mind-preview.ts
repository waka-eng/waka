import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  inspirations,
  meaningEdges,
  meaningEvidence,
  meaningNodes,
  meaningPackets,
} from "../db/index.js";
import { getDb } from "./db.js";

const MAX_PREVIEW_LENGTH = 180;
const TOP_NODE_LIMIT = 6;
const TOP_EDGE_LIMIT = 3;
const SUPPORTING_INSPIRATION_LIMIT = 2;

export interface TopOfMindNodeInput {
  id: string;
  type: string;
  label: string;
  description: string;
  weight: number;
  evidenceCount: number;
  lastReinforcedAt: Date;
}

export interface TopOfMindEdgeInput {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: string;
  weight: number;
  evidenceCount: number;
  lastReinforcedAt: Date;
}

export interface TopOfMindEvidenceInput {
  meaningNodeId: string;
  inspirationId: string;
  reason: string;
  weight: number;
  createdAt: Date;
  inspirationText: string;
  inspirationCreatedAt: Date;
  sparkText: string;
}

export interface TopOfMindPreviewInput {
  generatedAt?: Date;
  inspirationCount: number;
  meaningNoteCount: number;
  relationshipEdgeCount: number;
  nodes: TopOfMindNodeInput[];
  edges: TopOfMindEdgeInput[];
  evidence: TopOfMindEvidenceInput[];
}

export interface TopOfMindSupportingInspiration {
  id: string;
  preview: string;
  reason: string;
  createdAt: string;
}

export interface TopOfMindSignal {
  nodeId: string;
  label: string;
  type: string;
  reason: string;
  evidenceCount: number;
  lastReinforcedAt: string;
  supportingInspirations: TopOfMindSupportingInspiration[];
}

export interface TopOfMindRelationshipSignal {
  edgeId: string;
  kind: string;
  sourceNodeId: string;
  sourceLabel: string;
  targetNodeId: string;
  targetLabel: string;
  reason: string;
  evidenceCount: number;
  lastReinforcedAt: string;
}

export interface TopOfMindPreview {
  generatedAt: string;
  headline: string;
  activeThemes: TopOfMindSignal[];
  activeQuestions: TopOfMindSignal[];
  relationshipSignals: TopOfMindRelationshipSignal[];
  summary: {
    inspirationCount: number;
    meaningNoteCount: number;
    relationshipEdgeCount: number;
  };
}

function truncatePreview(value: string, maxLength = MAX_PREVIEW_LENGTH): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function typePriority(type: string): number {
  switch (type) {
    case "question":
      return 80;
    case "life_direction":
      return 70;
    case "tension":
      return 62;
    case "desire":
      return 56;
    case "value":
      return 50;
    case "environment":
      return 38;
    case "person_archetype":
      return 32;
    default:
      return 18;
  }
}

function isQuestionLike(type: string): boolean {
  return type === "question" || type === "tension" || type === "life_direction";
}

function recencyBoost(date: Date, now: Date): number {
  const ageMs = Math.max(0, now.getTime() - date.getTime());
  const ageDays = ageMs / 86_400_000;
  if (ageDays <= 3) return 44;
  if (ageDays <= 14) return 30;
  if (ageDays <= 45) return 16;
  return 0;
}

function nodeScore(node: TopOfMindNodeInput, now: Date): number {
  return (
    node.evidenceCount * 120 +
    node.weight +
    typePriority(node.type) +
    recencyBoost(node.lastReinforcedAt, now)
  );
}

function edgeScore(
  edge: TopOfMindEdgeInput,
  nodeScores: Map<string, number>,
  now: Date,
): number {
  return (
    edge.evidenceCount * 110 +
    edge.weight +
    recencyBoost(edge.lastReinforcedAt, now) +
    (nodeScores.get(edge.sourceNodeId) ?? 0) * 0.08 +
    (nodeScores.get(edge.targetNodeId) ?? 0) * 0.08
  );
}

function signalReason(node: TopOfMindNodeInput): string {
  if (node.description.trim()) return node.description.trim();
  return `${node.evidenceCount} inspiration${node.evidenceCount === 1 ? "" : "s"} currently reinforce this meaning note.`;
}

function relationshipKindLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}

function buildSignal(
  node: TopOfMindNodeInput,
  evidenceByNodeId: Map<string, TopOfMindEvidenceInput[]>,
): TopOfMindSignal {
  const supportingInspirations = (evidenceByNodeId.get(node.id) ?? [])
    .slice()
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .slice(0, SUPPORTING_INSPIRATION_LIMIT)
    .map((evidence) => ({
      id: evidence.inspirationId,
      preview: truncatePreview(evidence.sparkText || evidence.inspirationText),
      reason: evidence.reason,
      createdAt: evidence.inspirationCreatedAt.toISOString(),
    }));

  return {
    nodeId: node.id,
    label: node.label,
    type: node.type,
    reason: signalReason(node),
    evidenceCount: node.evidenceCount,
    lastReinforcedAt: node.lastReinforcedAt.toISOString(),
    supportingInspirations,
  };
}

export function rankTopOfMindPreview(input: TopOfMindPreviewInput): TopOfMindPreview {
  const generatedAt = input.generatedAt ?? new Date();
  const evidenceByNodeId = new Map<string, TopOfMindEvidenceInput[]>();
  for (const row of input.evidence) {
    const rows = evidenceByNodeId.get(row.meaningNodeId) ?? [];
    rows.push(row);
    evidenceByNodeId.set(row.meaningNodeId, rows);
  }

  const nodeScores = new Map(
    input.nodes.map((node) => [node.id, nodeScore(node, generatedAt)] as const),
  );
  const rankedNodes = input.nodes
    .slice()
    .sort(
      (a, b) =>
        (nodeScores.get(b.id) ?? 0) - (nodeScores.get(a.id) ?? 0) ||
        b.evidenceCount - a.evidenceCount ||
        b.weight - a.weight,
    );

  const activeQuestions = rankedNodes
    .filter((node) => isQuestionLike(node.type))
    .slice(0, TOP_NODE_LIMIT)
    .map((node) => buildSignal(node, evidenceByNodeId));

  const questionNodeIds = new Set(activeQuestions.map((signal) => signal.nodeId));
  const activeThemes = rankedNodes
    .filter((node) => !questionNodeIds.has(node.id))
    .slice(0, TOP_NODE_LIMIT)
    .map((node) => buildSignal(node, evidenceByNodeId));

  const nodeById = new Map(input.nodes.map((node) => [node.id, node] as const));
  const relationshipSignals = input.edges
    .slice()
    .sort(
      (a, b) =>
        edgeScore(b, nodeScores, generatedAt) - edgeScore(a, nodeScores, generatedAt) ||
        b.evidenceCount - a.evidenceCount ||
        b.weight - a.weight,
    )
    .slice(0, TOP_EDGE_LIMIT)
    .map((edge) => {
      const source = nodeById.get(edge.sourceNodeId);
      const target = nodeById.get(edge.targetNodeId);
      const sourceLabel = source?.label ?? "Unknown meaning note";
      const targetLabel = target?.label ?? "Unknown meaning note";
      return {
        edgeId: edge.id,
        kind: edge.kind,
        sourceNodeId: edge.sourceNodeId,
        sourceLabel,
        targetNodeId: edge.targetNodeId,
        targetLabel,
        reason: `${sourceLabel} ${relationshipKindLabel(edge.kind)} ${targetLabel}`,
        evidenceCount: edge.evidenceCount,
        lastReinforcedAt: edge.lastReinforcedAt.toISOString(),
      };
    });

  const lead = activeQuestions[0] ?? activeThemes[0];
  const headline = lead
    ? `Top of mind: ${lead.label}`
    : input.inspirationCount > 0
      ? "Top of mind is not ready yet"
      : "No inspirations saved yet";

  return {
    generatedAt: generatedAt.toISOString(),
    headline,
    activeThemes,
    activeQuestions,
    relationshipSignals,
    summary: {
      inspirationCount: input.inspirationCount,
      meaningNoteCount: input.meaningNoteCount,
      relationshipEdgeCount: input.relationshipEdgeCount,
    },
  };
}

async function countRows<T>(query: Promise<T[]>, key: keyof T): Promise<number> {
  const [row] = await query;
  const value = row?.[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

export async function buildTopOfMindPreviewForUser(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<TopOfMindPreview> {
  const nodes = await db
    .select({
      id: meaningNodes.id,
      type: meaningNodes.type,
      label: meaningNodes.label,
      description: meaningNodes.description,
      weight: meaningNodes.weight,
      evidenceCount: meaningNodes.evidenceCount,
      lastReinforcedAt: meaningNodes.lastReinforcedAt,
    })
    .from(meaningNodes)
    .where(and(eq(meaningNodes.userId, userId), eq(meaningNodes.status, "active")))
    .orderBy(desc(meaningNodes.evidenceCount), desc(meaningNodes.weight))
    .limit(80);

  const nodeIds = nodes.map((node) => node.id);
  const [edges, evidence, inspirationCount, meaningNoteCount, relationshipEdgeCount] = await Promise.all([
    nodeIds.length === 0
      ? []
      : db
          .select({
            id: meaningEdges.id,
            sourceNodeId: meaningEdges.sourceNodeId,
            targetNodeId: meaningEdges.targetNodeId,
            kind: meaningEdges.kind,
            weight: meaningEdges.weight,
            evidenceCount: meaningEdges.evidenceCount,
            lastReinforcedAt: meaningEdges.lastReinforcedAt,
          })
          .from(meaningEdges)
          .where(
            and(
              eq(meaningEdges.userId, userId),
              eq(meaningEdges.status, "active"),
              inArray(meaningEdges.sourceNodeId, nodeIds),
              inArray(meaningEdges.targetNodeId, nodeIds),
            ),
          )
          .orderBy(desc(meaningEdges.evidenceCount), desc(meaningEdges.weight))
          .limit(40),
    nodeIds.length === 0
      ? []
      : db
          .select({
            meaningNodeId: meaningEvidence.meaningNodeId,
            inspirationId: meaningEvidence.inspirationId,
            reason: meaningEvidence.reason,
            weight: meaningEvidence.weight,
            createdAt: meaningEvidence.createdAt,
            inspirationText: inspirations.text,
            inspirationCreatedAt: inspirations.createdAt,
            sparkText: meaningPackets.sparkText,
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
          .limit(120),
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
  ]);

  return rankTopOfMindPreview({
    inspirationCount,
    meaningNoteCount,
    relationshipEdgeCount,
    nodes,
    edges,
    evidence,
  });
}
