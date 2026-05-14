import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AdminApiError,
  fetchBackgroundJobs,
  retryBackgroundJob,
  type AdminBackgroundJob,
} from "./lib/admin-api";
import "./styles.css";

const STATUS_OPTIONS = ["pending", "running", "succeeded", "failed"];
const TYPE_OPTIONS = ["process_inspiration"];

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

function inspirationId(job: AdminBackgroundJob): string {
  const value = job.payloadSummary.inspirationId;
  return typeof value === "string" && value.length > 0 ? value : "—";
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
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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
    } catch (error) {
      setJobs([]);
      setNotice(classifyError(error));
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

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
                  <th>Inspiration ID</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <span className={`pill status-${job.status}`}>{job.status}</span>
                    </td>
                    <td>{job.type}</td>
                    <td>
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td>{formatDate(job.runAfter)}</td>
                    <td className="error-cell">{job.lastError ?? "—"}</td>
                    <td className="mono">{inspirationId(job)}</td>
                    <td>{formatDate(job.createdAt)}</td>
                    <td>{formatDate(job.updatedAt)}</td>
                    <td>
                      {job.status === "failed" ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void handleRetry(job)}
                          disabled={retryingId === job.id}
                        >
                          {retryingId === job.id ? "Retrying…" : "Retry"}
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
