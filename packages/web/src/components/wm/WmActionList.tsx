/**
 * <WmActionList /> — vertical filter-style list of actions the user can
 * take on a wow-moment cluster (Write, Discuss, Attach, Find related,
 * Share). Selecting one routes to that action's workspace.
 *
 * Ports the prototype's `#wmActionList` markup (index.html lines 2228–2244)
 * and its companion CSS (lines 1719–1748) into a declarative React
 * component while preserving the exact DOM structure, class names, and
 * event behaviors so the prototype CSS — and the parity rules now
 * mirrored in `global.css` — apply 1:1.
 *
 * Prototype DOM contract:
 *
 *   <div class="wm-action-list [action-selected]" id="wmActionList">
 *     <button class="wm-action-item [selected]" data-act="write">
 *       <span>Expand on this — write about it</span><span class="arrow">→</span>
 *     </button>
 *     …4 more buttons…
 *   </div>
 *
 * Behavior contract:
 *
 *   - Each `.wm-action-item` is a clickable filter chip-style button.
 *     Hover slides the row 6px right and brightens the arrow (CSS).
 *   - Selecting one fires `onSelect(action)` and adds the `selected`
 *     modifier to that row. The prototype also adds `action-selected`
 *     to the list root which CSS uses to hide the entire list when an
 *     action's workspace is open. We mirror via the `actionSelected`
 *     prop so the parent owns the open/closed state.
 *
 * The component is generic — callers pass their own `actions` array
 * so the same widget can be reused for other vertical filter lists in
 * future surfaces. For backward compatibility with the prototype's
 * five actions, we export `DEFAULT_WM_ACTIONS` matching the prototype
 * verbatim.
 */

import type { ReactNode } from "react";

export interface WmAction {
  /** Stable machine value persisted via `data-act`. */
  value: string;
  /** Visible label rendered inside the action's text span. */
  label: ReactNode;
  /** Optional override for the trailing arrow glyph. Defaults to "→". */
  arrow?: ReactNode;
}

/**
 * Default actions matching the prototype's five wow-moment options.
 * Exported so consumers don't have to redeclare the canonical set.
 */
export const DEFAULT_WM_ACTIONS: ReadonlyArray<WmAction> = [
  { value: "write", label: "Expand on this — write about it" },
  { value: "discuss", label: "Talk it out with the agent" },
  { value: "attach", label: "Attach a link, draft, or essay" },
  { value: "related", label: "Find related saves across your inspirations" },
  { value: "share", label: "Share this tile" },
];

export interface WmActionListProps {
  /** Actions to render. Defaults to `DEFAULT_WM_ACTIONS`. */
  actions?: ReadonlyArray<WmAction>;
  /**
   * Currently selected action's value, if any. Drives the `.selected`
   * modifier on the matching button and the `.action-selected` modifier
   * on the list root. Pass `null` / `undefined` when no action is
   * selected (the default state).
   */
  selected?: string | null;
  /** Fires when the user clicks an action button. */
  onSelect: (value: string) => void;
}

export function WmActionList({
  actions = DEFAULT_WM_ACTIONS,
  selected,
  onSelect,
}: WmActionListProps): JSX.Element {
  const rootClass = `wm-action-list${selected ? " action-selected" : ""}`;

  return (
    <div className={rootClass} id="wmActionList">
      {actions.map((action) => {
        const isSelected = action.value === selected;
        const itemClass = `wm-action-item${isSelected ? " selected" : ""}`;
        return (
          <button
            key={action.value}
            type="button"
            className={itemClass}
            data-act={action.value}
            aria-pressed={isSelected}
            onClick={() => onSelect(action.value)}
          >
            <span>{action.label}</span>
            <span className="arrow">{action.arrow ?? "→"}</span>
          </button>
        );
      })}
    </div>
  );
}

export default WmActionList;
