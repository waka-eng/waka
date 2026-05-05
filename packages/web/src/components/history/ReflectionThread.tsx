/**
 * <ReflectionThread /> — expandable list of question/answer reflections
 * attached to a single inspiration in the history detail view.
 *
 * Ports the prototype's "thread-toggle + thread-body" expand/collapse
 * widget (index.html lines 2667–2694) into a declarative React component
 * while preserving the exact DOM structure, class names, and event
 * behaviors so the prototype CSS (lines 861–899) — and the parity
 * rules now mirrored in `global.css` — applies 1:1.
 *
 * Prototype DOM contract:
 *
 *   <div class="thread-toggle [open]">
 *     <span class="thread-toggle-caret">›</span>
 *     <span class="thread-toggle-label">Show reflection · 3 notes</span>
 *   </div>
 *   <div class="thread-body [open]">
 *     <div class="thread-entry">
 *       <div class="thread-q">…question…</div>
 *       <div class="thread-a">…answer…</div>     <!-- or .skipped -->
 *     </div>
 *     …more entries…
 *   </div>
 *
 * The prototype's behavior (`renderDetail()` at line 2667 onward):
 *
 *   - Click on `.thread-toggle` flips `expandedItems.has(item.id)`.
 *   - The toggle adds/removes the `open` class on both the toggle and
 *     the body — the caret rotates 90° via CSS, and the body switches
 *     between `display: none` and `display: block`.
 *   - The label text alternates "Show reflection · …" / "Hide reflection · …".
 *   - Pluralization: " note" vs. " notes" depending on count.
 *   - Each `.thread-a` is click-to-edit; we accept an optional `onEntryClick`
 *     callback to preserve that affordance, but do NOT bake the textarea
 *     editor into this component (that lives one level up in the detail
 *     view, where reflection mutations are wired to the API).
 *
 * Per Sub-AC 4.3.3 the focus is on the *expand/collapse control*, plus
 * the entry list rendering — not the inline-edit flow, which is a
 * separate interactive primitive that lands when reflection mutations
 * are wired (a later sub-AC).
 */

import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useMemo,
} from "react";

/**
 * Single reflection record. Mirrors the prototype's
 * `item.reflections[i]` shape (index.html line 2690 onward).
 */
export interface ReflectionEntry {
  /** Optional id — used as React key when present, falls back to index. */
  id?: string;
  /** The question that was asked. */
  question: string;
  /**
   * The user's answer. Empty / undefined when the entry was skipped
   * (matches the prototype's `r.skipped` flag).
   */
  answer?: string | null;
  /** Whether the user skipped this question. Drives the `.skipped` modifier. */
  skipped?: boolean;
}

export interface ReflectionThreadProps {
  /** All reflections to render in the thread body. */
  entries: ReflectionEntry[];
  /** Whether the thread is currently expanded. */
  open: boolean;
  /** Fires when the user clicks the toggle to expand or collapse. */
  onToggle: () => void;
  /**
   * Optional click handler on a reflection answer cell. Wires the
   * prototype's `editAnswer()` affordance — we surface the entry index
   * and the entry itself so the parent can swap the cell with an inline
   * textarea (or open a modal, etc.) without this component having to
   * know how editing works.
   */
  onEntryClick?: (entry: ReflectionEntry, index: number) => void;
  /**
   * Optional override for the action verb in the toggle label.
   * Defaults match the prototype: "Show" when collapsed, "Hide" when open.
   */
  showVerb?: string;
  hideVerb?: string;
  /**
   * Optional placeholder copy shown on a skipped answer cell. Defaults
   * to the prototype's "skipped — click to answer" wording.
   */
  skippedPlaceholder?: string;
}

export function ReflectionThread({
  entries,
  open,
  onToggle,
  onEntryClick,
  showVerb = "Show",
  hideVerb = "Hide",
  skippedPlaceholder = "skipped — click to answer",
}: ReflectionThreadProps): JSX.Element | null {
  const count = entries.length;

  // Single-source pluralization that mirrors the prototype's
  // `(n === 1 ? ' note' : ' notes')`. Using a memo keeps the label
  // stable across renders so React doesn't churn the text node.
  // NOTE: hooks must run unconditionally; the empty-case early return
  // happens *after* the hook calls below.
  const label = useMemo(() => {
    const verb = open ? hideVerb : showVerb;
    const noun = count === 1 ? "note" : "notes";
    return `${verb} reflection · ${count} ${noun}`;
  }, [count, hideVerb, open, showVerb]);

  /**
   * Toggle is a `<div role="button">` rather than an actual `<button>`
   * because the prototype's CSS targets `.thread-toggle` directly and
   * relies on the default block layout. Switching to `<button>` resets
   * font-family/border defaults and breaks the visual cascade. We add
   * `role="button"` + `tabIndex={0}` + key handlers so the affordance
   * is still keyboard-activatable.
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onToggle();
      }
    },
    [onToggle],
  );

  // Match prototype: hide entirely when there are no reflections. The
  // calling site's `renderDeepenAffordance()` handles the empty case
  // separately, so returning null here keeps the contract explicit.
  if (count === 0) return null;

  return (
    <>
      <div
        className={`thread-toggle${open ? " open" : ""}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
      >
        <span className="thread-toggle-caret">›</span>
        <span className="thread-toggle-label">{label}</span>
      </div>
      <div className={`thread-body${open ? " open" : ""}`}>
        {entries.map((entry, index) => {
          const handleEntryClick = (
            event: MouseEvent<HTMLDivElement>,
          ): void => {
            // Stop the bubble so the parent `.history-item` (if mounted
            // inside one) doesn't also fire its own click handler.
            event.stopPropagation();
            onEntryClick?.(entry, index);
          };

          const answerText =
            entry.skipped || !entry.answer ? skippedPlaceholder : entry.answer;
          const answerClass = `thread-a${entry.skipped ? " skipped" : ""}`;

          return (
            <div className="thread-entry" key={entry.id ?? index}>
              <div className="thread-q">{entry.question}</div>
              <div
                className={answerClass}
                onClick={onEntryClick ? handleEntryClick : undefined}
                role={onEntryClick ? "button" : undefined}
                tabIndex={onEntryClick ? 0 : undefined}
                onKeyDown={
                  onEntryClick
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onEntryClick(entry, index);
                        }
                      }
                    : undefined
                }
              >
                {answerText}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default ReflectionThread;
