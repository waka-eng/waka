/**
 * Gemini embedding foundation for inspirations.
 *
 * This module intentionally stops at persisted embeddings. It does not generate
 * WOW moments and is not called automatically from create/update routes in this
 * slice; workers/routes can call `ensureInspirationEmbedding` explicitly when
 * their architecture is ready to pay the Gemini round-trip.
 */

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as dbSchema from "../db/index.js";
import {
  inspirationEmbeddings,
  inspirations,
  type Inspiration,
  type InspirationEmbedding,
} from "../db/index.js";
import { getDb } from "./db.js";

export const GEMINI_EMBEDDING_MODEL = "text-embedding-004";
export type WakaDb = PostgresJsDatabase<typeof dbSchema>;

export interface CanonicalInspirationEmbeddingInput {
  text: string;
  kind: string | null;
  category: number | null;
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

  return [
    "waka.inspiration_embedding_input.v1",
    `kind:${kind}`,
    `category:${category}`,
    "text:",
    text,
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
  apiKey: string,
  model = GEMINI_EMBEDDING_MODEL,
): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${encodeURIComponent(apiKey)}`;
}

const embedContentResponseSchema = z.object({
  embedding: z.object({
    values: z.array(z.number()),
  }),
});

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
    const response = await fetch(buildEmbedContentUrl(apiKey, this.model), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text: input }] },
        taskType: "RETRIEVAL_DOCUMENT",
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "<unreadable>");
      throw new Error(
        `Gemini embedding failed: HTTP ${response.status} ${response.statusText} — ${errBody.slice(0, 500)}`,
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

    return parsed.data.embedding.values;
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

/**
 * Ensure one stored Gemini embedding exists for a tenant-scoped inspiration.
 *
 * Idempotency: if the stored row already has the current canonical input hash
 * for the same model, this returns without calling Gemini.
 */
export async function ensureInspirationEmbedding(
  params: EnsureInspirationEmbeddingParams,
): Promise<EnsureInspirationEmbeddingResult> {
  const db: WakaDb = params.db ?? getDb();
  const client = params.client ?? new GeminiEmbeddingHttpClient();

  const inspiration = await loadTenantScopedInspiration(
    db,
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

  const canonicalInput = buildCanonicalInspirationEmbeddingInput(inspiration);
  const inputHash = hashEmbeddingInput(canonicalInput);
  const existing = await loadExistingEmbedding(db, params.userId, params.inspirationId);

  if (existing && !needsEmbeddingRegeneration(existing, inputHash, client.model)) {
    return { status: "unchanged", embedding: existing, generated: false, inputHash };
  }

  const embedding = await client.embed(canonicalInput);
  const now = new Date();
  const status = existing ? "updated" : "created";

  const [stored] = await db
    .insert(inspirationEmbeddings)
    .values({
      userId: inspiration.userId,
      inspirationId: inspiration.id,
      model: client.model,
      dimensions: embedding.length,
      inputHash,
      embedding,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: inspirationEmbeddings.inspirationId,
      set: {
        userId: inspiration.userId,
        model: client.model,
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
}
