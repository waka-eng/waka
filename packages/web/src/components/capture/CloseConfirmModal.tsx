/**
 * <CloseConfirmModal /> — confirmation dialog shown when the user tries
 * to dismiss the capture cell while it has unsaved content.
 *
 * Ports the prototype's `#closeConfirm` markup (index.html lines 2155–2163)
 * verbatim so the existing CSS rules (lines 96–124) — and the parity
 * rules now mirrored in `global.css` — apply 1:1.
 *
 * Prototype DOM contract:
 *
 *   <div class="close-confirm" id="closeConfirm" role="dialog" aria-modal="true">
 *     <div class="cc-box">
 *       <div class="cc-msg">Discard this capture? Your note will be lost.</div>
 *       <div class="cc-actions">
 *         <button type="button" class="cc-cancel" id="ccCancel">Keep editing</button>
 *         <button type="button" class="cc-discard" id="ccDiscard">Discard</button>
 *       </div>
 *     </div>
 *   </div>
 *
 * Behavior contract preserved:
 *
 *   - The overlay is permanently mounted; visibility flips via the
 *     `.visible` class on the root. This matches the prototype, where
 *     `closeConfirm.classList.toggle('visible', shown)` swaps display
 *     between `none` and `flex`. Keeping the DOM stable lets the fade
 *     transition (if any future sub-AC adds one) play smoothly.
 *
 *   - Backdrop click → cancel (the prototype binds this on the overlay
 *     and stops propagation inside `.cc-box`). We replicate by checking
 *     `event.target === event.currentTarget`.
 *
 *   - Escape key → cancel. The prototype handles this in a global
 *     keydown listener; we keep it scoped to the dialog so the
 *     listener self-cleans on unmount.
 *
 *   - Focus management: when shown, focus moves to the "Keep editing"
 *     button (the safe / non-destructive default). When hidden, focus
 *     returns to whatever the parent decides (typically the capture
 *     textarea — we expose `restoreFocusRef` for that, but leave the
 *     restore policy to the parent so the contract stays explicit).
 *
 * The component is fully controlled — `open` drives visibility, and the
 * parent decides what cancel/discard mean (typically: cancel keeps the
 * capture cell as-is; discard wipes the note + closes the cell).
 */

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

import { readStoredLocale, t, type SupportedLocale } from "../../lib/locales";

export interface CloseConfirmModalProps {
  /** Whether the dialog is currently visible. Drives the `.visible` class. */
  open: boolean;
  /** Fires when the user picks "Keep editing" or dismisses via Esc/backdrop. */
  onCancel: () => void;
  /** Fires when the user picks "Discard". */
  onDiscard: () => void;
  /** Override for the dialog message. Defaults to the prototype copy. */
  message?: ReactNode;
  /** Override for the cancel button label. */
  cancelLabel?: ReactNode;
  /** Override for the discard button label. */
  discardLabel?: ReactNode;
  /** Locale for built-in dialog copy. */
  locale?: SupportedLocale;
}

export function CloseConfirmModal({
  open,
  onCancel,
  onDiscard,
  message,
  cancelLabel,
  discardLabel,
  locale: localeProp,
}: CloseConfirmModalProps): JSX.Element {
  const locale = localeProp ?? readStoredLocale();
  const messageCopy = message ?? (
    <>
      {t(locale, "closeConfirmTitle")} {t(locale, "closeConfirmBody")}
    </>
  );
  const cancelCopy = cancelLabel ?? t(locale, "keepEditing");
  const discardCopy = discardLabel ?? t(locale, "discard");
  const cancelRef = useRef<HTMLButtonElement>(null);

  /**
   * When the dialog opens, move keyboard focus to the safe-default
   * "Keep editing" button. This is the same affordance the prototype
   * provided implicitly by being the first button in the DOM order.
   * Doing it explicitly here makes the behavior survive across
   * re-renders and play nicely with screen readers that announce the
   * focused control on dialog open.
   */
  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    }
  }, [open]);

  /**
   * Esc closes the dialog. Bound only while open so we don't leak a
   * global keydown listener onto unrelated pages. Listening at the
   * document level (rather than the dialog itself) matches the
   * prototype's approach and ensures the shortcut still fires when
   * focus has wandered away from the dialog buttons.
   */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  /**
   * Backdrop click → cancel. The check `target === currentTarget`
   * matches the prototype's implicit behavior: only the dimmed area
   * outside `.cc-box` dismisses; clicks inside the box do not.
   */
  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onCancel();
    }
  };

  return (
    <div
      className={`close-confirm${open ? " visible" : ""}`}
      id="closeConfirm"
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      aria-label={t(locale, "closeConfirmAria")}
      onClick={handleBackdropClick}
    >
      <div className="cc-box">
        <div className="cc-msg">{messageCopy}</div>
        <div className="cc-actions">
          <button
            ref={cancelRef}
            type="button"
            className="cc-cancel"
            id="ccCancel"
            onClick={onCancel}
          >
            {cancelCopy}
          </button>
          <button
            type="button"
            className="cc-discard"
            id="ccDiscard"
            onClick={onDiscard}
          >
            {discardCopy}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CloseConfirmModal;
