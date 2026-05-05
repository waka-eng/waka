/**
 * <HistoryPanel /> — saved-inspirations side drawer (layout shell only).
 *
 * Reproduces the prototype's right-anchored drawer:
 *
 *   <div class="history-overlay" id="historyOverlay">
 *     <div class="history-panel">
 *       <div class="history-head">
 *         <span class="history-title">Saved inspirations</span>
 *         <button class="history-close">×</button>
 *       </div>
 *       <div class="history-list">…</div>
 *       <div class="detail-view">…</div>
 *     </div>
 *   </div>
 *
 * This sub-AC is intentionally restricted to the *layout shell* — no list
 * fetching, no detail view rendering, no slide animation toggling. The
 * component exposes:
 *
 *   - `open`         → controls the `visible` class on the overlay so the
 *                      panel slides in/out via the prototype's CSS keyframe.
 *   - `title`        → the head copy (defaults to "Saved inspirations" to
 *                      match the prototype exactly).
 *   - `onClose`      → fires when the user clicks the × or the dimmed
 *                      backdrop, so the parent owns open/closed state.
 *   - `children`     → optional list/detail content. The empty-state copy
 *                      from the prototype is rendered when nothing is
 *                      provided, preserving visual parity for callers that
 *                      haven't wired data yet.
 *
 * Keeping the panel on every render (instead of conditionally mounting it)
 * matches the prototype, where the overlay lives in the DOM permanently and
 * is toggled with a class. This is what makes the slide-in animation play
 * smoothly on first open instead of mounting mid-frame.
 */

import type { ReactNode, MouseEvent } from "react";

export interface HistoryPanelProps {
  /** Whether the overlay is currently visible (slid in). */
  open: boolean;
  /** Fired when the user dismisses the panel (× or backdrop click). */
  onClose: () => void;
  /** Override for the panel's heading text. Defaults to the prototype copy. */
  title?: string;
  /**
   * Optional list / detail content. When omitted, the prototype's
   * "Nothing saved yet" empty state is rendered so the visual contract holds
   * even before real data is wired in.
   */
  children?: ReactNode;
  /**
   * Optional pre-rendered detail view. When provided, replaces the
   * default `.detail-view` shell so the parent can mount
   * `<InspirationDetail>` (or another sibling) without losing the
   * slide-over CSS contract. The detail view is responsible for adding
   * its own `.visible` class when it wants to be shown.
   */
  detail?: ReactNode;
}

export function HistoryPanel({
  open,
  onClose,
  title = "Saved inspirations",
  children,
  detail,
}: HistoryPanelProps): JSX.Element {
  /**
   * Backdrop click → close. The inner `.history-panel` stops propagation so
   * clicks inside the drawer don't dismiss it. This matches the prototype's
   * implicit behavior, where only the dimmed area outside the panel is
   * dismissible.
   */
  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className={`history-overlay${open ? " visible" : ""}`}
      id="historyOverlay"
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      aria-label={title}
      onClick={handleBackdropClick}
    >
      <div className="history-panel">
        <div className="history-head">
          <span className="history-title" id="historyTitle">
            {title}
          </span>
          <button
            type="button"
            className="history-close"
            id="historyClose"
            onClick={onClose}
            aria-label="Close saved inspirations"
          >
            ×
          </button>
        </div>
        <div className="history-list" id="historyList">
          {children ?? (
            <div className="history-empty">Nothing saved yet</div>
          )}
        </div>
        {/*
          Detail-view shell. The parent can supply a fully-rendered
          detail (typically `<InspirationDetail>`) via the `detail` prop;
          when omitted we fall back to the inert wrapper so the
          slide-over CSS still has a stable target before any selection
          is made.
        */}
        {detail ?? (
          <div className="detail-view" id="detailView">
            <div className="detail-head">
              <button type="button" className="detail-back" id="detailBack">
                ← Back
              </button>
            </div>
            <div className="detail-body" id="detailBody" />
          </div>
        )}
      </div>
    </div>
  );
}

export default HistoryPanel;
