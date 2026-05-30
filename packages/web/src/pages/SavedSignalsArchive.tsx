import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";

import {
  createFeedback,
  fetchSavedSignalDetail,
  fetchSavedSignals,
  type ApiFeedbackValue,
  type ApiSavedSignalDetail,
  type ApiSavedSignalSearchResult,
  type SavedSignalArchiveFilter,
  type SavedSignalArchiveSort,
} from "../lib/api";

const FILTERS: Array<{ value: SavedSignalArchiveFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "highlighted", label: "Highlighted" },
  { value: "high_resonance", label: "High resonance" },
  { value: "tensions", label: "Tensions" },
  { value: "questions", label: "Questions" },
  { value: "people_places", label: "People and places" },
  { value: "recently_resurfaced", label: "Recently resurfaced" },
];

const SORTS: Array<{ value: SavedSignalArchiveSort; label: string }> = [
  { value: "recent", label: "Newest" },
  { value: "resonance", label: "Resonance" },
  { value: "revisited", label: "Resurfaced" },
];

const FEEDBACK_ACTIONS: Array<{ value: ApiFeedbackValue; label: string }> = [
  { value: "important", label: "Still matters" },
  { value: "true", label: "True" },
  { value: "partly", label: "Needs correction" },
  { value: "not_important", label: "No longer matters" },
];

function shortText(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function scoreLabel(value: number): string {
  return `${Math.round(value)} resonance`;
}

function packetSummary(packetText: string): string {
  return packetText
    .split("\n")
    .filter((line) => !line.startsWith("waka.signal_packet"))
    .join(" ")
    .replace(/^[A-Z_]+:\s*/, "")
    .trim();
}

export function SavedSignalsArchivePage(): JSX.Element {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SavedSignalArchiveFilter>("all");
  const [sort, setSort] = useState<SavedSignalArchiveSort>("recent");
  const [signals, setSignals] = useState<ApiSavedSignalSearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApiSavedSignalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [feedbackState, setFeedbackState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved"; label: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const rows = await fetchSavedSignals({
            q: query.trim() || undefined,
            filter,
            sort,
            limit: 80,
          });
          if (cancelled) return;
          setSignals(rows);
          setSelectedId((current) => current ?? rows[0]?.id ?? null);
        } catch (caught) {
          if (cancelled) return;
          setError(caught instanceof Error ? caught.message : "Failed to load saved signals");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, filter, sort]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setFeedbackState({ status: "idle" });
    setCorrectionText("");
    void (async () => {
      try {
        const next = await fetchSavedSignalDetail(selectedId);
        if (cancelled) return;
        setDetail(next);
      } catch (caught) {
        if (cancelled) return;
        setDetailError(caught instanceof Error ? caught.message : "Failed to load signal detail");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectedResult = useMemo(
    () => signals.find((signal) => signal.id === selectedId) ?? signals[0] ?? null,
    [selectedId, signals],
  );

  const submitFeedback = useCallback(
    async (value: ApiFeedbackValue, label: string) => {
      const targetId = detail?.id ?? selectedId;
      if (!targetId) return;
      setFeedbackState({ status: "saving" });
      try {
        await createFeedback({
          targetType: "signal",
          targetId,
          value,
          ...(correctionText.trim() ? { correctionText: correctionText.trim() } : {}),
        });
        setFeedbackState({ status: "saved", label });
      } catch (caught) {
        setFeedbackState({
          status: "error",
          message: caught instanceof Error ? caught.message : "Feedback did not save",
        });
      }
    },
    [correctionText, detail?.id, selectedId],
  );

  return (
    <main className="signal-archive-page">
      <header className="signal-archive-topbar">
        <Link to="/" className="signal-archive-home">
          WAKA
        </Link>
        <div>
          <span>saved signal archive</span>
          <h1>Search what hit, then inspect why it still matters.</h1>
        </div>
      </header>

      <section className="signal-archive-controls" aria-label="saved signal search controls">
        <label className="signal-search">
          <span>Search</span>
          <input
            type="search"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            placeholder="Search exact text, highlights, context, or resurfaced notes"
          />
        </label>
        <div className="signal-filter-group" role="group" aria-label="quick filters">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={filter === item.value ? "is-active" : ""}
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="signal-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SavedSignalArchiveSort)}>
            {SORTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="signal-archive-layout">
        <div className="signal-results" aria-label="saved signal results">
          <div className="signal-results-head">
            <strong>{loading ? "Searching" : `${signals.length} signals`}</strong>
            <span>No folders or tags required.</span>
          </div>
          {error ? <p className="signal-state">{error}</p> : null}
          {!error && loading ? <p className="signal-state">Loading saved signals...</p> : null}
          {!error && !loading && signals.length === 0 ? (
            <p className="signal-state">No saved signals match this view yet.</p>
          ) : null}
          {signals.map((signal) => (
            <button
              key={signal.id}
              type="button"
              className={`signal-result${selectedId === signal.id ? " is-selected" : ""}`}
              onClick={() => setSelectedId(signal.id)}
            >
              <span className="signal-result-meta">
                {formatDate(signal.capturedAt)} · {scoreLabel(signal.resonanceScore)}
              </span>
              <strong>{signal.textPreview}</strong>
              {signal.highlightedSnippets[0] ? (
                <blockquote>{signal.highlightedSnippets[0].text}</blockquote>
              ) : null}
              <div className="signal-result-tags">
                {[
                  ...signal.relevanceReasons,
                  ...signal.relatedContextTerms.slice(0, 2),
                ].slice(0, 4).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </button>
          ))}
        </div>

        <aside className="signal-detail" aria-label="saved signal deep dive">
          {detailLoading ? <p className="signal-state">Opening signal...</p> : null}
          {detailError ? <p className="signal-state">{detailError}</p> : null}
          {!detailLoading && !detailError && !detail && selectedResult ? (
            <p className="signal-state">Select a signal to inspect it.</p>
          ) : null}
          {detail ? (
            <>
              <header className="signal-detail-header">
                <span>{formatDate(detail.capturedAt)}</span>
                <h2>{shortText(detail.rawText, 150)}</h2>
                <div className="signal-score-row">
                  <span>{scoreLabel(detail.resonanceScore)}</span>
                  <span>agency {Math.round(detail.signalScores.agency)}</span>
                  <span>decision {Math.round(detail.signalScores.decisionRelevance)}</span>
                </div>
              </header>

              <section className="signal-detail-section">
                <h3>Raw signal</h3>
                <p className="signal-raw">{detail.rawText}</p>
                {detail.attachments.length > 0 ? (
                  <ul className="signal-attachments">
                    {detail.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <span>{attachment.type}</span>
                        {attachment.url ? <a href={attachment.url}>{attachment.label}</a> : <strong>{attachment.label}</strong>}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              <section className="signal-detail-section">
                <h3>Highlighted parts</h3>
                {detail.highlightedSnippets.length > 0 ? (
                  <ul className="signal-highlight-list">
                    {detail.highlightedSnippets.map((snippet) => (
                      <li key={snippet.id}>
                        <blockquote>{snippet.text}</blockquote>
                        <span>{snippet.isPrimary ? "primary" : snippet.source}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No highlighted snippet is attached yet.</p>
                )}
              </section>

              <section className="signal-detail-section">
                <h3>Current interpretation</h3>
                {detail.signalPacket ? (
                  <p>{shortText(packetSummary(detail.signalPacket.text), 420)}</p>
                ) : (
                  <p>WAKA has not written a signal packet for this yet.</p>
                )}
              </section>

              <section className="signal-detail-section">
                <h3>Related context</h3>
                {detail.relatedContextNodes.length > 0 ? (
                  <ul className="signal-context-list">
                    {detail.relatedContextNodes.map((node) => (
                      <li key={node.id}>
                        <span>{node.type.replace(/_/g, " ")}</span>
                        <strong>{node.label}</strong>
                        <p>{node.evidenceReason || node.description}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No durable context claim is linked yet.</p>
                )}
              </section>

              <section className="signal-detail-section">
                <h3>Top-of-mind notes influenced</h3>
                {detail.relatedTopOfMindNotes.length > 0 ? (
                  <ul className="signal-note-list">
                    {detail.relatedTopOfMindNotes.map((note) => (
                      <li key={note.id}>
                        <span>{note.type}</span>
                        <strong>{note.title}</strong>
                        <p>{note.body}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>This signal has not resurfaced in a top-of-mind note yet.</p>
                )}
              </section>

              <section className="signal-detail-section signal-loop">
                <h3>Continue the loop</h3>
                <textarea
                  value={correctionText}
                  onChange={(event) => setCorrectionText(event.target.value)}
                  placeholder="Add a reflection or correct what WAKA should remember about this signal."
                  rows={3}
                />
                <div className="signal-feedback-row">
                  {FEEDBACK_ACTIONS.map((action) => (
                    <button
                      key={action.value}
                      type="button"
                      disabled={feedbackState.status === "saving"}
                      onClick={() => void submitFeedback(action.value, action.label)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
                {feedbackState.status === "saved" ? (
                  <p className="signal-feedback-status">Saved: {feedbackState.label}</p>
                ) : feedbackState.status === "error" ? (
                  <p className="signal-feedback-status signal-feedback-status--error">{feedbackState.message}</p>
                ) : feedbackState.status === "saving" ? (
                  <p className="signal-feedback-status">Saving...</p>
                ) : null}
              </section>
            </>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

export default SavedSignalsArchivePage;
