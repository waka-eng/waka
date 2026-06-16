import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";

import type { ApiTopOfMindCompatibilityMoment, ApiTopOfMindNoteType } from "../lib/api";
import {
  DEFAULT_LOCALE,
  formatBestRecentMirrorMoments,
  t,
  type SupportedLocale,
} from "../lib/locales";

const MAX_VISIBLE_WOW_MOMENTS = 9;
const MAX_BELIEF_EXCERPT_LENGTH = 72;
const MAX_WOW_LEAD_LENGTH = 180;
const MAX_PATTERN_CHUNK_LENGTH = 240;
const STICKY_NOTE_COLORS = ["#fff4a8", "#ffd7a8", "#d7f3c4", "#cfe8ff", "#f5d2f0"];
const STICKY_NOTE_ROTATIONS = [-2.4, 1.6, -1.1, 2.2, -1.8, 1.1, -2, 2.6, -0.8];
const SOURCE_FALLBACK_LABEL = "Source signal";
const SOURCE_FALLBACK_REASON = "Why this source matters";
const SOURCE_FALLBACK_TEXT = "a source signal";
const INTERNAL_SOURCE_ROLE_LABELS = new Set([
  "primary",
  "supporting",
  "support",
  "contrast",
  "contrasting",
  "related",
  "trigger",
  "candidate",
  "source",
]);

type ResonanceOption = "thats-me" | "partly" | "not-quite";
type MemoryEndingState = "prompt" | "editing" | "remembered" | "dismissed";

function countGeneratedFields(moment: ApiTopOfMindCompatibilityMoment): number {
  return [moment.title, moment.why, moment.beliefStatement, moment.reflectionQuestion, moment.reflectionGuide].filter(
    (value) => Boolean(value && value.trim()),
  ).length;
}

function formatDevCompactCounts(locale: SupportedLocale, moment: ApiTopOfMindCompatibilityMoment): string {
  const sourceCount = moment.relatedInspirations.length;
  const generatedFieldCount = countGeneratedFields(moment);
  if (locale === "ko-KR") {
    return `${sourceCount}개 출처; 생성 필드 ${generatedFieldCount}개 있음`;
  }
  return `${sourceCount} source${sourceCount === 1 ? "" : "s"}; ${generatedFieldCount} generated field${
    generatedFieldCount === 1 ? "" : "s"
  } present`;
}

function cleanBeliefSourceText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function beliefExcerpt(value: string | null | undefined): string {
  const cleaned = cleanBeliefSourceText(value);
  if (cleaned.length <= MAX_BELIEF_EXCERPT_LENGTH) return cleaned;

  const clipped = cleaned.slice(0, MAX_BELIEF_EXCERPT_LENGTH + 1);
  const lastSpaceIndex = clipped.lastIndexOf(" ");
  const excerpt = (lastSpaceIndex > 40 ? clipped.slice(0, lastSpaceIndex) : cleaned.slice(0, MAX_BELIEF_EXCERPT_LENGTH)).trim();
  return `${excerpt}…`;
}

function stripTerminalPunctuation(value: string): string {
  return value.replace(/[.!?。！？]+$/u, "");
}

function normalizeReportText(value: string | null | undefined): string {
  let normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  normalized = normalized
    .replace(/\b(?:Ambient signal|Matched environment|Anti-environment|Evidence rationale|Rejected alternative interpretation):\s*/gi, "")
    .replace(/\bThis may matter for ambition because it points[\s\S]*?(?=(?:\b(?:Ambient signal|Matched environment|Anti-environment|Evidence rationale|Rejected alternative interpretation):)|$)/gi, "")
    .replace(/\bMemory movement:\s*[^.。!?]*[.。!?]?/gi, "")
    .replace(/\bSupporting signals:\s*[\s\S]*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/\b(?:candidate|rank|score)\b/i.test(normalized)) return "";
  if (/\b(?:\w+ frequency in the surroundings|clustering around this frequency|starting this frequency)\b/i.test(normalized)) {
    return "";
  }
  return normalized;
}

const TOP_OF_MIND_TYPE_LABELS: Record<ApiTopOfMindNoteType, string> = {
  pattern: "recurring signal",
  tension: "live tension",
  question: "open question",
  hypothesis: "possible read",
  action: "try next / next action",
};

type StickyMomentDisplay = {
  title: string;
  rationale: string;
  typeLabel: string | null;
};

type CanonicalDetailField = {
  label: string;
  value: string;
};

function topOfMindTypeLabel(type: ApiTopOfMindNoteType | null | undefined): string | null {
  return type ? TOP_OF_MIND_TYPE_LABELS[type] ?? null : null;
}

function buildStickyMomentDisplay(moment: ApiTopOfMindCompatibilityMoment): StickyMomentDisplay {
  const canonicalTitle = normalizeReportText(moment.topOfMindNote?.title);
  const canonicalRationale = normalizeReportText(moment.topOfMindNote?.evidenceRationale);

  return {
    title: canonicalTitle || normalizeReportText(moment.title),
    rationale: canonicalRationale || normalizeReportText(moment.why),
    typeLabel: topOfMindTypeLabel(moment.topOfMindNote?.type),
  };
}

function canonicalDetailFields(moment: ApiTopOfMindCompatibilityMoment): CanonicalDetailField[] {
  const topOfMindNote = moment.topOfMindNote;
  if (!topOfMindNote) return [];

  return [
    { label: "Ambient signal", value: normalizeReportText(topOfMindNote.ambientSignal) },
    { label: "Matched environment", value: normalizeReportText(topOfMindNote.matchedEnvironment) },
    { label: "Anti-environment", value: normalizeReportText(topOfMindNote.antiEnvironment) },
    {
      label: "Rejected alternative interpretation",
      value: normalizeReportText(topOfMindNote.rejectedAlternativeInterpretation),
    },
  ].filter((field) => field.value);
}

type ReflectionGuideBlock = {
  heading: string;
  body: string[];
  questions: string[];
};

function normalizeReflectionGuideLine(value: string): string {
  return value.replace(/[\t ]+/g, " ").trim();
}

function isReflectionGuideHeading(line: string): boolean {
  const normalized = line.replace(/[:：]+$/u, "").trim();
  if (!normalized || normalized.length > 72) return false;
  if (/^[\-•*]\s/u.test(line)) return false;
  if (/[.!?。！？]$/u.test(normalized)) return false;
  return true;
}

function isReflectionGuideQuestion(line: string): boolean {
  return /^[\-•*]\s/u.test(line) || /[?？]$/u.test(line);
}

function parseReflectionGuide(value: string | null | undefined): ReflectionGuideBlock[] {
  const lines = (value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(normalizeReflectionGuideLine)
    .filter(Boolean);

  const blocks: ReflectionGuideBlock[] = [];
  let current: ReflectionGuideBlock | null = null;

  lines.forEach((line) => {
    if (isReflectionGuideHeading(line)) {
      current = { heading: line.replace(/[:：]+$/u, "").trim(), body: [], questions: [] };
      blocks.push(current);
      return;
    }

    if (!current) {
      current = { heading: "", body: [], questions: [] };
      blocks.push(current);
    }

    const cleaned = line.replace(/^[\-•*]\s*/u, "").trim();
    if (isReflectionGuideQuestion(line)) {
      current.questions.push(cleaned);
    } else {
      current.body.push(cleaned);
    }
  });

  return blocks.filter((block) => block.heading || block.body.length > 0 || block.questions.length > 0);
}

function isDateLookingSourceRoleLabel(value: string): boolean {
  return (
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(value) ||
    /\b(?:19|20)\d{2}\b/.test(value) ||
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(value) ||
    /\b\d{4}[/-]\d{1,2}(?:[/-]\d{1,2})?\b/.test(value)
  );
}

function safeSourceRoleLabel(value: string | null | undefined, fallback = SOURCE_FALLBACK_LABEL): string {
  const normalized = normalizeReportText(value);
  const canonical = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized || INTERNAL_SOURCE_ROLE_LABELS.has(canonical)) return fallback;
  if (/\b(score|uuid|classifier|candidate|embedding|similarity|rank|id)\b/i.test(normalized)) return fallback;
  if (isDateLookingSourceRoleLabel(normalized)) return fallback;
  return normalized;
}

function unsafeSourceTextPattern(value: string): boolean {
  return /\b(score|uuid|classifier|candidate|embedding|similarity|rank|id|runtimeCandidateScore|provider|payload|prompt|secret|token|debug)\b/i.test(
    value,
  );
}

function safeSourceReason(value: string | null | undefined, fallback = SOURCE_FALLBACK_REASON): string {
  const normalized = normalizeReportText(value);
  if (!normalized) return fallback;
  if (unsafeSourceTextPattern(normalized)) return fallback;
  if (isDateLookingSourceRoleLabel(normalized)) return fallback;
  return normalized;
}

function safeBeliefSourceReason(value: string | null | undefined): string {
  const normalized = cleanBeliefSourceText(value);
  return normalized ? safeSourceReason(normalized) : "";
}

function safeBeliefSourceText(value: string | null | undefined): string {
  const normalized = cleanBeliefSourceText(value);
  if (!normalized) return "";
  if (unsafeSourceTextPattern(normalized)) return SOURCE_FALLBACK_TEXT;
  if (isDateLookingSourceRoleLabel(normalized)) return SOURCE_FALLBACK_TEXT;
  return normalized;
}

function sentenceParts(value: string): string[] {
  return value.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/gu)?.map((part) => part.trim()).filter(Boolean) ?? [];
}

function characterWindowParts(value: string): string[] {
  const parts: string[] = [];
  for (let index = 0; index < value.length; index += MAX_PATTERN_CHUNK_LENGTH) {
    parts.push(value.slice(index, index + MAX_PATTERN_CHUNK_LENGTH));
  }
  return parts;
}

function buildPatternChunks(value: string | null | undefined): string[] {
  const normalized = normalizeReportText(value);
  if (!normalized) return [];

  const sentences = sentenceParts(normalized);
  if (sentences.length <= 1 && normalized.length <= MAX_PATTERN_CHUNK_LENGTH) return [normalized];

  const sourceParts = sentences.length > 1 ? sentences : normalized.split(/(?<=\S)\s+(?=\S)/u);
  const chunks: string[] = [];
  let current = "";

  sourceParts.forEach((part) => {
    const boundedParts = part.length > MAX_PATTERN_CHUNK_LENGTH ? characterWindowParts(part) : [part];

    boundedParts.forEach((boundedPart) => {
      const candidate = current ? `${current} ${boundedPart}` : boundedPart;
      if (candidate.length <= MAX_PATTERN_CHUNK_LENGTH || !current) {
        current = candidate;
        return;
      }

      chunks.push(current);
      current = boundedPart;
    });
  });

  if (current) chunks.push(current);
  return chunks;
}

function buildPatternReport(value: string | null | undefined): { lead: string; bodyChunks: string[] } {
  const normalized = normalizeReportText(value);
  if (!normalized) return { lead: "", bodyChunks: [] };

  const sentences = sentenceParts(normalized);
  const firstSentence = sentences[0] ?? "";
  if (sentences.length > 1 && firstSentence.length <= MAX_WOW_LEAD_LENGTH) {
    return {
      lead: firstSentence,
      bodyChunks: buildPatternChunks(normalized.slice(firstSentence.length).trim()),
    };
  }

  return { lead: "", bodyChunks: buildPatternChunks(normalized) };
}

function getReflectionGuide(moment: ApiTopOfMindCompatibilityMoment): string | null | undefined {
  return (moment as ApiTopOfMindCompatibilityMoment & { reflectionGuide?: string | null }).reflectionGuide;
}

function lowerFirstLetter(value: string): string {
  return value ? `${value.charAt(0).toLocaleLowerCase()}${value.slice(1)}` : value;
}

function sourceQuote(value: string): string {
  return `“${stripTerminalPunctuation(value)}”`;
}

function buildBeliefStatement(moment: ApiTopOfMindCompatibilityMoment): string {
  const suppliedBelief = cleanBeliefSourceText(moment.beliefStatement);
  if (suppliedBelief) return suppliedBelief;

  const title = beliefExcerpt(moment.title);
  const why = beliefExcerpt(normalizeReportText(moment.why));
  const sourceReason = beliefExcerpt(
    safeBeliefSourceReason(moment.relatedInspirations.find((related) => cleanBeliefSourceText(related.reason))?.reason),
  );
  const sourceText = beliefExcerpt(
    safeBeliefSourceText(moment.relatedInspirations.find((related) => cleanBeliefSourceText(related.text))?.text),
  );

  if (why && title) {
    return `One possible reading: because ${sourceQuote(why)}, this may point to a belief that ${sourceQuote(
      title,
    )} is worth exploring rather than treating as a one-off spark.`;
  }

  if (why) {
    return `One possible reading: ${sourceQuote(
      why,
    )} may point to a belief worth staying with, though WAKA needs more context to name it clearly.`;
  }

  if (title && sourceReason) {
    return `One possible reading: ${sourceQuote(title)} may matter through this source note: ${sourceQuote(
      lowerFirstLetter(sourceReason),
    )}. It points to a belief worth testing gently.`;
  }

  if (title && sourceText) {
    return `One possible reading: ${sourceQuote(title)} and the source ${sourceQuote(
      sourceText,
    )} may be a small mirror of something you are drawn to.`;
  }

  if (title) {
    return `One possible reading: ${sourceQuote(
      title,
    )} may be a small mirror of something you are drawn to. Add more signals and WAKA can ground this more clearly.`;
  }

  return "One possible reading: this moment may be a small mirror. Add more signals and WAKA can ground the belief more clearly.";
}

function compareBestRecentWowMoments(a: ApiTopOfMindCompatibilityMoment, b: ApiTopOfMindCompatibilityMoment): number {
  const scoreDelta = b.wowScore - a.wowScore;
  if (scoreDelta !== 0) return scoreDelta;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

interface WowMomentsSectionProps {
  moments: ApiTopOfMindCompatibilityMoment[];
  loading: boolean;
  error: string | null;
  onAddInspiration?: () => void;
  locale?: SupportedLocale;
  showDevInspection?: boolean;
}

export function WowMomentsSection({
  moments,
  loading,
  error,
  onAddInspiration,
  locale = DEFAULT_LOCALE,
  showDevInspection = false,
}: WowMomentsSectionProps): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const bestRecentMoments = useMemo(() => [...moments].sort(compareBestRecentWowMoments), [moments]);
  const visibleMoments = useMemo(() => bestRecentMoments.slice(0, MAX_VISIBLE_WOW_MOMENTS), [bestRecentMoments]);
  const [selectedMoment, setSelectedMoment] = useState<ApiTopOfMindCompatibilityMoment | null>(null);
  const [selectedResonance, setSelectedResonance] = useState<ResonanceOption | null>(null);
  const [memoryEndingState, setMemoryEndingState] = useState<MemoryEndingState>("prompt");
  const [memoryBeliefText, setMemoryBeliefText] = useState("");
  const [expandedSourceReasonIds, setExpandedSourceReasonIds] = useState<Set<string>>(new Set());
  const [devInspectionOpen, setDevInspectionOpen] = useState(false);

  const resetLocalReflectionState = () => {
    setSelectedResonance(null);
    setMemoryEndingState("prompt");
    setMemoryBeliefText("");
  };

  const selectMomentDetail = (moment: ApiTopOfMindCompatibilityMoment) => {
    setSelectedMoment(moment);
    resetLocalReflectionState();
    const firstSourceId = moment.relatedInspirations[0]?.inspirationId;
    setExpandedSourceReasonIds(firstSourceId ? new Set([firstSourceId]) : new Set());
  };

  const clearSelectedMomentDetail = () => {
    setSelectedMoment(null);
    resetLocalReflectionState();
    setExpandedSourceReasonIds(new Set());
  };

  const closeMoment = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("wow");
    setSearchParams(nextParams, { replace: true });
    clearSelectedMomentDetail();
  };

  useEffect(() => {
    if (!selectedMoment) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMoment();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [selectedMoment]);

  useEffect(() => {
    const selectedWowId = searchParams.get("wow");

    if (!selectedWowId) {
      if (selectedMoment) {
        clearSelectedMomentDetail();
      }
      return;
    }

    if (loading) return;

    const querySelectedMoment = visibleMoments.find((moment) => moment.id === selectedWowId);
    if (!querySelectedMoment) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("wow");
      setSearchParams(nextParams, { replace: true });
      if (selectedMoment) {
        clearSelectedMomentDetail();
      }
      return;
    }

    if (selectedMoment?.id !== querySelectedMoment.id) {
      selectMomentDetail(querySelectedMoment);
    }
  }, [loading, searchParams, selectedMoment, setSearchParams, visibleMoments]);

  const openMoment = (moment: ApiTopOfMindCompatibilityMoment) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("wow", moment.id);
    setSearchParams(nextParams);
    selectMomentDetail(moment);
  };

  const selectResonance = (resonance: ResonanceOption, beliefText: string) => {
    setSelectedResonance(resonance);
    setMemoryEndingState("prompt");
    setMemoryBeliefText(beliefText);
  };

  const handleAddInspirationSignal = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("waka:add-inspiration", {
          detail: {
            source: "wow-moment-ending",
            momentId: selectedMoment?.id ?? null,
          },
        }),
      );
    }
    onAddInspiration?.();
  };

  const toggleSourceReason = (sourceId: string) => {
    setExpandedSourceReasonIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(sourceId)) {
        nextIds.delete(sourceId);
      } else {
        nextIds.add(sourceId);
      }
      return nextIds;
    });
  };

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>, moment: ApiTopOfMindCompatibilityMoment) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMoment(moment);
    }
  };

  const stickyNoteStyle = (index: number): CSSProperties =>
    ({
      "--wow-note-color": STICKY_NOTE_COLORS[index % STICKY_NOTE_COLORS.length],
      "--wow-note-rotation": `${STICKY_NOTE_ROTATIONS[index % STICKY_NOTE_ROTATIONS.length]}deg`,
    }) as CSSProperties;

  const selectedDisplay = selectedMoment ? buildStickyMomentDisplay(selectedMoment) : null;
  const selectedCanonicalDetailFields = selectedMoment ? canonicalDetailFields(selectedMoment) : [];
  const selectedPatternReport = selectedMoment
    ? buildPatternReport(selectedMoment.topOfMindNote?.evidenceRationale ?? selectedMoment.why)
    : { lead: "", bodyChunks: [] };
  const selectedPatternVisible = Boolean(selectedPatternReport.lead || selectedPatternReport.bodyChunks.length > 0);
  const selectedBeliefStatement = selectedMoment ? buildBeliefStatement(selectedMoment) : "";
  const selectedSignalCount = selectedMoment?.relatedInspirations.length ?? 0;
  const selectedSignalCountLabel = `${selectedSignalCount} inspiration${selectedSignalCount === 1 ? "" : "s"}`;
  const selectedReflectionGuideBlocks = selectedMoment
    ? parseReflectionGuide(getReflectionGuide(selectedMoment))
    : [];

  const devInspectionPanel = showDevInspection && devInspectionOpen ? (
    <aside
      aria-labelledby="dev-wow-inspection-title"
      className="dev-wow-inspection-panel"
      id="dev-wow-inspection-panel"
      role="dialog"
    >
      <div className="dev-wow-inspection-header">
        <p>{t(locale, "devWowInspectionKicker")}</p>
        <button onClick={() => setDevInspectionOpen(false)} type="button">
          {t(locale, "devWowInspectionClose")}
        </button>
      </div>
      <h3 id="dev-wow-inspection-title">{t(locale, "devWowInspectionTitle")}</h3>
      <p>{t(locale, "devWowInspectionNote")}</p>
      <ol className="dev-wow-inspection-list">
        {bestRecentMoments.map((moment) => (
          <li key={`dev-inspect-${moment.id}`}>
            <h4>{moment.title || t(locale, "devWowUntitledMoment")}</h4>
            <dl>
              <dt>{t(locale, "devWowFieldTitle")}</dt>
              <dd>{moment.title || t(locale, "devWowFieldNotGenerated")}</dd>
              <dt>{t(locale, "devWowFieldWhy")}</dt>
              <dd>{normalizeReportText(moment.why) || t(locale, "devWowFieldNotGenerated")}</dd>
              <dt>{t(locale, "devWowFieldBelief")}</dt>
              <dd>{moment.beliefStatement || t(locale, "devWowFieldNotGenerated")}</dd>
              <dt>{t(locale, "devWowFieldReflection")}</dt>
              <dd>{moment.reflectionQuestion || t(locale, "devWowFieldNotGenerated")}</dd>
              <dt>{t(locale, "devWowFieldReflectionGuide")}</dt>
              <dd>{moment.reflectionGuide || t(locale, "devWowFieldNotGenerated")}</dd>
              <dt>{t(locale, "devWowFieldCompactCounts")}</dt>
              <dd>{formatDevCompactCounts(locale, moment)}</dd>
              <dt>{t(locale, "devWowSourceRoleReason")}</dt>
              <dd>{t(locale, "devWowSourceFallbackLabel")}</dd>
            </dl>
            {moment.relatedInspirations.length > 0 ? (
              <ol>
                {moment.relatedInspirations.map((related, index) => (
                  <li key={`dev-inspect-source-${moment.id}-${index}`}>
                    <span>{t(locale, "devWowSourceFallbackLabel")}</span>
                    <blockquote>{related.text}</blockquote>
                    <p>{t(locale, "devWowSourceFallbackReason")}</p>
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ol>
    </aside>
  ) : null;


  const selectedMomentDetail = selectedMoment ? (
    <article
      aria-labelledby="wow-moment-detail-title"
      className="wow-moment-detail-panel wow-moment-detail-panel--in-grid"
    >
      <div className="wow-moment-detail-header">
        <p className="wow-moment-detail-kicker">Reflection mode</p>
        <button
          className="wow-moment-detail-close"
          onClick={closeMoment}
          type="button"
        >
          Back to grid
        </button>
      </div>
      <h3 id="wow-moment-detail-title">{selectedDisplay?.title ?? selectedMoment.title}</h3>
      <section className="wow-moment-detail-section wow-moment-detail-section--recognition">
        <span className="wow-moment-step-label">Start here</span>
        <h4>The moment</h4>
        <p>This may be worth noticing: {selectedDisplay?.title ?? selectedMoment.title}</p>
      </section>
      {selectedCanonicalDetailFields.length > 0 ? (
        <section className="wow-moment-detail-section wow-moment-detail-section--canonical">
          <span className="wow-moment-step-label">Canonical top-of-mind note</span>
          <h4>Richer field notes</h4>
          <dl className="wow-moment-canonical-fields">
            {selectedCanonicalDetailFields.map((field) => (
              <div key={`${selectedMoment.id}-${field.label}`}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {selectedMoment.relatedInspirations.length > 0 ? (
        <section className="wow-moment-detail-section wow-moment-detail-section--evidence">
          <div className="wow-moment-detail-section-header">
            <div>
              <span className="wow-moment-step-label">Where it came from</span>
              <h4>Source trail</h4>
              <p className="wow-moment-section-caption">Artifacts behind this reading</p>
            </div>
            <span className="wow-moment-source-count">
              {`${selectedMoment.relatedInspirations.length} source${
                selectedMoment.relatedInspirations.length === 1 ? "" : "s"
              }`}
            </span>
          </div>
          <ol className="wow-moment-detail-sources">
            {selectedMoment.relatedInspirations.map((related) => {
              const isReasonExpanded = expandedSourceReasonIds.has(related.inspirationId);
              const reasonId = `wow-source-reason-${selectedMoment.id}-${related.inspirationId}`;
              return (
                <li key={`${selectedMoment.id}-detail-${related.inspirationId}`}>
                  <span className="wow-moment-related-label">{safeSourceRoleLabel(related.role)}</span>
                  <blockquote>{related.text}</blockquote>
                  <button
                    aria-controls={reasonId}
                    aria-expanded={isReasonExpanded}
                    className="wow-moment-source-reason-toggle"
                    onClick={() => toggleSourceReason(related.inspirationId)}
                    type="button"
                  >
                    {isReasonExpanded ? "Hide source note" : "Why this source matters"}
                  </button>
                  {isReasonExpanded ? (
                    <p className="wow-moment-source-reason" id={reasonId}>
                      <span>Source note</span>
                      {safeSourceReason(related.reason)}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      <section className="wow-moment-detail-section wow-moment-detail-section--pattern">
        <span className="wow-moment-step-label">Reading</span>
        <h4>What this may say about you</h4>
        <p>
          Across these inspirations, you may be returning to a question that already
          matters to you. Treat this as a mirror, not a recommendation.
        </p>
        {selectedPatternVisible ? (
          <div className="wow-moment-pattern-report">
            <h5>How the pattern shows up</h5>
            {selectedPatternReport.lead ? (
              <p className="wow-moment-pattern-lead">
                <span className="wow-moment-pattern-label">Field note</span>
                <span>{selectedPatternReport.lead}</span>
              </p>
            ) : null}
            {selectedPatternReport.bodyChunks.length > 0 ? (
              <div className="wow-moment-pattern-body" aria-label="How the pattern shows up">
                {selectedPatternReport.bodyChunks.length > 1 ? (
                  <ol className="wow-moment-pattern-list">
                    {selectedPatternReport.bodyChunks.map((chunk, index) => (
                      <li key={`${selectedMoment.id}-pattern-${index}`}>{chunk}</li>
                    ))}
                  </ol>
                ) : (
                  <p>{selectedPatternReport.bodyChunks[0]}</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      {selectedMoment.reflectionQuestion ? (
        <section className="wow-moment-detail-section wow-moment-detail-section--reflection">
          <h4>Reflection question</h4>
          <p>{selectedMoment.reflectionQuestion}</p>
        </section>
      ) : null}
      {getReflectionGuide(selectedMoment) ? (
        <section className="wow-moment-detail-section wow-moment-detail-section--reflection-guide">
          <span className="wow-moment-step-label">{t(locale, "wowReflectionGuideCaption")}</span>
          <h4>{t(locale, "wowReflectionGuideTitle")}</h4>
          <div className="wow-moment-reflection-guide-blocks">
            {selectedReflectionGuideBlocks.map((block, blockIndex) => (
              <section
                className="wow-moment-reflection-guide-block"
                key={`${selectedMoment.id}-reflection-guide-${block.heading || blockIndex}`}
              >
                {block.heading ? <h5>{block.heading}</h5> : null}
                {block.body.map((line, lineIndex) => (
                  <p key={`${selectedMoment.id}-reflection-guide-body-${blockIndex}-${lineIndex}`}>{line}</p>
                ))}
                {block.questions.length > 0 ? (
                  <ul className="wow-moment-reflection-guide-questions">
                    {block.questions.map((question, questionIndex) => (
                      <li key={`${selectedMoment.id}-reflection-guide-question-${blockIndex}-${questionIndex}`}>
                        {question}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </section>
      ) : null}
      <section className="wow-moment-detail-section wow-moment-detail-section--belief">
        <span className="wow-moment-step-label">The belief underneath</span>
        <h4>A belief this may point to</h4>
        <span className="wow-moment-belief-ownership">Ownership, not advice</span>
        <figure className="wow-moment-belief-pullquote">
          <blockquote>{selectedBeliefStatement}</blockquote>
          <figcaption>Does this feel like you?</figcaption>
        </figure>
        <div className="wow-moment-belief-actions" aria-label="Belief resonance options">
          <button
            aria-pressed={selectedResonance === "thats-me"}
            onClick={() => selectResonance("thats-me", selectedBeliefStatement)}
            type="button"
          >
            That’s me
          </button>
          <button
            aria-pressed={selectedResonance === "partly"}
            onClick={() => selectResonance("partly", selectedBeliefStatement)}
            type="button"
          >
            Partly
          </button>
          <button
            aria-pressed={selectedResonance === "not-quite"}
            onClick={() => selectResonance("not-quite", selectedBeliefStatement)}
            type="button"
          >
            Not quite
          </button>
        </div>
        <p className="wow-moment-belief-note">For reflection only; not saved.</p>
        {selectedResonance ? (
          <div className="wow-moment-memory-ending" aria-live="polite">
            {memoryEndingState === "remembered" ? (
              <>
                <h5>Marked locally for now</h5>
                <p>This is only a local preview. Future WAKA memory is coming soon.</p>
                <p>Nothing has been saved yet.</p>
                <blockquote>{memoryBeliefText}</blockquote>
              </>
            ) : memoryEndingState === "dismissed" ? (
              <>
                <h5>We’ll leave this one alone.</h5>
                <p>Nothing is saved; this reflection can stay as a passing mirror.</p>
              </>
            ) : (
              <>
                <h5>Does this feel true enough to remember?</h5>
                <p>
                  {memoryEndingState === "editing"
                    ? "Edit the memory preview locally first. It still will not be saved yet."
                    : "Local preview only — not saved yet."}
                </p>
                <div className="wow-moment-memory-preview" aria-label="Future memory preview">
                  <span>Future memory preview</span>
                  <p>WAKA might remember:</p>
                  <blockquote>{memoryBeliefText}</blockquote>
                </div>
                {memoryEndingState === "editing" ? (
                  <label className="wow-moment-memory-edit">
                    <span>Future memory wording</span>
                    <textarea
                      aria-label="Edit future memory wording"
                      onChange={(event) => setMemoryBeliefText(event.currentTarget.value)}
                      onInput={(event) => setMemoryBeliefText(event.currentTarget.value)}
                      rows={3}
                      value={memoryBeliefText}
                    />
                  </label>
                ) : null}
                <div className="wow-moment-memory-actions" aria-label="Local future-memory actions">
                  <button onClick={() => setMemoryEndingState("remembered")} type="button">
                    Looks right
                  </button>
                  {memoryEndingState === "editing" ? (
                    <button onClick={() => setMemoryEndingState("prompt")} type="button">
                      Cancel edit
                    </button>
                  ) : (
                    <button onClick={() => setMemoryEndingState("editing")} type="button">
                      Edit wording
                    </button>
                  )}
                  <button onClick={() => setMemoryEndingState("dismissed")} type="button">
                    Not for me
                  </button>
                </div>
              </>
            )}
            <aside className="wow-moment-add-signal" aria-labelledby="wow-moment-add-signal-title">
              <h5 id="wow-moment-add-signal-title">Add more signal for this pattern</h5>
              <p>
                This moment is based on {selectedSignalCountLabel}. More signal can make future moments sharper
                and more personal.
              </p>
              <div className="wow-moment-signal-prompts">
                <span>Try adding:</span>
                <ul>
                  <li>something you keep coming back to</li>
                  <li>a project or product that feels strangely important</li>
                  <li>a tension you notice in your work or taste</li>
                </ul>
              </div>
              <div className="wow-moment-signal-actions">
                <button onClick={handleAddInspirationSignal} type="button">
                  Add another inspiration
                </button>
              </div>
            </aside>
          </div>
        ) : null}
      </section>
    </article>
  ) : null;
  return (
    <section className="wow-moments-section" aria-labelledby="wow-moments-title">
      <div className="wow-moments-heading">
        <h2 id="wow-moments-title">{t(locale, "wowMomentsHeading")}</h2>
      </div>
      {!error && !loading && moments.length > 0 ? (
        <div className="wow-moments-actions">
          <p>
            {formatBestRecentMirrorMoments(locale, visibleMoments.length)}
          </p>
          {showDevInspection ? (
            <button
              aria-controls="dev-wow-inspection-panel"
              aria-expanded={devInspectionOpen}
              className="wow-moments-inspect-button"
              onClick={() => setDevInspectionOpen((isOpen) => !isOpen)}
              type="button"
            >
              {t(locale, "devWowInspectButton")} ({bestRecentMoments.length})
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="wow-moments-state" role="status">
          <strong>{t(locale, "wowMomentsLoadError")}</strong>
          <span>{error}</span>
        </div>
      ) : loading ? (
        <div className="wow-moments-grid" aria-busy="true" aria-live="polite" role="status">
          <span className="sr-only">{t(locale, "wowMomentsLoading")}</span>
          {[0, 1].map((index) => (
            <article className="wow-moment-card wow-moment-card--loading" key={index}>
              <div className="wow-moment-skeleton wow-moment-skeleton--short" />
              <div className="wow-moment-skeleton wow-moment-skeleton--title" />
              <div className="wow-moment-skeleton" />
              <div className="wow-moment-skeleton" />
            </article>
          ))}
        </div>
      ) : moments.length === 0 ? (
        <div className="wow-moments-state">
          <strong>{t(locale, "wowMomentsEmptyTitle")}</strong>
          <span>{t(locale, "wowMomentsEmptyHint")}</span>
        </div>
      ) : (
        <div
          className={`wow-moments-grid wow-moments-grid--populated${selectedMoment ? " wow-moments-grid--expanded" : ""}`}
        >
          {selectedMomentDetail ??
            visibleMoments.map((moment, index) => {
              const relatedSources = moment.relatedInspirations;
              const stickyDisplay = buildStickyMomentDisplay(moment);

              return (
                <article
                  aria-label={`Open mirror moment report: ${stickyDisplay.title}`}
                  className="wow-moment-card wow-moment-card--interactive wow-moment-card--sticky"
                  key={moment.id}
                  onClick={() => openMoment(moment)}
                  onKeyDown={(event) => handleCardKeyDown(event, moment)}
                  role="button"
                  style={stickyNoteStyle(index)}
                  tabIndex={0}
                >
                  <span className="wow-moment-sticky-tape" aria-hidden="true" />
                  <span className="wow-moment-sticky-pin" aria-hidden="true" />
                  {stickyDisplay.typeLabel ? (
                    <span className="wow-moment-type-chip">{stickyDisplay.typeLabel}</span>
                  ) : null}
                  <h3>{stickyDisplay.title}</h3>
                  <span className="wow-moment-open-cue" aria-hidden="true">
                    See why this matters
                  </span>
                  {stickyDisplay.rationale ? (
                    <div className="wow-moment-why" aria-label="Why WAKA noticed this">
                      <span>Why WAKA noticed this</span>
                      <p>{stickyDisplay.rationale}</p>
                    </div>
                  ) : null}
                  {relatedSources.length > 0 ? (
                    <ol className="wow-moment-related" aria-label="Signals behind this">
                      {relatedSources.map((related) => (
                        <li key={`${moment.id}-${related.inspirationId}`}>
                          <span className="wow-moment-related-label">{t(locale, "savedInspiration")}</span>
                          <blockquote>{related.text}</blockquote>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </article>
              );
            })}
        </div>
      )}
      {devInspectionPanel}
    </section>
  );
}
