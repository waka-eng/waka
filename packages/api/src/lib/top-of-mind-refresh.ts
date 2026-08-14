import { and, desc, eq, inArray, or } from "drizzle-orm";

import {
  feedback,
  inspirations,
  inspirationSparks,
  meaningEvidence,
  meaningNodes,
  meaningPackets,
  users,
  wowMomentInspirations,
  wowMoments,
  type WowKind,
} from "../db/index.js";
import {
  runBoundedAmbitionSynthesisLoop,
  type AmbitionSynthesisFailure,
  type AmbitionSynthesisFeedbackInput,
  type AmbitionSynthesisTrigger,
} from "./ambition-synthesis.js";
import {
  normalizeContextNodeType,
  type ContextNodeType,
} from "./context-node-types.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import { normalizeSupportedLocale, type SupportedLocale } from "./locales.js";
import {
  getDefaultModelProvider,
  type ModelProvider,
} from "./model-provider.js";
import { deriveMemoryPattern, type MemoryPattern } from "./memory-movement.js";
import type { AmbitionDimension } from "./top-of-mind-notes.js";
import { persistTopOfMindRevision } from "./top-of-mind-persistence.js";
import {
  canonicalTopOfMindValue,
  evidenceFingerprint,
  semanticFamilyKey,
} from "./top-of-mind-value.js";

const DEFAULT_REFRESH_LIMIT = 5;
const MAX_REFRESH_LIMIT = 20;
const MIN_EVIDENCE_PER_NOTE = 3;
const MAX_EVIDENCE_PER_NOTE = 5;
const MAX_TITLE_CHARS = 120;
const MAX_REASON_CHARS = 180;

export interface TopOfMindRefreshNodeInput {
  id: string;
  type: string;
  label: string;
  description: string;
  weight: number;
  confidence: number;
  evidenceCount: number;
  firstSeenAt: Date;
  lastReinforcedAt: Date;
}

export interface TopOfMindRefreshEvidenceInput {
  meaningNodeId: string;
  inspirationId: string;
  reason: string;
  weight: number;
  createdAt: Date;
  inspirationText: string;
  sparkText: string | null;
  sparkNote?: string | null;
}

export interface TopOfMindRefreshCandidate {
  preferredLocale: SupportedLocale;
  node: TopOfMindRefreshNodeInput;
  contextType: ContextNodeType;
  evidence: TopOfMindRefreshEvidenceInput[];
  memoryPattern: MemoryPattern;
  score: number;
  idempotencyKey: string;
  title: string;
  ambientSignal: string;
  matchedEnvironment: string;
  antiEnvironment: string;
  evidenceRationale: string;
  rejectedAlternativeInterpretation?: string;
  why: string;
  ambitionDimension: AmbitionDimension;
  kind: WowKind;
  reflectionQuestion: string | null;
  reflectionGuide: string | null;
  wowScore: number;
}

export interface RefreshTopOfMindNotesResult {
  generated: number;
  existing: number;
  skipped: number;
  synthesis: {
    attempted: number;
    synthesized: number;
    failed: number;
    skipped: number;
    failures: AmbitionSynthesisFailure[];
  };
  candidates: TopOfMindRefreshCandidate[];
  notes: Array<{
    id: string;
    contextNodeId: string;
    status: "created" | "existing";
  }>;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function contextPriority(type: ContextNodeType): number {
  switch (type) {
    case "project":
      return 90;
    case "open_question":
      return 86;
    case "tension":
      return 82;
    case "hypothesis":
      return 74;
    case "value":
      return 68;
    case "theme":
      return 54;
    case "environment":
      return 44;
    case "person":
      return 40;
    case "aesthetic":
      return 36;
  }
}

function recencyScore(date: Date, now: Date): number {
  const ageDays = Math.max(0, now.getTime() - date.getTime()) / 86_400_000;
  if (ageDays <= 3) return 48;
  if (ageDays <= 14) return 32;
  if (ageDays <= 45) return 18;
  return 0;
}

function candidateScore(
  node: TopOfMindRefreshNodeInput,
  type: ContextNodeType,
  memoryPattern: MemoryPattern,
  now: Date,
): number {
  return (
    node.evidenceCount * 130 +
    memoryPattern.currentWeight +
    node.confidence * 0.6 +
    contextPriority(type) +
    recencyScore(node.lastReinforcedAt, now) +
    memoryPattern.movementScore
  );
}

function noteKindForContextType(type: ContextNodeType): WowKind {
  switch (type) {
    case "tension":
      return "tension";
    case "open_question":
    case "hypothesis":
      return "outlier";
    case "project":
    case "value":
      return "bridge";
    default:
      return "recurrence";
  }
}

function reflectionQuestionForContextType(
  node: TopOfMindRefreshNodeInput,
  type: ContextNodeType,
): string | null {
  if (type === "open_question") {
    const label = normalizeWhitespace(node.label);
    return label.endsWith("?") ? label : `${label}?`;
  }
  if (type === "tension") {
    return "What correction would make this feel truer right now?";
  }
  if (type === "hypothesis") {
    return "What would you look for next to test this?";
  }
  return null;
}

function reflectionGuideForContextType(type: ContextNodeType): string | null {
  if (type !== "project") return null;
  return [
    "Start here",
    "Name the smallest next signal that would make this direction more concrete.",
  ].join("\n");
}

function evidencePreview(
  evidence: TopOfMindRefreshEvidenceInput | undefined,
): string {
  if (!evidence) return "";
  return truncateText(evidence.sparkText || evidence.inspirationText, 96);
}

function displayLabel(value: string): string {
  const label = normalizeWhitespace(value).replace(/[.。]+$/, "");
  if (!label) return "this";
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

function ambitionDimensionForContextType(
  type: ContextNodeType,
): AmbitionDimension {
  switch (type) {
    case "environment":
      return "place";
    case "person":
      return "people";
    case "project":
      return "work";
    case "aesthetic":
      return "taste";
    case "tension":
      return "rejection";
    case "open_question":
    case "hypothesis":
      return "next_experiment";
    case "value":
      return "identity";
    case "theme":
    default:
      return "work";
  }
}

function buildInternalFrequency(
  node: TopOfMindRefreshNodeInput,
  type: ContextNodeType,
  evidence: TopOfMindRefreshEvidenceInput[],
): Pick<
  TopOfMindRefreshCandidate,
  | "ambientSignal"
  | "matchedEnvironment"
  | "antiEnvironment"
  | "evidenceRationale"
> {
  const label = displayLabel(node.label);
  const dimension = ambitionDimensionForContextType(type);
  const evidenceCount = Math.max(node.evidenceCount, evidence.length);
  const patternScope =
    evidenceCount > 1
      ? `${evidenceCount} saved signals are clustering around this frequency`
      : "one saved signal is starting this frequency";
  const evidencePhrase =
    evidence.length > 1
      ? `${patternScope}, with the strongest ones pointing through "${evidencePreview(evidence[0])}" and "${evidencePreview(evidence[1])}".`
      : `${patternScope}, led by "${evidencePreview(evidence[0]) || label}".`;

  switch (dimension) {
    case "place":
      return {
        ambientSignal: "",
        matchedEnvironment: `A city, studio, or room where ${label} feels publicly reinforced.`,
        antiEnvironment:
          "Settings that make ambition feel private, apologetic, or over-explained.",
        evidenceRationale: evidencePhrase,
      };
    case "people":
      return {
        ambientSignal: "",
        matchedEnvironment: `People who make ${label} feel like a shared operating rhythm.`,
        antiEnvironment:
          "Circles where permission, polish, or social caution arrives before motion.",
        evidenceRationale: evidencePhrase,
      };
    case "work":
      return {
        ambientSignal: "",
        matchedEnvironment: `A working culture where ${label} becomes visible through repeated making.`,
        antiEnvironment:
          "Work contexts that reward commentary while the real object stays abstract.",
        evidenceRationale: evidencePhrase,
      };
    case "taste":
      return {
        ambientSignal: "",
        matchedEnvironment: `Surroundings where ${label} is treated as a standard, not decoration.`,
        antiEnvironment:
          "Rooms that flatten taste into trend, convenience, or generic approval.",
        evidenceRationale: evidencePhrase,
      };
    case "tension":
    case "rejection":
      return {
        ambientSignal: "",
        matchedEnvironment: `A surrounding culture that lets the tension around ${label} stay visible long enough to choose from it.`,
        antiEnvironment:
          "Rooms that smooth over the live part so everyone can keep performing agreement.",
        evidenceRationale: evidencePhrase,
      };
    case "identity":
      return {
        ambientSignal: "",
        matchedEnvironment: `An environment where ${label} is mirrored back as normal behavior.`,
        antiEnvironment:
          "Contexts that make the emerging version of you feel like a private exception.",
        evidenceRationale: evidencePhrase,
      };
    case "next_experiment":
      return {
        ambientSignal: "",
        matchedEnvironment: `A practical setting where ${label} can be tested in public conditions.`,
        antiEnvironment:
          "Analysis loops that keep the question safe, abstract, and uncostly.",
        evidenceRationale: evidencePhrase,
      };
  }
}

function buildIdempotencyKey(
  userId: string,
  nodeId: string,
  fingerprint: string,
): string {
  return `top_of_mind_context_node:v2:${userId}:${nodeId}:${fingerprint}`;
}

/**
 * The subset of these keys that already has a note.
 *
 * Deliberately unfiltered by lifecycle: the unique index on
 * `idempotency_key` is global, and `persistTopOfMindRevision` returns
 * `keep_existing` on any match. Matching what persistence will do is the whole
 * point — a key that is going to be rejected at write time should not be paid
 * for at synthesis time.
 */
async function loadExistingContextNoteKeys(
  db: WakaDb,
  input: { userId: string; candidateKeys: string[] },
): Promise<Set<string>> {
  if (input.candidateKeys.length === 0) return new Set<string>();
  const rows = await db
    .select({ idempotencyKey: wowMoments.idempotencyKey })
    .from(wowMoments)
    .where(
      and(
        eq(wowMoments.userId, input.userId),
        inArray(wowMoments.idempotencyKey, input.candidateKeys),
      ),
    );
  return new Set(rows.map((row) => row.idempotencyKey));
}

function groupEvidenceByNodeId(
  evidence: TopOfMindRefreshEvidenceInput[],
): Map<string, TopOfMindRefreshEvidenceInput[]> {
  const byNodeId = new Map<string, TopOfMindRefreshEvidenceInput[]>();
  for (const row of evidence) {
    const bucket = byNodeId.get(row.meaningNodeId) ?? [];
    bucket.push(row);
    byNodeId.set(row.meaningNodeId, bucket);
  }
  return byNodeId;
}

export function rankTopOfMindRefreshCandidates(input: {
  userId: string;
  preferredLocale?: SupportedLocale;
  nodes: TopOfMindRefreshNodeInput[];
  evidence: TopOfMindRefreshEvidenceInput[];
  existingIdempotencyKeys?: Set<string>;
  limit?: number;
  now?: Date;
}): TopOfMindRefreshCandidate[] {
  const now = input.now ?? new Date();
  const limit = Math.min(
    Math.max(input.limit ?? DEFAULT_REFRESH_LIMIT, 1),
    MAX_REFRESH_LIMIT,
  );
  const existing = input.existingIdempotencyKeys ?? new Set<string>();
  const preferredLocale = input.preferredLocale ?? "en-US";
  const evidenceByNodeId = groupEvidenceByNodeId(input.evidence);

  return input.nodes
    .map((node) => {
      const contextType = normalizeContextNodeType(node.type);
      const evidence = (evidenceByNodeId.get(node.id) ?? [])
        .slice()
        .sort(
          (a, b) =>
            b.weight - a.weight ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .slice(0, MAX_EVIDENCE_PER_NOTE);
      const idempotencyKey = buildIdempotencyKey(
        input.userId,
        node.id,
        evidenceFingerprint(evidence.map((row) => row.inspirationId)),
      );
      const memoryPattern = deriveMemoryPattern({ node, evidence, now });
      const ambitionDimension = ambitionDimensionForContextType(contextType);
      const frequency = buildInternalFrequency(node, contextType, evidence);
      return {
        preferredLocale,
        node,
        contextType,
        evidence,
        memoryPattern,
        score: candidateScore(node, contextType, memoryPattern, now),
        idempotencyKey,
        title: truncateText(frequency.ambientSignal, MAX_TITLE_CHARS),
        ...frequency,
        why: "",
        ambitionDimension,
        kind: noteKindForContextType(contextType),
        reflectionQuestion:
          preferredLocale === "ko-KR"
            ? null
            : reflectionQuestionForContextType(node, contextType),
        reflectionGuide:
          preferredLocale === "ko-KR"
            ? null
            : reflectionGuideForContextType(contextType),
        wowScore: canonicalTopOfMindValue({
          evidenceCount: evidence.length,
          confidence: node.confidence,
          relevance: node.weight,
          novelty:
            contextType === "hypothesis" || contextType === "tension" ? 80 : 60,
        }),
      };
    })
    .filter(
      (candidate) =>
        candidate.evidence.length >= MIN_EVIDENCE_PER_NOTE &&
        candidate.node.evidenceCount >= MIN_EVIDENCE_PER_NOTE &&
        !existing.has(candidate.idempotencyKey),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.node.evidenceCount - a.node.evidenceCount ||
        b.node.weight - a.node.weight,
    )
    .slice(0, limit);
}

async function loadPreferredLocale(
  db: WakaDb,
  userId: string,
): Promise<SupportedLocale> {
  const [user] = await db
    .select({ preferredLocale: users.preferredLocale })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return normalizeSupportedLocale(user?.preferredLocale);
}

/**
 * Which slice of the user's signals a distillation pass reads.
 *
 * "all" is the pre-existing behaviour (every signal). "app" and "agent"
 * narrow the evidence to signals with the matching `signals.source`, so an
 * owner-taste profile and an agent-lessons profile can be distilled
 * independently from the same store.
 */
export type TopOfMindLens = "all" | "app" | "agent";

export async function refreshTopOfMindNotesFromContextGraph(
  db: WakaDb,
  input: {
    userId: string;
    preferredLocale?: SupportedLocale;
    limit?: number;
    now?: Date;
    modelProvider?: ModelProvider;
    synthesisTrigger?: AmbitionSynthesisTrigger;
    lens?: TopOfMindLens;
  },
): Promise<RefreshTopOfMindNotesResult> {
  const lens = input.lens ?? "all";
  // Lens-scoped notes live in the same table under the same uniqueness
  // indexes, so their keys get a `<lens>:` prefix; the "all" lens keeps its
  // historical unprefixed keys.
  const lensKey = (key: string): string =>
    lens === "all" ? key : `${lens}:${key}`;
  const preferredLocale =
    input.preferredLocale ?? (await loadPreferredLocale(db, input.userId));
  const nodes = await db
    .select({
      id: meaningNodes.id,
      type: meaningNodes.type,
      label: meaningNodes.label,
      description: meaningNodes.description,
      weight: meaningNodes.weight,
      confidence: meaningNodes.confidence,
      evidenceCount: meaningNodes.evidenceCount,
      firstSeenAt: meaningNodes.firstSeenAt,
      lastReinforcedAt: meaningNodes.lastReinforcedAt,
    })
    .from(meaningNodes)
    .where(
      and(
        eq(meaningNodes.userId, input.userId),
        eq(meaningNodes.status, "active"),
      ),
    )
    .orderBy(desc(meaningNodes.evidenceCount), desc(meaningNodes.weight))
    .limit(80);

  const nodeIds = nodes.map((node) => node.id);
  const evidence = await (nodeIds.length === 0
    ? []
    : db
        .select({
          meaningNodeId: meaningEvidence.meaningNodeId,
          inspirationId: meaningEvidence.inspirationId,
          reason: meaningEvidence.reason,
          weight: meaningEvidence.weight,
          createdAt: meaningEvidence.createdAt,
          inspirationText: inspirations.text,
          sparkText: meaningPackets.sparkText,
          sparkNote: inspirationSparks.note,
        })
        .from(meaningEvidence)
        .innerJoin(
          inspirations,
          and(
            eq(inspirations.id, meaningEvidence.inspirationId),
            eq(inspirations.userId, meaningEvidence.userId),
          ),
        )
        .innerJoin(
          meaningPackets,
          and(
            eq(meaningPackets.id, meaningEvidence.packetId),
            eq(meaningPackets.userId, meaningEvidence.userId),
          ),
        )
        .leftJoin(
          inspirationSparks,
          and(
            eq(inspirationSparks.id, meaningPackets.primarySparkId),
            eq(inspirationSparks.userId, meaningEvidence.userId),
          ),
        )
        .where(
          and(
            eq(meaningEvidence.userId, input.userId),
            inArray(meaningEvidence.meaningNodeId, nodeIds),
            // A scoped lens only reads evidence whose underlying signal was
            // captured by that client kind; "all" keeps the full view.
            ...(lens === "all" ? [] : [eq(inspirations.source, lens)]),
          ),
        )
        .orderBy(desc(meaningEvidence.weight), desc(meaningEvidence.createdAt))
        .limit(240));
  /**
   * Which of the notes this pass could produce are already on the wall.
   *
   * This was `new Set<string>()` with nothing ever writing to it, so the
   * `!existing.has(key)` filter in `rankTopOfMindRefreshCandidates` was a
   * permanent no-op: every pass re-synthesized notes it already had, spending
   * up to five sequential 25s-bounded Gemini calls per save, and
   * `persistTopOfMindRevision` then returned `keep_existing` for each
   * unchanged fingerprint and threw the text away.
   *
   * It regressed in 06568c2, which put the evidence fingerprint into the key.
   * The loader it replaced precomputed keys from node ids alone, which the new
   * shape makes impossible — a key is not knowable until its candidate's
   * evidence has been chosen.
   *
   * So probe first. Ranking is pure and does no I/O, so running it once to
   * learn the keys, asking the database, and ranking again is one extra query
   * and no extra model call. Doing it in this order also means an
   * already-persisted note does not consume one of the `limit` slots, which
   * filtering the ranked output afterwards would get wrong.
   */
  const probedKeys = rankTopOfMindRefreshCandidates({
    userId: input.userId,
    preferredLocale,
    nodes,
    evidence,
    limit: MAX_REFRESH_LIMIT,
    now: input.now,
  }).map((candidate) => candidate.idempotencyKey);
  // The database stores lens-prefixed keys, while ranking/synthesis work in
  // unprefixed key space — probe with the stored form, hand back the bare one.
  const existingStoredKeys = await loadExistingContextNoteKeys(db, {
    userId: input.userId,
    candidateKeys: probedKeys.map(lensKey),
  });
  const existingIdempotencyKeys =
    lens === "all"
      ? existingStoredKeys
      : new Set(
          [...existingStoredKeys].map((key) => key.slice(lens.length + 1)),
        );

  const modelProvider =
    input.modelProvider ?? (await getDefaultModelProvider());
  const rankedCandidates = await modelProvider.generateTopOfMindNotes({
    userId: input.userId,
    preferredLocale,
    nodes,
    evidence,
    existingIdempotencyKeys,
    limit: input.limit,
    now: input.now,
  });
  const candidateNodeIds = rankedCandidates.map(
    (candidate) => candidate.node.id,
  );
  const candidateSignalIds = [
    ...new Set(
      rankedCandidates.flatMap((candidate) =>
        candidate.evidence.map((row) => row.inspirationId),
      ),
    ),
  ];
  const synthesisFeedback: AmbitionSynthesisFeedbackInput[] =
    candidateNodeIds.length === 0 && candidateSignalIds.length === 0
      ? []
      : (
          await db
            .select({
              targetType: feedback.targetType,
              targetId: feedback.targetId,
              value: feedback.value,
              emotionLabel: feedback.emotionLabel,
              correctionText: feedback.correctionText,
              createdAt: feedback.createdAt,
            })
            .from(feedback)
            .where(
              and(
                eq(feedback.userId, input.userId),
                or(
                  candidateNodeIds.length > 0
                    ? and(
                        inArray(feedback.targetType, [
                          "context_node",
                          "hypothesis",
                        ]),
                        inArray(feedback.targetId, candidateNodeIds),
                      )
                    : undefined,
                  candidateSignalIds.length > 0
                    ? and(
                        eq(feedback.targetType, "signal"),
                        inArray(feedback.targetId, candidateSignalIds),
                      )
                    : undefined,
                ),
              ),
            )
            .orderBy(desc(feedback.createdAt))
            .limit(80)
        ).map((row) => ({
          targetType: row.targetType,
          targetId: row.targetId,
          value: row.value,
          emotionLabel: row.emotionLabel,
          correctionText: row.correctionText,
          createdAt: row.createdAt,
        }));
  const synthesisResult = await runBoundedAmbitionSynthesisLoop({
    userId: input.userId,
    trigger: input.synthesisTrigger ?? "weekly_refresh",
    candidates: rankedCandidates,
    feedback: synthesisFeedback,
    synthesize: modelProvider.synthesizeAmbition,
  });
  const candidates = synthesisResult.candidates;

  const notes: RefreshTopOfMindNotesResult["notes"] = [];
  for (const candidate of candidates) {
    const semanticKey = lensKey(
      semanticFamilyKey("context_node", candidate.node.id),
    );
    const candidateEvidenceIds = [
      ...new Set(candidate.evidence.map((row) => row.inspirationId)),
    ].sort();
    const fingerprint = evidenceFingerprint(candidateEvidenceIds);
    const persisted = await persistTopOfMindRevision({
      db,
      userId: input.userId,
      semanticKey,
      evidenceFingerprint: fingerprint,
      evidenceIds: candidateEvidenceIds,
      value: candidate.wowScore,
      createRevision: async (tx) => {
        const [createdMoment] = await tx
          .insert(wowMoments)
          .values({
            userId: input.userId,
            title: candidate.title,
            kind: candidate.kind,
            idempotencyKey: lensKey(candidate.idempotencyKey),
            lens,
            why: candidate.why,
            beliefStatement: candidate.title,
            reflectionQuestion: candidate.reflectionQuestion,
            reflectionGuide: candidate.reflectionGuide,
            locale: candidate.preferredLocale,
            wowScore: candidate.wowScore,
            semanticKey,
            evidenceFingerprint: fingerprint,
          } as typeof wowMoments.$inferInsert)
          .onConflictDoNothing({ target: wowMoments.idempotencyKey })
          .returning();
        if (!createdMoment)
          throw new Error(
            "Top-of-mind revision insert conflicted unexpectedly.",
          );
        await tx
          .insert(wowMomentInspirations)
          .values(
            candidate.evidence.map((row, index) => ({
              userId: input.userId,
              wowMomentId: createdMoment.id,
              inspirationId: row.inspirationId,
              role: "Evidence signal",
              reason: truncateText(
                row.reason || "This signal supports the note.",
                MAX_REASON_CHARS,
              ),
              sortOrder: index,
            })),
          )
          .onConflictDoNothing({
            target: [
              wowMomentInspirations.wowMomentId,
              wowMomentInspirations.inspirationId,
            ],
          });
        return createdMoment;
      },
    });
    notes.push({
      id: persisted.note.id,
      contextNodeId: candidate.node.id,
      status:
        persisted.action === "create" || persisted.action === "replace"
          ? "created"
          : "existing",
    });
  }

  return {
    generated: notes.filter((note) => note.status === "created").length,
    existing: notes.filter((note) => note.status === "existing").length,
    skipped: Math.max(0, nodes.length - candidates.length),
    synthesis: {
      attempted: synthesisResult.attempted,
      synthesized: synthesisResult.synthesized,
      failed: synthesisResult.failed,
      skipped: synthesisResult.skipped,
      failures: synthesisResult.failures,
    },
    candidates,
    notes,
  };
}
