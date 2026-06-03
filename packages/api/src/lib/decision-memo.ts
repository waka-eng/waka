import { and, desc, eq, inArray } from "drizzle-orm";

import {
  inspirations,
  meaningEvidence,
  meaningNodes,
  meaningPackets,
} from "../db/index.js";
import { getDb } from "./db.js";
import type { TopOfMindNoteSurface } from "../routes/top-of-mind.js";
import { listTopOfMindNotesForUser } from "../routes/top-of-mind.js";
import { normalizeContextNodeType, type ContextNodeType } from "./context-node-types.js";

const MAX_CONTEXT_NODES = 40;
const MAX_EVIDENCE_ROWS = 120;
const MAX_TOP_OF_MIND_NOTES = 6;
const MAX_TEXT_PREVIEW_CHARS = 180;
const MAX_DRAWN_TO_NODES = 4;
const MAX_EVIDENCE_ITEMS = 5;
const MAX_TENSIONS = 3;

type WakaDb = ReturnType<typeof getDb>;

export interface DecisionMemoContextNodeInput {
  id: string;
  type: string;
  label: string;
  description: string;
  weight: number;
  confidence: number;
  evidenceCount: number;
  lastReinforcedAt: Date;
}

export interface DecisionMemoEvidenceInput {
  contextNodeId: string;
  signalId: string;
  reason: string;
  weight: number;
  confidence: number;
  createdAt: Date;
  signalText: string;
  signalKind: string | null;
  resonanceScore: number;
  packetText: string | null;
}

export interface DecisionMemoTopOfMindInput {
  id: string;
  title: string;
  body: string;
  type: string;
  confidence: number;
  status: string;
  relatedContextNodeIds: string[];
  relatedSignalIds: string[];
}

export interface WhatToBuildDecisionMemo {
  generatedAt: string;
  title: "What to build next";
  drawnTo: {
    summary: string;
    contextNodes: Array<{
      id: string;
      type: ContextNodeType;
      label: string;
      description: string;
      confidence: number;
      evidenceCount: number;
    }>;
  };
  strongestEvidence: Array<{
    signalId: string;
    contextNodeId: string;
    contextNodeLabel: string;
    reason: string;
    textPreview: string;
    kind: string | null;
    resonanceScore: number;
    createdAt: string;
  }>;
  tensions: Array<{
    contextNodeId: string;
    label: string;
    description: string;
    evidenceCount: number;
    confidence: number;
  }>;
  topOfMindNotes: Array<{
    id: string;
    title: string;
    type: string;
    confidence: number;
    status: string;
  }>;
  nextAction: string;
  isScaffold: true;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function nodeScore(node: DecisionMemoContextNodeInput): number {
  const type = normalizeContextNodeType(node.type);
  const typeBoost =
    type === "project"
      ? 80
      : type === "open_question"
        ? 70
        : type === "tension"
          ? 62
          : type === "hypothesis"
            ? 54
            : type === "value"
              ? 44
              : 30;
  return node.evidenceCount * 100 + node.weight + node.confidence * 0.75 + typeBoost;
}

function evidenceScore(row: DecisionMemoEvidenceInput): number {
  return row.weight * 2 + row.confidence + row.resonanceScore;
}

function buildDrawnToSummary(nodes: DecisionMemoContextNodeInput[]): string {
  const [first, second] = nodes;
  if (!first) {
    return "Not enough context graph evidence yet. Capture a few more high-resonance signals before trusting a build direction.";
  }
  if (!second) {
    return `You seem most drawn to ${first.label}.`;
  }
  return `You seem drawn to ${first.label}, with ${second.label} close behind.`;
}

function buildNextAction(input: {
  drawnToNodes: DecisionMemoContextNodeInput[];
  tensions: DecisionMemoContextNodeInput[];
  topOfMindNotes: DecisionMemoTopOfMindInput[];
}): string {
  const project = input.drawnToNodes.find(
    (node) => normalizeContextNodeType(node.type) === "project",
  );
  const unresolved = input.tensions[0];
  const note = input.topOfMindNotes.find((candidate) => candidate.status === "active");

  if (project && unresolved) {
    return `Prototype one small version of ${project.label} that directly tests the tension around ${unresolved.label}.`;
  }
  if (project) {
    return `Prototype the smallest useful version of ${project.label} and capture what feels energizing or false afterward.`;
  }
  if (unresolved) {
    return `Run one small test that makes the tension around ${unresolved.label} easier to confirm or correct.`;
  }
  if (note) {
    return `Use the current top-of-mind note "${note.title}" as a one-week build prompt, then mark what was true or not true.`;
  }
  return "Capture three concrete signals from what you keep wanting to make, then regenerate this memo.";
}

export function assembleWhatToBuildDecisionMemo(input: {
  contextNodes: DecisionMemoContextNodeInput[];
  evidence: DecisionMemoEvidenceInput[];
  topOfMindNotes: DecisionMemoTopOfMindInput[];
  now?: Date;
}): WhatToBuildDecisionMemo {
  const activeNodes = input.contextNodes
    .slice()
    .sort(
      (a, b) =>
        nodeScore(b) - nodeScore(a) ||
        b.lastReinforcedAt.getTime() - a.lastReinforcedAt.getTime(),
    );
  const drawnToNodes = activeNodes.slice(0, MAX_DRAWN_TO_NODES);
  const nodeById = new Map(input.contextNodes.map((node) => [node.id, node]));
  const evidence = input.evidence
    .filter((row) => nodeById.has(row.contextNodeId))
    .slice()
    .sort(
      (a, b) =>
        evidenceScore(b) - evidenceScore(a) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .slice(0, MAX_EVIDENCE_ITEMS);
  const tensions = activeNodes
    .filter((node) => {
      const type = normalizeContextNodeType(node.type);
      return type === "tension" || type === "open_question" || type === "hypothesis";
    })
    .slice(0, MAX_TENSIONS);
  const topOfMindNotes = input.topOfMindNotes
    .filter((note) => note.status === "active")
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_TOP_OF_MIND_NOTES);

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    title: "What to build next",
    drawnTo: {
      summary: buildDrawnToSummary(drawnToNodes),
      contextNodes: drawnToNodes.map((node) => ({
        id: node.id,
        type: normalizeContextNodeType(node.type),
        label: node.label,
        description: node.description,
        confidence: node.confidence,
        evidenceCount: node.evidenceCount,
      })),
    },
    strongestEvidence: evidence.map((row) => {
      const node = nodeById.get(row.contextNodeId);
      return {
        signalId: row.signalId,
        contextNodeId: row.contextNodeId,
        contextNodeLabel: node?.label ?? "Context claim",
        reason: row.reason,
        textPreview: truncateText(row.packetText || row.signalText, MAX_TEXT_PREVIEW_CHARS),
        kind: row.signalKind,
        resonanceScore: row.resonanceScore,
        createdAt: row.createdAt.toISOString(),
      };
    }),
    tensions: tensions.map((node) => ({
      contextNodeId: node.id,
      label: node.label,
      description: node.description,
      evidenceCount: node.evidenceCount,
      confidence: node.confidence,
    })),
    topOfMindNotes: topOfMindNotes.map((note) => ({
      id: note.id,
      title: note.title,
      type: note.type,
      confidence: note.confidence,
      status: note.status,
    })),
    nextAction: buildNextAction({ drawnToNodes, tensions, topOfMindNotes }),
    isScaffold: true,
  };
}

function topOfMindInputFromSurface(
  note: TopOfMindNoteSurface,
): DecisionMemoTopOfMindInput {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    type: note.type,
    confidence: note.confidence,
    status: note.status,
    relatedContextNodeIds: note.relatedContextNodeIds,
    relatedSignalIds: note.relatedSignalIds,
  };
}

export async function buildWhatToBuildDecisionMemoForUser(
  db: WakaDb,
  input: { userId: string; now?: Date },
): Promise<WhatToBuildDecisionMemo> {
  const contextNodes = await db
    .select({
      id: meaningNodes.id,
      type: meaningNodes.type,
      label: meaningNodes.label,
      description: meaningNodes.description,
      weight: meaningNodes.weight,
      confidence: meaningNodes.confidence,
      evidenceCount: meaningNodes.evidenceCount,
      lastReinforcedAt: meaningNodes.lastReinforcedAt,
    })
    .from(meaningNodes)
    .where(and(eq(meaningNodes.userId, input.userId), eq(meaningNodes.status, "active")))
    .orderBy(desc(meaningNodes.evidenceCount), desc(meaningNodes.weight))
    .limit(MAX_CONTEXT_NODES);

  const contextNodeIds = contextNodes.map((node) => node.id);
  const [evidence, topOfMindNotes] = await Promise.all([
    contextNodeIds.length === 0
      ? []
      : db
          .select({
            contextNodeId: meaningEvidence.meaningNodeId,
            signalId: meaningEvidence.inspirationId,
            reason: meaningEvidence.reason,
            weight: meaningEvidence.weight,
            confidence: meaningEvidence.confidence,
            createdAt: meaningEvidence.createdAt,
            signalText: inspirations.text,
            signalKind: inspirations.kind,
            resonanceScore: inspirations.wowScore,
            packetText: meaningPackets.packetText,
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
          .where(
            and(
              eq(meaningEvidence.userId, input.userId),
              inArray(meaningEvidence.meaningNodeId, contextNodeIds),
            ),
          )
          .orderBy(desc(meaningEvidence.weight), desc(meaningEvidence.createdAt))
          .limit(MAX_EVIDENCE_ROWS),
    listTopOfMindNotesForUser(db, {
      userId: input.userId,
      limit: MAX_TOP_OF_MIND_NOTES,
    }),
  ]);

  return assembleWhatToBuildDecisionMemo({
    contextNodes,
    evidence,
    topOfMindNotes: topOfMindNotes.map(topOfMindInputFromSurface),
    now: input.now,
  });
}
