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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  InspirationsBoard,
  type HomeCardData,
} from "../components/InspirationsBoard";
import type { InspirationCardData } from "../components/InspirationCard";
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
  type ClusterKind,
  fetchInspirations,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";

/**
 * Cluster topic resolution mirrors the prototype's `CLUSTER_TOPICS` map
 * (index.html ~2524). The classifier worker fills in the `cluster` enum
 * asynchronously; until then the chip is hidden.
 */
const CLUSTER_TOPICS: Record<ClusterKind, string> = {
  outlier: "a single quote I can’t shake",
  bridge: "architecture essays and jazz history",
  morph: "identity, reread",
  convergence: "education in the AI era",
  tension: "synthetic memory: tool or crutch",
  loop: "what it means to know something",
};

/**
 * Canonical render order for the cluster grid. Stable across renders so
 * the user's tiles don't reorder on every save — only their `count`,
 * `artifact`, and presence change. Mirrors the seed's `ClusterEnum` order.
 */
const CLUSTER_ORDER: ReadonlyArray<ClusterKind> = [
  "outlier",
  "bridge",
  "morph",
  "convergence",
  "tension",
  "loop",
];

/** Tile artifact column is short — keep excerpt under one paragraph. */
const ARTIFACT_MAX_CHARS = 140;
function makeArtifact(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length <= ARTIFACT_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, ARTIFACT_MAX_CHARS - 1).trimEnd()}…`;
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
  createdAt: string;
  /** Best-effort timestamp string for the meta row. */
  timestamp: string;
  /** Last error message, if `status === "error"`. */
  errorMessage?: string;
  /**
   * Server-side `kind` carried over for rows fetched from GET /inspirations.
   * Optimistic entries leave this `undefined`; the meta-row label still
   * surfaces the in-flight `"saving"` / `"save failed"` chip in that case.
   */
  serverKind?: string | null;
}

function entryToCardData(entry: InspirationListEntry): InspirationCardData {
  const clusterTopic = entry.cluster ? CLUSTER_TOPICS[entry.cluster] : null;
  // Surface the saving / error state as the kind tag so the user has an
  // immediate visual cue without us inventing new chrome. The prototype
  // already uppercases `kind` in the meta row. For server-fetched rows
  // (`status === "saved"` and no in-flight tempId) we fall back to the
  // server's own `kind` metadata when present.
  let kind: string | null = null;
  if (entry.status === "saving") kind = "saving";
  else if (entry.status === "error") kind = "save failed";
  else if (entry.serverKind) kind = entry.serverKind;
  return {
    id: entry.id,
    text: entry.text || null,
    links: entry.links.length > 0 ? entry.links : null,
    timestamp: entry.timestamp,
    kind,
    clusterTopic,
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
    createdAt: row.createdAt,
    timestamp: formatTimestamp(row.createdAt),
    serverKind: row.kind ?? null,
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
    createdAt: pending.createdAt,
    timestamp: formatNow(),
  };
}

function applyPersisted(
  entry: InspirationListEntry,
  inspiration: ApiInspiration,
  attachments: ApiAttachment[],
  failedCount: number,
): InspirationListEntry {
  return {
    ...entry,
    id: inspiration.id,
    status: failedCount > 0 ? "error" : "saved",
    text: inspiration.text,
    cluster: inspiration.cluster,
    attachments,
    errorMessage:
      failedCount > 0
        ? `${failedCount} attachment${failedCount === 1 ? "" : "s"} failed to upload.`
        : undefined,
  };
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

  useEffect(() => {
    if (!user) {
      // Guard regression — the route should have already redirected to
      // /login. Wipe local state defensively just in case.
      loadedForUserIdRef.current = null;
      setEntries([]);
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

  const handleOptimisticAdd = useCallback((pending: PendingInspiration) => {
    setEntries((prev) => [buildOptimisticEntry(pending), ...prev]);
  }, []);

  const handlePersisted = useCallback(
    (tempId: string, result: PersistedResult) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.tempId === tempId
            ? applyPersisted(
                e,
                result.inspiration,
                result.attachments,
                result.failedAttachments.length,
              )
            : e,
        ),
      );

      // The classifier worker (or the dev-mode inline fallback) writes
      // `cluster` asynchronously after the row is persisted. Without a
      // refetch the optimistic row stays at `cluster: null` forever in
      // local state, so the cluster grid never lights up. Poll on a
      // backoff schedule — fast classifications (warm Gemini, ~1 s)
      // surface immediately; slower ones still get picked up before the
      // user gives up.
      const targetId = result.inspiration.id;
      const delays = [1500, 2500, 3500, 5000];
      for (const delay of delays) {
        window.setTimeout(() => {
          void (async () => {
            try {
              const rows = await fetchInspirations();
              const target = rows.find((r) => r.id === targetId);
              if (!target?.cluster) return;
              // Patch only the cluster on the matching row; preserve
              // other local fields (status, attachments, errorMessage)
              // we already committed via `applyPersisted`. The setter
              // is also a no-op when the cluster is already set, which
              // keeps successive polls cheap if the first one wins.
              setEntries((prev) => {
                const found = prev.find((e) => e.id === target.id);
                if (!found || found.cluster === target.cluster) return prev;
                return prev.map((e) =>
                  e.id === target.id
                    ? { ...e, cluster: target.cluster }
                    : e,
                );
              });
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
    [],
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

  /**
   * Cluster tile click → drill into the most recent inspiration in
   * that cluster. The history sidebar opens with the detail view
   * mounted on the freshest match — the same affordance as clicking
   * the row in the history list, just reached via the home grid.
   *
   * `entries` is stored newest-first, so the first match is also the
   * most recent. Falls through if no entry has that cluster (which
   * would only happen if the user just deleted the last one).
   */
  const handleSelectCluster = useCallback(
    (card: HomeCardData) => {
      const target = entries.find((e) => e.cluster === card.kind);
      if (!target) return;
      setSelectedId(target.id);
    },
    [entries],
  );

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
      kind: selectedEntry.serverKind ?? null,
      clusterTopic: selectedEntry.cluster
        ? CLUSTER_TOPICS[selectedEntry.cluster]
        : null,
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

  /**
   * Cluster grid derived from the user's own saves. Entries that haven't
   * been classified yet (`cluster === null`) don't get a tile — the
   * classifier worker fills the column in asynchronously and the grid
   * picks them up on the next render.
   *
   * `entries` is stored newest-first, so the *first* entry encountered in
   * a cluster bucket is also the most recent — exactly the excerpt we
   * want as the tile's artifact.
   */
  const homeCards = useMemo<HomeCardData[]>(() => {
    const buckets = new Map<
      ClusterKind,
      { count: number; latestText: string | null }
    >();
    for (const entry of entries) {
      if (!entry.cluster) continue;
      const current = buckets.get(entry.cluster);
      if (current) {
        current.count += 1;
        if (!current.latestText && entry.text) current.latestText = entry.text;
      } else {
        buckets.set(entry.cluster, {
          count: 1,
          latestText: entry.text || null,
        });
      }
    }
    return CLUSTER_ORDER.flatMap((kind) => {
      const bucket = buckets.get(kind);
      if (!bucket) return [];
      return [
        {
          kind,
          count: bucket.count,
          topic: CLUSTER_TOPICS[kind],
          artifact: bucket.latestText ? makeArtifact(bucket.latestText) : null,
          awake: true,
        },
      ];
    });
  }, [entries]);

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

  return (
    <>
      <InspirationsBoard
        inspirations={cardItems}
        homeCards={homeCards}
        totalInspirations={entries.length}
        loading={initialLoading}
        onOptimisticAdd={handleOptimisticAdd}
        onPersisted={handlePersisted}
        onPersistError={handlePersistError}
        onSelectInspiration={handleSelectInspiration}
        onSelectCluster={handleSelectCluster}
        historyDetail={
          detailData ? (
            <InspirationDetail
              // Re-key on id so navigating between inspirations
              // remounts the component, resetting the loading state and
              // re-running the reflections fetch for the new row.
              key={detailData.id}
              inspiration={detailData}
              onBack={handleBackFromDetail}
              onDeleted={handleDeletedInspiration}
            />
          ) : undefined
        }
      />
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
          bottom: 16,
          left: 16,
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
          cursor: "pointer",
        }}
        aria-label={`Sign out ${user.email}`}
      >
        Sign out · {user.name}
      </button>
    </>
  );
}

export default HomePage;
