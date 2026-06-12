/**
 * Vault document serialization — DB rows in, YAML documents out.
 *
 * Document schemas:
 *   - waka/signal@v1              : captured signal text + sparks + packet +
 *                                   reflections + attachment references
 *   - waka/top-of-mind-note@v1    : a judged top-of-mind note with evidence
 *   - waka/context-node@v1        : a durable graph claim and its evidence
 *   - waka/context-edge@v1        : a durable graph relationship
 *
 * Design rules (docs/vault-architecture.md):
 *   - Machine-derived values NEVER enter files: no scores, no cluster, no
 *     embeddings. The judge's idempotency key is provenance, not a signal,
 *     so it rides along on top-of-mind note documents.
 *   - Output is deterministic for identical input rows: key order is fixed
 *     by construction, null/undefined/empty values are pruned, timestamps
 *     are ISO-8601 UTC strings. Determinism is what makes contentHash a
 *     meaningful drift detector.
 */

import { stringify } from "yaml";

import type {
  Attachment,
  ContextEdge,
  ContextEvidence,
  ContextNode,
  Reflection,
  Signal,
  SignalPacket,
  SignalSpark,
  TopOfMindNote,
  TopOfMindNoteSignal,
} from "../db/index.js";

export const SIGNAL_SCHEMA = "waka/signal@v1";
export const TOP_OF_MIND_NOTE_SCHEMA = "waka/top-of-mind-note@v1";
export const CONTEXT_NODE_SCHEMA = "waka/context-node@v1";
export const CONTEXT_EDGE_SCHEMA = "waka/context-edge@v1";

// Compatibility exports for code that has not completed the vocabulary cutover.
export const INSPIRATION_SCHEMA = SIGNAL_SCHEMA;
export const WOW_MOMENT_SCHEMA = TOP_OF_MIND_NOTE_SCHEMA;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function monthPartition(createdAt: Date): string {
  const year = createdAt.getUTCFullYear().toString().padStart(4, "0");
  const month = (createdAt.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${year}/${month}`;
}

/** `{userId}/signals/YYYY/MM/{id}.yaml` (UTC month of created_at). */
export function signalVaultPath(
  userId: string,
  id: string,
  createdAt: Date,
): string {
  return `${userId}/signals/${monthPartition(createdAt)}/${id}.yaml`;
}

/** `{userId}/top-of-mind/YYYY/MM/{id}.yaml` (UTC month of created_at). */
export function topOfMindNoteVaultPath(
  userId: string,
  id: string,
  createdAt: Date,
): string {
  return `${userId}/top-of-mind/${monthPartition(createdAt)}/${id}.yaml`;
}

export function inspirationVaultPath(
  userId: string,
  id: string,
  createdAt: Date,
): string {
  return signalVaultPath(userId, id, createdAt);
}

export function wowMomentVaultPath(
  userId: string,
  id: string,
  createdAt: Date,
): string {
  return topOfMindNoteVaultPath(userId, id, createdAt);
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

function truncateSlug(slug: string, maxLength: number): string {
  if (slug.length <= maxLength) return slug;
  return slug.slice(0, maxLength).replace(/-+$/g, "") || "untitled";
}

export function contextNodeSlug(node: Pick<ContextNode, "type" | "label" | "id">): string {
  return `${slugify(node.type)}--${truncateSlug(slugify(node.label), 64)}--${node.id}`;
}

function contextEdgeNodeSlug(node: Pick<ContextNode, "type" | "label" | "id">): string {
  return `${slugify(node.type)}--${truncateSlug(slugify(node.label), 24)}--${node.id}`;
}

export function contextNodeVaultPath(node: Pick<ContextNode, "userId" | "type" | "label" | "id">): string {
  return `${node.userId}/context/nodes/${contextNodeSlug(node)}.yaml`;
}

export function contextEdgeVaultPath(input: {
  edge: Pick<ContextEdge, "userId" | "kind" | "id">;
  sourceNode: Pick<ContextNode, "type" | "label" | "id">;
  targetNode: Pick<ContextNode, "type" | "label" | "id">;
}): string {
  const sourceSlug = contextEdgeNodeSlug(input.sourceNode);
  const targetSlug = contextEdgeNodeSlug(input.targetNode);
  return `${input.edge.userId}/context/edges/${sourceSlug}--${slugify(input.edge.kind)}--${targetSlug}--${input.edge.id}.yaml`;
}

// ---------------------------------------------------------------------------
// Document construction
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>;

/**
 * Drop keys whose value is null, undefined, an empty string, or an empty
 * array. Empty collections carry no meaning in a document and pruning them
 * keeps files readable and hashes stable across "absent" vs "empty" rows.
 */
function prune(entries: Record<string, unknown>): Doc {
  const out: Doc = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value === null || value === undefined) continue;
    if (value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

export interface SignalExport {
  signal: Signal;
  sparks: SignalSpark[];
  packet: SignalPacket | null;
  reflections: Reflection[];
  attachments: Attachment[];
}

export type InspirationExport = SignalExport;

export function buildSignalDoc(input: SignalExport): Doc {
  const { signal, sparks, packet, reflections, attachments } = input;
  return prune({
    schema: SIGNAL_SCHEMA,
    id: signal.id,
    rev: 1,
    created_at: signal.createdAt.toISOString(),
    text: signal.text,
    kind: signal.kind,
    category: signal.category,
    sparks: sparks.map((spark) =>
      prune({
        text: spark.text,
        source: spark.source,
        start_offset: spark.startOffset,
        end_offset: spark.endOffset,
        is_primary: spark.isPrimary || undefined,
        note: spark.note,
        what_moved_me: spark.whatMovedUser,
        implied_values: spark.impliedValues,
        worldview_claims: spark.worldviewClaims,
        tensions: spark.tensions,
        decision_relevance: spark.decisionRelevance,
        emotional_charge: spark.emotionalCharge,
      }),
    ),
    signal_packet: packet
      ? prune({
          spark_text: packet.sparkText,
          artifact_excerpt: packet.artifactExcerpt,
          packet_text: packet.packetText,
          source_metadata: packet.sourceMetadata,
        })
      : undefined,
    reflections: reflections.map((reflection) =>
      prune({
        question: reflection.question,
        answer: reflection.answer,
        skipped: reflection.skipped || undefined,
      }),
    ),
    attachments: attachments.map((attachment) =>
      prune({
        type: attachment.type,
        url: attachment.url,
        name: attachment.name,
        s3_key: attachment.s3Key,
        content_type: attachment.contentType,
        size: attachment.size,
      }),
    ),
  });
}

export function buildInspirationDoc(input: InspirationExport): Doc {
  return buildSignalDoc(input);
}

export interface TopOfMindNoteExport {
  note: TopOfMindNote;
  links: TopOfMindNoteSignal[];
}

export type WowMomentExport = TopOfMindNoteExport;

export function buildTopOfMindNoteDoc(input: TopOfMindNoteExport): Doc {
  const { note, links } = input;
  const ordered = [...links].sort((a, b) => a.sortOrder - b.sortOrder);
  return prune({
    schema: TOP_OF_MIND_NOTE_SCHEMA,
    id: note.id,
    rev: 1,
    created_at: note.createdAt.toISOString(),
    title: note.title,
    kind: note.kind,
    why: note.why,
    belief_statement: note.beliefStatement,
    reflection_question: note.reflectionQuestion,
    reflection_guide: note.reflectionGuide,
    locale: note.locale,
    related: ordered.map((link) =>
      prune({
        id: link.inspirationId,
        role: link.role,
        reason: link.reason,
      }),
    ),
    judge: prune({
      idempotency_key: note.idempotencyKey,
    }),
  });
}

export function buildWowMomentDoc(input: WowMomentExport): Doc {
  return buildTopOfMindNoteDoc(input);
}

export interface ContextNodeExport {
  node: ContextNode;
  evidence: ContextEvidence[];
}

export function buildContextNodeDoc(input: ContextNodeExport): Doc {
  const { node, evidence } = input;
  return prune({
    schema: CONTEXT_NODE_SCHEMA,
    id: node.id,
    rev: 1,
    type: node.type,
    label: node.label,
    description: node.description,
    status: node.status,
    first_seen_at: node.firstSeenAt.toISOString(),
    evidence: evidence.map((row) =>
      prune({
        signal: row.inspirationId,
        reason: row.reason,
      }),
    ),
  });
}

export interface ContextEdgeExport {
  edge: ContextEdge;
  sourceNode: ContextNode;
  targetNode: ContextNode;
}

export function buildContextEdgeDoc(input: ContextEdgeExport): Doc {
  const { edge, sourceNode, targetNode } = input;
  const sourceSlug = contextEdgeNodeSlug(sourceNode);
  const targetSlug = contextEdgeNodeSlug(targetNode);
  return prune({
    schema: CONTEXT_EDGE_SCHEMA,
    id: edge.id,
    rev: 1,
    kind: edge.kind,
    status: edge.status,
    source: {
      id: sourceNode.id,
      node: sourceSlug,
    },
    target: {
      id: targetNode.id,
      node: targetSlug,
    },
    evidence_signals: edge.evidenceInspirationIds,
  });
}

/**
 * Serialize a document to YAML. `lineWidth: 0` disables wrapping so long
 * signal text never gets reflowed (reflow would make hashes depend on
 * the serializer's wrap heuristics rather than on content).
 */
export function toYaml(doc: Doc): string {
  return stringify(doc, { lineWidth: 0 });
}
