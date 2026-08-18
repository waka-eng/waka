import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AdminApiError,
  fetchBackgroundJobDetail,
  fetchBackgroundJobs,
  retryBackgroundJob,
  type AdminBackgroundJob,
} from "./lib/admin-api";
import "./styles.css";

const STATUS_OPTIONS = ["pending", "running", "succeeded", "failed"];
const TYPE_OPTIONS = [
  "enrich_attachment",
  "derive_signals",
  "refresh_top_of_mind",
  "refresh_group_top_of_mind",
];

interface Notice {
  kind: "info" | "warning" | "error" | "success";
  message: string;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/**
 * The payload summary, rendered from whatever the server chose to name.
 *
 * Every job type carries a different payload, and the server is the side that
 * knows which of its keys are safe to show — so this prints the record it is
 * handed rather than reaching for one job type's field by name. A type this
 * app has never heard of still reads correctly.
 */
function payloadEntries(job: AdminBackgroundJob): Array<[string, string]> {
  return Object.entries(job.payloadSummary).map(([key, value]) => [
    key,
    typeof value === "string" ? value : JSON.stringify(value),
  ]);
}

function payloadInline(job: AdminBackgroundJob): string {
  const entries = payloadEntries(job);
  if (entries.length === 0) return "—";
  return entries.map(([key, value]) => `${key}: ${value}`).join(" · ");
}

function classifyError(error: unknown): Notice {
  if (error instanceof AdminApiError) {
    if (error.status === 404) {
      return {
        kind: "warning",
        message:
          "Admin routes are disabled. Set WAKA_ENABLE_BACKGROUND_JOBS_ADMIN=true on the API/dev server.",
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        kind: "warning",
        message: "Sign into the WAKA app first; cookies are required for admin access.",
      };
    }
    return { kind: "error", message: error.message };
  }
  return { kind: "error", message: "Unexpected error while loading background jobs" };
}

export function App(): JSX.Element {
  const [jobs, setJobs] = useState<AdminBackgroundJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<AdminBackgroundJob | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({ status: statusFilter || undefined, type: typeFilter || undefined }),
    [statusFilter, typeFilter],
  );

  const loadJobs = useCallback(async () => {
    setIsLoading(true);
    setNotice(null);
    try {
      const nextJobs = await fetchBackgroundJobs(filters);
      setJobs(nextJobs);
      setSelectedJob((current) => {
        if (!current) return null;
        return nextJobs.some((job) => job.id === current.id) ? current : null;
      });
    } catch (error) {
      setJobs([]);
      setSelectedJob(null);
      setNotice(classifyError(error));
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  const loadJobDetail = useCallback(async (job: AdminBackgroundJob) => {
    setSelectedJob(job);
    setIsDetailLoading(true);
    setNotice(null);
    try {
      const detail = await fetchBackgroundJobDetail(job.id);
      setSelectedJob(detail);
      setJobs((current) => current.map((item) => (item.id === detail.id ? { ...item, ...detail } : item)));
    } catch (error) {
      setNotice(classifyError(error));
    } finally {
      setIsDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  async function handleRetry(job: AdminBackgroundJob): Promise<void> {
    setRetryingId(job.id);
    setNotice(null);
    try {
      const updated = await retryBackgroundJob(job.id);
      setJobs((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice({ kind: "success", message: `Queued retry for job ${updated.id}` });
      if (selectedJob?.id === updated.id) {
        await loadJobDetail(updated);
      }
    } catch (error) {
      setNotice(classifyError(error));
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <main className="admin-shell">
      <header className="hero">
        <p className="eyebrow">Internal admin</p>
        <h1>WAKA Admin / Background Jobs</h1>
        <p className="subhead">
          Minimal queue observability for the tenant-scoped admin API. This UI never renders raw
          job payloads; it uses the backend-provided payload summary only.
        </p>
      </header>

      <section className="toolbar" aria-label="Background jobs filters">
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">All</option>
            {TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void loadJobs()} disabled={isLoading}>
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </section>

      {notice ? (
        <section className={`notice notice-${notice.kind}`} role="status">
          {notice.message}
        </section>
      ) : null}

      <section className="card" aria-live="polite">
        <div className="card-header">
          <h2>Jobs</h2>
          <span>{isLoading ? "Loading…" : `${jobs.length} shown`}</span>
        </div>

        {jobs.length === 0 && !isLoading ? (
          <p className="empty">No background jobs match the selected filters.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Attempts</th>
                  <th>Run after</th>
                  <th>Last error</th>
                  <th>Payload</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className={selectedJob?.id === job.id ? "selected-row" : undefined}>
                    <td>
                      <span className={`pill status-${job.status}`}>{job.status}</span>
                    </td>
                    <td>{job.type}</td>
                    <td>
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td>{formatDate(job.runAfter)}</td>
                    <td className="error-cell">{job.lastError ?? "—"}</td>
                    <td className="mono">{payloadInline(job)}</td>
                    <td>{formatDate(job.createdAt)}</td>
                    <td>{formatDate(job.updatedAt)}</td>
                    <td className="action-cell">
                      <button type="button" onClick={() => void loadJobDetail(job)} disabled={isDetailLoading}>
                        {selectedJob?.id === job.id && isDetailLoading ? "Loading…" : "Details"}
                      </button>
                      {job.status === "failed" ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void handleRetry(job)}
                          disabled={retryingId === job.id}
                        >
                          {retryingId === job.id ? "Retrying…" : "Retry"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedJob ? (
        <section className="card detail-card" aria-live="polite">
          <div className="card-header">
            <h2>Job detail</h2>
            <span className="mono">{selectedJob.id}</span>
          </div>
          <div className="detail-body">
            <dl className="metadata-grid">
              <dt>Status</dt>
              <dd>
                <span className={`pill status-${selectedJob.status}`}>{selectedJob.status}</span>
              </dd>
              <dt>Type</dt>
              <dd>{selectedJob.type}</dd>
              <dt>Profile</dt>
              <dd className="mono">{selectedJob.profileId}</dd>
              <dt>Attempts</dt>
              <dd>
                {selectedJob.attempts}/{selectedJob.maxAttempts}
              </dd>
              <dt>Run after</dt>
              <dd>{formatDate(selectedJob.runAfter)}</dd>
              <dt>Locked at</dt>
              <dd>{formatDate(selectedJob.lockedAt)}</dd>
              <dt>Last error</dt>
              <dd className="error-cell">{selectedJob.lastError ?? "—"}</dd>
              <dt>Payload summary</dt>
              <dd>
                {payloadEntries(selectedJob).length === 0 ? (
                  "—"
                ) : (
                  <ul className="payload-list">
                    {payloadEntries(selectedJob).map(([key, value]) => (
                      <li key={key}>
                        {key}: <span className="mono">{value}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
              <dt>Created / updated</dt>
              <dd>
                {formatDate(selectedJob.createdAt)} / {formatDate(selectedJob.updatedAt)}
              </dd>
            </dl>
            {selectedJob.status === "failed" ? (
              <button
                type="button"
                className="secondary detail-retry"
                onClick={() => void handleRetry(selectedJob)}
                disabled={retryingId === selectedJob.id}
              >
                {retryingId === selectedJob.id ? "Retrying…" : "Retry failed job"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
