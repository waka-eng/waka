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
  fetchInspirationScoreBreakdown,
  fetchReflections,
  updateInspiration,
  type ApiAttachment,
  type ApiInspiration,
  type ApiInspirationScoreBreakdown,
  type ApiInspirationScorePatch,
  type ApiReflection,
  type CreateReflectionResponse,
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
  /** Fires after reflection POST returns recomputed parent scores. */
  onInspirationScoresChanged?: (scores: ApiInspirationScorePatch) => void;
  /** Fires after editing details returns the canonical inspiration row. */
  onInspirationUpdated?: (inspiration: ApiInspiration) => void;
}

/* ============================================================
 * Component
 * ============================================================ */

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; reflections: ApiReflection[] };

type ScoreBreakdownState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; breakdown: ApiInspirationScoreBreakdown };

function formatScore(score: number | null): string {
  return score === null ? "—" : String(score);
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatRevisitFactors(
  revisit: ApiInspirationScoreBreakdown["factors"]["revisit"],
): string {
  return `${formatCount(revisit.uniqueRevisitDays, "unique day")} · ${formatCount(revisit.totalRevisitCount, "total revisit")} · ${formatCount(revisit.recentRevisitCount, "recent revisit")} · signals: ${revisit.uniqueRevisitDaysScore} unique-day, ${revisit.totalRevisitCountScore} total-revisit, ${revisit.revisitedInLast7DaysScore} recent`;
}

function ScoreRow({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <dt style={{ color: "var(--muted)" }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: "right" }}>{value}</dd>
    </div>
  );
}

function ScoreBreakdownPanel({ state }: { state: ScoreBreakdownState }): JSX.Element {
  return (
    <section
      aria-labelledby="score-breakdown-title"
      style={{
        marginTop: 18,
        border: "1px solid var(--line)",
        borderRadius: 18,
        padding: 16,
        background: "rgba(255,255,255,0.5)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h3
          id="score-breakdown-title"
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          WOW score breakdown
        </h3>
        {state.status === "ready" ? (
          <strong style={{ fontFamily: "var(--font-serif)", fontSize: 24 }}>
            WOW {state.breakdown.displayedWowScore}
          </strong>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <p role="status" aria-live="polite" style={{ margin: 0, color: "var(--muted)" }}>
          Loading score breakdown…
        </p>
      ) : null}

      {state.status === "error" ? (
        <p role="alert" aria-live="polite" style={{ margin: 0, color: "var(--muted)" }}>
          {state.message}
        </p>
      ) : null}

      {state.status === "ready" ? (
        <>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", lineHeight: 1.5 }}>
            Displayed WOW includes a read-time freshness adjustment. Stored scores below are
            persisted snapshots; viewing this panel does not run provider calls or generate
            embeddings.
          </p>
          <dl style={{ display: "grid", gap: 8, margin: 0, fontSize: 13 }}>
            <ScoreRow label="Displayed WOW" value={state.breakdown.displayedWowScore} />
            <ScoreRow label="Stored/core WOW" value={state.breakdown.persistedCoreWowScore} />
            <ScoreRow label="Stored importance" value={state.breakdown.importanceScore} />
            <ScoreRow
              label="Freshness adjustment"
              value={`${state.breakdown.freshnessAdjustment.displayedMinusCore >= 0 ? "+" : ""}${state.breakdown.freshnessAdjustment.displayedMinusCore}`}
            />
            <ScoreRow
              label="Freshness score"
              value={`${state.breakdown.freshnessAdjustment.freshnessScore} (${state.breakdown.freshnessAdjustment.ageDays.toFixed(1)} days old)`}
            />
            <ScoreRow label="Content/text/context" value={state.breakdown.factors.content.score} />
            <ScoreRow label="Text depth" value={state.breakdown.factors.content.textDepthScore} />
            <ScoreRow label="Context" value={state.breakdown.factors.content.contextScore} />
            <ScoreRow
              label="Context counts"
              value={`${state.breakdown.factors.content.meaningfulLinkCount} links · ${state.breakdown.factors.content.nonLinkAttachmentCount} attachments · ${state.breakdown.factors.content.reflectionTextChars} reflection chars`}
            />
            <ScoreRow
              label="Processing/reflection"
              value={`${state.breakdown.factors.processing.score} (${state.breakdown.factors.processing.hasReflection ? "has reflection" : "no reflection"})`}
            />
            <ScoreRow label="Revisit" value={state.breakdown.factors.revisit.score} />
            <ScoreRow
              label="Revisit factors"
              value={formatRevisitFactors(state.breakdown.factors.revisit)}
            />
            <ScoreRow
              label="Relationship"
              value={
                state.breakdown.factors.relationship.available
                  ? formatScore(state.breakdown.factors.relationship.score)
                  : "not available"
              }
            />
            {state.breakdown.factors.relationship.available ? (
              <ScoreRow
                label="Relationship signals"
                value={`${formatScore(state.breakdown.factors.relationship.topSimilaritySignal)} similarity · ${formatScore(state.breakdown.factors.relationship.topSurpriseSimilaritySignal)} surprise · ${formatScore(state.breakdown.factors.relationship.timeDistanceSignal)} time distance`}
              />
            ) : null}
          </dl>
          <p style={{ margin: "12px 0 0", color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>
            {state.breakdown.factors.relationship.note}
          </p>
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>
              Current formulas
            </summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.5 }}>
              <li>{state.breakdown.formulas.importance}</li>
              <li>{state.breakdown.formulas.coreWow}</li>
              <li>{state.breakdown.formulas.displayedWow}</li>
              {state.breakdown.formulas.relationship ? (
                <li>{state.breakdown.formulas.relationship}</li>
              ) : null}
            </ul>
          </details>
        </>
      ) : null}
    </section>
  );
}

export function InspirationDetail({
  inspiration,
  onBack,
  onDeleted,
  onReflectionCountChanged,
  onInspirationScoresChanged,
  onInspirationUpdated,
}: InspirationDetailProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [scoreBreakdownState, setScoreBreakdownState] =
    useState<ScoreBreakdownState>({ status: "loading" });
  const reflectionsRef = useRef<ApiReflection[]>([]);
  const scoreBreakdownRequestRef = useRef(0);
  const [reflecting, setReflecting] = useState(false);
  const [detailsText, setDetailsText] = useState(inspiration.text);
  const [saveState, setSaveState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved" }
    | { status: "error"; message: string }
  >({ status: "idle" });
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

  const loadScoreBreakdown = useCallback(() => {
    const requestId = scoreBreakdownRequestRef.current + 1;
    scoreBreakdownRequestRef.current = requestId;
    setScoreBreakdownState({ status: "loading" });
    void (async () => {
      try {
        const breakdown = await fetchInspirationScoreBreakdown(inspiration.id);
        if (scoreBreakdownRequestRef.current !== requestId) return;
        setScoreBreakdownState({ status: "ready", breakdown });
      } catch (caught) {
        if (scoreBreakdownRequestRef.current !== requestId) return;
        const message =
          caught instanceof ApiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : "Failed to load score breakdown.";
        setScoreBreakdownState({ status: "error", message });
      }
    })();
  }, [inspiration.id]);

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
    setDetailsText(inspiration.text);
    setSaveState({ status: "idle" });
    loadScoreBreakdown();

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
      scoreBreakdownRequestRef.current += 1;
    };
  }, [inspiration.id, loadScoreBreakdown, onReflectionCountChanged]);

  const detailsChanged = detailsText !== inspiration.text;
  const detailsEmpty = detailsText.trim().length === 0;

  const handleSaveDetails = useCallback(() => {
    const nextText = detailsText.trim();
    if (!nextText || saveState.status === "saving") return;

    setSaveState({ status: "saving" });
    void (async () => {
      try {
        const updated = await updateInspiration(inspiration.id, { text: nextText });
        setDetailsText(updated.text);
        setSaveState({ status: "saved" });
        onInspirationUpdated?.(updated);
        loadScoreBreakdown();
      } catch (caught) {
        const message =
          caught instanceof ApiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : "Failed to update inspiration.";
        setSaveState({ status: "error", message });
      }
    })();
  }, [detailsText, inspiration.id, loadScoreBreakdown, onInspirationUpdated, saveState.status]);

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
    (tempId: string, server: CreateReflectionResponse) => {
      const hadOptimistic = reflectionsRef.current.some((row) => row.id === tempId);
      const nextReflections = hadOptimistic
        ? reflectionsRef.current.map((row) =>
            row.id === tempId ? server.reflection : row,
          )
        : [...reflectionsRef.current, server.reflection];
      reflectionsRef.current = nextReflections;
      setState({ status: "ready", reflections: nextReflections });
      setReflecting(false);
      setThreadOpen(true);
      onReflectionCountChanged?.(inspiration.id, nextReflections.length);
      if (server.inspiration) onInspirationScoresChanged?.(server.inspiration);
      loadScoreBreakdown();
    },
    [
      inspiration.id,
      loadScoreBreakdown,
      onInspirationScoresChanged,
      onReflectionCountChanged,
    ],
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
        <form
          aria-label="Inspiration details"
          onSubmit={(event) => {
            event.preventDefault();
            handleSaveDetails();
          }}
          style={{ display: "grid", gap: 12 }}
        >
          <label
            htmlFor="inspirationDetailText"
            style={{
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Inspiration details
          </label>
          <textarea
            id="inspirationDetailText"
            value={detailsText}
            onChange={(event) => {
              setDetailsText(event.currentTarget.value);
              if (saveState.status !== "idle") setSaveState({ status: "idle" });
            }}
            rows={7}
            aria-label="Inspiration details"
            style={{
              width: "100%",
              resize: "vertical",
              border: "1px solid var(--line)",
              borderRadius: 16,
              background: "rgba(255,255,255,0.72)",
              color: "var(--ink)",
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              lineHeight: 1.5,
              padding: 16,
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="submit"
              disabled={!detailsChanged || detailsEmpty || saveState.status === "saving"}
              style={{
                background: "var(--ink)",
                border: "1px solid var(--ink)",
                borderRadius: 999,
                color: "var(--bg)",
                cursor:
                  !detailsChanged || detailsEmpty || saveState.status === "saving"
                    ? "not-allowed"
                    : "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.12em",
                padding: "8px 16px",
                textTransform: "uppercase",
                opacity:
                  !detailsChanged || detailsEmpty || saveState.status === "saving" ? 0.5 : 1,
              }}
            >
              {saveState.status === "saving" ? "Saving…" : "Save details"}
            </button>
            {saveState.status === "saved" ? (
              <span role="status" aria-live="polite" style={{ color: "var(--muted)", fontSize: 12 }}>
                Saved.
              </span>
            ) : null}
            {saveState.status === "error" ? (
              <span role="alert" aria-live="polite" style={{ color: "var(--muted)", fontSize: 12 }}>
                {saveState.message}
              </span>
            ) : null}
          </div>
        </form>

        <ScoreBreakdownPanel state={scoreBreakdownState} />

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
