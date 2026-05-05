/**
 * <HitlMenu /> — human-in-the-loop dropdown filter that lets the user
 * tag whether a wow-moment "lands", "doesn't land", or is "unclear".
 *
 * Ports the prototype's `#wmHitl` widget (index.html lines 2202–2210) and
 * its companion CSS (lines 1662–1693) into a declarative React component
 * while preserving the exact DOM structure, class names, and event
 * behaviors so the prototype CSS — and the parity rules now mirrored in
 * `global.css` — apply 1:1.
 *
 * Prototype DOM contract:
 *
 *   <div class="wm-overlay-hitl" id="wmHitl">
 *     <button class="hitl-trigger" id="hitlTrigger">···</button>
 *     <div class="hitl-menu [open]" id="hitlMenu">
 *       <button class="hitl-option" data-val="lands">lands</button>
 *       <button class="hitl-option" data-val="doesnt_land">doesn't land</button>
 *       <button class="hitl-option" data-val="unclear">unclear</button>
 *     </div>
 *     <span class="hitl-chosen" id="hitlChosen">{label}</span>
 *   </div>
 *
 * Behavior contract:
 *
 *   - Trigger click toggles the menu via the `.open` class on
 *     `.hitl-menu`. CSS in the prototype switches `display: none` to
 *     `display: block` based on that class. We mirror by accepting a
 *     controlled `open` prop so the parent owns the open/closed state.
 *
 *   - Selecting an option fires `onSelect(value)` and (per the
 *     prototype) auto-closes the menu — the caller usually wants both,
 *     so we expose `onClose` and call it from `onSelect` to keep the
 *     contract honest. If callers need a different policy they can
 *     pass `closeOnSelect={false}`.
 *
 *   - Clicking outside the widget closes it. The prototype handles this
 *     in a global click listener; we replicate by binding a `mousedown`
 *     listener on `document` while the menu is open and self-cleaning
 *     on close / unmount.
 *
 *   - Esc closes the menu.
 *
 * The component is intentionally generic: it doesn't bake in the three
 * prototype options. Callers pass their own `options` array so the same
 * widget can be reused for other dropdown filters in future surfaces
 * (e.g. cluster-kind filter on the history drawer). For backward
 * compatibility with the prototype's three options we export a
 * `DEFAULT_HITL_OPTIONS` constant.
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";

export interface HitlOption {
  /**
   * Stable machine value persisted via `data-val` and surfaced through
   * `onSelect`. Mirrors the prototype's `data-val="lands"` etc.
   */
  value: string;
  /** Visible label rendered inside the option button. */
  label: ReactNode;
}

/**
 * Default options matching the prototype's three HITL labels. Exported
 * so consumers don't have to redeclare the canonical set.
 */
export const DEFAULT_HITL_OPTIONS: ReadonlyArray<HitlOption> = [
  { value: "lands", label: "lands" },
  { value: "doesnt_land", label: "doesn't land" },
  { value: "unclear", label: "unclear" },
];

export interface HitlMenuProps {
  /** Whether the menu dropdown is currently open. */
  open: boolean;
  /** Fires when the user clicks the trigger to flip open/closed state. */
  onToggle: () => void;
  /** Fires when the menu should close (Esc, outside click, option pick). */
  onClose: () => void;
  /** Fires when the user picks an option. Receives the option's `value`. */
  onSelect: (value: string) => void;
  /**
   * Currently selected option's *label* (for display in `.hitl-chosen`).
   * The prototype renders this verbatim — we accept a `ReactNode` to
   * match. Pass `null` / `undefined` for "no choice yet".
   */
  chosenLabel?: ReactNode;
  /** Trigger label / glyph. Defaults to the prototype's `···`. */
  triggerLabel?: ReactNode;
  /** Options to render. Defaults to `DEFAULT_HITL_OPTIONS`. */
  options?: ReadonlyArray<HitlOption>;
  /**
   * If true (the default), picking an option calls `onClose` after
   * `onSelect`. Set false to keep the menu open after selection.
   */
  closeOnSelect?: boolean;
}

export function HitlMenu({
  open,
  onToggle,
  onClose,
  onSelect,
  chosenLabel,
  triggerLabel = "···",
  options = DEFAULT_HITL_OPTIONS,
  closeOnSelect = true,
}: HitlMenuProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * Outside-click → close. Bound only while the menu is open. We listen
   * to `mousedown` (rather than `click`) so the menu closes on the
   * press, not the release — this matches the platform behavior of
   * native popovers and avoids the half-second window where a
   * fast-clicker can double-fire the trigger.
   */
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (!root) return;
      if (!(event.target instanceof Node)) return;
      if (root.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, onClose]);

  /** Esc closes. Same lifecycle as the outside-click listener. */
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleSelect = useCallback(
    (value: string) => {
      onSelect(value);
      if (closeOnSelect) onClose();
    },
    [onSelect, onClose, closeOnSelect],
  );

  return (
    <div
      ref={rootRef}
      className="wm-overlay-hitl"
      id="wmHitl"
    >
      <button
        type="button"
        className="hitl-trigger"
        id="hitlTrigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        {triggerLabel}
      </button>
      <div
        className={`hitl-menu${open ? " open" : ""}`}
        id="hitlMenu"
        role="menu"
        aria-hidden={!open}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="hitl-option"
            data-val={option.value}
            role="menuitem"
            onClick={() => handleSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {chosenLabel != null && chosenLabel !== "" ? (
        <span className="hitl-chosen" id="hitlChosen">
          {chosenLabel}
        </span>
      ) : (
        // Keep the span in the DOM even when empty so the layout
        // (which the prototype assumes) stays stable. The prototype
        // also leaves `.hitl-chosen` mounted with empty text.
        <span className="hitl-chosen" id="hitlChosen" />
      )}
    </div>
  );
}

export default HitlMenu;
