/**
 * Vault document serialization — DB rows in, OKF markdown documents out.
 *
 * Every document is an Open Knowledge Format (OKF v0.1) concept file:
 * a YAML frontmatter block (with the OKF-required `type` field) followed
 * by a markdown body that holds the document's human core — the signal
 * text, the note's "why" narrative, the node's description. See
 * docs/okf-vault-protocol.md for the full mapping.
 *
 * Document schemas:
 *   - waka/signal@v2              : captured signal; body = the signal text
 *   - waka/top-of-mind-note@v2    : a judged note; body = the why narrative
 *   - waka/context-node@v2        : a durable graph claim; body = description
 *   - waka/context-edge@v2        : a durable graph relationship; empty body
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

import { parse, stringify } from "yaml";

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

export const SIGNAL_SCHEMA = "waka/signal@v2";
export const TOP_OF_MIND_NOTE_SCHEMA = "waka/top-of-mind-note@v2";
export const CONTEXT_NODE_SCHEMA = "waka/context-node@v2";
export const CONTEXT_EDGE_SCHEMA = "waka/context-edge@v2";

/**
 * OKF `type` values — the one field OKF v0.1 requires of every concept
 * document. `schema` stays alongside as the versioned waka shape id.
 */
export const SIGNAL_TYPE = "signal";
export const TOP_OF_MIND_NOTE_TYPE = "top-of-mind-note";
export const CONTEXT_NODE_TYPE = "context-node";
export const CONTEXT_EDGE_TYPE = "context-edge";

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

/** `{userId}/signals/YYYY/MM/{id}.md` (UTC month of created_at). */
export function signalVaultPath(
  userId: string,
  id: string,
  createdAt: Date,
): string {
  return `${userId}/signals/${monthPartition(createdAt)}/${id}.md`;
}

/** `{userId}/top-of-mind/YYYY/MM/{id}.md` (UTC month of created_at). */
export function topOfMindNoteVaultPath(
  userId: string,
  id: string,
  createdAt: Date,
): string {
  return `${userId}/top-of-mind/${monthPartition(createdAt)}/${id}.md`;
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
  return `${node.userId}/context/nodes/${contextNodeSlug(node)}.md`;
}

export function contextEdgeVaultPath(input: {
  edge: Pick<ContextEdge, "userId" | "kind" | "id">;
  sourceNode: Pick<ContextNode, "type" | "label" | "id">;
  targetNode: Pick<ContextNode, "type" | "label" | "id">;
}): string {
  const sourceSlug = contextEdgeNodeSlug(input.sourceNode);
  const targetSlug = contextEdgeNodeSlug(input.targetNode);
  return `${input.edge.userId}/context/edges/${sourceSlug}--${slugify(input.edge.kind)}--${targetSlug}--${input.edge.id}.md`;
}

// ---------------------------------------------------------------------------
// Document construction
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>;

/**
 * One OKF concept document: YAML frontmatter (always carries `type` and
 * `schema`) plus a markdown body holding the document's human core.
 */
export interface VaultDocument {
  frontmatter: Doc;
  body: string;
}

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

export function buildSignalDoc(input: SignalExport): VaultDocument {
  const { signal, sparks, packet, reflections, attachments } = input;
  const frontmatter = prune({
    type: SIGNAL_TYPE,
    schema: SIGNAL_SCHEMA,
    id: signal.id,
    rev: 1,
    created_at: signal.createdAt.toISOString(),
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
  return { frontmatter, body: signal.text };
}

export function buildInspirationDoc(input: InspirationExport): VaultDocument {
  return buildSignalDoc(input);
}

export interface TopOfMindNoteExport {
  note: TopOfMindNote;
  links: TopOfMindNoteSignal[];
}

export type WowMomentExport = TopOfMindNoteExport;

export function buildTopOfMindNoteDoc(input: TopOfMindNoteExport): VaultDocument {
  const { note, links } = input;
  const ordered = [...links].sort((a, b) => a.sortOrder - b.sortOrder);
  const frontmatter = prune({
    type: TOP_OF_MIND_NOTE_TYPE,
    schema: TOP_OF_MIND_NOTE_SCHEMA,
    id: note.id,
    rev: 1,
    created_at: note.createdAt.toISOString(),
    title: note.title,
    kind: note.kind,
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
  return { frontmatter, body: note.why ?? "" };
}

export function buildWowMomentDoc(input: WowMomentExport): VaultDocument {
  return buildTopOfMindNoteDoc(input);
}

export interface ContextNodeExport {
  node: ContextNode;
  evidence: ContextEvidence[];
}

export function buildContextNodeDoc(input: ContextNodeExport): VaultDocument {
  const { node, evidence } = input;
  // `type` is the OKF document type; the node's own taxonomy (value, theme,
  // person, …) moves to `node_type` to avoid colliding with it.
  const frontmatter = prune({
    type: CONTEXT_NODE_TYPE,
    schema: CONTEXT_NODE_SCHEMA,
    id: node.id,
    rev: 1,
    node_type: node.type,
    label: node.label,
    status: node.status,
    first_seen_at: node.firstSeenAt.toISOString(),
    evidence: evidence.map((row) =>
      prune({
        signal: row.inspirationId,
        reason: row.reason,
      }),
    ),
  });
  return { frontmatter, body: node.description ?? "" };
}

export interface ContextEdgeExport {
  edge: ContextEdge;
  sourceNode: ContextNode;
  targetNode: ContextNode;
}

export function buildContextEdgeDoc(input: ContextEdgeExport): VaultDocument {
  const { edge, sourceNode, targetNode } = input;
  const sourceSlug = contextEdgeNodeSlug(sourceNode);
  const targetSlug = contextEdgeNodeSlug(targetNode);
  const frontmatter = prune({
    type: CONTEXT_EDGE_TYPE,
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
  return { frontmatter, body: "" };
}

/**
 * Serialize a document to OKF markdown: a `---`-fenced YAML frontmatter
 * block, one blank separator line, then the body with exactly one trailing
 * newline (the canonical form — parseOkfMarkdown reverses it).
 *
 * `lineWidth: 0` disables YAML wrapping so long strings never get reflowed
 * (reflow would make hashes depend on the serializer's wrap heuristics
 * rather than on content).
 */
export function toOkfMarkdown(doc: VaultDocument): string {
  const yaml = stringify(doc.frontmatter, { lineWidth: 0 });
  const header = `---\n${yaml}---\n`;
  if (doc.body.length === 0) return header;
  const body = doc.body.endsWith("\n") ? doc.body : `${doc.body}\n`;
  return `${header}\n${body}`;
}

/**
 * Parse an OKF markdown document back into frontmatter + body. This is the
 * consuming half of the protocol: reindexing and inbound sync (foreign
 * files dropped into a synced vault) both come through here.
 *
 * The scan for the closing fence looks for a `---` line at column 0, which
 * cannot occur inside the frontmatter because YAML block scalars are always
 * indented.
 */
export function parseOkfMarkdown(content: string): VaultDocument {
  if (!content.startsWith("---\n")) {
    throw new Error("Not an OKF document: missing opening frontmatter fence");
  }
  const close = content.indexOf("\n---\n", 3);
  if (close === -1) {
    throw new Error("Not an OKF document: missing closing frontmatter fence");
  }
  const frontmatter = parse(content.slice(4, close + 1)) as Doc;
  let body = content.slice(close + 5);
  if (body.startsWith("\n")) body = body.slice(1);
  if (body.endsWith("\n")) body = body.slice(0, -1);
  return { frontmatter, body };
}

/**
 * YAML twin of a vault document — the same VaultDocument as one plain YAML
 * document, with the markdown body under a trailing `body` key.
 *
 * The OKF markdown file is the canonical representation; this is a lossless
 * *view* for YAML-first tools and for `.yaml` files arriving through inbound
 * sync. OKF conformance is untouched because the spec only constrains `.md`
 * files. toVaultYaml/fromVaultYaml and toOkfMarkdown/parseOkfMarkdown are
 * interchangeable round trips over the same VaultDocument.
 */
export function toVaultYaml(doc: VaultDocument): string {
  const merged: Doc = { ...doc.frontmatter };
  if (doc.body.length > 0) merged.body = doc.body;
  return stringify(merged, { lineWidth: 0 });
}

export function fromVaultYaml(content: string): VaultDocument {
  const parsed = parse(content);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Not a vault YAML document: top level must be a mapping");
  }
  const { body, ...frontmatter } = parsed as Doc;
  return {
    frontmatter,
    body: typeof body === "string" ? body : "",
  };
}
