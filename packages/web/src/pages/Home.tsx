/**
 * `/` — authenticated home page.
 *
 * Owns the inspirations list state for the authenticated user. The board
 * renders the list; the wired `<CaptureForm>` (inside the board) drives
 * the API round-trip. Home receives lifecycle callbacks from the form so
 * it can:
 *
 *   - Add an *optimistic* row to the history sidebar the instant Save is
 *     clicked (no waiting for the inspirations POST to round-trip).
 *   - Swap the optimistic row for the canonical server payload once the
 *     persistence completes.
 *   - Surface a banner / leave the optimistic row in place on hard
 *     failures so the user never loses their typed note.
 *
 * On mount the page calls `GET /inspirations` so the user sees their own
 * historical saves (and *only* their own — the API enforces tenant scope
 * by `user_id`). The result is merged with any in-flight optimistic rows so
 * a save that happens to land while the initial fetch is still resolving
 * is not clobbered by the response.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { InspirationsBoard } from "../components/InspirationsBoard";
import {
  InspirationCard,
  type InspirationCardData,
} from "../components/InspirationCard";
import { WowMomentsSection } from "../components/WowMomentsSection";
import { AppShell } from "../components/layout";
import type {
  PendingInspiration,
  PersistedResult,
} from "../components/capture";
import {
  InspirationDetail,
  type InspirationDetailData,
} from "../components/history";
import {
  type ApiAttachment,
  type ApiBackgroundJob,
  type ApiError,
  type ApiInspiration,
  type ApiInspirationScorePatch,
  type ApiWowMoment,
  type ClusterKind,
  fetchBackgroundJobs,
  fetchInspirations,
  fetchWowMoments,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";

/**
 * Internal state shape for the inspirations list. We track three bits the
 * canonical `ApiInspiration` doesn't carry: whether the row is still in
 * flight (`status`), the synthetic id we used before the server gave us a
 * real one (`tempId`), and the link/attachment metadata the user attached
 * locally (so the history card can render it before the GET endpoint is
 * online).
 */
type InspirationStatus = "saving" | "saved" | "error";

interface InspirationListEntry {
  /** Server-assigned id once persisted; equals `tempId` while saving. */
  id: string;
  tempId: string;
  status: InspirationStatus;
  text: string;
  links: string[];
  /** Per-attachment label (image / file). Surfaces nothing visually today
   *  but kept on the entry so a future detail-view sub-AC can render it
   *  without re-fetching. */
  attachments: ApiAttachment[];
  cluster: ClusterKind | null;
  /** Backend-calculated WOW score; absent while optimistic saves are in flight. */
  wowScore: number | null;
  reflectionsAnswered: number;
  reflectionsTotal: number;
  createdAt: string;
  /** Best-effort timestamp string for the meta row. */
  timestamp: string;
  /** Last error message, if `status === "error"`. */
  errorMessage?: string;
}

function entryToCardData(entry: InspirationListEntry): InspirationCardData {
  // Product UI no longer exposes backend inspiration kind or cluster labels.
  // Keep only transient save status as a user-useful state cue in the meta row.
  let statusLabel: string | null = null;
  if (entry.status === "saving") statusLabel = "saving";
  else if (entry.status === "error") statusLabel = "save failed";
  return {
    id: entry.id,
    text: entry.text || null,
    links: entry.links.length > 0 ? entry.links : null,
    timestamp: entry.timestamp,
    kind: statusLabel,
    reflectionsAnswered: entry.reflectionsAnswered,
    reflectionsTotal: entry.reflectionsTotal,
  };
}

/** Build a human-readable timestamp matching the prototype's format. */
function formatNow(): string {
  const now = new Date();
  return `${now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })} · ${now.toLocaleDateString()}`;
}

/**
 * Format a server-side ISO `created_at` into the same human-readable shape
 * the prototype renders for fresh saves. Falls back gracefully on a parse
 * failure so a malformed timestamp surfaces as the raw string rather than
 * crashing the row.
 */
function formatTimestamp(iso: string): string {
  const ts = new Date(iso);
  if (Number.isNaN(ts.getTime())) return iso;
  return `${ts.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })} · ${ts.toLocaleDateString()}`;
}

/**
 * Map a canonical `ApiInspiration` (as returned by GET /inspirations) into
 * the local list-entry shape. Server-fetched rows are immediately in
 * `"saved"` state — they were already durable when we read them. The
 * `tempId` mirrors the server id so the merge in `setEntries` below has a
 * stable key to reconcile against if a save round-trip eventually resolves
 * for the same row (e.g. after a refresh between optimistic add and POST
 * settlement).
 */
function apiInspirationToEntry(row: ApiInspiration): InspirationListEntry {
  return {
    id: row.id,
    tempId: row.id,
    status: "saved",
    text: row.text,
    links: [],
    attachments: [],
    cluster: row.cluster,
    wowScore: row.wowScore,
    reflectionsAnswered: 0,
    reflectionsTotal: 0,
    createdAt: row.createdAt,
    timestamp: formatTimestamp(row.createdAt),
  };
}

function buildOptimisticEntry(
  pending: PendingInspiration,
): InspirationListEntry {
  return {
    id: pending.tempId,
    tempId: pending.tempId,
    status: "saving",
    text: pending.text,
    links: pending.links,
    attachments: [],
    cluster: null,
    wowScore: null,
    reflectionsAnswered: 0,
    reflectionsTotal: 0,
    createdAt: pending.createdAt,
    timestamp: formatNow(),
  };
}

function applyPersisted(
  entry: InspirationListEntry,
  inspiration: ApiInspiration,
  attachments: ApiAttachment[],
  failedCount: number,
  reflectionCount = 0,
): InspirationListEntry {
  return {
    ...entry,
    id: inspiration.id,
    status: failedCount > 0 ? "error" : "saved",
    text: inspiration.text,
    cluster: inspiration.cluster,
    wowScore: inspiration.wowScore,
    reflectionsAnswered: entry.reflectionsAnswered + reflectionCount,
    reflectionsTotal: entry.reflectionsTotal + reflectionCount,
    attachments,
    errorMessage:
      failedCount > 0
        ? `${failedCount} attachment${failedCount === 1 ? "" : "s"} failed to upload.`
        : undefined,
  };
}

function applyInspirationScorePatch(
  entry: InspirationListEntry,
  scores: ApiInspirationScorePatch,
): InspirationListEntry {
  if (entry.id !== scores.id && entry.tempId !== scores.id) return entry;
  return {
    ...entry,
    wowScore:
      typeof scores.wowScore === "number" ? scores.wowScore : entry.wowScore,
  };
}

function applyUpdatedInspiration(
  entry: InspirationListEntry,
  inspiration: ApiInspiration,
): InspirationListEntry {
  if (entry.id !== inspiration.id && entry.tempId !== inspiration.id) return entry;
  return {
    ...entry,
    id: inspiration.id,
    text: inspiration.text,
    cluster: inspiration.cluster,
    wowScore: inspiration.wowScore,
    status: "saved",
    createdAt: inspiration.createdAt,
    timestamp: formatTimestamp(inspiration.createdAt),
  };
}

type HomeView = "wow" | "inspiration";

export interface HomeCaptureHandoffState {
  activeView: HomeView;
  autoFocusCaptureRequest: number;
}

export function nextHomeCaptureHandoffState(
  previousAutoFocusCaptureRequest: number,
): HomeCaptureHandoffState {
  return {
    activeView: "inspiration",
    autoFocusCaptureRequest: previousAutoFocusCaptureRequest + 1,
  };
}

interface InternalStatusEnv {
  DEV?: boolean;
  VITE_SHOW_INTERNAL_STATUS?: string;
}

export function shouldShowInternalStatus(env: InternalStatusEnv): boolean {
  return env.DEV === true || env.VITE_SHOW_INTERNAL_STATUS === "true";
}

type InternalWowPipelinePhase = "checking" | "found" | "none";

interface InternalWowStatusState {
  inspirationId: string;
  savedAt: string;
  latestWowCount: number;
  initialWowCount: number;
  wowPhase: InternalWowPipelinePhase;
  jobStatus: ApiBackgroundJob["status"] | "checking" | "unavailable";
  jobUpdatedAt?: string;
  adminUnavailable: boolean;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function InternalWowStatusPanel({
  status,
}: {
  status: InternalWowStatusState;
}): JSX.Element {
  const jobText = status.adminUnavailable
    ? "Admin job details unavailable; WOW refresh still polling."
    : status.jobStatus === "checking"
      ? "Background classification job checking"
      : `Background classification job ${status.jobStatus}`;
  const wowText =
    status.wowPhase === "found"
      ? "New WOW moment found"
      : status.wowPhase === "none"
        ? "No new WOW yet"
        : "WOW refresh checking";

  return (
    <aside
      className="internal-wow-status"
      aria-label="Internal/demo-only WOW pipeline status"
      role="status"
      aria-live="polite"
    >
      <div className="internal-wow-status-heading">
        <span>Internal/demo-only WOW pipeline status</span>
        <strong>Latest WOW count {status.latestWowCount}</strong>
      </div>
      <ol className="internal-wow-status-steps">
        <li>
          <span>Saved inspiration {shortId(status.inspirationId)}</span>
          <time dateTime={status.savedAt}>{formatTimestamp(status.savedAt)}</time>
        </li>
        <li>
          <span>{jobText}</span>
          {status.jobUpdatedAt ? (
            <time dateTime={status.jobUpdatedAt}>{formatTimestamp(status.jobUpdatedAt)}</time>
          ) : null}
        </li>
        <li>
          <span>{wowText}</span>
          <strong>{status.latestWowCount}</strong>
        </li>
      </ol>
    </aside>
  );
}

interface HomeViewToggleProps {
  activeView: HomeView;
  onChange: (view: HomeView) => void;
}

export function HomeViewToggle({
  activeView,
  onChange,
}: HomeViewToggleProps): JSX.Element {
  return (
    <nav
      className="home-view-switcher"
      aria-label="Home view"
      data-active-view={activeView}
    >
      <button
        type="button"
        className={activeView === "wow" ? "active" : undefined}
        aria-pressed={activeView === "wow"}
        onClick={() => onChange("wow")}
      >
        Wow Moment First
      </button>
      <button
        type="button"
        className={activeView === "inspiration" ? "active" : undefined}
        aria-pressed={activeView === "inspiration"}
        onClick={() => onChange("inspiration")}
      >
        Inspiration First
      </button>
    </nav>
  );
}

type InspirationSortColumn = "text" | "saved" | "wow";
type InspirationSortDirection = "asc" | "desc";

interface InspirationSortState {
  column: InspirationSortColumn;
  direction: InspirationSortDirection;
}

interface InspirationDiscoveryFilters {
  search: string;
  sort: InspirationSortState | null;
}

const DEFAULT_INSPIRATION_FILTERS: InspirationDiscoveryFilters = {
  search: "",
  sort: null,
};

const DEFAULT_SORT_DIRECTIONS: Record<
  InspirationSortColumn,
  InspirationSortDirection
> = {
  text: "asc",
  saved: "desc",
  wow: "desc",
};

function createdAtMs(entry: InspirationListEntry): number {
  const parsed = new Date(entry.createdAt).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareWowScore(
  a: InspirationListEntry,
  b: InspirationListEntry,
  direction: InspirationSortDirection,
): number {
  if (a.wowScore === null && b.wowScore === null) return 0;
  if (a.wowScore === null) return 1;
  if (b.wowScore === null) return -1;
  const comparison = a.wowScore - b.wowScore;
  return direction === "asc" ? comparison : -comparison;
}

function filterAndSortInspirationEntries(
  entries: InspirationListEntry[],
  filters: InspirationDiscoveryFilters,
): InspirationListEntry[] {
  const query = filters.search.trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    const haystack = entry.text.toLowerCase();
    return !query || haystack.includes(query);
  });

  return [...filtered].sort((a, b) => {
    const sort = filters.sort;
    if (!sort) return createdAtMs(b) - createdAtMs(a);

    let comparison = 0;
    if (sort.column === "text") {
      comparison = a.text.localeCompare(b.text, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    } else if (sort.column === "saved") {
      comparison = createdAtMs(a) - createdAtMs(b);
    } else {
      comparison = compareWowScore(a, b, sort.direction);
      if (comparison === 0) comparison = createdAtMs(b) - createdAtMs(a);
      return comparison;
    }

    if (comparison === 0) comparison = createdAtMs(b) - createdAtMs(a);
    return sort.direction === "asc" ? comparison : -comparison;
  });
}

interface InspirationDiscoveryPanelProps {
  entries: InspirationListEntry[];
  filteredEntries: InspirationListEntry[];
  filters: InspirationDiscoveryFilters;
  onFiltersChange: (filters: InspirationDiscoveryFilters) => void;
  onSelectInspiration: (id: string) => void;
}

function InspirationDiscoveryPanel({
  entries,
  filteredEntries,
  filters,
  onFiltersChange,
  onSelectInspiration,
}: InspirationDiscoveryPanelProps): JSX.Element {
  const updateFilter = <K extends keyof InspirationDiscoveryFilters>(
    key: K,
    value: InspirationDiscoveryFilters[K],
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const toggleSort = (column: InspirationSortColumn) => {
    const current = filters.sort;
    const direction: InspirationSortDirection =
      current?.column === column
        ? current.direction === "asc"
          ? "desc"
          : "asc"
        : DEFAULT_SORT_DIRECTIONS[column];
    onFiltersChange({ ...filters, sort: { column, direction } });
  };

  const sortLabel = (column: InspirationSortColumn): string => {
    if (filters.sort?.column !== column) return "not sorted";
    return filters.sort.direction === "asc" ? "ascending" : "descending";
  };

  const sortIndicator = (column: InspirationSortColumn): string => {
    if (filters.sort?.column !== column) return "↕";
    return filters.sort.direction === "asc" ? "↑" : "↓";
  };

  const resultLabel = `${filteredEntries.length} of ${entries.length} inspiration${
    entries.length === 1 ? "" : "s"
  }`;
  const [scoreExplainerOpen, setScoreExplainerOpen] = useState(false);

  const buildMetaText = (entry: InspirationListEntry): string => {
    const parts = [
      entry.status === "saved" ? "saved" : entry.status,
      entry.timestamp,
    ];
    if (entry.wowScore !== null) parts.push(`WOW ${entry.wowScore}`);
    return parts.join(" · ");
  };

  return (
    <section className="inspiration-discovery-panel" aria-labelledby="inspiration-discovery-title">
      <div className="inspiration-discovery-heading">
        <div>
          <span>Find inspirations</span>
          <h2 id="inspiration-discovery-title">Search the raw material</h2>
        </div>
        <div className="inspiration-discovery-actions">
          <button
            type="button"
            className="inspiration-score-explainer-toggle"
            aria-expanded={scoreExplainerOpen}
            aria-controls="inspiration-score-explainer"
            onClick={() => setScoreExplainerOpen((open) => !open)}
          >
            How scoring works
          </button>
          <strong aria-live="polite">{resultLabel}</strong>
        </div>
      </div>

      {scoreExplainerOpen ? (
        <div
          id="inspiration-score-explainer"
          className="inspiration-score-explainer"
          role="region"
          aria-labelledby="inspiration-score-explainer-title"
        >
          <h3 id="inspiration-score-explainer-title">How WAKA scoring works</h3>
          <p>
            WAKA starts with ImportanceScore, then looks at Relationship,
            Similarity, and SurpriseSimilarity signals to notice saves that
            matter together or stand out in a useful way.
          </p>
          <p>
            Recent saves get a small boost: freshness has a 30-day freshness
            half-life and only a 10% freshness weight, so older ideas can still
            win when they are meaningful.
          </p>
          <p>
            AI/LLM judgment is used for WOW moment judgment and user-facing
            explanations, not for basic score arithmetic.
          </p>
        </div>
      ) : null}

      <div className="inspiration-filter-bar" role="search" aria-label="Inspiration filters">
        <label className="inspiration-search-field">
          <span>Search</span>
          <input
            aria-label="Search inspirations"
            type="search"
            value={filters.search}
            placeholder="Search your inspiration archive…"
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateFilter("search", event.target.value)
            }
          />
        </label>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="inspiration-results-empty" role="status">
          <strong>No inspirations match those filters.</strong>
          <span>Try a broader search or clear the text query.</span>
        </div>
      ) : (
        <div className="inspiration-results-shell">
          <div className="inspiration-results-header" aria-label="Sort inspirations">
            <button
              type="button"
              className="inspiration-sort-button inspiration-sort-button--text"
              aria-label={`Sort by inspiration text, ${sortLabel("text")}`}
              aria-pressed={filters.sort?.column === "text"}
              onClick={() => toggleSort("text")}
            >
              <span>Inspiration text</span>
              <span aria-hidden="true">{sortIndicator("text")}</span>
            </button>
            <div className="inspiration-sort-meta-group">
              <button
                type="button"
                className="inspiration-sort-button"
                aria-label={`Sort by saved time, ${sortLabel("saved")}`}
                aria-pressed={filters.sort?.column === "saved"}
                onClick={() => toggleSort("saved")}
              >
                <span>Saved/time</span>
                <span aria-hidden="true">{sortIndicator("saved")}</span>
              </button>
              <button
                type="button"
                className="inspiration-sort-button"
                aria-label={`Sort by WOW score, ${sortLabel("wow")}`}
                aria-pressed={filters.sort?.column === "wow"}
                onClick={() => toggleSort("wow")}
              >
                <span>WOW score</span>
                <span aria-hidden="true">{sortIndicator("wow")}</span>
              </button>
            </div>
          </div>
          <div className="inspiration-results-grid" aria-label={resultLabel}>
          {filteredEntries.map((entry) => (
            <button
              type="button"
              className="inspiration-result-card"
              key={entry.id}
              onClick={() => onSelectInspiration(entry.id)}
            >
              <span className="inspiration-result-meta">
                {buildMetaText(entry)}
              </span>
              <span className="inspiration-result-text">{entry.text}</span>
            </button>
          ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function HomePage(): JSX.Element {
  const { user, logout } = useAuth();

  // Local list state is the union of:
  //   1. Rows fetched once on mount from GET /inspirations (the
  //      authenticated user's history, scoped to their `user_id` by the
  //      API).
  //   2. Optimistic rows added during this session as the user saves new
  //      inspirations through the `<CaptureForm>`.
  //
  // The fetch is a single request — pagination lands in a later AC. The
  // API enforces tenant scope, so this page never has to filter by
  // `user_id` itself; whatever the server returns is by construction the
  // current user's data, which is exactly the data-isolation contract the
  // seed's `data_isolation` evaluation rule calls for.
  const [entries, setEntries] = useState<InspirationListEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wowMoments, setWowMoments] = useState<ApiWowMoment[]>([]);
  const [wowMomentsLoading, setWowMomentsLoading] = useState(true);
  const [wowMomentsError, setWowMomentsError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<HomeView>("wow");
  const [inspirationFilters, setInspirationFilters] =
    useState<InspirationDiscoveryFilters>(DEFAULT_INSPIRATION_FILTERS);
  const [autoFocusCaptureRequest, setAutoFocusCaptureRequest] = useState(0);
  const [internalWowStatus, setInternalWowStatus] =
    useState<InternalWowStatusState | null>(null);
  const internalStatusEnabled = shouldShowInternalStatus(import.meta.env);
  /**
   * `true` until the first `GET /inspirations` resolves for this user.
   * Drives the loading-skeleton UI in `<InspirationsBoard>` so the page
   * never momentarily lies with "0 INSPIRATIONS SAVED" + an empty grid
   * before the fetch comes back. Stays `false` after that point — a
   * future explicit refresh affordance can re-arm it locally without
   * toggling the page-wide skeleton.
   */
  const [initialLoading, setInitialLoading] = useState(true);
  /**
   * Currently-selected inspiration id for the history-drawer detail
   * view. `null` while the user is browsing the list. The detail view
   * itself is responsible for fetching reflections — this page only
   * tracks *which* row is selected.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * Track which auth identity owns the rows currently in `entries`. If the
   * user signs out and another user signs in inside the same SPA mount
   * (extremely rare, but defensible against), this guard prevents the
   * previous user's rows from briefly leaking into the new user's view
   * before the next fetch resolves.
   */
  const loadedForUserIdRef = useRef<string | null>(null);
  const wowMomentsLoadedForUserIdRef = useRef<string | null>(null);
  const wowMomentsRequestIdRef = useRef(0);

  useEffect(() => {
    if (!user) {
      // Guard regression — the route should have already redirected to
      // /login. Wipe local state defensively just in case.
      loadedForUserIdRef.current = null;
      wowMomentsLoadedForUserIdRef.current = null;
      wowMomentsRequestIdRef.current += 1;
      setEntries([]);
      setWowMoments([]);
      setInternalWowStatus(null);
      setWowMomentsLoading(false);
      setWowMomentsError(null);
      return;
    }

    // If we already loaded for this user, don't refetch. A future explicit
    // refresh affordance can bypass this by clearing the ref.
    //
    // The ref is only set AFTER the fetch resolves successfully — under
    // React Strict Mode the effect runs twice on mount, and setting the
    // ref synchronously here would cause the second invocation to
    // short-circuit while the first invocation's fetch is still in flight
    // (and ultimately discarded by the `cancelled` flag), leaving
    // `entries` empty forever after a refresh.
    if (loadedForUserIdRef.current === user.id) return;

    let cancelled = false;
    // Optimistically wipe any rows belonging to a *different* user before
    // starting the new fetch. The new fetch result will repopulate.
    if (loadedForUserIdRef.current && loadedForUserIdRef.current !== user.id) {
      setEntries([]);
    }

    void (async () => {
      try {
        const rows = await fetchInspirations();
        if (cancelled) return;
        // Defence in depth: even though the API enforces tenant scope, we
        // still drop any row whose `userId` does not match the
        // currently-authenticated user. A regression on the server side
        // (or a bug in a future admin endpoint) would not be allowed to
        // surface another user's saves through this page.
        const ownRows = rows.filter((r) => r.userId === user.id);
        const fetched = ownRows.map(apiInspirationToEntry);
        // Merge with any optimistic entries that may have been added
        // *during* the fetch. We dedupe by `tempId`/`id` so a save that
        // raced the response lands once. Optimistic-saving rows take
        // precedence (their status is still in flight).
        setEntries((prev) => {
          const inflight = prev.filter((e) => e.status !== "saved");
          const fetchedById = new Map(fetched.map((e) => [e.id, e] as const));
          // Drop fetched rows that collide with an optimistic save still
          // in flight to keep the in-flight indicator visible.
          for (const e of inflight) fetchedById.delete(e.id);
          // Newest first within each group; the API already returns
          // server rows newest-first.
          return [...inflight, ...fetchedById.values()];
        });
        setLoadError(null);
        // Mark the load as committed only once the canonical state has
        // landed. A subsequent re-render with the same user.id will then
        // correctly short-circuit, while a Strict Mode double-mount that
        // cancelled the first run leaves the ref untouched so the second
        // run actually refetches.
        loadedForUserIdRef.current = user.id;
        setInitialLoading(false);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to load inspirations";
        setLoadError(message);
        // Drop the skeleton even on failure so the user can still
        // capture into the empty state — the load-error banner below
        // surfaces the actual problem.
        setInitialLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const refreshWowMoments = useCallback(
    async (options?: {
      showLoading?: boolean;
      surfaceErrors?: boolean;
    }): Promise<ApiWowMoment[] | null> => {
      if (!user) return null;

      const requestUserId = user.id;
      const requestId = wowMomentsRequestIdRef.current + 1;
      wowMomentsRequestIdRef.current = requestId;

      if (options?.showLoading) setWowMomentsLoading(true);
      if (options?.surfaceErrors ?? true) setWowMomentsError(null);

      try {
        const rows = await fetchWowMoments();
        if (wowMomentsRequestIdRef.current !== requestId) return null;
        // Match the inspirations load's defence-in-depth tenant guard: the
        // route is scoped by session, but the page still refuses to render any
        // row whose user id does not match the current auth context.
        const ownRows = rows.filter((row) => row.userId === requestUserId);
        setWowMoments(ownRows);
        wowMomentsLoadedForUserIdRef.current = requestUserId;
        setWowMomentsLoading(false);
        setWowMomentsError(null);
        return ownRows;
      } catch (err) {
        if (wowMomentsRequestIdRef.current !== requestId) return null;
        if (options?.surfaceErrors ?? true) {
          const message =
            err instanceof Error ? err.message : "Failed to load WOW moments";
          setWowMomentsError(message);
        }
        setWowMomentsLoading(false);
        return null;
      }
    },
    [user],
  );

  useEffect(() => {
    if (!user) return;
    if (wowMomentsLoadedForUserIdRef.current === user.id) return;

    if (
      wowMomentsLoadedForUserIdRef.current &&
      wowMomentsLoadedForUserIdRef.current !== user.id
    ) {
      setWowMoments([]);
    }

    void refreshWowMoments({ showLoading: true, surfaceErrors: true });

    return () => {
      wowMomentsRequestIdRef.current += 1;
    };
  }, [refreshWowMoments, user]);

  const handleOptimisticAdd = useCallback((pending: PendingInspiration) => {
    setEntries((prev) => [buildOptimisticEntry(pending), ...prev]);
  }, []);

  const updateInternalWowCount = useCallback((rows: ApiWowMoment[] | null) => {
    if (!rows) return;
    setInternalWowStatus((prev) => {
      if (!prev) return prev;
      const nextPhase: InternalWowPipelinePhase =
        rows.length > prev.initialWowCount ? "found" : "none";
      return {
        ...prev,
        latestWowCount: rows.length,
        wowPhase: nextPhase,
      };
    });
  }, []);

  const refreshInternalBackgroundJob = useCallback(
    (inspirationId: string) => {
      void (async () => {
        try {
          const jobs = await fetchBackgroundJobs({
            type: "process_inspiration",
            limit: 10,
          });
          const matchingJob =
            jobs.find((job) => job.payloadSummary?.inspirationId === inspirationId) ??
            jobs[0];
          setInternalWowStatus((prev) => {
            if (!prev || prev.inspirationId !== inspirationId) return prev;
            if (!matchingJob) {
              return { ...prev, jobStatus: "checking", adminUnavailable: false };
            }
            return {
              ...prev,
              jobStatus: matchingJob.status,
              jobUpdatedAt: matchingJob.updatedAt,
              adminUnavailable: false,
            };
          });
        } catch {
          setInternalWowStatus((prev) => {
            if (!prev || prev.inspirationId !== inspirationId) return prev;
            return {
              ...prev,
              jobStatus: "unavailable",
              adminUnavailable: true,
            };
          });
        }
      })();
    },
    [],
  );

  const handlePersisted = useCallback(
    (tempId: string, result: PersistedResult) => {
      const reflectionScorePatch = result.reflection?.inspiration;
      const scoredInspiration = reflectionScorePatch
        ? {
            ...result.inspiration,
            importanceScore:
              typeof reflectionScorePatch.importanceScore === "number"
                ? reflectionScorePatch.importanceScore
                : result.inspiration.importanceScore,
            wowScore:
              typeof reflectionScorePatch.wowScore === "number"
                ? reflectionScorePatch.wowScore
                : result.inspiration.wowScore,
          }
        : result.inspiration;

      setEntries((prev) =>
        prev.map((e) =>
          e.tempId === tempId
            ? applyPersisted(
                e,
                scoredInspiration,
                result.attachments,
                result.failedAttachments.length,
                result.reflection ? 1 : 0,
              )
            : e,
        ),
      );

      const targetId = result.inspiration.id;
      if (internalStatusEnabled) {
        setInternalWowStatus({
          inspirationId: targetId,
          savedAt: result.inspiration.createdAt,
          latestWowCount: wowMoments.length,
          initialWowCount: wowMoments.length,
          wowPhase: "checking",
          jobStatus: "checking",
          adminUnavailable: false,
        });
        refreshInternalBackgroundJob(targetId);
        void refreshWowMoments({ showLoading: false, surfaceErrors: true }).then(
          (rows) => {
            if (!rows) return;
            setInternalWowStatus((prev) =>
              prev && prev.inspirationId === targetId
                ? { ...prev, latestWowCount: rows.length }
                : prev,
            );
          },
        );
      } else {
        void refreshWowMoments({ showLoading: false, surfaceErrors: true });
      }

      // The classifier worker (or the dev-mode inline fallback) writes
      // `cluster` asynchronously after the row is persisted. Without a
      // refetch the optimistic row stays at `cluster: null` forever in
      // local state, so the cluster grid never lights up. Poll on a
      // backoff schedule — fast classifications (warm Gemini, ~1 s)
      // surface immediately; slower ones still get picked up before the
      // user gives up.
      const delays = [1500, 2500, 3500, 5000];
      let classifiedRefreshRequested = false;
      for (const delay of delays) {
        window.setTimeout(() => {
          void (async () => {
            try {
              const rows = await fetchInspirations();
              const target = rows.find((r) => r.id === targetId);
              if (!target) return;
              // Patch server-calculated fields on the matching row; preserve
              // other local fields (status, attachments, errorMessage)
              // we already committed via `applyPersisted`. The setter is
              // also a no-op when those fields are already set, which keeps
              // successive polls cheap if the first one wins.
              setEntries((prev) => {
                const found = prev.find((e) => e.id === target.id);
                if (
                  !found ||
                  (found.cluster === target.cluster && found.wowScore === target.wowScore)
                ) {
                  return prev;
                }
                return prev.map((e) =>
                  e.id === target.id
                    ? { ...e, cluster: target.cluster, wowScore: target.wowScore }
                    : e,
                );
              });
              if (!target.cluster) return;
              if (!classifiedRefreshRequested) {
                classifiedRefreshRequested = true;
                void refreshWowMoments({
                  showLoading: false,
                  surfaceErrors: false,
                }).then(updateInternalWowCount);
                if (internalStatusEnabled) refreshInternalBackgroundJob(targetId);
              }
            } catch {
              // Silent — the user will pick up the classification on
              // the next mount or refresh. No banner here because the
              // save itself succeeded; surfacing this would be
              // misleading.
            }
          })();
        }, delay);
      }
    },
    [
      internalStatusEnabled,
      refreshInternalBackgroundJob,
      refreshWowMoments,
      updateInternalWowCount,
      wowMoments.length,
    ],
  );

  const handlePersistError = useCallback(
    (tempId: string, error: ApiError) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.tempId === tempId
            ? {
                ...e,
                status: "error",
                errorMessage: error.message,
              }
            : e,
        ),
      );
    },
    [],
  );

  const handleSelectInspiration = useCallback((id: string) => {
    // Sub-AC 9.5 — open the detail view for the activated row. The
    // `<InspirationDetail>` component fetches reflections via the
    // GET endpoint on mount; this page only needs to track the
    // selected id so the panel knows which inspiration to render.
    setSelectedId(id);
  }, []);



  const handleBackFromDetail = useCallback(() => {
    setSelectedId(null);
  }, []);

  /**
   * Drop the deleted row from local state and dismiss the detail view.
   * The DELETE round-trip has already resolved successfully by the time
   * this fires (the detail view only invokes `onDeleted` on success), so
   * we don't need to gate on a second confirmation here. Tenant scope is
   * implicit: the row was loaded from the same `GET /inspirations`
   * response, which the API enforces by `user_id`.
   */
  const handleDeletedInspiration = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id && e.tempId !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const handleDetailReflectionCountChanged = useCallback(
    (id: string, count: number) => {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === id || entry.tempId === id
            ? {
                ...entry,
                reflectionsAnswered: count,
                reflectionsTotal: count,
              }
            : entry,
        ),
      );
    },
    [],
  );

  const handleInspirationScoresChanged = useCallback(
    (scores: ApiInspirationScorePatch) => {
      setEntries((prev) => prev.map((entry) => applyInspirationScorePatch(entry, scores)));
    },
    [],
  );

  const handleInspirationUpdated = useCallback((inspiration: ApiInspiration) => {
    setEntries((prev) =>
      prev.map((entry) => applyUpdatedInspiration(entry, inspiration)),
    );
  }, []);

  /**
   * Pull the currently-selected entry out of the local list so we can
   * hand its body / links / attachments to the detail view. Falls back
   * to `null` when the id no longer matches a row (e.g. the row was
   * just persisted with a new server id and the optimistic mapping has
   * already been swapped).
   */
  const selectedEntry = useMemo(() => {
    if (!selectedId) return null;
    return entries.find((e) => e.id === selectedId) ?? null;
  }, [entries, selectedId]);

  const detailData = useMemo<InspirationDetailData | null>(() => {
    if (!selectedEntry) return null;
    return {
      id: selectedEntry.id,
      text: selectedEntry.text,
      links: selectedEntry.links,
      attachments: selectedEntry.attachments,
      timestamp: selectedEntry.timestamp,
    };
  }, [selectedEntry]);

  /**
   * The board's `inspirations` prop expects `InspirationCardData[]` in
   * chronological (oldest-first) order — the board itself reverses for
   * display. We currently store entries newest-first (because the user's
   * latest save sits at the top of the saving queue). Reverse here so the
   * board's reversal lands them in the right order.
   */
  const cardItems = useMemo<InspirationCardData[]>(() => {
    return [...entries].reverse().map(entryToCardData);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return filterAndSortInspirationEntries(entries, inspirationFilters);
  }, [entries, inspirationFilters]);

  const filteredCardItems = useMemo<InspirationCardData[]>(() => {
    return [...filteredEntries].reverse().map(entryToCardData);
  }, [filteredEntries]);



  const historyContent = useMemo(() => {
    if (cardItems.length === 0) return undefined;
    return [...cardItems].reverse().map((item) => (
      <InspirationCard
        key={item.id}
        item={item}
        onSelect={handleSelectInspiration}
      />
    ));
  }, [cardItems, handleSelectInspiration]);



  const handleWowHeaderCapture = useCallback(() => {
    const next = nextHomeCaptureHandoffState(autoFocusCaptureRequest);
    setActiveView(next.activeView);
    setAutoFocusCaptureRequest(next.autoFocusCaptureRequest);
  }, [autoFocusCaptureRequest]);

  // The guard guarantees `user` is non-null at this point. The defensive
  // check below converts a guard regression from "blank screen + console
  // TypeError" into a single visible diagnostic line.
  if (!user) {
    return (
      <div
        // Defensive diagnostic surface — kept in the WAKA design language so
        // an accidental render (route-guard regression) still reads as part
        // of the same product rather than a raw browser error page.
        style={{
          padding: "var(--space-6)",
          fontFamily: "var(--font-sans)",
          color: "var(--ink)",
          background: "var(--bg)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 400,
            fontSize: 36,
            letterSpacing: "-0.01em",
            margin: "0 0 var(--space-3) 0",
          }}
        >
          Unexpected state
        </h1>
        <p
          style={{
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          Home rendered without an authenticated user. This indicates a route
          guard regression — please report it.
        </p>
      </div>
    );
  }

  const viewSwitcher = (
    <HomeViewToggle activeView={activeView} onChange={setActiveView} />
  );

  const historyDetail = detailData ? (
    <InspirationDetail
      // Re-key on id so navigating between inspirations remounts the
      // component, resetting the loading state and re-running the
      // reflections fetch for the new row.
      key={detailData.id}
      inspiration={detailData}
      onBack={handleBackFromDetail}
      onDeleted={handleDeletedInspiration}
      onReflectionCountChanged={handleDetailReflectionCountChanged}
      onInspirationScoresChanged={handleInspirationScoresChanged}
      onInspirationUpdated={handleInspirationUpdated}
    />
  ) : undefined;

  const primaryContent =
    activeView === "wow" ? (
      <AppShell
        count={entries.length}
        headerTagline="wow moments"
        loading={initialLoading}
        onCaptureClick={handleWowHeaderCapture}
        historyContent={historyContent}
        historyDetail={historyDetail}
      >
        {viewSwitcher}
        <section className="wow-first-home" aria-label="Wow Moment First">
          <WowMomentsSection
            moments={wowMoments}
            loading={wowMomentsLoading}
            error={wowMomentsError}
          />
        </section>
      </AppShell>
    ) : (
      <InspirationsBoard
        inspirations={filteredCardItems}
        homeCards={[]}
        totalInspirations={entries.length}
        loading={initialLoading}
        onOptimisticAdd={handleOptimisticAdd}
        onPersisted={handlePersisted}
        onPersistError={handlePersistError}
        onSelectInspiration={handleSelectInspiration}
        captureFirst
        beforeGridContent={
          <>
            {viewSwitcher}
            {internalStatusEnabled && internalWowStatus ? (
              <InternalWowStatusPanel status={internalWowStatus} />
            ) : null}
            <InspirationDiscoveryPanel
              entries={entries}
              filteredEntries={filteredEntries}
              filters={inspirationFilters}
              onFiltersChange={setInspirationFilters}
              onSelectInspiration={handleSelectInspiration}
            />
          </>
        }
        historyDetail={historyDetail}
        autoFocusCaptureRequest={
          autoFocusCaptureRequest > 0 ? autoFocusCaptureRequest : undefined
        }
      />
    );

  return (
    <>
      {primaryContent}
      {/*
        Temporary sign-out affordance. The prototype has no auth concept,
        so there's no in-design slot for this control yet. We render it
        as a fixed-position pill outside the board so it doesn't pollute
        the visual contract — a proper user-menu UI lands in a later
        design pass.
      */}
      {loadError ? (
        <div
          // Non-blocking diagnostic ribbon. Kept tiny + outside the board's
          // visual contract so a transient fetch error doesn't disrupt the
          // prototype's layout rhythm. The user can still capture new saves
          // — only the historical list failed to load.
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 300,
            background: "transparent",
            border: "1px solid var(--line)",
            borderRadius: 999,
            padding: "6px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--muted)",
            maxWidth: 320,
          }}
        >
          {loadError}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => {
          void logout();
        }}
        style={{
          position: "fixed",
          bottom: 10,
          left: 10,
          zIndex: 300,
          background: "rgba(255, 253, 247, 0.52)",
          border: "1px solid rgba(15, 15, 14, 0.12)",
          borderRadius: 999,
          padding: "4px 9px",
          fontFamily: "var(--font-mono)",
          fontSize: 8,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--muted)",
          opacity: 0.72,
          cursor: "pointer",
        }}
        aria-label={`Sign out ${user.email}`}
        title={`Sign out ${user.name}`}
      >
        Sign out
      </button>
    </>
  );
}

export default HomePage;
