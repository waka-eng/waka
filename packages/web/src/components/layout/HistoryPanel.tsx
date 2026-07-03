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
 *   - `children`     → optional list content. The empty-state copy from the
 *                      prototype is rendered when nothing is provided,
 *                      preserving visual parity for callers that haven't
 *                      wired data yet.
 *
 * Keeping the panel on every render (instead of conditionally mounting it)
 * matches the prototype, where the overlay lives in the DOM permanently and
 * is toggled with a class. This is what makes the slide-in animation play
 * smoothly on first open instead of mounting mid-frame.
 */

import type { ReactNode, MouseEvent } from "react";

import { readStoredLocale, t } from "../../lib/locales";

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
   * Optional pre-rendered detail view. When provided, replaces the list so the
   * parent can mount `<InspirationDetail>` (or another sibling) without
   * exposing inactive detail controls before a selection exists.
   */
  detail?: ReactNode;
}

export function HistoryPanel({
  open,
  onClose,
  title,
  children,
  detail,
}: HistoryPanelProps): JSX.Element {
  const locale = readStoredLocale();
  const panelTitle = title ?? t(locale, "historyTitle");
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
      role={open ? "dialog" : undefined}
      aria-modal={open ? "true" : undefined}
      aria-hidden={!open}
      aria-label={panelTitle}
      {...(!open ? { inert: "" } : {})}
      onClick={handleBackdropClick}
    >
      <div className="history-panel">
        <div className="history-head">
          <span className="history-title" id="historyTitle">
            {panelTitle}
          </span>
          <button
            type="button"
            className="history-close"
            id="historyClose"
            onClick={onClose}
            aria-label={t(locale, "historyClose")}
          >
            ×
          </button>
        </div>
        {detail ? null : (
          <div className="history-list" id="historyList">
            {children ?? (
              <div className="history-empty">{t(locale, "historyEmpty")}</div>
            )}
          </div>
        )}
        {/*
          Detail view. Mount it only when the parent supplies an active
          detail so the inactive back button and empty detail shell never
          leak into the accessibility tree or body text.
        */}
        {detail ?? null}
      </div>
    </div>
  );
}

export default HistoryPanel;
