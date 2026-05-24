/**
 * Meaning packets are compact, reusable receipts for one saved inspiration.
 *
 * They are deliberately local and deterministic: no Gemini call, no archive
 * scan, no graph write. Later graph/synthesis workers can read these packets
 * instead of repeatedly shipping full artifacts to an LLM.
 */

import { createHash } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as dbSchema from "../db/index.js";
import {
  inspirationSparks,
  inspirations,
  meaningPackets,
  type Inspiration,
  type InspirationSpark,
  type MeaningPacket,
} from "../db/index.js";
import { getDb } from "./db.js";

export type WakaDb = PostgresJsDatabase<typeof dbSchema>;

const MAX_EXCERPT_CHARS_WITH_SPARK = 1_200;
const MAX_EXCERPT_CHARS_WITHOUT_SPARK = 2_000;
const MAX_PACKET_CHARS = 3_200;
const MAX_SPARKS_IN_PACKET = 6;

type PacketInspiration = Pick<
  Inspiration,
  | "id"
  | "userId"
  | "text"
  | "kind"
  | "category"
  | "cluster"
  | "classifiedAt"
  | "createdAt"
  | "updatedAt"
>;

type PacketSpark = Pick<
  InspirationSpark,
  | "id"
  | "text"
  | "source"
  | "confidence"
  | "isPrimary"
  | "note"
  | "startOffset"
  | "endOffset"
  | "createdAt"
  | "updatedAt"
>;

export interface BuildMeaningPacketInput {
  inspiration: PacketInspiration;
  sparks: PacketSpark[];
}

export interface BuiltMeaningPacket {
  primarySparkId: string | null;
  sparkText: string;
  artifactExcerpt: string;
  packetText: string;
  sourceMetadata: Record<string, unknown>;
  classifierSnapshot: Record<string, unknown>;
  inputFingerprint: string;
  tokenEstimate: number;
}

export interface PersistMeaningPacketParams {
  userId: string;
  inspirationId: string;
  db?: WakaDb;
}

export type PersistMeaningPacketResult =
  | { status: "missing_inspiration"; packet: null }
  | { status: "created_or_updated"; packet: MeaningPacket };

function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(value: string, maxChars: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function hashPacketInput(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");
}

function orderSparks(sparks: PacketSpark[]): PacketSpark[] {
  return [...sparks].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function buildMeaningPacket(
  input: BuildMeaningPacketInput,
): BuiltMeaningPacket {
  const sparks = orderSparks(input.sparks).slice(0, MAX_SPARKS_IN_PACKET);
  const primarySpark = sparks.find((spark) => spark.isPrimary) ?? sparks[0] ?? null;
  const sparkText = primarySpark ? normalizeText(primarySpark.text) : "";
  const artifactExcerpt = truncateText(
    input.inspiration.text,
    sparkText ? MAX_EXCERPT_CHARS_WITH_SPARK : MAX_EXCERPT_CHARS_WITHOUT_SPARK,
  );
  const sparkLines = sparks.map((spark, index) => {
    const label = index === 0 ? "primary" : `spark_${index + 1}`;
    const note = spark.note ? ` note=${normalizeText(spark.note)}` : "";
    return `${label}: ${normalizeText(spark.text)} (${spark.source}, confidence=${spark.confidence}${note})`;
  });

  const classifierSnapshot = {
    cluster: input.inspiration.cluster,
    classifiedAt: input.inspiration.classifiedAt?.toISOString() ?? null,
  };
  const sourceMetadata = {
    kind: input.inspiration.kind,
    category: input.inspiration.category,
    createdAt: input.inspiration.createdAt.toISOString(),
    updatedAt: input.inspiration.updatedAt.toISOString(),
    sparkCount: input.sparks.length,
    hasPrimarySpark: Boolean(primarySpark),
  };
  const rawPacketText = [
    "waka.meaning_packet.v1",
    "SPARKS",
    sparkLines.length > 0 ? sparkLines.join("\n") : "none",
    "CONTEXT_EXCERPT",
    artifactExcerpt,
    "CLASSIFIER",
    `cluster=${input.inspiration.cluster ?? "unclassified"}`,
  ].join("\n");
  const packetText = truncateText(rawPacketText, MAX_PACKET_CHARS);
  const inputFingerprint = hashPacketInput({
    version: "waka.meaning_packet.v1",
    inspiration: {
      id: input.inspiration.id,
      text: input.inspiration.text,
      kind: input.inspiration.kind,
      category: input.inspiration.category,
      cluster: input.inspiration.cluster,
      classifiedAt: input.inspiration.classifiedAt?.toISOString() ?? null,
    },
    sparks: input.sparks.map((spark) => ({
      id: spark.id,
      text: spark.text,
      source: spark.source,
      confidence: spark.confidence,
      isPrimary: spark.isPrimary,
      note: spark.note,
      startOffset: spark.startOffset,
      endOffset: spark.endOffset,
    })),
  });

  return {
    primarySparkId: primarySpark?.id ?? null,
    sparkText,
    artifactExcerpt,
    packetText,
    sourceMetadata,
    classifierSnapshot,
    inputFingerprint,
    tokenEstimate: estimateTokens(packetText),
  };
}

export async function persistMeaningPacketForInspiration(
  params: PersistMeaningPacketParams,
): Promise<PersistMeaningPacketResult> {
  const db = params.db ?? getDb();
  const [inspiration] = await db
    .select({
      id: inspirations.id,
      userId: inspirations.userId,
      text: inspirations.text,
      kind: inspirations.kind,
      category: inspirations.category,
      cluster: inspirations.cluster,
      classifiedAt: inspirations.classifiedAt,
      createdAt: inspirations.createdAt,
      updatedAt: inspirations.updatedAt,
    })
    .from(inspirations)
    .where(
      and(
        eq(inspirations.id, params.inspirationId),
        eq(inspirations.userId, params.userId),
      ),
    )
    .limit(1);

  if (!inspiration) return { status: "missing_inspiration", packet: null };

  const sparks = await db
    .select({
      id: inspirationSparks.id,
      text: inspirationSparks.text,
      source: inspirationSparks.source,
      confidence: inspirationSparks.confidence,
      isPrimary: inspirationSparks.isPrimary,
      note: inspirationSparks.note,
      startOffset: inspirationSparks.startOffset,
      endOffset: inspirationSparks.endOffset,
      createdAt: inspirationSparks.createdAt,
      updatedAt: inspirationSparks.updatedAt,
    })
    .from(inspirationSparks)
    .where(
      and(
        eq(inspirationSparks.inspirationId, params.inspirationId),
        eq(inspirationSparks.userId, params.userId),
      ),
    )
    .orderBy(
      desc(inspirationSparks.isPrimary),
      desc(inspirationSparks.confidence),
      inspirationSparks.createdAt,
    );

  const built = buildMeaningPacket({ inspiration, sparks });
  const [packet] = await db
    .insert(meaningPackets)
    .values({
      userId: params.userId,
      inspirationId: params.inspirationId,
      primarySparkId: built.primarySparkId,
      sparkText: built.sparkText,
      artifactExcerpt: built.artifactExcerpt,
      packetText: built.packetText,
      sourceMetadata: built.sourceMetadata,
      classifierSnapshot: built.classifierSnapshot,
      inputFingerprint: built.inputFingerprint,
      tokenEstimate: built.tokenEstimate,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [meaningPackets.userId, meaningPackets.inspirationId],
      set: {
        primarySparkId: built.primarySparkId,
        sparkText: built.sparkText,
        artifactExcerpt: built.artifactExcerpt,
        packetText: built.packetText,
        sourceMetadata: built.sourceMetadata,
        classifierSnapshot: built.classifierSnapshot,
        inputFingerprint: built.inputFingerprint,
        tokenEstimate: built.tokenEstimate,
        updatedAt: new Date(),
      },
    })
    .returning();

  return { status: "created_or_updated", packet: packet! };
}
