import type { TopOfMindNoteSurface } from "../routes/top-of-mind.js";

export const actionRecommendationStatusValues = [
  "active",
  "completed",
  "removed",
] as const;

export type ActionRecommendationStatus =
  (typeof actionRecommendationStatusValues)[number];

export const actionRecommendationKindValues = [
  "message_person",
  "enter_room",
  "make_artifact",
  "remove_pull",
  "test_hunch",
  "revisit_signal",
] as const;

export type ActionRecommendationKind =
  (typeof actionRecommendationKindValues)[number];

export interface ActionRecommendationState {
  actionId: string;
  sourceTopOfMindId: string;
  status: ActionRecommendationStatus;
  outcomeText: string | null;
  relatedSignalIds: string[];
  updatedAt: Date;
}

export interface RecommendedAction {
  id: string;
  text: string;
  sourceTopOfMindId: string;
  sourceSignalIds: string[];
  evidenceSnippets: string[];
  kind: ActionRecommendationKind;
  whyNow: string;
  confidence: number;
  createdAt: Date;
  status: ActionRecommendationStatus;
  dismissedAt: Date | null;
  completedAt: Date | null;
}

export interface ActionRecommendationCandidate {
  id: string;
  sourceTopOfMindId: string;
  sourceSignalIds: string[];
  evidenceSnippets: string[];
  confidence: number;
  createdAt: Date;
  note: TopOfMindNoteSurface;
}

export interface GeneratedActionRecommendationFields {
  text: string;
  kind: ActionRecommendationKind;
  whyNow: string;
}

export interface ActionRecommendationGenerationInput {
  userId: string;
  candidate: ActionRecommendationCandidate;
  states?: ActionRecommendationState[];
}

export interface ActionRecommendationGenerator {
  generateActionRecommendation(
    input: ActionRecommendationGenerationInput,
  ): Promise<GeneratedActionRecommendationFields | null>;
}

const ACTION_RECOMMENDATION_ID_VERSION = "v2";
const GENERIC_ACTION_PATTERN =
  /\b(do one tiny|tiny test|smallest test|explore this|explore it|reflect on|journal|learn more|think about|research|dig deeper|look into|productivity|optimize|write down|make a list)\b/i;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function hasOutcomeEvidence(state: ActionRecommendationState): boolean {
  return Boolean(
    state.status === "completed" &&
      ((state.outcomeText ?? "").trim() || state.relatedSignalIds.length > 0),
  );
}

function scoreOutcomeEvidence(
  note: TopOfMindNoteSurface,
  states: ActionRecommendationState[],
): number {
  const completedOutcomes = states.filter(
    (state) =>
      state.sourceTopOfMindId === note.id && hasOutcomeEvidence(state),
  );
  if (completedOutcomes.length === 0) return 0;
  return Math.min(12, completedOutcomes.length * 8);
}

function baseCandidateConfidence(
  note: TopOfMindNoteSurface,
  states: ActionRecommendationState[],
): number {
  let score = Math.round(note.confidence);
  if (note.evidencePreviews.length > 0) score += 8;
  if (note.evidencePreviews.some((evidence) => evidence.resonanceScore >= 7)) {
    score += 6;
  }
  if (note.antiEnvironment.trim()) score += 4;
  score += scoreOutcomeEvidence(note, states);
  return Math.min(Math.max(score, 0), 100);
}

function buildStableActionId(note: TopOfMindNoteSurface): string {
  const stableKey = [
    ACTION_RECOMMENDATION_ID_VERSION,
    note.id,
    note.ambitionDimension,
    note.relatedSignalIds.join(","),
  ].join(":");
  return `action-${note.id}-${stableHash(stableKey)}`;
}

function isUsefulGeneratedRecommendation(
  generated: GeneratedActionRecommendationFields,
  note: TopOfMindNoteSurface,
): boolean {
  const text = generated.text.trim();
  const whyNow = generated.whyNow.trim();
  if (!text || !whyNow) return false;
  if (!actionRecommendationKindValues.includes(generated.kind)) return false;
  if (text.length > 220 || whyNow.length > 360) return false;
  if (GENERIC_ACTION_PATTERN.test(text)) return false;
  if (normalizeText(text) === normalizeText(note.title)) return false;
  if (!/\b(message|spend|make|show|remove|put|ask|do|share|visit|send|invite|schedule|prototype|try|bring|draft|ship|publish|join|leave|block|compare)\b/i.test(text)) {
    return false;
  }
  return text.split(/\s+/).length >= 6;
}

export function selectActionRecommendationCandidates(input: {
  notes: TopOfMindNoteSurface[];
  states?: ActionRecommendationState[];
  limit?: number;
}): ActionRecommendationCandidate[] {
  const states = input.states ?? [];
  const statesById = new Map(states.map((state) => [state.actionId, state]));

  return input.notes
    .filter((note) => note.status === "active")
    .map((note): ActionRecommendationCandidate => {
      const id = buildStableActionId(note);
      return {
        id,
        sourceTopOfMindId: note.id,
        sourceSignalIds: note.relatedSignalIds,
        evidenceSnippets: note.evidencePreviews
          .map((evidence) => shortText(evidence.textPreview, 120))
          .filter(Boolean),
        confidence: baseCandidateConfidence(note, states),
        createdAt: note.createdAt,
        note,
      };
    })
    .filter((candidate) => candidate.confidence >= 60)
    .filter((candidate) => {
      const state = statesById.get(candidate.id);
      return (state?.status ?? "active") === "active";
    })
    .sort(
      (a, b) =>
        b.confidence - a.confidence || b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .slice(0, input.limit ?? 5);
}

export async function recommendActionsFromTopOfMind(input: {
  userId: string;
  notes: TopOfMindNoteSurface[];
  generator: ActionRecommendationGenerator;
  states?: ActionRecommendationState[];
  limit?: number;
  now?: Date;
}): Promise<RecommendedAction[]> {
  const states = input.states ?? [];
  const statesById = new Map(states.map((state) => [state.actionId, state]));
  const candidates = selectActionRecommendationCandidates({
    notes: input.notes,
    states,
    limit: input.limit,
  });

  const generatedResults = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const generated = await input.generator.generateActionRecommendation({
          userId: input.userId,
          candidate,
          states,
        });
        return { candidate, generated };
      } catch {
        return { candidate, generated: null };
      }
    }),
  );

  const seenText = new Set<string>();
  const actions: RecommendedAction[] = [];
  for (const { candidate, generated } of generatedResults) {
    if (!generated) continue;
    if (!isUsefulGeneratedRecommendation(generated, candidate.note)) continue;
    const text = shortText(generated.text, 220);
    const whyNow = shortText(generated.whyNow, 360);
    const textKey = normalizeText(text);
    if (seenText.has(textKey)) continue;
    seenText.add(textKey);

    const state = statesById.get(candidate.id);
    const status = state?.status ?? "active";
    if (status !== "active") continue;

    actions.push({
      id: candidate.id,
      text,
      sourceTopOfMindId: candidate.sourceTopOfMindId,
      sourceSignalIds: candidate.sourceSignalIds,
      evidenceSnippets: candidate.evidenceSnippets,
      kind: generated.kind,
      whyNow,
      confidence: candidate.confidence,
      createdAt: candidate.createdAt,
      status,
      dismissedAt: null,
      completedAt: null,
    });
  }

  return actions.slice(0, input.limit ?? 5);
}
