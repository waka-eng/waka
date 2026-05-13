import type { ApiWowMoment, WowKind } from "../lib/api";

const WOW_KIND_LABELS: Record<WowKind, string> = {
  recurrence: "Recurrence",
  bridge: "Bridge",
  surprise_bridge: "Surprise bridge",
  tension: "Tension",
  outlier: "Outlier",
};

interface WowMomentsSectionProps {
  moments: ApiWowMoment[];
  loading: boolean;
  error: string | null;
}

function formatRelatedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function WowMomentsSection({
  moments,
  loading,
  error,
}: WowMomentsSectionProps): JSX.Element {
  const totalRelated = moments.reduce(
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
            {moments.length} moments · {totalRelated} links
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
          {moments.map((moment) => (
            <article className="wow-moment-card" key={moment.id}>
              <div className="wow-moment-card-topline">
                <span>{WOW_KIND_LABELS[moment.kind]}</span>
                <span>{moment.relatedInspirations.length} inspirations</span>
                <span>score {moment.wowScore}</span>
              </div>
              <h3>{moment.title}</h3>
              <p className="wow-moment-why">{moment.why}</p>
              {moment.relatedInspirations.length > 0 ? (
                <ol className="wow-moment-related" aria-label="Related inspirations">
                  {moment.relatedInspirations.map((related, index) => (
                    <li key={`${moment.id}-${related.inspirationId}`}>
                      <div className="wow-moment-related-index">{index + 1}</div>
                      <div className="wow-moment-related-body">
                        <div className="wow-moment-related-meta">
                          <strong>{related.role}</strong>
                          <span>
                            {related.kind ?? "inspiration"} · {formatRelatedDate(related.createdAt)}
                          </span>
                        </div>
                        {related.reason ? (
                          <p className="wow-moment-related-reason">{related.reason}</p>
                        ) : null}
                        <blockquote>{related.text}</blockquote>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : null}
              {moment.reflectionQuestion ? (
                <p className="wow-moment-reflection">
                  {moment.reflectionQuestion}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
