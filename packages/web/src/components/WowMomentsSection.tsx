import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { ApiWowMoment } from "../lib/api";

const MAX_VISIBLE_WOW_MOMENTS = 9;
const MAX_BELIEF_EXCERPT_LENGTH = 72;
const MAX_WOW_LEAD_LENGTH = 180;
const MAX_PATTERN_CHUNK_LENGTH = 240;
const MAX_DEV_INSPECTION_PREVIEW_LENGTH = 180;
const SOURCE_FALLBACK_LABEL = "Source inspiration";
const SOURCE_FALLBACK_REASON = "Why this source matters";
const SOURCE_FALLBACK_TEXT = "a source inspiration";
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
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isDateLookingSourceRoleLabel(value: string): boolean {
  return (
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(value) ||
    /\b(?:19|20)\d{2}\b/.test(value) ||
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(value) ||
    /\b\d{4}[/-]\d{1,2}(?:[/-]\d{1,2})?\b/.test(value)
  );
}

function safeSourceRoleLabel(value: string | null | undefined): string {
  const normalized = normalizeReportText(value);
  const canonical = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized || INTERNAL_SOURCE_ROLE_LABELS.has(canonical)) return SOURCE_FALLBACK_LABEL;
  if (/\b(score|uuid|classifier|candidate|embedding|similarity|rank|id)\b/i.test(normalized)) return SOURCE_FALLBACK_LABEL;
  if (isDateLookingSourceRoleLabel(normalized)) return SOURCE_FALLBACK_LABEL;
  return normalized;
}

function unsafeSourceTextPattern(value: string): boolean {
  return /\b(score|uuid|classifier|candidate|embedding|similarity|rank|id|runtimeCandidateScore|provider|payload|prompt|secret|token|debug)\b/i.test(
    value,
  );
}

function safeSourceReason(value: string | null | undefined): string {
  const normalized = normalizeReportText(value);
  if (!normalized) return SOURCE_FALLBACK_REASON;
  if (unsafeSourceTextPattern(normalized)) return SOURCE_FALLBACK_REASON;
  if (isDateLookingSourceRoleLabel(normalized)) return SOURCE_FALLBACK_REASON;
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

function boundedInspectionPreview(value: string | null | undefined, fallback = "Not generated"): string {
  const normalized = normalizeReportText(value);
  if (!normalized) return fallback;
  if (/\b(prompt|secret|token|provider payload|db_connection_url|connection string|embedding)\b/i.test(normalized)) {
    return "[redacted internal value]";
  }
  if (normalized.length <= MAX_DEV_INSPECTION_PREVIEW_LENGTH) return normalized;

  const clipped = normalized.slice(0, MAX_DEV_INSPECTION_PREVIEW_LENGTH + 1);
  const lastSpaceIndex = clipped.lastIndexOf(" ");
  const preview = (lastSpaceIndex > 80 ? clipped.slice(0, lastSpaceIndex) : normalized.slice(0, MAX_DEV_INSPECTION_PREVIEW_LENGTH)).trim();
  return `${preview}…`;
}

function inspectionFieldCount(moment: ApiWowMoment): number {
  return [moment.title, moment.why, moment.beliefStatement, moment.reflectionQuestion].filter(
    (value) => normalizeReportText(value).length > 0,
  ).length;
}

function lowerFirstLetter(value: string): string {
  return value ? `${value.charAt(0).toLocaleLowerCase()}${value.slice(1)}` : value;
}

function sourceQuote(value: string): string {
  return `“${stripTerminalPunctuation(value)}”`;
}

function buildBeliefStatement(moment: ApiWowMoment): string {
  const suppliedBelief = cleanBeliefSourceText(moment.beliefStatement);
  if (suppliedBelief) return suppliedBelief;

  const title = beliefExcerpt(moment.title);
  const why = beliefExcerpt(moment.why);
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
    )} may be a small mirror of something you are drawn to. Add more inspirations and WAKA can ground this more clearly.`;
  }

  return "One possible reading: this moment may be a small mirror. Add more inspirations and WAKA can ground the belief more clearly.";
}

function compareBestRecentWowMoments(a: ApiWowMoment, b: ApiWowMoment): number {
  const scoreDelta = b.wowScore - a.wowScore;
  if (scoreDelta !== 0) return scoreDelta;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

interface WowMomentsSectionProps {
  moments: ApiWowMoment[];
  loading: boolean;
  error: string | null;
  showDevInspection?: boolean;
  onAddInspiration?: () => void;
}

export function WowMomentsSection({
  moments,
  loading,
  error,
  showDevInspection = false,
  onAddInspiration,
}: WowMomentsSectionProps): JSX.Element {
  const bestRecentMoments = [...moments].sort(compareBestRecentWowMoments);
  const visibleMoments = bestRecentMoments.slice(0, MAX_VISIBLE_WOW_MOMENTS);
  const [selectedMoment, setSelectedMoment] = useState<ApiWowMoment | null>(null);
  const [selectedResonance, setSelectedResonance] = useState<ResonanceOption | null>(null);
  const [memoryEndingState, setMemoryEndingState] = useState<MemoryEndingState>("prompt");
  const [memoryBeliefText, setMemoryBeliefText] = useState("");
  const [signalExamplesOpen, setSignalExamplesOpen] = useState(false);
  const [expandedSourceReasonIds, setExpandedSourceReasonIds] = useState<Set<string>>(new Set());
  const [allMomentsOpen, setAllMomentsOpen] = useState(false);

  const resetLocalReflectionState = () => {
    setSelectedResonance(null);
    setMemoryEndingState("prompt");
    setMemoryBeliefText("");
    setSignalExamplesOpen(false);
  };

  const closeMoment = () => {
    setSelectedMoment(null);
    resetLocalReflectionState();
    setExpandedSourceReasonIds(new Set());
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
    if (!allMomentsOpen) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAllMomentsOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [allMomentsOpen]);

  useEffect(() => {
    if (!selectedMoment) return;
    if (!visibleMoments.some((moment) => moment.id === selectedMoment.id)) {
      setSelectedMoment(null);
      resetLocalReflectionState();
      setExpandedSourceReasonIds(new Set());
    }
  }, [selectedMoment, visibleMoments]);

  const openMoment = (moment: ApiWowMoment) => {
    setSelectedMoment(moment);
    resetLocalReflectionState();
    const firstSourceId = moment.relatedInspirations[0]?.inspirationId;
    setExpandedSourceReasonIds(firstSourceId ? new Set([firstSourceId]) : new Set());
  };

  const selectResonance = (resonance: ResonanceOption, beliefText: string) => {
    setSelectedResonance(resonance);
    setMemoryEndingState("prompt");
    setMemoryBeliefText(beliefText);
    setSignalExamplesOpen(false);
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

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>, moment: ApiWowMoment) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMoment(moment);
    }
  };

  const selectedPatternReport = selectedMoment ? buildPatternReport(selectedMoment.why) : { lead: "", bodyChunks: [] };
  const selectedPatternVisible = Boolean(selectedPatternReport.lead || selectedPatternReport.bodyChunks.length > 0);
  const selectedBeliefStatement = selectedMoment ? buildBeliefStatement(selectedMoment) : "";
  const selectedSignalCount = selectedMoment?.relatedInspirations.length ?? 0;
  const selectedSignalCountLabel = `${selectedSignalCount} inspiration${selectedSignalCount === 1 ? "" : "s"}`;


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
      <h3 id="wow-moment-detail-title">{selectedMoment.title}</h3>
      <section className="wow-moment-detail-section wow-moment-detail-section--recognition">
        <span className="wow-moment-step-label">Start here</span>
        <h4>The moment</h4>
        <p>This may be worth noticing: {selectedMoment.title}</p>
      </section>
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
                <h5>Marked locally</h5>
                <p>This is only marked locally in this reflection. Future memory is coming soon.</p>
                <blockquote>{memoryBeliefText}</blockquote>
              </>
            ) : memoryEndingState === "dismissed" ? (
              <>
                <h5>We’ll leave this one alone.</h5>
                <p>Nothing is saved; this reflection can stay as a passing mirror.</p>
              </>
            ) : (
              <>
                <h5>Save this as a future memory?</h5>
                <p>
                  {memoryEndingState === "editing"
                    ? "Shape the sentence locally first. It still will not be saved yet."
                    : "Local preview only: nothing is saved yet."}
                </p>
                {memoryEndingState === "editing" ? (
                  <label className="wow-moment-memory-edit">
                    <span>Local draft belief</span>
                    <textarea
                      onChange={(event) => setMemoryBeliefText(event.currentTarget.value)}
                      onInput={(event) => setMemoryBeliefText(event.currentTarget.value)}
                      rows={3}
                      value={memoryBeliefText}
                    />
                  </label>
                ) : null}
                <div className="wow-moment-memory-actions" aria-label="Local future-memory actions">
                  <button onClick={() => setMemoryEndingState("remembered")} type="button">
                    Mark locally
                  </button>
                  <button onClick={() => setMemoryEndingState("editing")} type="button">
                    Edit first
                  </button>
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
              {signalExamplesOpen ? (
                <ul className="wow-moment-signal-examples" aria-label="Example inspiration prompts">
                  <li>A quote, tool, or article you keep reopening without knowing why.</li>
                  <li>A product or side project that feels important even before it is useful.</li>
                  <li>A taste tension like calm vs. ambition, polish vs. play, or solitude vs. signal.</li>
                </ul>
              ) : null}
              <div className="wow-moment-signal-actions">
                <button onClick={handleAddInspirationSignal} type="button">
                  Add another inspiration
                </button>
                <button
                  aria-expanded={signalExamplesOpen}
                  onClick={() => setSignalExamplesOpen((isOpen) => !isOpen)}
                  type="button"
                >
                  {signalExamplesOpen ? "Hide examples" : "Show me examples"}
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
        <h2 id="wow-moments-title">What WAKA noticed</h2>
      </div>
      {!error && !loading && moments.length > 0 ? (
        <div className="wow-moments-actions">
          <p>{visibleMoments.length} best-recent mirror moments shown.</p>
          {showDevInspection ? (
            <button
              aria-controls="dev-wow-inspection-panel"
              aria-expanded={allMomentsOpen}
              className="wow-moments-inspect-button"
              onClick={() => setAllMomentsOpen(true)}
              type="button"
            >
              Dev-only inspect WOW fields ({bestRecentMoments.length})
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="wow-moments-state" role="status">
          <strong>Couldn’t load WOW moments.</strong>
          <span>{error}</span>
        </div>
      ) : loading ? (
        <div className="wow-moments-grid" aria-busy="true" aria-live="polite" role="status">
          <span className="sr-only">Loading WOW moments…</span>
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
          <strong>No WOW moments yet.</strong>
          <span>Keep saving inspirations; patterns will appear here.</span>
        </div>
      ) : (
        <div
          className={`wow-moments-grid wow-moments-grid--populated${selectedMoment ? " wow-moments-grid--expanded" : ""}`}
        >
          {selectedMomentDetail ??
            visibleMoments.map((moment) => {
              const relatedSources = moment.relatedInspirations;

              return (
                <article
                  aria-label={`Open mirror moment report: ${moment.title}`}
                  className="wow-moment-card wow-moment-card--interactive"
                  key={moment.id}
                  onClick={() => openMoment(moment)}
                  onKeyDown={(event) => handleCardKeyDown(event, moment)}
                  role="button"
                  tabIndex={0}
                >
                  <h3>{moment.title}</h3>
                  <span className="wow-moment-open-cue" aria-hidden="true">
                    See why this matters
                  </span>
                  {moment.why ? (
                    <div className="wow-moment-why" aria-label="Why WAKA noticed this">
                      <span>Why WAKA noticed this</span>
                      <p>{moment.why}</p>
                    </div>
                  ) : null}
                  {relatedSources.length > 0 ? (
                    <ol className="wow-moment-related" aria-label="Inspirations behind this">
                      {relatedSources.map((related) => (
                        <li key={`${moment.id}-${related.inspirationId}`}>
                          <span className="wow-moment-related-label">Source inspiration</span>
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


      {showDevInspection && allMomentsOpen ? (
        <div className="wow-moment-detail-backdrop" role="presentation">
          <aside
            aria-labelledby="dev-wow-inspection-title"
            aria-modal="true"
            className="wow-moment-detail-panel wow-moments-all-panel wow-moments-dev-inspection-panel"
            id="dev-wow-inspection-panel"
            role="dialog"
          >
            <div className="wow-moment-detail-header">
              <p className="wow-moment-detail-kicker">Temporary internal inspection</p>
              <button
                className="wow-moment-detail-close"
                onClick={() => setAllMomentsOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <h3 id="dev-wow-inspection-title">Generated field previews</h3>
            <p className="wow-moments-dev-inspection-note">
              Safe, bounded previews of generated fields for live internal testing. This panel is only
              shown behind the internal development gate.
            </p>
            <ol className="wow-moments-all-list">
              {bestRecentMoments.map((moment) => (
                <li className="wow-moments-all-item" key={`all-${moment.id}`}>
                  <div className="wow-moments-all-item-header">
                    <strong>{boundedInspectionPreview(moment.title, "Untitled WOW moment")}</strong>
                  </div>
                  <dl className="wow-moments-dev-fields">
                    <div>
                      <dt>Title / headline</dt>
                      <dd>{boundedInspectionPreview(moment.title, "Untitled WOW moment")}</dd>
                    </div>
                    <div>
                      <dt>Why / meaning copy</dt>
                      <dd>{boundedInspectionPreview(moment.why)}</dd>
                    </div>
                    <div>
                      <dt>Belief statement</dt>
                      <dd>{boundedInspectionPreview(moment.beliefStatement)}</dd>
                    </div>
                    <div>
                      <dt>Reflection prompt</dt>
                      <dd>{boundedInspectionPreview(moment.reflectionQuestion)}</dd>
                    </div>
                    <div>
                      <dt>Compact counts</dt>
                      <dd>
                        {moment.relatedInspirations.length} source
                        {moment.relatedInspirations.length === 1 ? "" : "s"}; {inspectionFieldCount(moment)}
                        {" "}generated field
                        {inspectionFieldCount(moment) === 1 ? "" : "s"} present
                      </dd>
                    </div>
                  </dl>
                  {moment.relatedInspirations.length > 0 ? (
                    <ol className="wow-moments-all-sources">
                      {moment.relatedInspirations.map((related) => (
                        <li key={`all-${moment.id}-${related.inspirationId}`}>
                          <span>Source role / reason</span>
                          <blockquote>{boundedInspectionPreview(related.text)}</blockquote>
                          <p className="wow-moment-source-reason">
                            <span>{boundedInspectionPreview(safeSourceRoleLabel(related.role), SOURCE_FALLBACK_LABEL)}</span>
                            {boundedInspectionPreview(safeSourceReason(related.reason), SOURCE_FALLBACK_REASON)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ol>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
