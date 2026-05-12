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

export function WowMomentsSection({
  moments,
  loading,
  error,
}: WowMomentsSectionProps): JSX.Element {
  return (
    <section className="wow-moments-section" aria-labelledby="wow-moments-title">
      <div className="wow-moments-heading">
        <span className="wow-moments-eyebrow">WOW moments</span>
        <h2 id="wow-moments-title">Patterns worth returning to</h2>
      </div>
      {error ? (
        <p className="wow-moments-empty" role="status">
          {error}
        </p>
      ) : loading ? (
        <p className="wow-moments-empty" role="status">
          Loading WOW moments…
        </p>
      ) : moments.length === 0 ? (
        <p className="wow-moments-empty">
          No WOW moments yet. Keep saving inspirations; WAKA will surface
          recurrences, bridges, tensions, and outliers here once the generator is
          connected.
        </p>
      ) : (
        <div className="wow-moments-list">
          {moments.map((moment) => (
            <article className="wow-moment-card" key={moment.id}>
              <div className="wow-moment-card-topline">
                <span>{WOW_KIND_LABELS[moment.kind]}</span>
                <span>score {moment.wowScore}</span>
              </div>
              <h3>{moment.title}</h3>
              <p className="wow-moment-why">{moment.why}</p>
              {moment.relatedInspirations.length > 0 ? (
                <ul className="wow-moment-related">
                  {moment.relatedInspirations.map((related) => (
                    <li key={`${moment.id}-${related.inspirationId}`}>
                      <strong>{related.role}</strong>
                      {related.reason ? <span>{related.reason}</span> : null}
                      <blockquote>{related.text}</blockquote>
                    </li>
                  ))}
                </ul>
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
