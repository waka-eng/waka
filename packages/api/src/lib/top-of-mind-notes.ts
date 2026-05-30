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
}

function confidenceFromWowScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))];
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
    title: moment.title,
    type: topOfMindNoteTypeFromWowMoment(moment),
    body: moment.why,
    prompt: moment.reflectionQuestion,
    guidance: moment.reflectionGuide,
    confidence: confidenceFromWowScore(moment.wowScore),
    status: "active",
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
