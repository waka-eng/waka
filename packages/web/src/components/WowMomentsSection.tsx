import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { ApiWowMoment } from "../lib/api";

const MAX_VISIBLE_WOW_MOMENTS = 9;

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

function formatDevWowScore(score: number): string {
  return `DEV WOW score ${score}`;
}

export function WowMomentsSection({
  moments,
  loading,
  error,
}: WowMomentsSectionProps): JSX.Element {
  const bestRecentMoments = [...moments].sort(compareBestRecentWowMoments);
  const visibleMoments = bestRecentMoments.slice(0, MAX_VISIBLE_WOW_MOMENTS);
  const [selectedMoment, setSelectedMoment] = useState<ApiWowMoment | null>(null);
  const [allMomentsOpen, setAllMomentsOpen] = useState(false);

  useEffect(() => {
    if (!selectedMoment) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedMoment(null);
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
    }
  }, [selectedMoment, visibleMoments]);

  const openMoment = (moment: ApiWowMoment) => {
    setSelectedMoment(moment);
  };

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>, moment: ApiWowMoment) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMoment(moment);
    }
  };

  return (
    <section className="wow-moments-section" aria-labelledby="wow-moments-title">
      <div className="wow-moments-heading">
        <h2 id="wow-moments-title">WOW moments</h2>
      </div>
      {!error && !loading && moments.length > 0 ? (
        <div className="wow-moments-actions">
          <p>{visibleMoments.length} best-recent WOW moments shown.</p>
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
                aria-label={`Open WOW moment details: ${moment.title}`}
                className="wow-moment-card wow-moment-card--interactive"
                key={moment.id}
                onClick={() => openMoment(moment)}
                onKeyDown={(event) => handleCardKeyDown(event, moment)}
                role="button"
                tabIndex={0}
              >
                <h3>{moment.title}</h3>
                <span className="wow-moment-open-cue" aria-hidden="true">
                  Open detail
                </span>
                {relatedSources.length > 0 ? (
                  <ol className="wow-moment-related" aria-label="Related inspirations">
                    {relatedSources.map((related) => (
                      <li key={`${moment.id}-${related.inspirationId}`}>
                        <span className="wow-moment-related-score">
                          {formatDevWowScore(related.wowScore)}
                        </span>
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
              <p className="wow-moment-detail-kicker">WOW moment detail</p>
              <button
                className="wow-moment-detail-close"
                onClick={() => setSelectedMoment(null)}
                type="button"
              >
                Close
              </button>
            </div>
            <h3 id="wow-moment-detail-title">{selectedMoment.title}</h3>
            {selectedMoment.why ? (
              <section className="wow-moment-detail-section">
                <h4>Why it matters</h4>
                <p>{selectedMoment.why}</p>
              </section>
            ) : null}
            {selectedMoment.reflectionQuestion ? (
              <section className="wow-moment-detail-section wow-moment-detail-section--reflection">
                <h4>Reflection question</h4>
                <p>{selectedMoment.reflectionQuestion}</p>
              </section>
            ) : null}
            {selectedMoment.relatedInspirations.length > 0 ? (
              <section className="wow-moment-detail-section">
                <h4>Related source inspirations</h4>
                <ol className="wow-moment-detail-sources">
                  {selectedMoment.relatedInspirations.map((related) => (
                    <li key={`${selectedMoment.id}-detail-${related.inspirationId}`}>
                      <span className="wow-moment-related-score">
                        {formatDevWowScore(related.wowScore)}
                      </span>
                      <blockquote>{related.text}</blockquote>
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
              <p className="wow-moment-detail-kicker">All generated WOW moments</p>
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
                    <span>{formatDevWowScore(moment.wowScore)}</span>
                  </div>
                  <p>
                    {moment.relatedInspirations.length} related source
                    {moment.relatedInspirations.length === 1 ? "" : "s"}
                  </p>
                  {moment.why ? <blockquote>{moment.why}</blockquote> : null}
                  {moment.relatedInspirations.length > 0 ? (
                    <ol className="wow-moments-all-sources">
                      {moment.relatedInspirations.map((related) => (
                        <li key={`all-${moment.id}-${related.inspirationId}`}>
                          <span>{related.role}</span>
                          <blockquote>{related.text}</blockquote>
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
