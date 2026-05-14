import type { ApiWowMoment } from "../lib/api";

const MAX_VISIBLE_WOW_MOMENTS = 9;

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
  const totalRelated = visibleMoments.reduce(
    (count, moment) => count + moment.relatedInspirations.length,
    0,
  );

  return (
    <section className="wow-moments-section" aria-labelledby="wow-moments-title">
      <div className="wow-moments-heading">
        <div>
          <span className="wow-moments-eyebrow">WOW moment dashboard</span>
          <h2 id="wow-moments-title">Patterns worth returning to</h2>
        </div>
        {!loading && !error && moments.length > 0 ? (
          <span className="wow-moments-count">
            {visibleMoments.length}
            {moments.length > visibleMoments.length ? ` of ${moments.length}` : ""} moments · {totalRelated} links
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
          <span>
            Keep saving inspirations; WAKA will surface recurrences, bridges,
            tensions, and outliers here once the generator finds a durable
            pattern.
          </span>
        </div>
      ) : (
        <div className="wow-moments-grid">
          {visibleMoments.map((moment) => {
            return (
              <article className="wow-moment-card" key={moment.id}>
                <div className="wow-moment-card-topline">
                  <span>{moment.wowScore}% confidence</span>
                </div>
                <h3>{moment.title}</h3>
                <p className="wow-moment-why">{moment.why}</p>
                {moment.relatedInspirations.length > 0 ? (
                  <ol className="wow-moment-related" aria-label="Related inspirations">
                    {moment.relatedInspirations.map((related) => (
                      <li key={`${moment.id}-${related.inspirationId}`}>
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
    </section>
  );
}
