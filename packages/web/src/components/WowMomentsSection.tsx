import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { ApiWowMoment } from "../lib/api";

const MAX_VISIBLE_WOW_MOMENTS = 9;
const MAX_BELIEF_EXCERPT_LENGTH = 72;
const MAX_WOW_LEAD_LENGTH = 180;
const MAX_PATTERN_CHUNK_LENGTH = 240;
type ResonanceOption = "feels-true" | "not-quite";

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
    moment.relatedInspirations.find((related) => cleanBeliefSourceText(related.reason))?.reason,
  );
  const sourceText = beliefExcerpt(
    moment.relatedInspirations.find((related) => cleanBeliefSourceText(related.text))?.text,
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
}

export function WowMomentsSection({
  moments,
  loading,
  error,
}: WowMomentsSectionProps): JSX.Element {
  const bestRecentMoments = [...moments].sort(compareBestRecentWowMoments);
  const visibleMoments = bestRecentMoments.slice(0, MAX_VISIBLE_WOW_MOMENTS);
  const [selectedMoment, setSelectedMoment] = useState<ApiWowMoment | null>(null);
  const [selectedResonance, setSelectedResonance] = useState<ResonanceOption | null>(null);
  const [allMomentsOpen, setAllMomentsOpen] = useState(false);

  const closeMoment = () => {
    setSelectedMoment(null);
    setSelectedResonance(null);
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
      setSelectedResonance(null);
    }
  }, [selectedMoment, visibleMoments]);

  const openMoment = (moment: ApiWowMoment) => {
    setSelectedMoment(moment);
    setSelectedResonance(null);
  };

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>, moment: ApiWowMoment) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMoment(moment);
    }
  };

  const selectedPatternReport = selectedMoment ? buildPatternReport(selectedMoment.why) : { lead: "", bodyChunks: [] };
  const selectedPatternVisible = Boolean(selectedPatternReport.lead || selectedPatternReport.bodyChunks.length > 0);

  return (
    <section className="wow-moments-section" aria-labelledby="wow-moments-title">
      <div className="wow-moments-heading">
        <h2 id="wow-moments-title">What WAKA noticed</h2>
      </div>
      {!error && !loading && moments.length > 0 ? (
        <div className="wow-moments-actions">
          <p>{visibleMoments.length} best-recent mirror moments shown.</p>
          <button
            aria-controls="all-wow-moments-panel"
            aria-expanded={allMomentsOpen}
            className="wow-moments-inspect-button"
            onClick={() => setAllMomentsOpen(true)}
            type="button"
          >
            Inspect all WOW moments ({bestRecentMoments.length})
          </button>
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
        <div className="wow-moments-grid wow-moments-grid--populated">
          {visibleMoments.map((moment) => {
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

      {selectedMoment ? (
        <div className="wow-moment-detail-backdrop" role="presentation">
          <aside
            aria-labelledby="wow-moment-detail-title"
            aria-modal="true"
            className="wow-moment-detail-panel"
            role="dialog"
          >
            <div className="wow-moment-detail-header">
              <p className="wow-moment-detail-kicker">Personal pattern report</p>
              <button
                className="wow-moment-detail-close"
                onClick={closeMoment}
                type="button"
              >
                Close
              </button>
            </div>
            <h3 id="wow-moment-detail-title">{selectedMoment.title}</h3>
            {selectedPatternVisible ? (
              <section className="wow-moment-detail-section wow-moment-detail-section--pattern">
                <h4>How the pattern shows up</h4>
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
              </section>
            ) : null}
            <section className="wow-moment-detail-section">
              <h4>What this may say about you</h4>
              <p>
                Across these inspirations, you may be returning to a question that already
                matters to you. Treat this as a mirror, not a recommendation.
              </p>
            </section>
            {selectedMoment.reflectionQuestion ? (
              <section className="wow-moment-detail-section wow-moment-detail-section--reflection">
                <h4>Reflection question</h4>
                <p>{selectedMoment.reflectionQuestion}</p>
              </section>
            ) : null}
            <section className="wow-moment-detail-section wow-moment-detail-section--belief">
              <h4>A belief this may point to</h4>
              <p>{buildBeliefStatement(selectedMoment)} Does this feel true?</p>
              <div className="wow-moment-belief-actions" aria-label="Belief resonance options">
                <button
                  aria-pressed={selectedResonance === "feels-true"}
                  onClick={() => setSelectedResonance("feels-true")}
                  type="button"
                >
                  Feels true
                </button>
                <button
                  aria-pressed={selectedResonance === "not-quite"}
                  onClick={() => setSelectedResonance("not-quite")}
                  type="button"
                >
                  Not quite
                </button>
              </div>
              <p className="wow-moment-belief-note">For reflection only; not saved.</p>
            </section>
            {selectedMoment.relatedInspirations.length > 0 ? (
              <section className="wow-moment-detail-section">
                <div className="wow-moment-detail-section-header">
                  <h4>Inspirations behind this</h4>
                  <span className="wow-moment-source-count">
                    {`${selectedMoment.relatedInspirations.length} source${
                      selectedMoment.relatedInspirations.length === 1 ? "" : "s"
                    }`}
                  </span>
                </div>
                <ol className="wow-moment-detail-sources">
                  {selectedMoment.relatedInspirations.map((related) => (
                    <li key={`${selectedMoment.id}-detail-${related.inspirationId}`}>
                      <span className="wow-moment-related-label">Source inspiration</span>
                      <blockquote>{related.text}</blockquote>
                      {related.reason ? (
                        <p className="wow-moment-source-reason">
                          <span>Why this source matters</span>
                          {related.reason}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </aside>
        </div>
      ) : null}

      {allMomentsOpen ? (
        <div className="wow-moment-detail-backdrop" role="presentation">
          <aside
            aria-labelledby="all-wow-moments-title"
            aria-modal="true"
            className="wow-moment-detail-panel wow-moments-all-panel"
            id="all-wow-moments-panel"
            role="dialog"
          >
            <div className="wow-moment-detail-header">
              <p className="wow-moment-detail-kicker">All WOW moments</p>
              <button
                className="wow-moment-detail-close"
                onClick={() => setAllMomentsOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <h3 id="all-wow-moments-title">Available WOW moments</h3>
            <ol className="wow-moments-all-list">
              {bestRecentMoments.map((moment) => (
                <li className="wow-moments-all-item" key={`all-${moment.id}`}>
                  <div className="wow-moments-all-item-header">
                    <strong>{moment.title}</strong>
                  </div>
                  <p>
                    {moment.relatedInspirations.length} source
                    {moment.relatedInspirations.length === 1 ? "" : "s"}
                    {" "}connected
                  </p>
                  {moment.why ? (
                    <div className="wow-moments-all-reasoning">
                      <p>Why WAKA noticed this</p>
                      <blockquote>{moment.why}</blockquote>
                    </div>
                  ) : null}
                  {moment.relatedInspirations.length > 0 ? (
                    <ol className="wow-moments-all-sources">
                      {moment.relatedInspirations.map((related) => (
                        <li key={`all-${moment.id}-${related.inspirationId}`}>
                          <span>Source inspiration</span>
                          <blockquote>{related.text}</blockquote>
                          {related.reason ? (
                            <p className="wow-moment-source-reason">
                              <span>Why this source matters</span>
                              {related.reason}
                            </p>
                          ) : null}
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
