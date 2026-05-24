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
import { Link } from "react-router-dom";

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
  type ApiError,
  type ApiInspiration,
  type ApiInspirationScorePatch,
  type ApiWowMoment,
  type ClusterKind,
  fetchInspirations,
  fetchWowMoments,
  recordInspirationRevisit,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";
import {
  DEFAULT_LOCALE,
  formatResultsCount,
  normalizeSupportedLocale,
  t,
  type SupportedLocale,
} from "../lib/locales";

const WOW_MOMENTS_INSPECT_LIMIT = 100;
const LOCALE_STORAGE_KEY = "waka.ui.locale";

function readInitialLocale(): SupportedLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;

  try {
    const storedLocale = window.localStorage?.getItem?.(LOCALE_STORAGE_KEY);
    if (storedLocale) return normalizeSupportedLocale(storedLocale);
  } catch {
    // Tests and privacy-mode browsers can expose localStorage but throw or stub
    // incomplete methods. Fall back to the browser language in those cases.
  }

  return normalizeSupportedLocale(window.navigator.language);
}

function writeLocalePreference(locale: SupportedLocale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Preference persistence is best-effort; the selected locale still applies
    // for the current render through React state.
  }
}

interface InternalEntryEnv {
  DEV?: boolean;
  VITE_SHOW_INTERNAL_STATUS?: string;
}

function shouldShowAdminEntry(env: InternalEntryEnv): boolean {
  return env.DEV === true || env.VITE_SHOW_INTERNAL_STATUS === "true";
}

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

interface HomeViewToggleProps {
  activeView: HomeView;
  onChange: (view: HomeView) => void;
  locale: SupportedLocale;
}

export function HomeViewToggle({
  activeView,
  onChange,
  locale,
}: HomeViewToggleProps): JSX.Element {
  return (
    <nav
      className="home-view-switcher"
      aria-label={t(locale, "homeView")}
      data-active-view={activeView}
    >
      <button
        type="button"
        className={activeView === "wow" ? "active" : undefined}
        aria-pressed={activeView === "wow"}
        onClick={() => onChange("wow")}
      >
        {t(locale, "wowMomentFirst")}
      </button>
      <button
        type="button"
        className={activeView === "inspiration" ? "active" : undefined}
        aria-pressed={activeView === "inspiration"}
        onClick={() => onChange("inspiration")}
      >
        {t(locale, "inspirationFirst")}
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
  locale: SupportedLocale;
  onFiltersChange: (filters: InspirationDiscoveryFilters) => void;
  onSelectInspiration: (id: string) => void;
}

function InspirationDiscoveryPanel({
  entries,
  filteredEntries,
  filters,
  locale,
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
    if (filters.sort?.column !== column) return t(locale, "notSorted");
    return filters.sort.direction === "asc" ? t(locale, "ascending") : t(locale, "descending");
  };

  const sortIndicator = (column: InspirationSortColumn): string => {
    if (filters.sort?.column !== column) return "↕";
    return filters.sort.direction === "asc" ? "↑" : "↓";
  };

  const resultLabel = formatResultsCount(locale, entries.length, filteredEntries.length);
  const [scoreExplainerOpen, setScoreExplainerOpen] = useState(false);

  const buildMetaText = (entry: InspirationListEntry): string => {
    const parts = [
      entry.status === "saved" ? t(locale, "savedStatus") : entry.status,
      entry.timestamp,
    ];
    if (entry.wowScore !== null) parts.push(`WOW ${entry.wowScore}`);
    return parts.join(" · ");
  };

  return (
    <section className="inspiration-discovery-panel" aria-labelledby="inspiration-discovery-title">
      <div className="inspiration-discovery-heading">
        <div>
          <span>{t(locale, "findInspirationsEyebrow")}</span>
          <h2 id="inspiration-discovery-title">{t(locale, "searchRawMaterial")}</h2>
        </div>
        <div className="inspiration-discovery-actions">
          <button
            type="button"
            className="inspiration-score-explainer-toggle"
            aria-expanded={scoreExplainerOpen}
            aria-controls="inspiration-score-explainer"
            onClick={() => setScoreExplainerOpen((open) => !open)}
          >
            {t(locale, "howScoringWorks")}
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
            WAKA keeps scoring deterministic and bounded. Each inspiration gets a 0–100 WOW
            score from its depth, reflection and revisit activity, relationship signals, and
            a small freshness boost; the app does not ask an LLM to calculate scores.
          </p>
          <section aria-labelledby="score-signals-title">
            <h4 id="score-signals-title">What raises a WOW score</h4>
            <dl>
              <div>
                <dt>Depth</dt>
                <dd>
                  Richer saved text, useful link context, attachments, and reflection text
                  make an inspiration feel more substantial. Bare URL spam does not earn
                  extra depth credit.
                </dd>
              </div>
              <div>
                <dt>Processing</dt>
                <dd>
                  Reflections count as a clear processing signal, while unreflected saves
                  stay lighter until you come back to them.
                </dd>
              </div>
              <div>
                <dt>Revisits</dt>
                <dd>
                  Meaningful returns—opening details, returning to details, creating
                  reflections, or editing an inspiration—show that the idea keeps mattering.
                </dd>
              </div>
              <div>
                <dt>Relationships</dt>
                <dd>
                  Stored embeddings help WAKA find similar, surprising, or time-distant
                  connections inside your own archive without sending the full history to an
                  LLM.
                </dd>
              </div>
              <div>
                <dt>Freshness</dt>
                <dd>
                  Recent saves get a small display boost that decays over time, so new raw
                  material can surface without permanently overriding strong older work.
                </dd>
              </div>
            </dl>
          </section>
          <section aria-labelledby="candidate-retrieval-title">
            <h4 id="candidate-retrieval-title">Why different inspirations can find different candidates</h4>
            <p>
              Candidate selection happens in stages, and it always starts with the new or
              trigger inspiration. WAKA excludes that trigger, stays inside your own archive,
              and only considers inspirations with stored embeddings and enough data for
              bounded retrieval.
            </p>
            <p>
              The app then computes a deterministic candidate score at runtime: 50% the
              candidate’s existing WOW score, 25% similarity to the trigger, 20% surprise
              or bridge similarity to the trigger, and 5% time distance from the trigger.
              WAKA takes the top bounded candidates from that ranking; only that selected
              set goes to the AI judge for WOW writing and selection.
            </p>
          </section>
          <section aria-labelledby="wow-generation-title">
            <h4 id="wow-generation-title">How WOW moments are generated and shown</h4>
            <p>
              The AI judge only evaluates and writes WOW moments from this bounded candidate
              set. Deterministic scoring and retrieval happen first; the LLM does not choose
              candidates by scanning your whole archive or calculate the numeric scores.
            </p>
            <p>
              WOW moment cards keep source links focused: the trigger inspiration plus up to
              three related inspirations. The main WOW view shows the best-recent 9 moments,
              while the inspect panel can show a larger bounded set for review.
            </p>
          </section>
          <p>
            Scores refresh on bounded triggers such as save, edit, reflection, meaningful
            revisit, embedding refresh, new related inspiration, and WOW generation—without
            rescoring the whole archive every time.
          </p>
        </div>
      ) : null}

      <div className="inspiration-filter-bar" role="search" aria-label={t(locale, "inspirationFilters")}>
        <label className="inspiration-search-field">
          <span>{t(locale, "search")}</span>
          <input
            aria-label={t(locale, "searchInspirations")}
            type="search"
            value={filters.search}
            placeholder={t(locale, "searchPlaceholder")}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateFilter("search", event.target.value)
            }
          />
        </label>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="inspiration-results-empty" role="status">
          <strong>{t(locale, "noInspirationsMatch")}</strong>
          <span>{t(locale, "broaderSearchHint")}</span>
        </div>
      ) : (
        <div className="inspiration-results-shell">
          <div className="inspiration-results-header" aria-label={t(locale, "sortInspirations")}>
            <button
              type="button"
              className="inspiration-sort-button inspiration-sort-button--text"
              aria-label={`${t(locale, "sortByInspirationText")}, ${sortLabel("text")}`}
              aria-pressed={filters.sort?.column === "text"}
              onClick={() => toggleSort("text")}
            >
              <span>{t(locale, "inspirationText")}</span>
              <span aria-hidden="true">{sortIndicator("text")}</span>
            </button>
            <div className="inspiration-sort-meta-group">
              <button
                type="button"
                className="inspiration-sort-button"
                aria-label={`${t(locale, "sortBySavedTime")}, ${sortLabel("saved")}`}
                aria-pressed={filters.sort?.column === "saved"}
                onClick={() => toggleSort("saved")}
              >
                <span>{t(locale, "savedTime")}</span>
                <span aria-hidden="true">{sortIndicator("saved")}</span>
              </button>
              <button
                type="button"
                className="inspiration-sort-button"
                aria-label={`${t(locale, "sortByWowScore")}, ${sortLabel("wow")}`}
                aria-pressed={filters.sort?.column === "wow"}
                onClick={() => toggleSort("wow")}
              >
                <span>{t(locale, "wowScore")}</span>
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
  const { user, logout, updatePreferredLocale } = useAuth();

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
  const [locale, setLocale] = useState<SupportedLocale>(() => readInitialLocale());
  const [inspirationFilters, setInspirationFilters] =
    useState<InspirationDiscoveryFilters>(DEFAULT_INSPIRATION_FILTERS);
  const [autoFocusCaptureRequest, setAutoFocusCaptureRequest] = useState(0);
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

  const handleLocaleChange = useCallback(
    (nextLocale: SupportedLocale) => {
      setLocale(nextLocale);
      writeLocalePreference(nextLocale);
      void updatePreferredLocale(nextLocale);
    },
    [updatePreferredLocale],
  );

  useEffect(() => {
    if (!user) return;
    const preferredLocale = normalizeSupportedLocale(user.preferredLocale);
    setLocale(preferredLocale);
    writeLocalePreference(preferredLocale);
  }, [user?.preferredLocale, user?.id]);

  useEffect(() => {
    if (!user) {
      // Guard regression — the route should have already redirected to
      // /login. Wipe local state defensively just in case.
      loadedForUserIdRef.current = null;
      wowMomentsLoadedForUserIdRef.current = null;
      wowMomentsRequestIdRef.current += 1;
      setEntries([]);
      setWowMoments([]);
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
        const rows = await fetchWowMoments({ limit: WOW_MOMENTS_INSPECT_LIMIT });
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
      void refreshWowMoments({ showLoading: false, surfaceErrors: true });

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
                });
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
      refreshWowMoments,
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

  const recordRevisit = useCallback(
    (id: string, eventType: "detail_opened" | "detail_returned") => {
      void (async () => {
        try {
          const result = await recordInspirationRevisit(id, eventType);
          if (result.inspiration) {
            setEntries((prev) =>
              prev.map((entry) => applyInspirationScorePatch(entry, result.inspiration!)),
            );
          }
        } catch {
          // Best-effort analytics/scoring signal only; never block detail navigation.
        }
      })();
    },
    [],
  );

  const handleSelectInspiration = useCallback(
    (id: string) => {
      // Sub-AC 9.5 — open the detail view for the activated row. The
      // `<InspirationDetail>` component fetches reflections via the
      // GET endpoint on mount; this page only needs to track the
      // selected id so the panel knows which inspiration to render.
      setSelectedId(id);
      recordRevisit(id, "detail_opened");
    },
    [recordRevisit],
  );

  const handleBackFromDetail = useCallback(() => {
    const returningId = selectedId;
    setSelectedId(null);
    if (returningId) recordRevisit(returningId, "detail_returned");
  }, [recordRevisit, selectedId]);

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

  const showAdminEntry = shouldShowAdminEntry(import.meta.env);
  const viewSwitcher = (
    <HomeViewToggle
      activeView={activeView}
      onChange={setActiveView}
      locale={locale}
    />
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
        headerTagline={t(locale, "wowMoments")}
        loading={initialLoading}
        onCaptureClick={handleWowHeaderCapture}
        historyContent={historyContent}
        historyDetail={historyDetail}
        locale={locale}
        onLocaleChange={handleLocaleChange}
      >
        {viewSwitcher}
        <section className="wow-first-home" aria-label={t(locale, "wowMomentFirst")}>
          <WowMomentsSection
            moments={wowMoments}
            loading={wowMomentsLoading}
            error={wowMomentsError}
            showDevInspection={false}
            onAddInspiration={handleWowHeaderCapture}
            locale={locale}
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
            <InspirationDiscoveryPanel
              entries={entries}
              filteredEntries={filteredEntries}
              filters={inspirationFilters}
              locale={locale}
              onFiltersChange={setInspirationFilters}
              onSelectInspiration={handleSelectInspiration}
            />
          </>
        }
        historyDetail={historyDetail}
        autoFocusCaptureRequest={
          autoFocusCaptureRequest > 0 ? autoFocusCaptureRequest : undefined
        }
        locale={locale}
        onLocaleChange={handleLocaleChange}
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
        aria-label={`${t(locale, "signOut")} ${user.email}`}
        title={`${user.name} ${t(locale, "signOutPerson")}`}
      >
        {t(locale, "signOut")}
      </button>
      {showAdminEntry ? (
        <Link
          to="/admin"
          className="admin-entry-pill"
          aria-label="Open admin inspection tools"
          title="Admin inspection"
        >
          Admin
        </Link>
      ) : null}
    </>
  );
}

export default HomePage;
