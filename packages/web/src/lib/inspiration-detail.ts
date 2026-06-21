import type { ApiReflection } from "./api";
import { formatMessage, t, type SupportedLocale } from "./locales";

const TITLE_MAX_LENGTH = 132;
const TITLE_EXCERPT_LENGTH = 96;
const ANALYSIS_EXCERPT_MAX_LENGTH = 150;

export function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function normalizeDetailText(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ");
}

export function deriveInspirationTitle(text: string | null | undefined, locale: SupportedLocale): string {
  const normalized = normalizeDetailText(text);
  if (!normalized) return t(locale, "detailSavedInspiration");

  const sentenceMatch = normalized.match(/^(.+?[.!?。！？])(?:\s|$)/u);
  const firstSentence = sentenceMatch?.[1]?.trim() ?? "";
  const candidate = firstSentence.length > 0 && firstSentence.length <= TITLE_MAX_LENGTH
    ? firstSentence
    : normalized;
  const maxLength = candidate === normalized ? TITLE_EXCERPT_LENGTH : TITLE_MAX_LENGTH;

  if (candidate.length <= maxLength) return candidate;
  return `${candidate.slice(0, maxLength - 1).trimEnd()}…`;
}

export const deriveTitleFromText = deriveInspirationTitle;

function answerText(reflection: ApiReflection): string | null {
  if (reflection.skipped) return null;
  const answer = reflection.answer?.trim();
  return answer && answer.length > 0 ? answer : null;
}

export function answeredReflections(reflections: ApiReflection[]): ApiReflection[] {
  return reflections.filter((reflection) => answerText(reflection) !== null);
}

export function mergeReflectionRows(
  current: ApiReflection[],
  incoming: ApiReflection[],
): ApiReflection[] {
  const merged = [...incoming];
  const seenIds = new Set(merged.map((reflection) => reflection.id));
  for (const reflection of current) {
    if (seenIds.has(reflection.id)) continue;
    merged.push(reflection);
    seenIds.add(reflection.id);
  }
  return merged;
}

function normalizeAnswer(answer: string): string {
  return answer
    .replace(/\s+/g, " ")
    .replace(/^(i\s+(noticed|realized|felt|feel|think|want|need)\s+that\s+)/iu, "")
    .trim();
}

function excerptInsight(answer: string, maxLength = ANALYSIS_EXCERPT_MAX_LENGTH): string {
  const normalized = normalizeAnswer(answer);
  const sentenceEnd = normalized.search(/[.!?。！？](?:\s|$)/u);
  const firstSentence = sentenceEnd >= 0 ? normalized.slice(0, sentenceEnd + 1) : normalized;
  return firstSentence.length > maxLength
    ? `${firstSentence.slice(0, maxLength - 1).trimEnd()}…`
    : firstSentence;
}

export interface ReflectionAnalysis {
  title: string;
  summary: string;
  insights: string[];
  overview: string;
  bullets: string[];
  answeredCount: number;
  totalCount: number;
}

export function reflectionDefaultQuestion(locale: SupportedLocale): string {
  return t(locale, "reflectionDetailDefaultQuestion");
}

export function buildReflectionAnalysis(
  reflections: ApiReflection[],
  titleOrLocale: string | SupportedLocale,
  maybeLocale?: SupportedLocale,
): ReflectionAnalysis | null {
  const locale = maybeLocale ?? (titleOrLocale as SupportedLocale);
  const title = maybeLocale ? titleOrLocale : null;
  const answered = answeredReflections(reflections);
  if (answered.length === 0) return null;

  const insights = answered
    .map((reflection) => excerptInsight(reflection.answer ?? ""))
    .filter((insight) => insight.length > 0)
    .slice(0, 3);

  if (insights.length === 0) return null;

  const first = insights[0];
  const last = insights[insights.length - 1];
  const middle = insights.length > 2 ? insights[Math.floor(insights.length / 2)] : null;
  const bullets = [
    formatMessage(locale, "reflectDeeperAnalysisReveals", { insight: first }),
    middle && middle !== first && middle !== last
      ? formatMessage(locale, "reflectDeeperAnalysisPattern", { insight: middle })
      : null,
    formatMessage(locale, "reflectDeeperAnalysisNextThread", { insight: last }),
  ].filter((bullet): bullet is string => Boolean(bullet));

  return {
    title: t(locale, "reflectionAnalysisTitle"),
    summary: formatMessage(locale, "reflectionAnalysisSummary", {
      answered: answered.length,
      total: reflections.length,
    }),
    insights,
    overview: formatMessage(locale, "reflectDeeperAnalysisOverview", {
      title: title ?? t(locale, "detailSavedInspiration"),
      count: answered.length,
    }),
    bullets,
    answeredCount: answered.length,
    totalCount: reflections.length,
  };
}
