/**
 * Gemini embedding foundation for inspirations.
 *
 * This module intentionally stops at persisted embeddings. WOW moment routes and
 * the async classifier/WOW handoff call `ensureInspirationEmbedding` explicitly
 * when they are ready to pay the Gemini round-trip; embedding generation itself
 * remains tenant-scoped and idempotent here.
 */

import { createHash } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as dbSchema from "../db/index.js";
import {
  inspirationEmbeddings,
  inspirations,
  reflections,
  type Inspiration,
  type InspirationEmbedding,
  type Reflection,
} from "../db/index.js";
import { getDb } from "./db.js";
import {
  buildGeminiJsonHeaders,
  buildGeminiModelEndpoint,
  formatSafeGeminiError,
  safeGeminiErrorDetails,
} from "./gemini-http.js";

export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
export const GEMINI_EMBEDDING_DIMENSIONS = 768;
export const MAX_GEMINI_EMBEDDING_VALUES = 4096;
export type WakaDb = PostgresJsDatabase<typeof dbSchema>;

export interface CanonicalInspirationEmbeddingInput {
  text: string;
  kind: string | null;
  category: number | null;
  /**
   * Fetched page text for URL saves (title/description), when we have it.
   * See `signal-enrichment.ts`.
   */
  enrichment?: string | null;
  reflections?: Array<Pick<Reflection, "question" | "answer" | "skipped" | "createdAt">>;
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
 * Keep this deliberately small and versioned: changing these bytes changes the
 * hash and therefore triggers a one-time regeneration for existing rows.
 */
export function buildCanonicalInspirationEmbeddingInput(
  inspiration: CanonicalInspirationEmbeddingInput,
): string {
  const text = normalizeTextForEmbedding(inspiration.text);
  const kind = inspiration.kind?.trim() || "null";
  const category = inspiration.category === null ? "null" : String(inspiration.category);
  const reflectionLines = (inspiration.reflections ?? [])
    .filter((reflection) => !reflection.skipped && normalizeTextForEmbedding(reflection.answer ?? "").length > 0)
    .map((reflection, index) => {
      const question = normalizeTextForEmbedding(reflection.question);
      const answer = normalizeTextForEmbedding(reflection.answer ?? "");
      return [`reflection_${index + 1}_question:`, question, `reflection_${index + 1}_answer:`, answer].join("\n");
    });

  /**
   * Enrichment joins the input ONLY when present, rather than as an always-on
   * `enrichment:none` line under a bumped version. The distinction is the
   * regeneration blast radius: this way an un-enriched row's input stays
   * byte-identical to what it hashed before enrichment existed, so nothing
   * regenerates until a row actually gains enrichment — at which point its
   * hash changes and `ensureInspirationEmbedding` regenerates exactly that
   * one. A version bump would have re-embedded every signal ever saved to say
   * "none" about most of them.
   */
  const enrichment = normalizeTextForEmbedding(inspiration.enrichment ?? "");

  return [
    "waka.inspiration_embedding_input.v2",
    `kind:${kind}`,
    `category:${category}`,
    "text:",
    text,
    ...(enrichment.length > 0 ? ["enrichment:", enrichment] : []),
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

export function buildEmbedContentUrl(
  model = GEMINI_EMBEDDING_MODEL,
): string {
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

export interface GeminiEmbeddingClient {
  readonly model: string;
  embed(input: string): Promise<number[]>;
}

export class GeminiEmbeddingHttpClient implements GeminiEmbeddingClient {
  readonly model: string;

  constructor(model = GEMINI_EMBEDDING_MODEL) {
    this.model = model;
  }

  async embed(input: string): Promise<number[]> {
    const apiKey = getGeminiApiKey();
    const response = await fetch(buildEmbedContentUrl(this.model), {
      method: "POST",
      headers: buildGeminiJsonHeaders(apiKey),
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text: input }] },
        taskType: "RETRIEVAL_DOCUMENT",
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
  userId: string;
  inspirationId: string;
  db?: WakaDb;
  client?: GeminiEmbeddingClient;
}

export type EnsureInspirationEmbeddingResult =
  | {
      status: "missing_inspiration";
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

async function loadTenantScopedInspiration(
  db: WakaDb,
  userId: string,
  inspirationId: string,
): Promise<Inspiration | null> {
  const rows = await db
    .select()
    .from(inspirations)
    .where(and(eq(inspirations.id, inspirationId), eq(inspirations.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
}

async function loadExistingEmbedding(
  db: WakaDb,
  userId: string,
  inspirationId: string,
): Promise<InspirationEmbedding | null> {
  const rows = await db
    .select()
    .from(inspirationEmbeddings)
    .where(
      and(
        eq(inspirationEmbeddings.userId, userId),
        eq(inspirationEmbeddings.inspirationId, inspirationId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function loadTenantScopedReflections(
  db: WakaDb,
  userId: string,
  inspirationId: string,
): Promise<Array<Pick<Reflection, "question" | "answer" | "skipped" | "createdAt">>> {
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
        eq(reflections.userId, userId),
        eq(reflections.inspirationId, inspirationId),
      ),
    )
    .orderBy(asc(reflections.createdAt), asc(reflections.id));
}

async function buildCanonicalInputForInspiration(
  db: WakaDb,
  userId: string,
  inspiration: Inspiration,
): Promise<string> {
  const reflectionRows = await loadTenantScopedReflections(db, userId, inspiration.id);
  return buildCanonicalInspirationEmbeddingInput({
    ...inspiration,
    reflections: reflectionRows,
  });
}

async function acquireEmbeddingAdvisoryLock(
  db: WakaDb,
  params: Pick<EnsureInspirationEmbeddingParams, "userId" | "inspirationId"> & {
    model: string;
  },
): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${[
      "waka.inspiration_embedding",
      params.userId,
      params.inspirationId,
      params.model,
    ].join(":")}, 0))`,
  );
}

async function sourceMatchesSnapshot(
  db: WakaDb,
  userId: string,
  source: Inspiration | null,
  snapshot: { inputHash: string },
): Promise<boolean> {
  if (!source) return false;
  const currentInput = await buildCanonicalInputForInspiration(db, userId, source);
  return hashEmbeddingInput(currentInput) === snapshot.inputHash;
}

/**
 * Ensure one stored Gemini embedding exists for a tenant-scoped inspiration.
 *
 * Idempotency: if the stored row already has the current canonical input hash
 * for the same model, this returns without calling Gemini. A transaction-scoped
 * advisory lock serializes concurrent generation for the same tenant/source/model;
 * the source row is re-read after the lock, and re-read again after Gemini so a
 * stale embedding is never persisted over edited content.
 */
export async function ensureInspirationEmbedding(
  params: EnsureInspirationEmbeddingParams,
): Promise<EnsureInspirationEmbeddingResult> {
  const db: WakaDb = params.db ?? getDb();
  const client = params.client ?? new GeminiEmbeddingHttpClient();

  return db.transaction(async (tx) => {
    await acquireEmbeddingAdvisoryLock(tx, {
      userId: params.userId,
      inspirationId: params.inspirationId,
      model: client.model,
    });

    const inspiration = await loadTenantScopedInspiration(
      tx,
      params.userId,
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

    const canonicalInput = await buildCanonicalInputForInspiration(tx, params.userId, inspiration);
    const inputHash = hashEmbeddingInput(canonicalInput);
    const existing = await loadExistingEmbedding(tx, params.userId, params.inspirationId);

    if (existing && !needsEmbeddingRegeneration(existing, inputHash, client.model)) {
      return { status: "unchanged", embedding: existing, generated: false, inputHash };
    }

    const embedding = validateEmbeddingVector(await client.embed(canonicalInput));
    const freshSource = await loadTenantScopedInspiration(
      tx,
      params.userId,
      params.inspirationId,
    );
    if (
      !(await sourceMatchesSnapshot(tx, params.userId, freshSource, {
        inputHash,
      }))
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
    const values = {
      userId: inspiration.userId,
      inspirationId: inspiration.id,
      model: client.model,
      dimensions: embedding.length,
      inputHash,
      embedding,
      updatedAt: now,
    } as typeof inspirationEmbeddings.$inferInsert;

    const [stored] = await tx
      .insert(inspirationEmbeddings)
      .values(values)
      .onConflictDoUpdate({
        target: inspirationEmbeddings.inspirationId,
        set: {
          userId: inspiration.userId,
          model: client.model,
          dimensions: embedding.length,
          inputHash,
          embedding,
          updatedAt: now,
        } as Partial<typeof inspirationEmbeddings.$inferInsert>,
      })
      .returning();

    if (!stored) {
      throw new Error("Failed to persist inspiration embedding");
    }

    return { status, embedding: stored, generated: true, inputHash };
  });
}
