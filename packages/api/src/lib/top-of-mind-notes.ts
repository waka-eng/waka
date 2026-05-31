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

export interface TopOfMindNote {
  id: string;
  userId: string;
  title: string;
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

function titleFromLegacyMoment(moment: TopOfMindNoteWowMoment): string {
  const belief = normalizeTitleText(moment.beliefStatement ?? "");
  if (belief && !/^this may point to\b/i.test(belief)) return belief;

  const label = lowerFirst(moment.title);
  if (moment.reflectionQuestion?.trim()) return `You may be asking: ${label}?`;
  if (moment.reflectionGuide?.trim()) return `A small next move may be hiding in ${label}.`;
  if (moment.kind === "tension") return `You seem caught between ${label}.`;
  if (moment.kind === "outlier" || moment.kind === "surprise_bridge") {
    return `Something about ${label} keeps pulling at you.`;
  }
  return `You keep circling ${label}.`;
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
