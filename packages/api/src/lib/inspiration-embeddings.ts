import {embeddingPolicySql,parseEmbeddingPolicy,embeddingPolicyMatchesSql,embeddingPolicyIdentity,type EmbeddingIndexPolicy} from './embedding-policy.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
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
  type Inspiration,
  type InspirationEmbedding,
  type InspirationEmbeddingScope,
} from "../db/index.js";
import { getDb } from "./db.js";
import {measurePerformanceStage} from './performance-stages.js';
import { effectiveAttachmentText } from './attachment-material.js';
import {buildCanonicalInspirationEmbeddingInput,type CanonicalReflectionInput,type CanonicalAttachmentInput} from './inspiration-embedding-source.js';
export {buildCanonicalInspirationEmbeddingInput,readInspirationEmbeddingSource,type CanonicalReflectionInput,type CanonicalAttachmentInput,type CanonicalInspirationEmbeddingInput} from './inspiration-embedding-source.js';
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

// Canonical-v1 construction lives in the pure source reader and is re-exported
// above for the existing native callers. Its bytes/version remain unchanged.
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
  readonly dimensions?: number;
  embed(input: string, taskType?: EmbeddingTaskType): Promise<number[]>;
}

export class GeminiEmbeddingHttpClient implements GeminiEmbeddingClient {
  readonly model: string;
  readonly dimensions=GEMINI_EMBEDDING_DIMENSIONS;

  constructor(model = GEMINI_EMBEDDING_MODEL, private readonly deadlines?:{timeoutMs:number;exchangeTimeoutMs:number}) {
    this.model = model;
  }

  async embed(
    input: string,
    taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT",
  ): Promise<number[]> {
    return measurePerformanceStage('embedding','gemini',async()=>{
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
    },this.deadlines?.timeoutMs,this.deadlines?.exchangeTimeoutMs);

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
    });
  }
}

export interface EnsureInspirationEmbeddingParams {
  profileId: string;
  inspirationId: string;
  inputScope?: InspirationEmbeddingScope;
  db?: WakaDb;
  client?: GeminiEmbeddingClient;
  embeddingPolicy?:EmbeddingIndexPolicy;
  beforeCommit?: (tx: Parameters<Parameters<WakaDb["transaction"]>[0]>[0]) => Promise<void>;
}

export type EnsureInspirationEmbeddingResult =
  | {
      status: "missing_inspiration" | "not_public" | "ineligible";
      embedding: null;
      generated: false;
      inputHash: null;
    }
  | {
      status: "stale_source";
      embedding: null;
      generated: boolean;
      inputHash: string|null;
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
  lock:boolean|'nowait' = false,expected?:EmbeddingIndexPolicy,
): Promise<Inspiration | null> {
  const query = db
    .select()
    .from(inspirations)
    .where(and(eq(inspirations.id, inspirationId), eq(inspirations.profileId, profileId),expected?embeddingPolicyMatchesSql(expected):undefined))
    .limit(1);
  const rows = await (lock ? query.for("update",lock==='nowait'?{noWait:true}:{}) : query);

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
  lock:boolean|'nowait' = false,
): Promise<CanonicalReflectionInput[]> {
  const query = db
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
  return lock ? query.for("share",lock==='nowait'?{noWait:true}:{}) : query;
}

async function loadProfileScopedAttachments(
  db: WakaDb,
  profileId: string,
  inspirationId: string,
  lock:boolean|'nowait' = false,
): Promise<CanonicalAttachmentInput[]> {
  const query = db
    .select({
      type: attachments.type,
      enrichmentText: effectiveAttachmentText,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.profileId, profileId),
        eq(attachments.inspirationId, inspirationId),
      ),
    )
    .orderBy(asc(attachments.createdAt), asc(attachments.id));
  return lock ? query.for("share",lock==='nowait'?{noWait:true}:{}) : query;
}

async function buildCanonicalInputForInspiration(
  db: WakaDb,
  profileId: string,
  inspiration: Inspiration,
  inputScope: InspirationEmbeddingScope,
  lock:boolean|'nowait' = false,
): Promise<string> {
  const [reflectionRows, attachmentRows] = await Promise.all([
    inputScope === "personal" ? loadProfileScopedReflections(db, profileId, inspiration.id, lock) : [],
    loadProfileScopedAttachments(db, profileId, inspiration.id, lock),
  ]);
  return buildCanonicalInspirationEmbeddingInput({
    text: inspiration.text,
    kind: inspiration.kind,
    reflections: reflectionRows,
    attachments: attachmentRows,
  });
}


async function acquireEmbeddingAdvisoryLock(db:WakaDb,params:{profileId:string;inspirationId:string;model?:string;inputScope:InspirationEmbeddingScope}){
 const [row]=await db.execute<{policy:unknown}>(sql`WITH metadata AS MATERIALIZED(SELECT ${embeddingPolicySql(params.profileId)} AS policy)
 SELECT pg_advisory_xact_lock(hashtextextended(${'waka.inspiration_embedding:'+params.profileId+':'+params.inspirationId+':'}::text||${params.model?sql`${params.model}::text`:sql`(policy->>'activeSpace')`}||${':'+params.inputScope}::text,0)),policy FROM metadata`);
 return parseEmbeddingPolicy(params.profileId,row.policy);
}

async function ensureModel2Inspiration(params:EnsureInspirationEmbeddingParams,policy?:EmbeddingIndexPolicy):Promise<EnsureInspirationEmbeddingResult>{
 const db=params.db??getDb(),scope=params.inputScope??'personal';
 const {indexEmbeddingSource}=await import('./embedding-indexer.js');
 const result=await indexEmbeddingSource(db,{profileId:params.profileId,sourceKind:'inspiration',sourceId:params.inspirationId,space:EMBEDDING_2_SPACE.id,scope},{client:params.client,expectedPolicy:policy,beforeCommit:params.beforeCommit});
 if(result.status==='inactive')return{status:'stale_source',embedding:null,generated:false,inputHash:null};
 if(result.status==='missing'||result.status==='ineligible')return{status:result.status==='missing'?'missing_inspiration':'ineligible',embedding:null,generated:false,inputHash:null};
 const stored=await loadExistingEmbedding(db,params.profileId,params.inspirationId,EMBEDDING_2_SPACE.id,scope);
 const {embeddingInSpace}=await import('./embedding-provider.js');
 if(!stored||stored.inputHash!==result.inputHash||!embeddingInSpace(stored.embedding,stored.dimensions,{model:EMBEDDING_2_SPACE.id,dimensions:768}))return{status:'stale_source',embedding:null,generated:result.generated,inputHash:result.inputHash};
 return{status:result.generated?'updated':'unchanged',embedding:stored,generated:result.generated,inputHash:stored.inputHash};
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
  const currentInput = await buildCanonicalInputForInspiration(db, profileId, source, inputScope, true);
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
  // Lazy import keeps the storage/canonical module below the factory in the
  // initialization graph; standalone callers still use the same selection.
  const {createEmbeddingClient,embeddingInSpace,embeddingSpaceForClient}=await import('./embedding-provider.js');
  if(params.embeddingPolicy?.activeSpace===EMBEDDING_2_SPACE.id||params.client?.model===EMBEDDING_2_SPACE.id)return ensureModel2Inspiration(params,params.embeddingPolicy);
  const inputScope = params.inputScope ?? "personal";
  let deferred:EmbeddingIndexPolicy|undefined;
  const result:EnsureInspirationEmbeddingResult=await db.transaction(async (tx) => {
    const policy=await acquireEmbeddingAdvisoryLock(tx, {
      profileId: params.profileId,
      inspirationId: params.inspirationId,
      model: params.client?.model,
      inputScope,
    });
    if(params.embeddingPolicy&&embeddingPolicyIdentity(params.embeddingPolicy)!==embeddingPolicyIdentity(policy))return{status:'stale_source',embedding:null,generated:false,inputHash:null};
    const client=params.client??createEmbeddingClient(undefined,policy),space=embeddingSpaceForClient(client);
    if(client.model===EMBEDDING_2_SPACE.id){deferred=policy;return{status:'stale_source',embedding:null,generated:false,inputHash:null};}

    const inspiration = await loadProfileScopedInspiration(
      tx,
      params.profileId,
      params.inspirationId,
      false,policy,
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

    if (existing && !needsEmbeddingRegeneration(existing, inputHash, client.model)&&embeddingInSpace(existing.embedding,existing.dimensions,space)) {
      return { status: "unchanged", embedding: existing, generated: false, inputHash };
    }

    const embedding = validateEmbeddingVector(await client.embed(canonicalInput));
    const freshSource = await loadProfileScopedInspiration(
      tx,
      params.profileId,
      params.inspirationId,
      true,policy,
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

    await params.beforeCommit?.(tx);
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
  return deferred?ensureModel2Inspiration(params,deferred):result;
}
