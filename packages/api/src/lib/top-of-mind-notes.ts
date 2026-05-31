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

function mirrorTitleFromLegacyLabel(label: string, dimension: AmbitionDimension): string {
  switch (dimension) {
    case "place":
      return /^(the\s+)?rooms?\b/i.test(label)
        ? `You seem pulled toward ${label}.`
        : `You seem pulled toward rooms where ${label} can become normal.`;
    case "people":
      return `You seem to want peers who make ${label} easier to practice.`;
    case "work":
      return `You may want work that turns ${label} into something visible.`;
    case "taste":
      return `Your taste seems to sharpen around ${label} as a standard, not decoration.`;
    case "tension":
      return `Your ambition may be forming inside the tension around ${label}.`;
    case "rejection":
      return `You may be outgrowing contexts shaped by ${label}.`;
    case "next_experiment":
      return `A next experiment may be to test whether ${label} belongs in your real life.`;
    case "identity":
    default:
      return `You seem to be protecting an identity built around ${label}.`;
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
  return {
    id: moment.id,
    userId: moment.userId,
    title: titleFromLegacyMoment(moment),
    ambitionDimension: ambitionDimensionFromMoment(moment),
    type: topOfMindNoteTypeFromWowMoment(moment),
    body: moment.why,
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
