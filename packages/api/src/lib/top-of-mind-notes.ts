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
  if (/\b(room|place|city|cities|environment|studio|world|where)\b/.test(text)) return "place";
  if (/\b(peer|people|collaborator|friend|mentor|who to think with)\b/.test(text)) return "people";
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
      return "You may be looking for places that quietly tell you to be braver.";
    case "people":
      return "You seem to want peers who make fast, public building feel normal.";
    case "work":
      return "You may need workrooms where making the thing is the default temperature.";
    case "taste":
      return "You seem drawn to standards that make sharper taste feel ordinary.";
    case "tension":
    case "rejection":
      return "You may be trying to leave rooms that reward consensus over aliveness.";
    case "next_experiment":
      return "You may need a small real-world test, not another private theory.";
    case "identity":
    default:
      return "You may be practicing a self-image that needs braver surroundings.";
  }
}

function extractAmbientField(body: string, field: string): string | null {
  const pattern = new RegExp(
    `${field}:\\s+(.+?)(?=\\s+(?:Ambient signal:|Matched environment:|Anti-environment:|Evidence rationale:|This may matter|Supporting signals:)|$)`,
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
  if (
    belief &&
    !/^this may point to\b/i.test(belief) &&
    !/^you keep circling\b/i.test(belief) &&
    /^(you|your|a next experiment)\b/i.test(belief)
  ) {
    return belief;
  }

  const label = lowerFirst(
    /^you keep circling\b/i.test(belief)
      ? belief.replace(/^you keep circling\s+/i, "")
      : moment.title,
  );
  return mirrorTitleFromLegacyLabel(label, ambitionDimensionFromMoment(moment));
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
  return {
    id: moment.id,
    userId: moment.userId,
    title,
    ambitionDimension,
    ambientSignal: extractAmbientField(moment.why, "Ambient signal") ?? title,
    matchedEnvironment:
      extractAmbientField(moment.why, "Matched environment") ??
      fallbackMatchedEnvironment(legacyLabel, ambitionDimension),
    antiEnvironment:
      extractAmbientField(moment.why, "Anti-environment") ??
      fallbackAntiEnvironment(ambitionDimension),
    evidenceRationale:
      extractAmbientField(moment.why, "Evidence rationale") ??
      "This post-it is inferred from saved signals and may change as the graph gets better evidence.",
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
