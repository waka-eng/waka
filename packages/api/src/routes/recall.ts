/**
 * `GET /api/recall?q=…` — ask the memory what this person thinks about X.
 *
 * The one door that turns the memory from something a mind RECEIVES (a top
 * of mind, principles) into something it can ASK. The question embeds as a
 * RETRIEVAL_QUERY — the other half of the asymmetric pairing every stored
 * vector was written in — and cosine runs in process over the standing
 * signals' vectors: at or above `RECALL_MIN_COSINE` (the same relatedness
 * floor derivation trusts), strongest first, at most `RECALL_LIMIT`.
 *
 * Matches are SIGNALS — distilled patterns with live confidence — never raw
 * captures: recall answers "what do they think", and the capture behind a
 * thought stays behind its own doors.
 *
 * Access is the read matrix, unchanged: `resolveProfileScope("read")`, so a
 * keeper key asks its own memory, an agent asks its own or a granted
 * sibling's, exactly as `GET /api/signals` already allows. And the asking
 * is ON THE RECORD: every serve writes the same `signals` consultation row
 * a list-read writes — a question about someone's mind is a read of it.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { signalEmbeddings, signals, inspirations, signalEvidence } from "../db/index.js";
import { recordConsultation } from "../lib/consultations.js";
import { getDb } from "../lib/db.js";
import {
  GeminiEmbeddingHttpClient,
  type GeminiEmbeddingClient,
} from "../lib/inspiration-embeddings.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import {
  MATCH_CANDIDATE_SCAN_LIMIT,
  RECALL_LIMIT,
  RECALL_MIN_COSINE,
} from "../lib/signal-derivation-thresholds.js";
import { computeSignalConfidence } from "../lib/signal-derivation.js";
import { validationDetails } from "../lib/validation.js";
import { cosineSimilarity } from "../scoring/vector.js";
import { loadProfileTarget, resolveProfileScope } from "./signals.js";

const recallQuerySchema = z.object({
  q: z.string().trim().min(2, "Ask at least a couple of characters").max(500),
  profile: z.string().uuid().optional(),
});

interface RecallRouteDependencies {
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  getDatabase?: typeof getDb;
  embedClient?: GeminiEmbeddingClient;
  loadProfile?: typeof loadProfileTarget;
}

export function createRecallRoutes(deps: RecallRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const loadProfile = deps.loadProfile ?? loadProfileTarget;
  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsed = recallQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: "Invalid recall query", details: validationDetails(parsed.error) },
        400,
      );
    }

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsed.data.profile,
      "read",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    /* lazily built so a hermetic test can inject without a key in the env */
    const embedClient = deps.embedClient ?? new GeminiEmbeddingHttpClient();
    const queryVector = await embedClient.embed(parsed.data.q, "RETRIEVAL_QUERY");

    /* the standing set, the same bound match-or-mint scans by */
    const rows = await db
      .select({
        id: signals.id,
        statement: signals.statement,
        status: signals.status,
      })
      .from(signals)
      .where(
        and(
          eq(signals.profileId, scope.profileId),
          inArray(signals.status, ["active", "emerging"]),
          isNull(signals.dismissedAt),
        ),
      )
      .orderBy(desc(signals.lastEvidenceAt), desc(signals.createdAt))
      .limit(MATCH_CANDIDATE_SCAN_LIMIT);

    const vectors = rows.length
      ? await db
          .select({
            signalId: signalEmbeddings.signalId,
            embedding: signalEmbeddings.embedding,
          })
          .from(signalEmbeddings)
          .where(
            inArray(
              signalEmbeddings.signalId,
              rows.map((row) => row.id),
            ),
          )
      : [];
    const vectorById = new Map<string, number[]>();
    for (const row of vectors) {
      if (!vectorById.has(row.signalId)) vectorById.set(row.signalId, row.embedding);
    }

    const scoredMatches = rows
      .flatMap((row) => {
        const vector = vectorById.get(row.id);
        if (!vector) return [];
        const similarity = cosineSimilarity(queryVector, vector);
        if (similarity === null || similarity < RECALL_MIN_COSINE) return [];
        return [{ ...row, similarity }];
      })
      .sort((a, b) => b.similarity - a.similarity || (a.id < b.id ? -1 : 1))
      .slice(0, RECALL_LIMIT);

    /* live confidence for exactly the matches served — the same
       read-time honesty every other signal read keeps */
    const evidenceRows = scoredMatches.length
      ? await db
          .select({
            signalId: signalEvidence.signalId,
            createdAt: inspirations.createdAt,
            source: inspirations.source,
          })
          .from(signalEvidence)
          .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
          .where(
            inArray(
              signalEvidence.signalId,
              scoredMatches.map((match) => match.id),
            ),
          )
      : [];
    const evidenceBySignal = new Map<string, Array<{ createdAt: Date; source: "app" | "agent" }>>();
    for (const row of evidenceRows) {
      const bucket = evidenceBySignal.get(row.signalId);
      if (bucket) bucket.push(row);
      else evidenceBySignal.set(row.signalId, [row]);
    }
    const now = new Date();

    /* the asking is a read of the mind, and it lands on the record */
    await recordConsultation(db, {
      profileId: scope.profileId,
      session: c.get("session"),
      surface: "signals",
    });

    return c.json({
      recall: {
        query: parsed.data.q,
        matches: scoredMatches.map((match) => ({
          signalId: match.id,
          statement: match.statement,
          status: match.status,
          similarity: Math.round(match.similarity * 1000) / 1000,
          confidence: computeSignalConfidence(evidenceBySignal.get(match.id) ?? [], now),
          evidenceCount: (evidenceBySignal.get(match.id) ?? []).length,
        })),
      },
    });
  });

  return routes;
}
