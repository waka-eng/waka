import type { ApiWowMoment } from "../lib/api";

const MAX_VISIBLE_WOW_MOMENTS = 9;
const MAX_VISIBLE_SOURCES_PER_CARD = 2;
const SOURCE_SNIPPET_MAX_LENGTH = 54;

function getSourceSnippet(text: string): string {
  const compactText = text.trim().replace(/\s+/g, " ");
  if (compactText.length <= SOURCE_SNIPPET_MAX_LENGTH) return compactText;
  return `${compactText.slice(0, SOURCE_SNIPPET_MAX_LENGTH - 1).trimEnd()}…`;
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
  const visibleMoments = moments.slice(0, MAX_VISIBLE_WOW_MOMENTS);

  return (
    <section className="wow-moments-section" aria-labelledby="wow-moments-title">
      <div className="wow-moments-heading">
        <h2 id="wow-moments-title">WOW moments</h2>
        {!loading && !error && moments.length > 0 ? (
          <span
            className="wow-moments-count"
            aria-label={`${visibleMoments.length} WOW moments shown`}
          >
            {visibleMoments.length}
          </span>
        ) : null}
      </div>
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
            const visibleSources = moment.relatedInspirations.slice(0, MAX_VISIBLE_SOURCES_PER_CARD);
            const hiddenSourceCount = Math.max(0, moment.relatedInspirations.length - visibleSources.length);

            return (
              <article className="wow-moment-card" key={moment.id}>
                <h3>{moment.title}</h3>
                {visibleSources.length > 0 ? (
                  <ol className="wow-moment-related" aria-label="Related inspirations">
                    {visibleSources.map((related) => (
                      <li key={`${moment.id}-${related.inspirationId}`}>
                        <blockquote>{getSourceSnippet(related.text)}</blockquote>
                      </li>
                    ))}
                    {hiddenSourceCount > 0 ? (
                      <li className="wow-moment-related-more">
                        +{hiddenSourceCount} {hiddenSourceCount === 1 ? "source" : "sources"}
                      </li>
                    ) : null}
                  </ol>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
