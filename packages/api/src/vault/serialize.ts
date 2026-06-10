/**
 * Vault document serialization — DB rows in, YAML documents out.
 *
 * Two document schemas exist in Phase 1:
 *   - waka/inspiration@v1 : inspiration text + sparks + reflections +
 *     attachment references
 *   - waka/wow-moment@v1  : a judged WOW moment with its evidence links
 *
 * Design rules (docs/vault-architecture.md):
 *   - Machine-derived values NEVER enter files: no scores, no cluster, no
 *     embeddings. The judge's idempotency key is provenance, not a signal,
 *     so it rides along on WOW moment documents.
 *   - Output is deterministic for identical input rows: key order is fixed
 *     by construction, null/undefined/empty values are pruned, timestamps
 *     are ISO-8601 UTC strings. Determinism is what makes contentHash a
 *     meaningful drift detector.
 */

import { stringify } from "yaml";

import type {
  Attachment,
  Inspiration,
  InspirationSpark,
  Reflection,
  WowMoment,
  WowMomentInspiration,
} from "../db/index.js";

export const INSPIRATION_SCHEMA = "waka/inspiration@v1";
export const WOW_MOMENT_SCHEMA = "waka/wow-moment@v1";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function monthPartition(createdAt: Date): string {
  const year = createdAt.getUTCFullYear().toString().padStart(4, "0");
  const month = (createdAt.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${year}/${month}`;
}

/** `{userId}/inspirations/YYYY/MM/{id}.yaml` (UTC month of created_at). */
export function inspirationVaultPath(
  userId: string,
  id: string,
  createdAt: Date,
): string {
  return `${userId}/inspirations/${monthPartition(createdAt)}/${id}.yaml`;
}

/** `{userId}/moments/YYYY/MM/{id}.yaml` (UTC month of created_at). */
export function wowMomentVaultPath(
  userId: string,
  id: string,
  createdAt: Date,
): string {
  return `${userId}/moments/${monthPartition(createdAt)}/${id}.yaml`;
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

export interface InspirationExport {
  inspiration: Inspiration;
  sparks: InspirationSpark[];
  reflections: Reflection[];
  attachments: Attachment[];
}

export function buildInspirationDoc(input: InspirationExport): Doc {
  const { inspiration, sparks, reflections, attachments } = input;
  return prune({
    schema: INSPIRATION_SCHEMA,
    id: inspiration.id,
    rev: 1,
    created_at: inspiration.createdAt.toISOString(),
    text: inspiration.text,
    kind: inspiration.kind,
    category: inspiration.category,
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

export interface WowMomentExport {
  moment: WowMoment;
  links: WowMomentInspiration[];
}

export function buildWowMomentDoc(input: WowMomentExport): Doc {
  const { moment, links } = input;
  const ordered = [...links].sort((a, b) => a.sortOrder - b.sortOrder);
  return prune({
    schema: WOW_MOMENT_SCHEMA,
    id: moment.id,
    rev: 1,
    created_at: moment.createdAt.toISOString(),
    title: moment.title,
    kind: moment.kind,
    why: moment.why,
    belief_statement: moment.beliefStatement,
    reflection_question: moment.reflectionQuestion,
    reflection_guide: moment.reflectionGuide,
    locale: moment.locale,
    related: ordered.map((link) =>
      prune({
        id: link.inspirationId,
        role: link.role,
        reason: link.reason,
      }),
    ),
    judge: prune({
      idempotency_key: moment.idempotencyKey,
    }),
  });
}

/**
 * Serialize a document to YAML. `lineWidth: 0` disables wrapping so long
 * inspiration text never gets reflowed (reflow would make hashes depend on
 * the serializer's wrap heuristics rather than on content).
 */
export function toYaml(doc: Doc): string {
  return stringify(doc, { lineWidth: 0 });
}
