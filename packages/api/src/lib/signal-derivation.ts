/**
 * Layer 2 — turning one inspiration into evidence for the profile's signals.
 *
 * The shape of a pass, per capture:
 *
 *   1. load the capture, its reflections, and its attachments' enrichment
 *   2. ask the provider for 0–3 candidate statements, each grounded in a span
 *   3. embed the capture (so layer-1 recall stays warm) and each candidate
 *   4. match-or-mint: cosine each candidate against the profile's existing
 *      signal vectors — above the bar it is evidence for that signal, below
 *      it is a new `emerging` signal
 *   5. recompute lifecycle in pure code: confidence, promotion, recency
 *
 * Only step 2 is a model call. Everything that decides what the profile ends
 * up holding is deterministic and testable without a network, which is what
 * makes the thresholds below tunable rather than mysterious.
 *
 * The lock rule is absolute: a signal whose `lockedAt` is set never has its
 * statement rewritten here. Evidence and confidence keep accruing to it — the
 * human's text is frozen, its support is not.
 *
 * Steps 1–3 are this file. The rest were carved out along those same seams,
 * because the pass had grown past the point where a reader could hold it:
 *
 *   - `signal-derivation-thresholds.ts` — every tuning number, plus
 *     `classifyMatch`, the function that reads two of them. Locked to
 *     docs/generation.md; that file's header explains how, and why it says so.
 *   - `signal-match-or-mint.ts` — step 4. Cosine decides; the one model call
 *     in it is a tie-breaker inside a band and can never overrule the number.
 *   - `signal-lifecycle.ts` — step 5, plus what becomes of a signal when its
 *     evidence is deleted. Arithmetic over rows; no model, no network.
 *   - `signal-embeddings.ts` — the signal-vector store: write, drop, and the
 *     re-embed a human edit triggers.
 *
 * This module re-exports all four with `export *`. That keeps every existing
 * import path working, and — the reason it is `export *` rather than a list of
 * names — it keeps the doc-lock test seeing the whole tuning surface. A named
 * re-export list silently narrows what that test can find; see the header of
 * `signal-derivation-thresholds.ts` for the failure it produced.
 */

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import {
  attachments,
  inspirations,
  profiles,
  reflections,
  signals,
} from "../db/index.js";
import { cosineSimilarity } from "../scoring/vector.js";
import { getDb } from "./db.js";
import {
  ensureInspirationEmbedding,
  GeminiEmbeddingHttpClient,
} from "./inspiration-embeddings.js";
import { normalizeSupportedLocale } from "./locales.js";
import { verifyQuote } from "./salience.js";
import { getDefaultModelProvider, type ModelProvider } from "./model-provider.js";
import {
  MATCH_CANDIDATE_SCAN_LIMIT,
  SIGNAL_BATCH_DEDUPE_MIN_COSINE,
} from "./signal-derivation-thresholds.js";
import type { StatementEmbeddingClient } from "./signal-embeddings.js";
import {
  acquireSignalDerivationLock,
  applyCandidates,
  type ResolvedCandidate,
} from "./signal-match-or-mint.js";

export * from "./signal-derivation-thresholds.js";
export * from "./signal-embeddings.js";
export * from "./signal-lifecycle.js";
export * from "./signal-match-or-mint.js";

type WakaDb = ReturnType<typeof getDb>;

// Bounds on what one candidate may carry into the database. Unexported on
// purpose: `signal-derivation-thresholds.ts` is machine-checked against
// docs/generation.md, so exporting these would enrol them in that lock and
// oblige the doc to carry three rows about string truncation. They belong
// beside `clip`, which is their only caller.
const MAX_STATEMENT_LENGTH = 500;
const MAX_QUOTE_LENGTH = 500;
const MAX_REASON_LENGTH = 500;

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

export interface DeriveSignalsInput {
  inspirationId: string;
  /** "created" on capture, "edited" when a change re-derives the capture. */
  reason: "created" | "edited";
}

export interface SignalDerivationDependencies {
  db?: WakaDb;
  modelProvider?: ModelProvider;
  embeddingClient?: StatementEmbeddingClient;
  now?: Date;
}

export interface SignalDerivationResult {
  status: "derived" | "missing_inspiration" | "no_candidates";
  inspirationId: string;
  profileId: string | null;
  candidateCount: number;
  /** Existing signals this capture became evidence for. */
  matchedSignalIds: string[];
  /** Signals minted because nothing the profile held was close enough. */
  mintedSignalIds: string[];
  /** Signals that crossed the evidence bar into `active` on this pass. */
  promotedSignalIds: string[];
}

/**
 * Derive signals for one inspiration.
 *
 * Returns rather than throws for the two ordinary "nothing to do" outcomes —
 * the capture was deleted while the job waited, or it carries no durable
 * pattern. Both are correct states, not failures, and a queue that retries
 * them three times learns nothing on attempts two and three.
 */
export async function deriveSignalsForInspiration(
  input: DeriveSignalsInput,
  deps: SignalDerivationDependencies = {},
): Promise<SignalDerivationResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const provider = deps.modelProvider ?? (await getDefaultModelProvider());
  const embeddingClient = deps.embeddingClient ?? new GeminiEmbeddingHttpClient();

  const [inspiration] = await db
    .select()
    .from(inspirations)
    .where(eq(inspirations.id, input.inspirationId))
    .limit(1);

  if (!inspiration) {
    return {
      status: "missing_inspiration",
      inspirationId: input.inspirationId,
      profileId: null,
      candidateCount: 0,
      matchedSignalIds: [],
      mintedSignalIds: [],
      promotedSignalIds: [],
    };
  }

  const profileId = inspiration.profileId;

  const [profileRows, reflectionRows, attachmentRows, existingStatements] = await Promise.all([
    db
      .select({ preferredLocale: profiles.preferredLocale })
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .limit(1),
    db
      .select({
        question: reflections.question,
        answer: reflections.answer,
      })
      .from(reflections)
      .where(
        and(
          eq(reflections.inspirationId, inspiration.id),
          eq(reflections.skipped, false),
          isNotNull(reflections.answer),
        ),
      ),
    db
      .select({
        kind: attachments.enrichmentKind,
        text: attachments.enrichmentText,
        hostname: attachments.hostname,
        name: attachments.name,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.inspirationId, inspiration.id),
          eq(attachments.enrichmentStatus, "ready"),
          isNotNull(attachments.enrichmentText),
        ),
      ),
    db
      .select({ id: signals.id, statement: signals.statement })
      .from(signals)
      .where(
        and(
          eq(signals.profileId, profileId),
          inArray(signals.status, ["emerging", "active"]),
        ),
      )
      .orderBy(desc(signals.lastEvidenceAt))
      .limit(MATCH_CANDIDATE_SCAN_LIMIT),
  ]);

  const extraction = await provider.extractSignalCandidates({
    profileId,
    // Statements come back in the owner's language; the locale is the hint
    // that keeps a Korean archive from being distilled into English.
    preferredLocale: normalizeSupportedLocale(profileRows[0]?.preferredLocale),
    inspiration: {
      id: inspiration.id,
      text: inspiration.text,
      source: inspiration.source,
      createdAt: inspiration.createdAt,
    },
    reflections: reflectionRows.map((row) => ({
      question: row.question,
      answer: row.answer ?? "",
    })),
    attachments: attachmentRows.flatMap((row) =>
      row.text && row.kind
        ? [{ kind: row.kind, label: row.hostname ?? row.name, text: row.text }]
        : [],
    ),
    existingStatements,
  });

  // The capture's own vector is layer-1 machinery (recall, future matching),
  // and it is worth keeping current even when this capture yielded nothing.
  // The injected db and embedding client flow through — in production both
  // defaults resolve to the same thing, and a test that stubbed them must
  // never find a second, unstubbed connection underneath.
  await ensureInspirationEmbedding({
    profileId,
    inspirationId: inspiration.id,
    db,
    client: embeddingClient,
  });

  /**
   * The model names a span; `verifyQuote` decides whether to believe it. A
   * quote survives only as a literal (whitespace-normalized) span of the
   * person's own words — their capture and their reflection answers — or of
   * the page enrichment behind their link, labeled which, because those are
   * different claims about a person. Verification runs BEFORE the clip: the
   * other order truncates a long honest quote into something verification
   * would then reject (docs/known-issues.md H2). The clip afterwards only
   * shortens a verified span, which keeps it a verified span.
   */
  const ownText = [inspiration.text, ...reflectionRows.map((row) => row.answer ?? "")]
    .filter((piece) => piece.length > 0)
    .join("\n\n");
  const enrichmentText = attachmentRows
    .map((row) => row.text)
    .filter((piece): piece is string => Boolean(piece))
    .join("\n\n");

  const statements = extraction.statements
    .map((candidate) => {
      const verified = verifyQuote(candidate.quote, {
        text: ownText,
        enrichment: enrichmentText.length > 0 ? enrichmentText : null,
      });
      return {
        statement: clip(candidate.statement, MAX_STATEMENT_LENGTH),
        reason: candidate.reason ? clip(candidate.reason, MAX_REASON_LENGTH) : null,
        quote: verified ? clip(verified.quote, MAX_QUOTE_LENGTH) : null,
        quoteSource: verified?.source ?? null,
      };
    })
    .filter((candidate) => candidate.statement.length > 0);

  if (statements.length === 0) {
    return {
      status: "no_candidates",
      inspirationId: inspiration.id,
      profileId,
      candidateCount: 0,
      matchedSignalIds: [],
      mintedSignalIds: [],
      promotedSignalIds: [],
    };
  }

  const embedded: ResolvedCandidate[] = [];
  for (const candidate of statements) {
    const embedding = await embeddingClient.embed(candidate.statement);
    // One capture saying the same thing twice is one pattern.
    const duplicate = embedded.some((seen) => {
      const similarity = cosineSimilarity(seen.embedding, embedding);
      return similarity !== null && similarity >= SIGNAL_BATCH_DEDUPE_MIN_COSINE;
    });
    if (!duplicate) embedded.push({ ...candidate, embedding });
  }

  const outcome = await db.transaction(async (tx) => {
    await acquireSignalDerivationLock(tx, profileId);
    return applyCandidates(tx, {
      profileId,
      /* a personal derivation reads its own memory; the room path (which
         derives into a mind while citing a member) sets these apart */
      evidenceOwnerProfileId: inspiration.profileId,
      inspirationId: inspiration.id,
      candidates: embedded,
      embeddingModel: embeddingClient.model,
      provider,
      preferredLocale: normalizeSupportedLocale(profileRows[0]?.preferredLocale),
      now,
    });
  });

  return {
    status: "derived",
    inspirationId: inspiration.id,
    profileId,
    candidateCount: embedded.length,
    ...outcome,
  };
}

/** Exposed for callers that summarize a pass without re-reading the rows. */
export function describeSignalDerivation(result: SignalDerivationResult): string {
  return [
    `status=${result.status}`,
    `candidates=${result.candidateCount}`,
    `matched=${result.matchedSignalIds.length}`,
    `minted=${result.mintedSignalIds.length}`,
    `promoted=${result.promotedSignalIds.length}`,
  ].join(" ");
}
