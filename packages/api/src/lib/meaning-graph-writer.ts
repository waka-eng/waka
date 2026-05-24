/**
 * Persisted meaning graph writer.
 *
 * This is the first durable graph layer: packetized inspirations become
 * internal nodes, and accepted relationship proposals become idempotent edges.
 * It stays backend-only; user-facing synthesis and admin graph views can read
 * from these tables in later PRs.
 */

import { and, eq } from "drizzle-orm";

import {
  meaningGraphEdges,
  meaningGraphNodes,
  meaningPackets,
  type MeaningGraphEdge,
  type MeaningGraphNode,
} from "../db/index.js";
import { getDb } from "./db.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import {
  judgeMeaningRelationshipsForInspiration,
  type JudgeMeaningRelationshipsForInspirationParams,
  type JudgeMeaningRelationshipsForInspirationResult,
  type MeaningRelationshipProposal,
} from "./meaning-relationship-judge.js";

export interface PersistMeaningGraphForInspirationParams
  extends JudgeMeaningRelationshipsForInspirationParams {}

export interface PersistMeaningGraphForInspirationResult {
  judgmentResult: JudgeMeaningRelationshipsForInspirationResult;
  triggerNode: MeaningGraphNode | null;
  nodes: MeaningGraphNode[];
  edges: MeaningGraphEdge[];
}

async function loadPacket(
  db: WakaDb,
  userId: string,
  inspirationId: string,
) {
  const [packet] = await db
    .select()
    .from(meaningPackets)
    .where(
      and(
        eq(meaningPackets.userId, userId),
        eq(meaningPackets.inspirationId, inspirationId),
      ),
    )
    .limit(1);

  return packet ?? null;
}

async function upsertMeaningGraphNode(input: {
  db: WakaDb;
  userId: string;
  inspirationId: string;
}): Promise<MeaningGraphNode | null> {
  const packet = await loadPacket(input.db, input.userId, input.inspirationId);
  if (!packet) return null;

  const now = new Date();
  const [node] = await input.db
    .insert(meaningGraphNodes)
    .values({
      userId: input.userId,
      inspirationId: input.inspirationId,
      packetId: packet.id,
      status: "active",
      source: "meaning_graph_writer",
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [meaningGraphNodes.userId, meaningGraphNodes.inspirationId],
      set: {
        packetId: packet.id,
        status: "active",
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return node ?? null;
}

async function upsertMeaningGraphEdge(input: {
  db: WakaDb;
  userId: string;
  proposal: MeaningRelationshipProposal;
  fromNode: MeaningGraphNode;
  toNode: MeaningGraphNode;
}): Promise<MeaningGraphEdge> {
  const now = new Date();
  const [edge] = await input.db
    .insert(meaningGraphEdges)
    .values({
      userId: input.userId,
      fromNodeId: input.fromNode.id,
      toNodeId: input.toNode.id,
      fromInspirationId: input.proposal.fromInspirationId,
      toInspirationId: input.proposal.toInspirationId,
      kind: input.proposal.kind,
      confidence: input.proposal.confidence,
      reason: input.proposal.reason,
      evidence: input.proposal.evidence.map((item) => ({ ...item })),
      status: "active",
      source: "meaning_relationship_judge",
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        meaningGraphEdges.userId,
        meaningGraphEdges.fromInspirationId,
        meaningGraphEdges.toInspirationId,
        meaningGraphEdges.kind,
      ],
      set: {
        fromNodeId: input.fromNode.id,
        toNodeId: input.toNode.id,
        confidence: input.proposal.confidence,
        reason: input.proposal.reason,
        evidence: input.proposal.evidence.map((item) => ({ ...item })),
        status: "active",
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return edge!;
}

export async function persistMeaningGraphForInspiration(
  params: PersistMeaningGraphForInspirationParams,
): Promise<PersistMeaningGraphForInspirationResult> {
  const db = params.db ?? getDb();
  const judgmentResult = await judgeMeaningRelationshipsForInspiration({
    ...params,
    db,
  });

  const triggerNode = judgmentResult.candidateSet.trigger
    ? await upsertMeaningGraphNode({
        db,
        userId: params.userId,
        inspirationId: params.triggerInspirationId,
      })
    : null;

  const nodesByInspirationId = new Map<string, MeaningGraphNode>();
  if (triggerNode) nodesByInspirationId.set(params.triggerInspirationId, triggerNode);

  const edges: MeaningGraphEdge[] = [];
  for (const proposal of judgmentResult.proposals) {
    const fromNode =
      nodesByInspirationId.get(proposal.fromInspirationId) ??
      (await upsertMeaningGraphNode({
        db,
        userId: params.userId,
        inspirationId: proposal.fromInspirationId,
      }));
    const toNode =
      nodesByInspirationId.get(proposal.toInspirationId) ??
      (await upsertMeaningGraphNode({
        db,
        userId: params.userId,
        inspirationId: proposal.toInspirationId,
      }));

    if (!fromNode || !toNode) continue;
    nodesByInspirationId.set(proposal.fromInspirationId, fromNode);
    nodesByInspirationId.set(proposal.toInspirationId, toNode);
    edges.push(
      await upsertMeaningGraphEdge({
        db,
        userId: params.userId,
        proposal,
        fromNode,
        toNode,
      }),
    );
  }

  return {
    judgmentResult,
    triggerNode,
    nodes: [...nodesByInspirationId.values()],
    edges,
  };
}
