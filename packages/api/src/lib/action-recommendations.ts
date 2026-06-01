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

function objectText(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? "")
    .replace(/["“”]/g, "")
    .replace(/[.?!:;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return shortText(cleaned, 72).replace(/[.?!:;]+$/g, "");
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function firstEvidenceSnippet(note: TopOfMindNoteSurface): string | null {
  const preview =
    note.evidencePreviews.find((evidence) => evidence.textPreview.trim())
      ?.textPreview ??
    note.relatedSignals.find((signal) => signal.preview.trim())?.preview;
  return preview ? objectText(preview, "the saved signal") : null;
}

function repeatedMotif(note: TopOfMindNoteSurface): string {
  return objectText(
    note.matchedEnvironment || note.ambientSignal || note.title,
    "this pattern",
  );
}

function buildActionText(
  note: TopOfMindNoteSurface,
): { text: string; kind: ActionRecommendationKind } | null {
  const label = objectText(note.title || note.ambientSignal, "this post-it");
  const environment = repeatedMotif(note);
  const antiEnvironment = objectText(note.antiEnvironment, label);
  const evidence = firstEvidenceSnippet(note);

  switch (note.ambitionDimension) {
    case "people":
      return {
        kind: "message_person",
        text: `Message one person who makes ${label.toLowerCase()} feel normal and ask for a 20-minute exchange.`,
      };
    case "place":
      return {
        kind: "enter_room",
        text: `Spend one hour in a room like ${environment.toLowerCase()}, then save what shifted there.`,
      };
    case "work":
      return {
        kind: "make_artifact",
        text: /make the thing before explaining it/i.test(label)
          ? "Make the rough thing first, then show one person before explaining it."
          : `Make a rough artifact from ${(
              evidence ?? label
            ).toLowerCase()} and show one person within 72 hours.`,
      };
    case "taste":
      return {
        kind: "make_artifact",
        text: `Make one version using the standard in ${(
          evidence ?? label
        ).toLowerCase()} and compare it with one discerning person.`,
      };
    case "rejection":
      return {
        kind: "remove_pull",
        text: `Remove one pull toward ${antiEnvironment.toLowerCase()} for the next 48 hours.`,
      };
    case "tension":
      return {
        kind: "test_hunch",
        text: `Put ${label.toLowerCase()} in front of one trusted person and ask what feels false.`,
      };
    case "identity":
      return {
        kind: "test_hunch",
        text: `Do one visible act from ${label.toLowerCase()} before you can fully explain it.`,
      };
    case "next_experiment":
      return {
        kind: "test_hunch",
        text: `Ask one person to try the rough version of ${label.toLowerCase()} this week.`,
      };
    default:
      return null;
  }
}

function isUsefulActionText(text: string, note: TopOfMindNoteSurface): boolean {
  const normalizedText = normalizeText(text);
  if (GENERIC_ACTION_PATTERN.test(text)) return false;
  if (normalizedText === normalizeText(note.title)) return false;
  if (!/\b(message|spend|make|show|remove|put|ask|do|share|visit|send|invite)\b/i.test(text)) {
    return false;
  }
  if (!/\b(person|people|room|hour|artifact|version|pull|trusted|visible|rough|week|48 hours|72 hours|exchange)\b/i.test(text)) {
    return false;
  }
  return text.split(/\s+/).length >= 8;
}

function scoreAction(note: TopOfMindNoteSurface, text: string): number {
  let score = Math.round(note.confidence);
  if (note.evidencePreviews.length > 0) score += 8;
  if (note.evidencePreviews.some((evidence) => evidence.resonanceScore >= 7)) {
    score += 6;
  }
  if (note.antiEnvironment.trim()) score += 4;
  if (/\b(48 hours|72 hours|this week|one hour|20-minute)\b/i.test(text)) {
    score += 5;
  }
  return Math.min(Math.max(score, 0), 100);
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

export function recommendActionsFromTopOfMind(input: {
  notes: TopOfMindNoteSurface[];
  states?: ActionRecommendationState[];
  limit?: number;
  now?: Date;
}): RecommendedAction[] {
  const now = input.now ?? new Date();
  const statesById = new Map(
    (input.states ?? []).map((state) => [state.actionId, state]),
  );
  const states = input.states ?? [];
  const seenText = new Set<string>();

  const candidates = input.notes
    .filter((note) => note.status === "active")
    .flatMap((note) => {
      const action = buildActionText(note);
      if (!action || !isUsefulActionText(action.text, note)) return [];
      const textKey = normalizeText(action.text);
      if (seenText.has(textKey)) return [];
      seenText.add(textKey);

      const id = `action-${note.id}-${stableHash(action.text)}`;
      const state = statesById.get(id);
      const status = state?.status ?? "active";
      const confidence = Math.min(
        scoreAction(note, action.text) + scoreOutcomeEvidence(note, states),
        100,
      );
      if (confidence < 60) return [];

      return [
        {
          id,
          text: action.text,
          sourceTopOfMindId: note.id,
          sourceSignalIds: note.relatedSignalIds,
          evidenceSnippets: note.evidencePreviews
            .map((evidence) => shortText(evidence.textPreview, 120))
            .filter(Boolean),
          kind: action.kind,
          whyNow:
            note.evidenceRationale ||
            `This comes from the current post-it "${shortText(note.title, 64)}".`,
          confidence,
          createdAt: note.createdAt,
          status,
          dismissedAt: status === "removed" ? state?.updatedAt ?? now : null,
          completedAt: status === "completed" ? state?.updatedAt ?? now : null,
        },
      ];
    })
    .filter((action) => action.status === "active")
    .sort((a, b) => b.confidence - a.confidence || b.createdAt.getTime() - a.createdAt.getTime());

  return candidates.slice(0, input.limit ?? 5);
}
