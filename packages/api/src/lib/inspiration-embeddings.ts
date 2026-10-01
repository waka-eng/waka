/**
 * Gemini embeddings for the two things signal generation compares.
 *
 * One persisted vector per inspiration, model and input scope, and one per signal
 * statement. Match-or-mint needs both: a capture is embedded to find what it
 * resembles, and every statement is embedded so "is this the same pattern we
 * already know?" is answered by cosine distance rather than by a model call.
 *
 * This module stops at persisted vectors. Callers pay the Gemini round-trip
 * explicitly, and both entry points are idempotent: the canonical input is
 * hashed, and an unchanged hash returns the stored row without a provider call.
 */

import { createHash } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as dbSchema from "../db/index.js";
import {
  attachments,
  inspirationEmbeddings,
  inspirations,
  reflections,
  type Attachment,
  type Inspiration,
  type InspirationEmbedding,
  type InspirationEmbeddingScope,
  type Reflection,
} from "../db/index.js";
import { getDb } from "./db.js";
import {
  buildGeminiJsonHeaders,
  buildGeminiModelEndpoint,
  fetchModelWithTimeout,
  formatSafeGeminiError,
  safeGeminiErrorDetails,
} from "./gemini-http.js";

export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
export const GEMINI_EMBEDDING_DIMENSIONS = 768;
export const MAX_GEMINI_EMBEDDING_VALUES = 4096;
export type WakaDb = PostgresJsDatabase<typeof dbSchema>;

/**
 * Marks the canonical input format. The bytes below are what the hash is taken
 * over, so changing any of them changes every hash and regenerates every stored
 * vector — which is the intent when the format changes, and the reason the
 * format is versioned rather than tweaked in place.
 */
const CANONICAL_INPUT_VERSION = "waka.inspiration_embedding_input.v1";

export type CanonicalReflectionInput = Pick<
  Reflection,
  "question" | "answer" | "skipped" | "createdAt"
>;

export type CanonicalAttachmentInput = Pick<Attachment, "type" | "enrichmentText">;

export interface CanonicalInspirationEmbeddingInput {
  text: string;
  kind: string | null;
  /**
   * Human-authored Q&A on the capture. The strongest context an inspiration
   * carries: the person saying, in their own words, why this mattered.
   */
  reflections?: CanonicalReflectionInput[];
  /**
   * What was saved alongside the text — a link's page body, an image's
   * description. Without it a bare link embeds as a URL, which resembles every
   * other URL and nothing else.
   */
  attachments?: CanonicalAttachmentInput[];
}

function normalizeTextForEmbedding(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/**
 * Pure canonical input builder for inspiration embeddings.
 *
 * Deliberately small and ordered: the same capture must produce the same bytes
 * on every host, or the hash stops meaning "this content already has a vector".
 */
export function buildCanonicalInspirationEmbeddingInput(
  inspiration: CanonicalInspirationEmbeddingInput,
): string {
  const text = normalizeTextForEmbedding(inspiration.text);
  const kind = inspiration.kind?.trim() || "null";

  const reflectionLines = (inspiration.reflections ?? [])
    .filter(
      (reflection) =>
        !reflection.skipped &&
        normalizeTextForEmbedding(reflection.answer ?? "").length > 0,
    )
    .map((reflection, index) => {
      const question = normalizeTextForEmbedding(reflection.question);
      const answer = normalizeTextForEmbedding(reflection.answer ?? "");
      return [
        `reflection_${index + 1}_question:`,
        question,
        `reflection_${index + 1}_answer:`,
        answer,
      ].join("\n");
    });

  const attachmentLines = (inspiration.attachments ?? [])
    .filter(
      (attachment) => normalizeTextForEmbedding(attachment.enrichmentText ?? "").length > 0,
    )
    .map((attachment, index) => {
      const enrichment = normalizeTextForEmbedding(attachment.enrichmentText ?? "");
      return [`attachment_${index + 1}_${attachment.type}:`, enrichment].join("\n");
    });

  return [
    CANONICAL_INPUT_VERSION,
    `kind:${kind}`,
    "text:",
    text,
    "attachments:",
    attachmentLines.length > 0 ? attachmentLines.join("\n") : "none",
    "reflections:",
    reflectionLines.length > 0 ? reflectionLines.join("\n") : "none",
  ].join("\n");
}

/** Stable SHA-256 hex hash helper for canonical embedding inputs. */
export function hashEmbeddingInput(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function getGeminiApiKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const sstLink = process.env.SST_RESOURCE_GeminiApiKey;
  if (sstLink) {
    try {
      const parsed = JSON.parse(sstLink) as { value?: string };
      if (parsed?.value) return parsed.value;
    } catch {
      // fall through to error
    }
  }

  throw new Error(
    "Gemini API key is not configured (GEMINI_API_KEY / SST_RESOURCE_GeminiApiKey).",
  );
}

export function buildEmbedContentUrl(model = GEMINI_EMBEDDING_MODEL): string {
  return buildGeminiModelEndpoint(model, "embedContent");
}

const embedContentResponseSchema = z.object({
  embedding: z.object({
    values: z
      .array(z.number().finite())
      .min(GEMINI_EMBEDDING_DIMENSIONS)
      .max(MAX_GEMINI_EMBEDDING_VALUES),
  }),
});

export function validateEmbeddingVector(
  embedding: number[],
  expectedDimensions = GEMINI_EMBEDDING_DIMENSIONS,
): number[] {
  if (embedding.length !== expectedDimensions) {
    throw new Error(
      `Gemini embedding dimension mismatch: expected ${expectedDimensions}, received ${embedding.length}`,
    );
  }
  const invalidIndex = embedding.findIndex((value) => !Number.isFinite(value));
  if (invalidIndex !== -1) {
    throw new Error(`Gemini embedding contained a non-finite value at index ${invalidIndex}`);
  }
  return embedding;
}

/** The two halves of the asymmetric pairing gemini-embedding-001 was
    calibrated for: stored memories are DOCUMENTs, a live question is a
    QUERY. Every stored vector in the system is a document; only recall's
    incoming question uses the other half. */
export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface GeminiEmbeddingClient {
  readonly model: string;
  embed(input: string, taskType?: EmbeddingTaskType): Promise<number[]>;
}

export class GeminiEmbeddingHttpClient implements GeminiEmbeddingClient {
  readonly model: string;

  constructor(model = GEMINI_EMBEDDING_MODEL) {
    this.model = model;
  }

  async embed(
    input: string,
    taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT",
  ): Promise<number[]> {
    const apiKey = getGeminiApiKey();
    const response = await fetchModelWithTimeout(fetch, buildEmbedContentUrl(this.model), {
      method: "POST",
      headers: buildGeminiJsonHeaders(apiKey),
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text: input }] },
        taskType,
        outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      throw new Error(
        formatSafeGeminiError(
          "Gemini embedding failed",
          await safeGeminiErrorDetails(response),
        ),
      );
    }

    let rawJson: unknown;
    try {
      rawJson = await response.json();
    } catch (err) {
      throw new Error(
        `Gemini embedding returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = embedContentResponseSchema.safeParse(rawJson);
    if (!parsed.success) {
      throw new Error(
        `Gemini embedding response failed schema validation: ${parsed.error.message}`,
      );
    }

    return validateEmbeddingVector(parsed.data.embedding.values);
  }
}

export interface EnsureInspirationEmbeddingParams {
  profileId: string;
  inspirationId: string;
  inputScope?: InspirationEmbeddingScope;
  db?: WakaDb;
  client?: GeminiEmbeddingClient;
}

export type EnsureInspirationEmbeddingResult =
  | {
      status: "missing_inspiration" | "not_public";
      embedding: null;
      generated: false;
      inputHash: null;
    }
  | {
      status: "stale_source";
      embedding: null;
      generated: true;
      inputHash: string;
    }
  | {
      status: "unchanged" | "created" | "updated";
      embedding: InspirationEmbedding;
      generated: boolean;
      inputHash: string;
    };

export function needsEmbeddingRegeneration(
  existing: Pick<InspirationEmbedding, "inputHash" | "model"> | null,
  inputHash: string,
  model: string,
): boolean {
  return existing?.inputHash !== inputHash || existing.model !== model;
}

async function loadProfileScopedInspiration(
  db: WakaDb,
  profileId: string,
  inspirationId: string,
): Promise<Inspiration | null> {
  const rows = await db
    .select()
    .from(inspirations)
    .where(and(eq(inspirations.id, inspirationId), eq(inspirations.profileId, profileId)))
    .limit(1);

  return rows[0] ?? null;
}

async function loadExistingEmbedding(
  db: WakaDb,
  profileId: string,
  inspirationId: string,
  model: string,
  inputScope: InspirationEmbeddingScope,
): Promise<InspirationEmbedding | null> {
  const rows = await db
    .select()
    .from(inspirationEmbeddings)
    .where(
      and(
        eq(inspirationEmbeddings.profileId, profileId),
        eq(inspirationEmbeddings.inspirationId, inspirationId),
        eq(inspirationEmbeddings.model, model),
        eq(inspirationEmbeddings.inputScope, inputScope),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function loadProfileScopedReflections(
  db: WakaDb,
  profileId: string,
  inspirationId: string,
): Promise<CanonicalReflectionInput[]> {
  return db
    .select({
      question: reflections.question,
      answer: reflections.answer,
      skipped: reflections.skipped,
      createdAt: reflections.createdAt,
    })
    .from(reflections)
    .where(
      and(
        eq(reflections.profileId, profileId),
        eq(reflections.inspirationId, inspirationId),
      ),
    )
    .orderBy(asc(reflections.createdAt), asc(reflections.id));
}

async function loadProfileScopedAttachments(
  db: WakaDb,
  profileId: string,
  inspirationId: string,
): Promise<CanonicalAttachmentInput[]> {
  return db
    .select({
      type: attachments.type,
      enrichmentText: attachments.enrichmentText,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.profileId, profileId),
        eq(attachments.inspirationId, inspirationId),
      ),
    )
    .orderBy(asc(attachments.createdAt), asc(attachments.id));
}

async function buildCanonicalInputForInspiration(
  db: WakaDb,
  profileId: string,
  inspiration: Inspiration,
  inputScope: InspirationEmbeddingScope,
): Promise<string> {
  const [reflectionRows, attachmentRows] = await Promise.all([
    inputScope === "personal" ? loadProfileScopedReflections(db, profileId, inspiration.id) : [],
    loadProfileScopedAttachments(db, profileId, inspiration.id),
  ]);
  return buildCanonicalInspirationEmbeddingInput({
    text: inspiration.text,
    kind: inspiration.kind,
    reflections: reflectionRows,
    attachments: attachmentRows,
  });
}

async function acquireEmbeddingAdvisoryLock(
  db: WakaDb,
  params: Pick<EnsureInspirationEmbeddingParams, "profileId" | "inspirationId"> & {
    model: string;
    inputScope: InspirationEmbeddingScope;
  },
): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${[
      "waka.inspiration_embedding",
      params.profileId,
      params.inspirationId,
      params.model,
      params.inputScope,
    ].join(":")}, 0))`,
  );
}

async function sourceMatchesSnapshot(
  db: WakaDb,
  profileId: string,
  source: Inspiration | null,
  snapshot: { inputHash: string },
  inputScope: InspirationEmbeddingScope,
): Promise<boolean> {
  if (!source) return false;
  if (inputScope === "public" && source.visibility !== "public") return false;
  const currentInput = await buildCanonicalInputForInspiration(db, profileId, source, inputScope);
  return hashEmbeddingInput(currentInput) === snapshot.inputHash;
}

/**
 * Ensure one stored Gemini embedding exists for a profile-scoped inspiration.
 *
 * Idempotency: if the stored row already carries the current canonical input
 * hash for the same model, this returns without calling Gemini. A
 * transaction-scoped advisory lock serializes concurrent generation for the
 * same profile/source/model; the source is re-read after the lock, and read
 * again after Gemini answers, so a vector describing text that has since been
 * edited is never persisted over the edit.
 */
export async function ensureInspirationEmbedding(
  params: EnsureInspirationEmbeddingParams,
): Promise<EnsureInspirationEmbeddingResult> {
  const db: WakaDb = params.db ?? getDb();
  const client = params.client ?? new GeminiEmbeddingHttpClient();
  const inputScope = params.inputScope ?? "personal";

  return db.transaction(async (tx) => {
    await acquireEmbeddingAdvisoryLock(tx, {
      profileId: params.profileId,
      inspirationId: params.inspirationId,
      model: client.model,
      inputScope,
    });

    const inspiration = await loadProfileScopedInspiration(
      tx,
      params.profileId,
      params.inspirationId,
    );
    if (!inspiration) {
      return {
        status: "missing_inspiration",
        embedding: null,
        generated: false,
        inputHash: null,
      };
    }
    if (inputScope === "public" && inspiration.visibility !== "public") {
      return { status: "not_public", embedding: null, generated: false, inputHash: null };
    }

    const canonicalInput = await buildCanonicalInputForInspiration(
      tx,
      params.profileId,
      inspiration,
      inputScope,
    );
    const inputHash = hashEmbeddingInput(canonicalInput);
    const existing = await loadExistingEmbedding(
      tx,
      params.profileId,
      params.inspirationId,
      client.model,
      inputScope,
    );

    if (existing && !needsEmbeddingRegeneration(existing, inputHash, client.model)) {
      return { status: "unchanged", embedding: existing, generated: false, inputHash };
    }

    const embedding = validateEmbeddingVector(await client.embed(canonicalInput));
    const freshSource = await loadProfileScopedInspiration(
      tx,
      params.profileId,
      params.inspirationId,
    );
    if (
      !(await sourceMatchesSnapshot(tx, params.profileId, freshSource, { inputHash }, inputScope))
    ) {
      return {
        status: "stale_source",
        embedding: null,
        generated: true,
        inputHash,
      };
    }

    const now = new Date();
    const status = existing ? "updated" : "created";
    const [stored] = await tx
      .insert(inspirationEmbeddings)
      .values({
        profileId: inspiration.profileId,
        inspirationId: inspiration.id,
        model: client.model,
        inputScope,
        dimensions: embedding.length,
        inputHash,
        embedding,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [inspirationEmbeddings.inspirationId, inspirationEmbeddings.model, inspirationEmbeddings.inputScope],
        set: {
          profileId: inspiration.profileId,
          dimensions: embedding.length,
          inputHash,
          embedding,
          updatedAt: now,
        },
      })
      .returning();

    if (!stored) {
      throw new Error("Failed to persist inspiration embedding");
    }

    return { status, embedding: stored, generated: true, inputHash };
  });
}
