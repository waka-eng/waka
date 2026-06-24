import type { WowKind, WowMoment } from "../db/index.js";
import type { SupportedLocale } from "./locales.js";

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
  "unavailable",
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
  preferredLocale?: SupportedLocale;
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

function hasHangul(value: string | null | undefined): boolean {
  return /[\u3131-\u318E\uAC00-\uD7A3]/u.test(value ?? "");
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
  if (isOutsideVoicePostIt(normalized)) return null;
  if (isPostItThought(normalized)) return normalizeTitleText(normalized);
  return null;
}

function primaryGeneratedTextForLocale(
  value: string | null | undefined,
  dimension: AmbitionDimension,
  preferredLocale: SupportedLocale,
): string | null {
  if (preferredLocale !== "ko-KR") return primaryPostItText(value, dimension);

  const sanitized = sanitizeUserFacingTopOfMindText(value);
  if (!hasHangul(sanitized)) return null;
  return normalizeTitleText(sanitized);
}

const AMBIENT_FIELD_LABELS = [
  "Ambient signal",
  "Matched environment",
  "Anti-environment",
  "Evidence rationale",
  "Rejected alternative interpretation",
] as const;

function hasForbiddenTopOfMindScaffolding(value: string): boolean {
  return /\bThis may matter for ambition because it points\b/i.test(value) ||
    /\bMemory movement\s*:/i.test(value) ||
    /\bSupporting signals\s*:/i.test(value) ||
    /\b(?:frequency scaffolding|\w+ frequency in the surroundings|clustering around this frequency|starting this frequency)\b/i.test(value);
}

export function sanitizeUserFacingTopOfMindText(value: string | null | undefined): string {
  let sanitized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!sanitized) return "";

  for (const label of AMBIENT_FIELD_LABELS) {
    sanitized = sanitized.replace(new RegExp(`\\b${label}:\\s*`, "gi"), "");
  }

  sanitized = sanitized
    .replace(/\bThis may matter for ambition because it points[\s\S]*?(?=(?:\b(?:Ambient signal|Matched environment|Anti-environment|Evidence rationale|Rejected alternative interpretation):)|$)/gi, "")
    .replace(/\bMemory movement:\s*[^.。!?]*[.。!?]?/gi, "")
    .replace(/\bSupporting signals:\s*[\s\S]*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized || hasForbiddenTopOfMindScaffolding(sanitized)) return "";
  return sanitized;
}

function extractAmbientField(body: string, field: string): string | null {
  const labelAlternation = AMBIENT_FIELD_LABELS.join("|");
  const pattern = new RegExp(
    `${field}:\\s+(.+?)(?=\\s+(?:${labelAlternation}):|\\s+This may matter|\\s+Supporting signals:|$)`,
    "i",
  );
  const match = body.match(pattern);
  const sanitized = sanitizeUserFacingTopOfMindText(match?.[1]);
  return sanitized || null;
}

function sanitizeTopOfMindBody(body: string): string {
  const withoutLabeledFields = AMBIENT_FIELD_LABELS.reduce(
    (text, label) =>
      text.replace(
        new RegExp(`${label}:\\s+(.+?)(?=\\s+(?:${AMBIENT_FIELD_LABELS.join("|")}):|\\s+This may matter|\\s+Supporting signals:|$)`, "gi"),
        " ",
      ),
    body,
  );
  return sanitizeUserFacingTopOfMindText(withoutLabeledFields);
}

function titleFromLegacyMoment(
  moment: TopOfMindNoteWowMoment,
  preferredLocale: SupportedLocale,
): string {
  const belief = normalizeTitleText(moment.beliefStatement ?? "");
  const dimension = ambitionDimensionFromMoment(moment);
  const postItBelief = primaryGeneratedTextForLocale(
    belief,
    dimension,
    preferredLocale,
  );
  if (postItBelief) return postItBelief;

  if (preferredLocale === "ko-KR") {
    const koreanTitle = primaryGeneratedTextForLocale(
      moment.title,
      dimension,
      preferredLocale,
    );
    if (koreanTitle) return koreanTitle;

    const koreanAmbientSignal = primaryGeneratedTextForLocale(
      extractAmbientField(moment.why, "Ambient signal"),
      dimension,
      preferredLocale,
    );
    return koreanAmbientSignal ?? "";
  }

  const modelTitle = normalizeTitleText(moment.title);
  return modelTitle || lowerFirst(belief);
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
  const preferredLocale = input.preferredLocale ?? "en-US";
  const ambitionDimension = ambitionDimensionFromMoment(moment);
  const title = titleFromLegacyMoment(moment, preferredLocale);
  const embeddedAmbientSignal = primaryGeneratedTextForLocale(
    extractAmbientField(moment.why, "Ambient signal"),
    ambitionDimension,
    preferredLocale,
  );
  return {
    id: moment.id,
    userId: moment.userId,
    title,
    ambitionDimension,
    ambientSignal: embeddedAmbientSignal ?? title,
    matchedEnvironment: extractAmbientField(moment.why, "Matched environment") ?? "",
    antiEnvironment: extractAmbientField(moment.why, "Anti-environment") ?? "",
    evidenceRationale: extractAmbientField(moment.why, "Evidence rationale") ?? "",
    rejectedAlternativeInterpretation: extractAmbientField(
      moment.why,
      "Rejected alternative interpretation",
    ),
    type: topOfMindNoteTypeFromWowMoment(moment),
    body: sanitizeTopOfMindBody(moment.why),
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
