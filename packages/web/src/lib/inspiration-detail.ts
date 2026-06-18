import type { ApiReflection } from "./api";
import { formatMessage, t, type SupportedLocale } from "./locales";

const TITLE_MAX_LENGTH = 132;
const FIRST_SENTENCE_MAX_LENGTH = 160;
const ANALYSIS_EXCERPT_MAX_LENGTH = 150;

export function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function deriveInspirationTitle(text: string, locale: SupportedLocale): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return t(locale, "detailSavedInspiration");

  const sentenceEnd = normalized.search(/[.!?。！？](?:\s|$)/u);
  const candidate = sentenceEnd >= 0 && sentenceEnd + 1 <= FIRST_SENTENCE_MAX_LENGTH
    ? normalized.slice(0, sentenceEnd + 1)
    : normalized;

  return candidate.length > TITLE_MAX_LENGTH
    ? `${candidate.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
    : candidate;
}

export function answeredReflections(reflections: ApiReflection[]): ApiReflection[] {
  return reflections.filter(
    (reflection) => !reflection.skipped && typeof reflection.answer === "string" && reflection.answer.trim().length > 0,
  );
}

function normalizeAnswer(answer: string): string {
  return answer
    .replace(/\s+/g, " ")
    .replace(/^(i\s+(noticed|realized|felt|feel|think|want|need)\s+that\s+)/iu, "")
    .trim();
}

function excerptInsight(answer: string): string {
  const normalized = normalizeAnswer(answer);
  const sentenceEnd = normalized.search(/[.!?。！？](?:\s|$)/u);
  const firstSentence = sentenceEnd >= 0 ? normalized.slice(0, sentenceEnd + 1) : normalized;
  return firstSentence.length > ANALYSIS_EXCERPT_MAX_LENGTH
    ? `${firstSentence.slice(0, ANALYSIS_EXCERPT_MAX_LENGTH - 1).trimEnd()}…`
    : firstSentence;
}

export interface ReflectionAnalysis {
  title: string;
  summary: string;
  insights: string[];
  answeredCount: number;
  totalCount: number;
}

export function buildReflectionAnalysis(reflections: ApiReflection[], locale: SupportedLocale): ReflectionAnalysis | null {
  const answered = answeredReflections(reflections);
  if (answered.length === 0) return null;

  const insights = answered
    .map((reflection) => excerptInsight(reflection.answer ?? ""))
    .filter((insight) => insight.length > 0)
    .slice(0, 3);

  if (insights.length === 0) return null;

  return {
    title: t(locale, "reflectionAnalysisTitle"),
    summary: formatMessage(locale, "reflectionAnalysisSummary", {
      answered: answered.length,
      total: reflections.length,
    }),
    insights,
    answeredCount: answered.length,
    totalCount: reflections.length,
  };
}

export function reflectionDefaultQuestion(locale: SupportedLocale): string {
  return t(locale, "reflectionDetailDefaultQuestion");
}
