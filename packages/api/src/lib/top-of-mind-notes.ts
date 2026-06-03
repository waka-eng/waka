import type { WowKind, WowMoment } from "../db/index.js";

export const topOfMindNoteTypeValues = [
  "pattern",
  "tension",
  "question",
  "hypothesis",
  "action",
] as const;

export type TopOfMindNoteType = (typeof topOfMindNoteTypeValues)[number];

export const topOfMindNoteStatusValues = [
  "active",
  "dismissed",
  "stale",
  "replaced",
] as const;

export type TopOfMindNoteStatus = (typeof topOfMindNoteStatusValues)[number];

export const ambitionDimensionValues = [
  "place",
  "people",
  "work",
  "taste",
  "tension",
  "identity",
  "rejection",
  "next_experiment",
] as const;

export type AmbitionDimension = (typeof ambitionDimensionValues)[number];

export interface TopOfMindNote {
  id: string;
  userId: string;
  title: string;
  ambitionDimension: AmbitionDimension;
  ambientSignal: string;
  matchedEnvironment: string;
  antiEnvironment: string;
  evidenceRationale: string;
  rejectedAlternativeInterpretation: string | null;
  type: TopOfMindNoteType;
  body: string;
  prompt: string | null;
  guidance: string | null;
  confidence: number;
  status: TopOfMindNoteStatus;
  relatedSignalIds: string[];
  relatedContextNodeIds: string[];
  createdAt: Date;
  updatedAt: Date;
  source: "wow_moment_compatibility";
  isProvisional: true;
  legacy: {
    wowMomentId: string;
    wowKind: WowKind;
    wowScore: number;
  };
}

type TopOfMindNoteWowMoment = Pick<
  WowMoment,
  | "id"
  | "userId"
  | "title"
  | "kind"
  | "why"
  | "beliefStatement"
  | "reflectionQuestion"
  | "reflectionGuide"
  | "wowScore"
  | "createdAt"
  | "updatedAt"
>;

export interface TopOfMindNoteFromWowMomentInput {
  moment: TopOfMindNoteWowMoment;
  relatedSignalIds?: string[];
  relatedContextNodeIds?: string[];
  status?: TopOfMindNoteStatus;
}

function confidenceFromWowScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))];
}

function normalizeTitleText(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[.。]+$/, "");
}

function lowerFirst(value: string): string {
  const normalized = normalizeTitleText(value);
  if (!normalized) return "this";
  return `${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`;
}

function ambitionDimensionFromMoment(moment: TopOfMindNoteWowMoment): AmbitionDimension {
  const text = `${moment.title} ${moment.why} ${moment.beliefStatement ?? ""}`.toLowerCase();
  if (/\b(peer|peers|people|collaborator|friend|mentor|who to think with)\b/.test(text)) return "people";
  if (/\b(room|place|city|cities|environment|studio|world|where)\b/.test(text)) return "place";
  if (/\b(work|build|make|project|craft|ship)\b/.test(text)) return "work";
  if (/\b(taste|standard|beautiful|aesthetic|style)\b/.test(text)) return "taste";
  if (moment.kind === "tension") return "tension";
  if (/\b(outgrow|leave|reject|consensus|permission|perform)\b/.test(text)) return "rejection";
  if (moment.reflectionGuide?.trim() || moment.reflectionQuestion?.trim()) return "next_experiment";
  return "identity";
}

function mirrorTitleFromLegacyLabel(_label: string, dimension: AmbitionDimension): string {
  switch (dimension) {
    case "place":
      return "a room where unfinished ambition is allowed";
    case "people":
      return "people who make courage feel normal";
    case "work":
      return "make the thing before explaining it";
    case "taste":
      return "sharper taste than the room expects";
    case "tension":
    case "rejection":
      return "not another impressive path that feels dead";
    case "next_experiment":
      return "test the question where it can cost something";
    case "identity":
    default:
      return "a self that gets braver in public";
  }
}

function isForcedFirstPersonTemplate(value: string): boolean {
  return /^(i need|i want|i am|i'm|i refuse|i am done with)\b/i.test(normalizeTitleText(value));
}

function isOutsideVoicePostIt(value: string): boolean {
  return /^(you|your|this person|waka)\b/i.test(normalizeTitleText(value));
}

function isWeakPostItThought(value: string): boolean {
  const normalized = normalizeTitleText(value);
  const lower = normalized.toLowerCase();
  if (/\b(i think|maybe|might|probably|seems|kind of)\b/i.test(normalized)) return true;
  if (/^(this may point to|this points to|the pattern is|a theme of)\b/i.test(normalized)) return true;
  if (/^you keep circling\b/i.test(normalized)) return true;
  if (/rooms where .+ can become normal|work that turns .+ visible/i.test(normalized)) return true;
  if (
    [
      "public before perfect",
      "taste as default",
      "test it outside",
      "test it in public",
      "courage normal",
      "places that make courage normal",
      "people who make courage normal",
      "sharper taste as the default",
    ].includes(lower)
  ) {
    return true;
  }
  return false;
}

function isPostItThought(value: string): boolean {
  const normalized = normalizeTitleText(value);
  if (!normalized) return false;
  if (isOutsideVoicePostIt(normalized) || isForcedFirstPersonTemplate(normalized) || isWeakPostItThought(normalized)) {
    return false;
  }
  const wordCount = normalized.split(/\s+/).length;
  if (wordCount < 5 || wordCount > 14) return false;
  if (!/\b(people|peers|room|rooms|place|places|city|cities|work|build|building|thing|path|taste|life|self|standard|experiment|question|environment)\b/i.test(normalized)) {
    return false;
  }
  return /\b(before|after|without|instead|than|where|who|because|until|against|not|less|more|cost|allowed|dead|normal|braver|lonely|clarity)\b/i.test(normalized);
}

function primaryPostItText(value: string | null | undefined, dimension: AmbitionDimension): string | null {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (isOutsideVoicePostIt(normalized)) return mirrorTitleFromLegacyLabel(normalized, dimension);
  if (isPostItThought(normalized)) return normalizeTitleText(normalized);
  return null;
}

function extractAmbientField(body: string, field: string): string | null {
  const pattern = new RegExp(
    `${field}:\\s+(.+?)(?=\\s+(?:Ambient signal:|Matched environment:|Anti-environment:|Evidence rationale:|Rejected alternative interpretation:|This may matter|Supporting signals:)|$)`,
  );
  const match = body.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function stripAmbientFieldPrefix(body: string): string {
  const marker = body.match(/\bThis may matter\b/);
  if (!marker?.index) return body;
  return body.slice(marker.index).trim();
}

function fallbackMatchedEnvironment(label: string, dimension: AmbitionDimension): string {
  switch (dimension) {
    case "place":
      return `A city, studio, or room where ${label} feels publicly reinforced.`;
    case "people":
      return `People who make ${label} feel like a shared operating rhythm.`;
    case "work":
      return `A working culture where ${label} becomes visible through repeated making.`;
    case "taste":
      return `Surroundings where ${label} is treated as a standard, not decoration.`;
    case "tension":
    case "rejection":
      return `A surrounding culture that lets ${label} stay visible long enough to choose from it.`;
    case "next_experiment":
      return `A practical setting where ${label} can be tested in public conditions.`;
    case "identity":
    default:
      return `An environment where ${label} is mirrored back as normal behavior.`;
  }
}

function fallbackAntiEnvironment(dimension: AmbitionDimension): string {
  switch (dimension) {
    case "place":
      return "Settings that make ambition feel private, apologetic, or over-explained.";
    case "people":
      return "Circles where permission, polish, or social caution arrives before motion.";
    case "work":
      return "Work contexts that reward commentary while the real object stays abstract.";
    case "taste":
      return "Rooms that flatten taste into trend, convenience, or generic approval.";
    case "tension":
    case "rejection":
      return "Rooms that smooth over the live part so everyone can keep performing agreement.";
    case "next_experiment":
      return "Analysis loops that keep the question safe, abstract, and uncostly.";
    case "identity":
    default:
      return "Contexts that make the emerging version of you feel like a private exception.";
  }
}

function titleFromLegacyMoment(moment: TopOfMindNoteWowMoment): string {
  const belief = normalizeTitleText(moment.beliefStatement ?? "");
  const dimension = ambitionDimensionFromMoment(moment);
  const postItBelief = primaryPostItText(belief, dimension);
  if (postItBelief) return postItBelief;

  const label = lowerFirst(
    /^you keep circling\b/i.test(belief)
      ? belief.replace(/^you keep circling\s+/i, "")
      : moment.title,
  );
  return mirrorTitleFromLegacyLabel(label, dimension);
}

export function topOfMindNoteTypeFromWowMoment(input: {
  kind: WowKind;
  reflectionQuestion?: string | null;
  reflectionGuide?: string | null;
}): TopOfMindNoteType {
  if (input.kind === "tension") return "tension";
  if (input.reflectionQuestion?.trim()) return "question";
  if (input.reflectionGuide?.trim()) return "action";
  if (input.kind === "outlier" || input.kind === "surprise_bridge") {
    return "hypothesis";
  }
  return "pattern";
}

export function topOfMindNoteFromWowMoment(
  input: TopOfMindNoteFromWowMomentInput,
): TopOfMindNote {
  const moment = input.moment;
  const ambitionDimension = ambitionDimensionFromMoment(moment);
  const title = titleFromLegacyMoment(moment);
  const legacyLabel = lowerFirst(moment.title);
  const embeddedAmbientSignal = primaryPostItText(
    extractAmbientField(moment.why, "Ambient signal"),
    ambitionDimension,
  );
  return {
    id: moment.id,
    userId: moment.userId,
    title,
    ambitionDimension,
    ambientSignal: embeddedAmbientSignal ?? title,
    matchedEnvironment:
      extractAmbientField(moment.why, "Matched environment") ??
      fallbackMatchedEnvironment(legacyLabel, ambitionDimension),
    antiEnvironment:
      extractAmbientField(moment.why, "Anti-environment") ??
      fallbackAntiEnvironment(ambitionDimension),
    evidenceRationale:
      extractAmbientField(moment.why, "Evidence rationale") ??
      "This post-it is inferred from saved signals and may change as the graph gets better evidence.",
    rejectedAlternativeInterpretation: extractAmbientField(
      moment.why,
      "Rejected alternative interpretation",
    ),
    type: topOfMindNoteTypeFromWowMoment(moment),
    body: stripAmbientFieldPrefix(moment.why),
    prompt: moment.reflectionQuestion,
    guidance: moment.reflectionGuide,
    confidence: confidenceFromWowScore(moment.wowScore),
    status: input.status ?? "active",
    relatedSignalIds: uniqueIds(input.relatedSignalIds ?? []),
    relatedContextNodeIds: uniqueIds(input.relatedContextNodeIds ?? []),
    createdAt: moment.createdAt,
    updatedAt: moment.updatedAt,
    source: "wow_moment_compatibility",
    isProvisional: true,
    legacy: {
      wowMomentId: moment.id,
      wowKind: moment.kind,
      wowScore: moment.wowScore,
    },
  };
}
