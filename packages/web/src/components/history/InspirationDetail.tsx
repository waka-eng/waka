/**
 * <InspirationDetail /> — single-inspiration detail view rendered inside
 * the history drawer's `.detail-view` shell.
 *
 * Sub-AC 9.5 wires the GET /inspirations/:id/reflections endpoint into
 * the React component tree, replacing the prototype's
 * `renderDetail(item)` (index.html lines 2628-2698) with a declarative
 * component that:
 *
 *   1. Renders the inspiration's text / links / attachments / meta
 *      (same DOM contract as the prototype so the existing CSS rules in
 *      `.detail-text`, `.detail-links`, `.detail-attachments`,
 *      `.detail-meta` apply 1:1).
 *   2. Fetches the caller's reflections for this inspiration via
 *      `fetchReflections(id)` on mount, surfaces loading + error states
 *      while the request is in flight, and shows an empty placeholder
 *      when the response is `[]`.
 *   3. Hands the populated list to `<ReflectionThread>` (already built in
 *      Sub-AC 4.3.3) which owns the expand/collapse toggle and the
 *      thread-body rendering.
 *
 * Loading state: small mono-uppercase ribbon ("Loading reflections…")
 * inside the detail body so the user sees motion before the response
 * arrives. The visual rhythm matches the rest of the prototype's
 * diagnostic chrome.
 *
 * Empty state: a single italic-serif sentence ("No reflections yet.")
 * — matches the prototype's "sit with this a little longer" cadence
 * without claiming a prompt that the user hasn't been given. Authoring
 * a new reflection is wired separately by `<ReflectionForm>`.
 *
 * Error state: a non-blocking ribbon with the API error message. The
 * user can still see the inspiration body — only the reflections panel
 * fails open. We deliberately do *not* throw or unmount the detail view
 * because that would steal the user's attention from a failure they
 * cannot fix.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  deleteInspiration,
  fetchReflections,
  type ApiAttachment,
  type ApiReflection,
} from "../../lib/api";
import { ReflectionForm, type PendingReflection } from "./ReflectionForm";
import { ReflectionThread, type ReflectionEntry } from "./ReflectionThread";

/* ============================================================
 * Types
 * ============================================================ */

/**
 * The minimum inspiration shape the detail view needs to render its
 * header / body. Mirrors the fields the prototype's `renderDetail`
 * touches (index.html line 2628). The detail view does NOT depend on
 * the full `ApiInspiration` shape so a parent that only has a card-row
 * representation can still mount the component.
 */
export interface InspirationDetailData {
  /** Server-assigned uuid. Drives the reflection fetch URL. */
  id: string;
  /** Inspiration text body. May be empty. */
  text: string;
  /** Optional list of link URLs attached to the inspiration. */
  links?: string[] | null;
  /** Optional attachments (image / file / link). */
  attachments?: ApiAttachment[] | null;
  /** Pre-formatted timestamp string for the meta row. */
  timestamp: string;
  /** Optional transient save status copy retained for compatibility. */
  kind?: string | null;
}

export interface InspirationDetailProps {
  /** The inspiration being inspected. Required — the component wouldn't
   *  have anything to render without it. */
  inspiration: InspirationDetailData;
  /** Fires when the user clicks "← Back" in the detail header. */
  onBack: () => void;
  /**
   * Fires when the user confirms a delete and the DELETE round-trip
   * resolves successfully. The parent uses this to drop the row from the
   * history list and close the detail view. The component DOES NOT close
   * itself — the parent owns the navigation state — so a parent that
   * wants to keep the detail open (e.g. for an undo affordance in a
   * later AC) can do so.
   *
   * Optional: when omitted, the delete affordance is hidden so the
   * component can still be mounted in a read-only context.
   */
  onDeleted?: (id: string) => void;
  /**
   * Optional parent-state bridge. Fires whenever this detail view knows the
   * exact reflection count (after the initial GET, and after a successful
   * POST). The parent uses the exact count instead of blindly incrementing so
   * list rows stay aligned with the detail thread.
   */
  onReflectionCountChanged?: (id: string, count: number) => void;
}

/* ============================================================
 * Component
 * ============================================================ */

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; reflections: ApiReflection[] };

export function InspirationDetail({
  inspiration,
  onBack,
  onDeleted,
  onReflectionCountChanged,
}: InspirationDetailProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const reflectionsRef = useRef<ApiReflection[]>([]);
  const [reflecting, setReflecting] = useState(false);
  /**
   * Two-stage confirmation for the destructive delete affordance:
   *   - idle             → "Delete" pill in the header.
   *   - confirming       → swap the pill for "Confirm? · Cancel" so the
   *                         user has to click a second button to proceed.
   *                         An accidental click on the first pill never
   *                         destroys data.
   *   - deleting         → in-flight indicator; both buttons disabled.
   *   - error            → kept inline so the user can retry without
   *                         leaving the detail view.
   *
   * We deliberately avoid `window.confirm()`: the prototype's design
   * language has its own .close-confirm modal vocabulary, and a native
   * confirm dialog would clash with the WAKA visual rhythm. An inline
   * two-step is also faster to dismiss with the keyboard.
   */
  const [deleteState, setDeleteState] = useState<
    | { status: "idle" }
    | { status: "confirming" }
    | { status: "deleting" }
    | { status: "error"; message: string }
  >({ status: "idle" });
  /**
   * Thread expansion mirrors the prototype's `expandedItems` set, but
   * scoped to this detail mount — when the user navigates to a different
   * inspiration the thread starts collapsed (matches the prototype's
   * behavior since `renderDetail` re-reads the set per render and a
   * fresh detail view begins with no entry in the set).
   */
  const [threadOpen, setThreadOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    reflectionsRef.current = [];
    setThreadOpen(false);
    setReflecting(false);
    // Reset the delete affordance whenever the user navigates to a
    // different inspiration so a half-confirmed delete on row A doesn't
    // bleed into row B.
    setDeleteState({ status: "idle" });

    void (async () => {
      try {
        const rows = await fetchReflections(inspiration.id);
        if (cancelled) return;
        reflectionsRef.current = rows;
        setState({ status: "ready", reflections: rows });
        onReflectionCountChanged?.(inspiration.id, rows.length);
      } catch (caught) {
        if (cancelled) return;
        const message =
          caught instanceof ApiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : "Failed to load reflections.";
        setState({ status: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inspiration.id, onReflectionCountChanged]);

  // ----- Delete handlers ---------------------------------------------------

  const handleDeleteClick = useCallback(() => {
    setDeleteState((prev) =>
      prev.status === "idle" || prev.status === "error"
        ? { status: "confirming" }
        : prev,
    );
  }, []);

  const handleCancelDelete = useCallback(() => {
    setDeleteState({ status: "idle" });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    setDeleteState({ status: "deleting" });
    void (async () => {
      try {
        await deleteInspiration(inspiration.id);
        // Parent owns the post-delete navigation: dropping the row from
        // the list and dismissing the detail view. Do NOT call setState
        // afterwards — the parent will unmount us.
        onDeleted?.(inspiration.id);
      } catch (caught) {
        const message =
          caught instanceof ApiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : "Failed to delete inspiration.";
        setDeleteState({ status: "error", message });
      }
    })();
  }, [inspiration.id, onDeleted]);

  // ----- Reflection authoring ----------------------------------------------

  const handleStartReflection = useCallback(() => {
    setReflecting(true);
  }, []);

  const handleCancelReflection = useCallback(() => {
    setReflecting(false);
  }, []);

  const handleOptimisticReflection = useCallback(
    (pending: PendingReflection) => {
      const optimistic: ApiReflection = {
        id: pending.tempId,
        inspirationId: pending.inspirationId,
        userId: "",
        question: pending.question,
        answer: pending.answer,
        skipped: pending.skipped,
        createdAt: pending.createdAt,
      };

      const nextReflections = [...reflectionsRef.current, optimistic];
      reflectionsRef.current = nextReflections;
      setState({ status: "ready", reflections: nextReflections });
      setThreadOpen(true);
    },
    [],
  );

  const handlePersistedReflection = useCallback(
    (tempId: string, server: ApiReflection) => {
      const hadOptimistic = reflectionsRef.current.some((row) => row.id === tempId);
      const nextReflections = hadOptimistic
        ? reflectionsRef.current.map((row) => (row.id === tempId ? server : row))
        : [...reflectionsRef.current, server];
      reflectionsRef.current = nextReflections;
      setState({ status: "ready", reflections: nextReflections });
      setReflecting(false);
      setThreadOpen(true);
      onReflectionCountChanged?.(inspiration.id, nextReflections.length);
    },
    [inspiration.id, onReflectionCountChanged],
  );

  const handleReflectionError = useCallback((tempId: string) => {
    const nextReflections = reflectionsRef.current.filter((row) => row.id !== tempId);
    reflectionsRef.current = nextReflections;
    setState({ status: "ready", reflections: nextReflections });
  }, []);

  // Map server rows into the shape `<ReflectionThread>` expects. The
  // server enforces tenant scope so we don't need to filter by user_id
  // here; whatever we got back is by construction the caller's data.
  const entries: ReflectionEntry[] =
    state.status === "ready"
      ? state.reflections.map((r) => ({
          id: r.id,
          question: r.question,
          answer: r.answer,
          skipped: r.skipped,
        }))
      : [];

  // Filter non-link attachments for the meta line, preserving the
  // prototype's `atts.filter(a => a.type !== 'link')` rule.
  const fileAttachments =
    inspiration.attachments?.filter((a) => a.type !== "link") ?? [];

  return (
    <div className="detail-view visible" id="detailView">
      <div
        className="detail-head"
        style={{
          // Allow the delete pill to sit on the right edge without
          // disrupting the prototype's left-aligned `← Back` rhythm.
          // The prototype's `.detail-head` rule already lays the area
          // out as a flex row, so this just enables `justify-content`
          // without changing visual parity for the empty case.
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <button
          type="button"
          className="detail-back"
          id="detailBack"
          onClick={onBack}
          aria-label="Back to saved inspirations"
        >
          ← Back
        </button>
        {onDeleted ? (
          // Inline two-stage delete pill. Hidden when `onDeleted` is not
          // wired so a read-only mount of the detail view stays read-only.
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            {deleteState.status === "idle" || deleteState.status === "error" ? (
              <button
                type="button"
                onClick={handleDeleteClick}
                aria-label="Delete this inspiration"
                style={{
                  background: "transparent",
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  padding: "6px 14px",
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  letterSpacing: "inherit",
                  textTransform: "inherit",
                }}
              >
                Delete
              </button>
            ) : null}

            {deleteState.status === "confirming" ? (
              <>
                <span
                  // Live region so screen readers announce the destructive
                  // confirmation step the moment it appears.
                  role="status"
                  aria-live="polite"
                  style={{ color: "var(--muted)" }}
                >
                  Delete this?
                </span>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  aria-label="Confirm delete"
                  style={{
                    background: "transparent",
                    border: "1px solid var(--line)",
                    borderRadius: 999,
                    padding: "6px 14px",
                    color: "var(--ink)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    letterSpacing: "inherit",
                    textTransform: "inherit",
                  }}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={handleCancelDelete}
                  aria-label="Cancel delete"
                  style={{
                    background: "transparent",
                    border: "1px solid transparent",
                    borderRadius: 999,
                    padding: "6px 10px",
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    letterSpacing: "inherit",
                    textTransform: "inherit",
                  }}
                >
                  Cancel
                </button>
              </>
            ) : null}

            {deleteState.status === "deleting" ? (
              <span
                role="status"
                aria-live="polite"
                style={{ color: "var(--muted)" }}
              >
                Deleting…
              </span>
            ) : null}

            {deleteState.status === "error" ? (
              <span
                role="alert"
                aria-live="polite"
                style={{
                  color: "var(--muted)",
                  textTransform: "none",
                  letterSpacing: 0,
                  fontFamily: "var(--font-sans)",
                  fontSize: 12,
                }}
              >
                {deleteState.message}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="detail-body" id="detailBody">
        {inspiration.text ? (
          <div className="detail-text">{inspiration.text}</div>
        ) : null}

        {inspiration.links && inspiration.links.length > 0 ? (
          <div className="detail-links">
            {inspiration.links.map((href) => (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer">
                {href}
              </a>
            ))}
          </div>
        ) : null}

        {fileAttachments.length > 0 ? (
          <div className="detail-attachments">
            {fileAttachments.map((a) => a.name || a.type).join(" · ")}
          </div>
        ) : null}

        <div className="detail-meta">{inspiration.timestamp}</div>

        {state.status === "ready" ? (
          <div style={{ marginTop: 18 }}>
            {!reflecting ? (
              <button
                type="button"
                className="reflect-btn reflect-next"
                onClick={handleStartReflection}
                aria-label="Process this inspiration with a reflection"
              >
                Process this inspiration
              </button>
            ) : (
              <ReflectionForm
                key={inspiration.id}
                inspirationId={inspiration.id}
                defaultQuestion="What about this is worth remembering?"
                answerPlaceholder="Sit with it for a moment, then add what it opens up…"
                hideSkip
                onCancel={handleCancelReflection}
                onOptimisticAdd={handleOptimisticReflection}
                onPersisted={handlePersistedReflection}
                onPersistError={handleReflectionError}
              />
            )}
          </div>
        ) : null}

        {/* Reflections panel — loading / error / empty / list */}
        {state.status === "loading" ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              marginTop: 16,
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Loading reflections…
          </div>
        ) : null}

        {state.status === "error" ? (
          <div
            role="alert"
            aria-live="polite"
            style={{
              marginTop: 16,
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            {state.message}
          </div>
        ) : null}

        {state.status === "ready" && entries.length === 0 ? (
          <div
            // Empty-state copy. Italic serif so it reads as part of the
            // prototype's reflective voice rather than a system message.
            style={{
              marginTop: 18,
              color: "var(--muted)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            No reflections yet.
          </div>
        ) : null}

        {state.status === "ready" && entries.length > 0 ? (
          <div style={{ marginTop: 18 }}>
            <ReflectionThread
              entries={entries}
              open={threadOpen}
              onToggle={() => setThreadOpen((v) => !v)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default InspirationDetail;
