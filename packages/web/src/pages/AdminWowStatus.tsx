import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchInspirationScoreBreakdown,
  fetchWowStatus,
  type ApiInspirationScoreBreakdown,
  type ApiWowStatusRow,
} from "../lib/api";

function formatDate(value: string | null | undefined): string {
  if (!value) return "not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not set";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function rawJudgeLog(row: ApiWowStatusRow): string {
  const parts = [
    row.debugReason.rawGeminiPreview ? `raw: ${row.debugReason.rawGeminiPreview}` : "",
    row.debugReason.parseFailureStage ? `stage: ${row.debugReason.parseFailureStage}` : "",
    row.debugReason.finishReason ? `finish: ${row.debugReason.finishReason}` : "",
    row.debugReason.schemaIssueSummary ? `schema: ${row.debugReason.schemaIssueSummary}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : "No raw judge diagnostics.";
}

type ScoreBreakdownState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; breakdown: ApiInspirationScoreBreakdown };

function scoreValue(score: number | null): string {
  return score === null ? "not available" : String(score);
}

function ScoreBreakdownGrid({ breakdown }: { breakdown: ApiInspirationScoreBreakdown }): JSX.Element {
  return (
    <div className="admin-score-breakdown">
      <div>
        <span>Displayed WOW</span>
        <strong>{breakdown.displayedWowScore}</strong>
      </div>
      <div>
        <span>Stored/core WOW</span>
        <strong>{breakdown.persistedCoreWowScore}</strong>
      </div>
      <div>
        <span>Stored importance</span>
        <strong>{breakdown.importanceScore}</strong>
      </div>
      <div>
        <span>Freshness adjustment</span>
        <strong>
          {breakdown.freshnessAdjustment.displayedMinusCore >= 0 ? "+" : ""}
          {breakdown.freshnessAdjustment.displayedMinusCore}
        </strong>
      </div>
      <div>
        <span>Content/text/context</span>
        <strong>{breakdown.factors.content.score}</strong>
      </div>
      <div>
        <span>Processing/reflection</span>
        <strong>{breakdown.factors.processing.score}</strong>
      </div>
      <div>
        <span>Revisit</span>
        <strong>{breakdown.factors.revisit.score}</strong>
      </div>
      <div>
        <span>Relationship</span>
        <strong>{scoreValue(breakdown.factors.relationship.score)}</strong>
      </div>
      <div className="admin-score-breakdown-wide">
        <span>Context counts</span>
        <strong>
          {breakdown.factors.content.meaningfulLinkCount} links ·{" "}
          {breakdown.factors.content.nonLinkAttachmentCount} attachments ·{" "}
          {breakdown.factors.content.reflectionTextChars} reflection chars
        </strong>
      </div>
      <div className="admin-score-breakdown-wide">
        <span>Relationship note</span>
        <strong>{breakdown.factors.relationship.note}</strong>
      </div>
    </div>
  );
}

export default function AdminWowStatusPage(): JSX.Element {
  const [rows, setRows] = useState<ApiWowStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedScoreId, setExpandedScoreId] = useState<string | null>(null);
  const [scoreBreakdowns, setScoreBreakdowns] = useState<Record<string, ScoreBreakdownState>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchWowStatus(24));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load WOW status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleScoreBreakdown = useCallback((inspirationId: string) => {
    setExpandedScoreId((current) => (current === inspirationId ? null : inspirationId));
    setScoreBreakdowns((current) => {
      if (current[inspirationId]) return current;
      return { ...current, [inspirationId]: { status: "loading" } };
    });
    if (scoreBreakdowns[inspirationId]) return;
    void (async () => {
      try {
        const breakdown = await fetchInspirationScoreBreakdown(inspirationId);
        setScoreBreakdowns((current) => ({
          ...current,
          [inspirationId]: { status: "ready", breakdown },
        }));
      } catch (caught) {
        setScoreBreakdowns((current) => ({
          ...current,
          [inspirationId]: {
            status: "error",
            message: caught instanceof Error ? caught.message : "Failed to load score breakdown.",
          },
        }));
      }
    })();
  }, [scoreBreakdowns]);

  const summary = useMemo(
    () => ({
      inspirations: rows.length,
      ready: rows.filter((row) => row.debugReason.code === "linked_wow_ready").length,
      waiting: rows.filter((row) => row.debugReason.code === "waiting_for_job").length,
      failed: rows.filter((row) => row.debugReason.code === "job_failed").length,
    }),
    [rows],
  );

  return (
    <main className="admin-page">
      <header className="admin-page-header admin-page-header--row">
        <div>
          <Link to="/admin" className="admin-back-link">Admin</Link>
          <span>internal diagnostics</span>
          <h1>WOW pipeline status</h1>
          <p>
            Internal visibility into the existing WOW pipeline. This page keeps
            scores, debug labels, jobs, and judge diagnostics out of the
            user-facing product surface.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <section className="admin-summary-row" aria-label="WOW status summary">
        <span>{summary.inspirations} inspirations</span>
        <span>{summary.ready} ready</span>
        <span>{summary.waiting} waiting</span>
        <span>{summary.failed} failed</span>
      </section>

      {error ? <p className="admin-error">{error}</p> : null}

      <section className="admin-table-card" aria-label="WOW pipeline rows">
        <div className="admin-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Saved</th>
                <th>Inspiration</th>
                <th>Cluster</th>
                <th>Scores</th>
                <th>Embedding</th>
                <th>Job</th>
                <th>Generated</th>
                <th>Why</th>
                <th>Raw judge log</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9}>{loading ? "Loading status..." : "No recent inspirations."}</td>
                </tr>
              ) : (
                rows.map((row) => {
                  const scoreState = scoreBreakdowns[row.inspiration.id];
                  const scoreExpanded = expandedScoreId === row.inspiration.id;
                  return (
                    <Fragment key={row.inspiration.id}>
                      <tr>
                        <td>{formatDate(row.inspiration.createdAt)}</td>
                        <td>{row.inspiration.textPreview}</td>
                        <td>{row.inspiration.cluster ?? "unclassified"}</td>
                        <td>
                          <strong>WOW {row.inspiration.wowScore}</strong>
                          <span>Importance {row.inspiration.importanceScore}</span>
                          <button
                            type="button"
                            className="admin-inline-button"
                            onClick={() => toggleScoreBreakdown(row.inspiration.id)}
                          >
                            {scoreExpanded ? "Hide breakdown" : "Score breakdown"}
                          </button>
                        </td>
                        <td>{row.embedded ? "embedded" : "missing"}</td>
                        <td>
                          {row.job ? (
                            <>
                              <strong>{row.job.status}</strong>
                              <span>{formatDate(row.job.updatedAt)}</span>
                            </>
                          ) : (
                            "no job"
                          )}
                        </td>
                        <td>{row.generatedWowMomentCount}</td>
                        <td>
                          <strong>{row.debugReason.label}</strong>
                          <span>{row.debugReason.detail}</span>
                        </td>
                        <td>
                          <pre>{rawJudgeLog(row)}</pre>
                        </td>
                      </tr>
                      {scoreExpanded ? (
                        <tr key={`${row.inspiration.id}-score-breakdown`}>
                          <td colSpan={9}>
                            {scoreState?.status === "ready" ? (
                              <ScoreBreakdownGrid breakdown={scoreState.breakdown} />
                            ) : scoreState?.status === "error" ? (
                              <p className="admin-error">{scoreState.message}</p>
                            ) : (
                              "Loading score breakdown..."
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
